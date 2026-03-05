'use client'

import { useRef, useState, useEffect, useCallback } from 'react'
import ePub from 'epubjs'

const DB_NAME = 'cinematic-epub-db'
const DB_VERSION = 1
const STORE_NAME = 'books'
const CURRENT_BOOK_KEY = 'current-book'

type ThemeMode = 'cinematic-dark' | 'classic-sepia'

type DirectorInfo = {
  title: string
  author: string
  previewText: string
  logline: string
}

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

function generateLogline(text: string): string {
  // Placeholder for AI integration (Gemini / OpenAI)
  // You can replace this implementation with an API call that returns a 1-sentence movie-style logline.
  if (!text) return 'Director\'s logline will appear here once generated.'

  const snippet = text.split(/\s+/).slice(0, 40).join(' ')
  return `A cinematic journey teased by: "${snippet}..." (replace with AI-generated logline)`
}

function applyThemeStyles(rendition: any, theme: ThemeMode) {
  if (!rendition) return

  if (theme === 'cinematic-dark') {
    rendition.themes.default({
      body: {
        'font-family': "Georgia, 'Times New Roman', serif",
        'font-size': '18px',
        'line-height': '1.9',
        'letter-spacing': '0.4px',
        color: '#f5f5f5',
        'background-color': '#050509',
      },
      p: {
        'margin-bottom': '1.3em',
      },
      a: {
        color: '#9b87ff',
        'text-decoration': 'none',
      },
    })
  } else {
    rendition.themes.default({
      body: {
        'font-family': "Georgia, 'Times New Roman', serif",
        'font-size': '18px',
        'line-height': '1.8',
        'letter-spacing': '0.3px',
        color: '#3b2f2f',
        'background-color': '#f4f1ea',
      },
      p: {
        'margin-bottom': '1.2em',
      },
      a: {
        color: '#6b4b2f',
        'text-decoration': 'none',
      },
    })
  }
}

function DirectorSummary({ info }: { info: DirectorInfo }) {
  return (
    <aside className="w-full md:w-80 lg:w-96 mt-8 md:mt-0 md:ml-8 text-sm text-neutral-100/90">
      <div className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur-sm p-5 space-y-3">
        <div className="text-xs uppercase tracking-[0.22em] text-white/70">
          Director&apos;s Cut
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-[0.18em] text-white/50">
            Title
          </div>
          <div className="mt-1 text-base font-medium text-white">
            {info.title || 'Unknown Title'}
          </div>
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-[0.18em] text-white/50">
            Author
          </div>
          <div className="mt-1 text-[13px] text-white/80">
            {info.author || 'Unknown Author'}
          </div>
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-[0.18em] text-white/50 mb-1">
            Movie Pitch
          </div>
          <p className="text-[13px] leading-relaxed text-white/90">
            {info.logline}
          </p>
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-[0.18em] text-white/50 mb-1">
            Opening Pages
          </div>
          <p className="text-[12px] leading-relaxed text-white/80 line-clamp-[10]">
            {info.previewText}
          </p>
        </div>
      </div>
    </aside>
  )
}

