'use client'

import { useRef, useState, useEffect, useCallback } from 'react'
import ePub from 'epubjs'

const DB_NAME = 'cinematic-epub-db'
const DB_VERSION = 1
const STORE_NAME = 'books'
const CURRENT_BOOK_KEY = 'current-book'

const isBrowser = () =>
  typeof window !== 'undefined' && typeof window.indexedDB !== 'undefined'

function openBookDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!isBrowser()) {
      reject(new Error('IndexedDB is not available'))
      return
    }

    const request = window.indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME)
      }
    }

    request.onsuccess = () => {
      resolve(request.result)
    }

    request.onerror = () => {
      reject(request.error || new Error('Failed to open IndexedDB'))
    }
  })
}

async function saveBookBuffer(buffer: ArrayBuffer) {
  if (!isBrowser()) return
  const db = await openBookDB()

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    const req = store.put(buffer, CURRENT_BOOK_KEY)

    req.onsuccess = () => resolve()
    req.onerror = () =>
      reject(req.error || new Error('Failed to save book to IndexedDB'))
  })

  db.close()
}

async function loadBookBuffer(): Promise<ArrayBuffer | null> {
  if (!isBrowser()) return null
  const db = await openBookDB()

  const result = await new Promise<ArrayBuffer | null>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const store = tx.objectStore(STORE_NAME)
    const req = store.get(CURRENT_BOOK_KEY)

    req.onsuccess = () => {
      resolve((req.result as ArrayBuffer) || null)
    }
    req.onerror = () =>
      reject(req.error || new Error('Failed to load book from IndexedDB'))
  })

  db.close()
  return result
}

export default function Home() {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const viewerRef = useRef<HTMLDivElement>(null)

  const bookRef = useRef<any | null>(null)
  const renditionRef = useRef<any | null>(null)
  const keyHandlerRef = useRef<((e: KeyboardEvent) => void) | null>(null)

  const [bookFile, setBookFile] = useState<File | null>(null)
  const [progress, setProgress] = useState(0)

  const cleanupRendition = useCallback(() => {
    if (keyHandlerRef.current) {
      document.removeEventListener('keydown', keyHandlerRef.current)
      keyHandlerRef.current = null
    }

    if (renditionRef.current) {
      try {
        renditionRef.current.destroy()
      } catch {
        // ignore
      }
      renditionRef.current = null
    }

    if (bookRef.current) {
      try {
        bookRef.current.destroy()
      } catch {
        // ignore
      }
      bookRef.current = null
    }

    if (viewerRef.current) {
      viewerRef.current.innerHTML = ''
      viewerRef.current.classList.remove('opacity-100')
    }
  }, [])

  const handleClick = () => {
    fileInputRef.current?.click()
  }

  const handleFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

     cleanupRendition()

    setBookFile(file)

    const reader = new FileReader()
    reader.onload = async () => {
      const buffer = reader.result as ArrayBuffer
      try {
        await saveBookBuffer(buffer)
      } catch (err) {
        console.error('Failed to persist book in IndexedDB', err)
      }
    }
    reader.readAsArrayBuffer(file)
  }
  
  useEffect(() => {
    let cancelled = false

    const restoreBook = async () => {
      try {
        const buffer = await loadBookBuffer()
        if (!buffer || cancelled) return

        const file = new File([buffer], 'saved.epub', {
          type: 'application/epub+zip',
        })
        setBookFile(file)
      } catch (err) {
        console.error('Failed to restore book from IndexedDB', err)
      }
    }

    restoreBook()

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!bookFile || !viewerRef.current) return

    const reader = new FileReader()

    reader.onload = (e) => {
      const arrayBuffer = e.target?.result as ArrayBuffer

      const book = ePub(arrayBuffer)
      bookRef.current = book

      const rendition = book.renderTo(viewerRef.current!, {
        width: '100%',
        height: '100%',
        flow: 'paginated',
        spread: 'auto',
        snap: true,
      })
      renditionRef.current = rendition

      book.ready.then(() => {
        const savedLocation = localStorage.getItem("epub-location")

if (savedLocation) {
  rendition.display(savedLocation)
} else {
  rendition.display()
}

        rendition.themes.default({
          body: {
            "font-family": "Georgia, 'Times New Roman', serif",
            "font-size": "18px",
            "line-height": "1.8",
            "letter-spacing": "0.3px",
            "color": "#1a1a1a"
          },
          p: {
            "margin-bottom": "1.2em"
          },
          a: {
            "color": "#2c2c2c",
            "text-decoration": "none"
          }
        })
      })

      rendition.on("rendered", () => {
        viewerRef.current?.classList.add("opacity-100")
      })

      rendition.on("relocated", (location: any) => {
        const percent = location.start.percentage || 0
        setProgress(Math.floor(percent * 100))

        const cfi = location.start.cfi
        localStorage.setItem("epub-location", cfi)
      })

      const handleKey = (e: KeyboardEvent) => {
        if (e.key === "ArrowRight") rendition.next()
        if (e.key === "ArrowLeft") rendition.prev()
      }

      keyHandlerRef.current = handleKey
      document.addEventListener("keydown", handleKey)
    }

    reader.readAsArrayBuffer(bookFile)

    return () => {
      cleanupRendition()
    }

  }, [bookFile, cleanupRendition])

  return (
    <main className="min-h-screen bg-neutral-100">
      {!bookFile ? (
        <div className="flex items-center justify-center min-h-screen">
          <div className="w-[420px] rounded-3xl bg-white shadow-xl p-10 text-center">
            <h1 className="text-3xl font-light tracking-tight">
              Document Reader
            </h1>

            <p className="mt-3 text-neutral-500 text-sm">
              Upload your EPUB file to start reading.
            </p>

            <button
              onClick={handleClick}
              className="mt-8 w-full rounded-2xl bg-black text-white py-3 text-sm tracking-wide hover:opacity-90 transition"
            >
              Upload EPUB
            </button>

            <input
              type="file"
              accept=".epub"
              ref={fileInputRef}
              onChange={handleFile}
              className="hidden"
            />
          </div>
        </div>
      ) : (
        <div className="min-h-screen w-full bg-[#0f0f12] flex items-center justify-center px-6 py-10 relative">

          {/* Progress Bar */}
          <div className="absolute top-0 left-0 w-full h-1 bg-white/10">
            <div
              className="h-full bg-white transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>

          {/* Book Card */}
          <div className="relative w-full max-w-5xl bg-[#f4f1ea] rounded-2xl shadow-[0_40px_120px_rgba(0,0,0,0.6)] overflow-hidden">

            {/* Vignette */}
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_60%,rgba(0,0,0,0.25))]" />

            {/* Viewer */}
            <div
              ref={viewerRef}
              className="h-[85vh] w-full px-16 py-14 text-[18px] leading-relaxed transition-all duration-700 ease-in-out opacity-0 overflow-hidden"
            />

          </div>
        </div>
      )}
    </main>
  )
}