export default function Home() {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const viewerRef = useRef<HTMLDivElement>(null)

  const bookRef = useRef<any | null>(null)
  const renditionRef = useRef<any | null>(null)
  const keyHandlerRef = useRef<((e: KeyboardEvent) => void) | null>(null)
  const touchStartXRef = useRef<number | null>(null)

  const [bookFile, setBookFile] = useState<File | null>(null)
  const [progress, setProgress] = useState(0)
  const [theme, setTheme] = useState<ThemeMode>(() => {
    if (typeof window === 'undefined') return 'cinematic-dark'
    const stored = window.localStorage.getItem('reader-theme') as ThemeMode | null
    return stored || 'cinematic-dark'
  })
  const [directorInfo, setDirectorInfo] = useState<DirectorInfo | null>(null)

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
  
    // reset previous reading location
    localStorage.removeItem("epub-location")
    setDirectorInfo(null)
    setBookFile(file)
  
    // save EPUB to IndexedDB
    const reader = new FileReader()
  
    reader.onload = async () => {
      const buffer = reader.result as ArrayBuffer
      try {
        await saveBookBuffer(buffer)
      } catch (err) {
        console.error("Failed to persist book in IndexedDB", err)
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
    let cancelled = false

    reader.onload = (e) => {
      if (cancelled) return

      const arrayBuffer = e.target?.result as ArrayBuffer

      const book = ePub(arrayBuffer)
      bookRef.current = book

      const spreadMode =
        typeof window !== 'undefined' && window.innerWidth < 768 ? 'none' : 'auto'

      const rendition = book.renderTo(viewerRef.current!, {
        width: '100%',
        height: '100%',
        flow: 'paginated',
        spread: spreadMode,
        snap: true,
      })
      renditionRef.current = rendition

      book.ready.then(async () => {
        if (cancelled) return

        const savedLocation = localStorage.getItem("epub-location")

        try {
          if (savedLocation) {
            await rendition.display(savedLocation)
          } else {
            await rendition.display()
          }
        } catch {
          await rendition.display()
        }

        applyThemeStyles(rendition, theme)

        // Extract metadata + opening text for DirectorSummary
        try {
          const metadata = await (book.loaded as any).metadata
          const title = metadata?.title || 'Unknown Title'
          const author = metadata?.creator || metadata?.author || 'Unknown Author'

          let previewText = ''
          const firstSection = (book.spine as any)?.get?.(0)
          if (firstSection && typeof firstSection.load === 'function') {
            const doc = await firstSection.load(book.load.bind(book))
            const textContent =
              (doc?.documentElement?.textContent as string | null) ||
              (doc?.body?.textContent as string | null) ||
              ''
            const words = textContent.trim().split(/\s+/)
            previewText = words.slice(0, 500).join(' ')

            if (typeof firstSection.unload === 'function') {
              firstSection.unload()
            }
          }

          setDirectorInfo({
            title,
            author,
            previewText,
            logline: generateLogline(previewText || `${title} by ${author}`),
          })
        } catch {
          // best-effort only; ignore failures
        }
      })

      rendition.on("rendered", () => {
        if (!cancelled) {
          viewerRef.current?.classList.add("opacity-100")
        }
      })

      rendition.on("relocated", (location: any) => {
        const percent = location.start.percentage || 0
        setProgress(Math.floor(percent * 100))

        const cfi = location.start.cfi
        localStorage.setItem("epub-location", cfi)
      })

      const handleKey = (e: KeyboardEvent) => {
        if (!renditionRef.current) return

        if (e.key === "ArrowRight" || e.key === "ArrowDown") {
          e.preventDefault()
          renditionRef.current.next()
        } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
          e.preventDefault()
          renditionRef.current.prev()
        } else if (e.key === "PageDown" || (e.key === " " && !e.shiftKey)) {
          e.preventDefault()
          renditionRef.current.next()
        } else if (e.key === "PageUp" || (e.key === " " && e.shiftKey)) {
          e.preventDefault()
          renditionRef.current.prev()
        } else if (e.key === "Home") {
          e.preventDefault()
          renditionRef.current.display()
        } else if (e.key === "End" && bookRef.current) {
          e.preventDefault()
          try {
            const last = (bookRef.current.spine as any)?.last?.()
            if (last?.href) {
              renditionRef.current.display(last.href)
            } else {
              renditionRef.current.display()
            }
          } catch {
            renditionRef.current.display()
          }
        }
      }

      keyHandlerRef.current = handleKey
      document.addEventListener("keydown", handleKey)

      const viewerEl = viewerRef.current
      if (viewerEl) {
        const handleTouchStart = (evt: TouchEvent) => {
          if (evt.touches && evt.touches.length > 0) {
            touchStartXRef.current = evt.touches[0].clientX
          }
        }

        const handleTouchEnd = (evt: TouchEvent) => {
          if (touchStartXRef.current == null) return
          if (!renditionRef.current) return

          const endX = evt.changedTouches[0].clientX
          const deltaX = endX - touchStartXRef.current

          const threshold = 40
          if (Math.abs(deltaX) > threshold) {
            if (deltaX < 0) {
              renditionRef.current.next()
            } else {
              renditionRef.current.prev()
            }
          }

          touchStartXRef.current = null
        }

        viewerEl.addEventListener('touchstart', handleTouchStart, { passive: true })
        viewerEl.addEventListener('touchend', handleTouchEnd)

        // Best-effort wiring into rendition events as well
        try {
          rendition.on('touchstart', handleTouchStart as any)
          rendition.on('touchend', handleTouchEnd as any)
        } catch {
          // ignore if not supported
        }

        // cleanup for these listeners
        const cleanupDomTouch = () => {
          viewerEl.removeEventListener('touchstart', handleTouchStart)
          viewerEl.removeEventListener('touchend', handleTouchEnd)
        }

        // Attach a small hook on rendition destroy to ensure removal
        const originalDestroy = rendition.destroy.bind(rendition)
        rendition.destroy = () => {
          cleanupDomTouch()
          originalDestroy()
        }
      }
    }

    reader.readAsArrayBuffer(bookFile)

    return () => {
      cancelled = true
      cleanupRendition()
    }

  }, [bookFile, cleanupRendition, theme])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem('reader-theme', theme)
    if (renditionRef.current) {
      applyThemeStyles(renditionRef.current, theme)
    }
  }, [theme])

  const toggleTheme = () => {
    setTheme((prev) =>
      prev === 'cinematic-dark' ? 'classic-sepia' : 'cinematic-dark',
    )
  }

  return (
    <main className="min-h-screen bg-[#050509] bg-[radial-gradient(circle_at_top,_rgba(40,40,52,0.7)_0,_#050509_55%,_#000_100%)] text-white">
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
        <div className="min-h-screen w-full flex flex-col items-center justify-center px-4 py-8 md:px-8 md:py-12 relative">
          {/* Floating Theme Toggle */}
          <button
            onClick={toggleTheme}
            className="fixed top-4 right-4 z-30 rounded-full border border-white/20 bg-black/40 px-4 py-2 text-xs font-medium uppercase tracking-[0.18em] text-white/80 backdrop-blur-md hover:bg-white/10 transition"
          >
            {theme === 'cinematic-dark' ? 'Classic Sepia' : 'Cinematic Dark'}
          </button>

          <div className="relative w-full max-w-6xl flex flex-col md:flex-row items-stretch justify-center md:items-start md:justify-between gap-6 md:gap-10">
            {/* Book Card */}
            <div
              className={
                theme === 'cinematic-dark'
                  ? 'relative flex-1 min-w-0 bg-[#050509] rounded-3xl shadow-[0_40px_140px_rgba(0,0,0,0.9)] overflow-hidden border border-white/10'
                  : 'relative flex-1 min-w-0 bg-[#f4f1ea] rounded-3xl shadow-[0_40px_140px_rgba(0,0,0,0.75)] overflow-hidden border border-black/5'
              }
            >
              {/* Outer Vignette over the page */}
              <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_55%,rgba(0,0,0,0.6))]" />

              {/* Tap Zones */}
              <button
                type="button"
                aria-label="Previous page"
                className="absolute inset-y-0 left-0 w-[18%] z-20 bg-gradient-to-r from-black/10 via-transparent to-transparent opacity-0 hover:opacity-40 transition-opacity md:opacity-0 md:hover:opacity-25"
                onClick={() => renditionRef.current?.prev()}
              />
              <button
                type="button"
                aria-label="Next page"
                className="absolute inset-y-0 right-0 w-[18%] z-20 bg-gradient-to-l from-black/10 via-transparent to-transparent opacity-0 hover:opacity-40 transition-opacity md:opacity-0 md:hover:opacity-25"
                onClick={() => renditionRef.current?.next()}
              />

              {/* Viewer */}
              <div
                ref={viewerRef}
                className="relative h-[78vh] md:h-[82vh] w-full px-5 sm:px-8 md:px-14 py-10 md:py-14 text-[18px] leading-relaxed transition-opacity duration-500 ease-out opacity-0 overflow-hidden"
              />

              {/* Progress Bar pinned to paper bottom */}
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1.5 bg-black/20 dark:bg-white/10">
                <div
                  className="h-full bg-gradient-to-r from-emerald-400 via-sky-400 to-violet-400 transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>

            {directorInfo && <DirectorSummary info={directorInfo} />}
          </div>
        </div>
      )}
    </main>
  )
}