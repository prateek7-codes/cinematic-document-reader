'use client'

import { useRef, useState, useEffect, useCallback } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import ePub from 'epubjs'

const DB_NAME = 'cinematic-epub-db'
const DB_VERSION = 1
const STORE_NAME = 'books'
const CURRENT_BOOK_KEY = 'current-book'

type ThemeMode = 'cinematic-dark' | 'classic-sepia'

type DirectorInfo = {
  title: string
  author: string
  description?: string
}

type ChapterItem = {
  label: string
  href: string
}

type Bookmark = {
  cfi: string
  chapterTitle: string
  preview: string
}

const BOOKMARKS_KEY = 'epub-bookmarks'

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
        color: '#3B2F2F',
        'background-color': '#F4ECD8',
      },
      p: {
        'margin-bottom': '1.2em',
      },
      a: {
        color: '#8C6B4F',
        'text-decoration': 'none',
      },
    })
  }
}

export default function Home() {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const viewerRef = useRef<HTMLDivElement>(null)
  const readerShellRef = useRef<HTMLDivElement>(null)

  const bookRef = useRef<any | null>(null)
  const renditionRef = useRef<any | null>(null)
  const keyHandlerRef = useRef<((e: KeyboardEvent) => void) | null>(null)
  const touchStartXRef = useRef<number | null>(null)
  const currentLocationRef = useRef<string | null>(null)
  const lastLocationRef = useRef<any | null>(null)

  const [bookFile, setBookFile] = useState<File | null>(null)
  const [progress, setProgress] = useState(0)
  const [currentLocation, setCurrentLocation] = useState<string | null>(null)
  const [spreadMode, setSpreadMode] = useState<'none' | 'always'>(() => {
    if (typeof window === 'undefined') return 'none'
    return window.innerWidth >= 768 ? 'always' : 'none'
  })
  const [theme, setTheme] = useState<ThemeMode>(() => {
    if (typeof window === 'undefined') return 'cinematic-dark'
    const stored = window.localStorage.getItem('reader-theme') as ThemeMode | null
    return stored || 'cinematic-dark'
  })
  const [directorInfo, setDirectorInfo] = useState<DirectorInfo | null>(null)
  const [isReaderMode, setIsReaderMode] = useState(false)
  const [bookmarks, setBookmarks] = useState<Bookmark[]>(() => {
    if (typeof window === 'undefined') return []
    try {
      const raw = window.localStorage.getItem(BOOKMARKS_KEY)
      if (!raw) return []
      const parsed = JSON.parse(raw)
      if (!Array.isArray(parsed)) return []
      // migrate from old string-only bookmarks if needed
      if (parsed.length > 0 && typeof parsed[0] === 'string') {
        return (parsed as string[]).map((cfi) => ({
          cfi,
          chapterTitle: 'Bookmark',
          preview: '',
        }))
      }
      return parsed as Bookmark[]
    } catch {
      return []
    }
  })
  const [chapters, setChapters] = useState<ChapterItem[]>([])
  const [showBookmarksPanel, setShowBookmarksPanel] = useState(false)
  const [showInfoPanel, setShowInfoPanel] = useState(false)
  const [isUiVisible, setIsUiVisible] = useState(true)
  const uiHideTimeoutRef = useRef<number | null>(null)

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

    currentLocationRef.current = null
    setProgress(0)
  }, [])

  const handleClick = () => {
    fileInputRef.current?.click()
  }

  const handleFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
  
    cleanupRendition()
  
    // reset previous reading location and UI state
    localStorage.removeItem("epub-location")
    setProgress(0)
    setBookmarks([])
    setChapters([])
    window.localStorage.removeItem(BOOKMARKS_KEY)
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

      const isMobile =
        typeof window !== 'undefined' && window.innerWidth < 768
      const effectiveSpread = isMobile ? 'none' : spreadMode

      const rendition = book.renderTo(viewerRef.current!, {
        width: '100%',
        height: '100%',
        flow: 'paginated',
        spread: effectiveSpread,
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

        // Capture chapters/TOC
        try {
          const nav = (book as any).navigation
          const toc = (nav && Array.isArray(nav.toc) ? nav.toc : []) as any[]
          const mapped: ChapterItem[] = toc
            .filter((item) => item && item.href)
            .map((item) => ({
              label: item.label || item.id || 'Chapter',
              href: item.href,
            }))
          setChapters(mapped)
        } catch {
          setChapters([])
        }

        // Extract metadata for Book Info
        try {
          const metadata = await (book.loaded as any).metadata
          const title = metadata?.title || 'Unknown Title'
          const author = metadata?.creator || metadata?.author || 'Unknown Author'
          const description =
            metadata?.description ||
            metadata?.subtitle ||
            undefined

          setDirectorInfo({
            title,
            author,
            description,
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
        currentLocationRef.current = cfi
        lastLocationRef.current = location
        setCurrentLocation(cfi)
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

  const toggleSpreadMode = () => {
    setSpreadMode((prev) => (prev === 'none' ? 'always' : 'none'))
    // Live update if rendition is active and not on mobile
    if (
      renditionRef.current &&
      typeof window !== 'undefined' &&
      window.innerWidth >= 768
    ) {
      const next = spreadMode === 'none' ? 'always' : 'none'
      try {
        renditionRef.current.spread(next)
      } catch {
        // ignore
      }
    }
  }

  const toggleReaderMode = () => {
    setIsReaderMode((prev) => {
      const next = !prev
      if (next) {
        setShowInfoPanel(false)
        setIsUiVisible(false)
      } else {
        setIsUiVisible(true)
      }
      return next
    })
  }

  const toggleFullscreen = async () => {
    if (typeof document === 'undefined') return

    try {
      if (!document.fullscreenElement) {
        if (readerShellRef.current?.requestFullscreen) {
          await readerShellRef.current.requestFullscreen()
        }
      } else if (document.exitFullscreen) {
        await document.exitFullscreen()
      }
    } catch {
      // ignore failures
    }
  }

  const persistBookmarks = (next: Bookmark[]) => {
    setBookmarks(next)
    try {
      window.localStorage.setItem(BOOKMARKS_KEY, JSON.stringify(next))
    } catch {
      // ignore
    }
  }

  const addBookmark = async () => {
    const cfi = currentLocationRef.current
    if (!cfi) return
    if (bookmarks.some((b) => b.cfi === cfi)) return

    let chapterTitle = 'Bookmark'
    let preview = ''

    try {
      const loc = lastLocationRef.current
      const href: string | undefined = loc?.start?.href
      if (href && chapters.length > 0) {
        const match = chapters.find((ch) =>
          href.endsWith(ch.href),
        )
        if (match) {
          chapterTitle = match.label
        }
      }

      const anyBook = bookRef.current as any
      if (anyBook && typeof anyBook.getRange === 'function') {
        const range = await anyBook.getRange(cfi)
        const text = range?.toString?.() || ''
        if (text) {
          const words = text.trim().split(/\s+/)
          preview = words.slice(0, 18).join(' ')
        }
      }
    } catch {
      // best-effort; ignore failures
    }

    const next: Bookmark[] = [
      ...bookmarks,
      {
        cfi,
        chapterTitle,
        preview,
      },
    ]
    persistBookmarks(next)
  }

  const jumpToBookmark = (cfi: string) => {
    if (!renditionRef.current) return
    try {
      renditionRef.current.display(cfi)
    } catch {
      // ignore
    }
  }

  const jumpToChapter = (href: string) => {
    if (!renditionRef.current) return
    try {
      renditionRef.current.display(href)
    } catch {
      // ignore
    }
  }

  // Ghost UI: hide chrome (toolbar + progress bar) after inactivity in Reader Mode
  useEffect(() => {
    if (typeof window === 'undefined') return

    if (!isReaderMode) {
      setIsUiVisible(true)
      if (uiHideTimeoutRef.current) {
        window.clearTimeout(uiHideTimeoutRef.current)
        uiHideTimeoutRef.current = null
      }
      return
    }

    const resetUiTimer = () => {
      setIsUiVisible(true)
      if (uiHideTimeoutRef.current) {
        window.clearTimeout(uiHideTimeoutRef.current)
      }
      uiHideTimeoutRef.current = window.setTimeout(() => {
        setIsUiVisible(false)
      }, 3000)
    }

    resetUiTimer()

    const events: (keyof DocumentEventMap)[] = [
      'mousemove',
      'mousedown',
      'keydown',
      'touchstart',
    ]

    events.forEach((evt) => {
      window.addEventListener(evt, resetUiTimer, { passive: true } as any)
    })

    return () => {
      if (uiHideTimeoutRef.current) {
        window.clearTimeout(uiHideTimeoutRef.current)
        uiHideTimeoutRef.current = null
      }
      events.forEach((evt) => {
        window.removeEventListener(evt, resetUiTimer as any)
      })
    }
  }, [isReaderMode])

  const uiChromeVisible = !isReaderMode || isUiVisible

  return (
    <main
      className={
        theme === 'cinematic-dark'
          ? 'min-h-screen bg-[#050509] bg-[radial-gradient(circle_at_center,_rgba(30,30,40,0.9)_0,_#050509_55%,_#000_100%)] text-white'
          : 'min-h-screen bg-[#1c1913] bg-[radial-gradient(circle_at_center,_rgba(244,236,216,0.6)_0,_#1c1913_60%,_#000_100%)] text-[#3B2F2F]'
      }
    >
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
          {/* Global progress bar at the very bottom */}
          <div
            className={`fixed bottom-0 left-0 w-full h-[2px] bg-black/70 backdrop-blur-sm z-40 transition-opacity duration-500 ${
              uiChromeVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'
            }`}
          >
            <div
              className="h-full bg-gradient-to-r from-emerald-400 via-sky-400 to-violet-500 shadow-[0_0_14px_rgba(56,189,248,0.8)] transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>

          {/* Unified floating toolbar */}
          <div
            className={`fixed top-4 right-4 z-50 transition-opacity duration-500 ${
              uiChromeVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'
            }`}
          >
            <div className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-black/60/75 px-4 py-2 text-[10px] uppercase tracking-[0.18em] text-white/80 backdrop-blur-2xl shadow-[0_18px_45px_rgba(0,0,0,0.85)]">
              <button
                onClick={toggleTheme}
                className="px-2 py-1 rounded-full bg-white/5 hover:bg-white/10 transition"
              >
                {theme === 'cinematic-dark' ? 'Cinematic · Dark' : 'Classic · Sepia'}
              </button>
              <span className="h-4 w-px bg-white/15" />
              <button
                onClick={toggleSpreadMode}
                className="px-2 py-1 rounded-full bg-white/5 hover:bg-white/10 transition"
              >
                {spreadMode === 'none' ? 'Single Page' : 'Two‑Page'}
              </button>
              <span className="h-4 w-px bg-white/15" />
              <button
                onClick={toggleFullscreen}
                className="px-2 py-1 rounded-full bg-white/5 hover:bg-white/10 transition"
              >
                Full Screen
              </button>
              <span className="h-4 w-px bg-white/15" />
              <button
                onClick={toggleReaderMode}
                className="px-2 py-1 rounded-full bg-white/5 hover:bg-white/10 transition"
              >
                {isReaderMode ? 'Exit Reader' : 'Reader Mode'}
              </button>
              <span className="h-4 w-px bg-white/15" />
              <button
                type="button"
                onClick={() => {
                  if (isReaderMode) return
                  setShowInfoPanel((prev) => !prev)
                }}
                className={`px-2 py-1 rounded-full bg-white/5 hover:bg-white/10 transition ${
                  isReaderMode ? 'opacity-40 cursor-default pointer-events-none' : ''
                }`}
                aria-label="Book information"
              >
                Info
              </button>
              <span className="h-4 w-px bg-white/15" />
              <button
                type="button"
                onClick={handleClick}
                className="px-2 py-1 rounded-full bg-white/5 hover:bg-white/10 transition"
              >
                Change Book
              </button>
            </div>
          </div>

          {/* Chapters & Bookmarks pill */}
          {!isReaderMode && (
            <button
              type="button"
              onClick={() => setShowBookmarksPanel((prev) => !prev)}
              className="fixed left-4 bottom-6 z-40 rounded-full border border-white/20 bg-black/70 px-4 py-2 text-[11px] font-medium uppercase tracking-[0.18em] text-white/80 backdrop-blur-xl shadow-[0_18px_45px_rgba(0,0,0,0.65)] hover:bg-white/10 transition"
            >
              Chapters &amp; Bookmarks
            </button>
          )
          }

          {/* Chapters & Bookmarks overlay */}
          {showBookmarksPanel && !isReaderMode && (
            <div className="fixed inset-x-4 bottom-16 md:inset-auto md:right-6 md:bottom-20 md:w-80 z-40 rounded-2xl border border-white/15 bg-black/80 backdrop-blur-2xl p-4 text-xs shadow-[0_30px_80px_rgba(0,0,0,0.85)] space-y-3">
              <div className="flex items-center justify-between">
                <span className="uppercase tracking-[0.21em] text-white/60">
                  Chapters
                </span>
                <button
                  type="button"
                  onClick={() => setShowBookmarksPanel(false)}
                  className="text-white/40 hover:text-white/80 text-[11px]"
                >
                  Close
                </button>
              </div>
              <div className="max-h-40 overflow-y-auto space-y-1 pr-1">
                {chapters.length === 0 && (
                  <div className="text-white/40 italic">No chapter data</div>
                )}
                {chapters.map((ch) => (
                  <button
                    key={ch.href}
                    type="button"
                    onClick={() => jumpToChapter(ch.href)}
                    className="block w-full text-left rounded-md px-2 py-1 text-[11px] text-white/80 hover:bg-white/10"
                  >
                    {ch.label}
                  </button>
                ))}
              </div>
              <div className="pt-2 border-t border-white/10">
                <div className="flex items-center justify-between mb-2">
                  <span className="uppercase tracking-[0.21em] text-white/60">
                    Bookmarks
                  </span>
                  <button
                    type="button"
                    onClick={addBookmark}
                    className="inline-flex items-center gap-1 rounded-full border border-white/20 px-2 py-0.5 text-[10px] text-white/80 hover:bg-white/10"
                  >
                    ★ Add
                  </button>
                </div>
                <div className="max-h-32 overflow-y-auto space-y-1 pr-1">
                  {bookmarks.length === 0 && (
                    <div className="text-white/40 italic">No bookmarks yet</div>
                  )}
                  {bookmarks.map((bm, idx) => (
                    <button
                      key={bm.cfi}
                      type="button"
                      onClick={() => jumpToBookmark(bm.cfi)}
                      className="block w-full text-left rounded-md px-2 py-1 text-[11px] text-white/80 hover:bg-white/10"
                    >
                      <div className="font-medium text-[11px]">
                        {bm.chapterTitle || `Bookmark ${idx + 1}`}
                      </div>
                      {bm.preview && (
                        <div className="text-[10px] text-white/65 line-clamp-2">
                          {bm.preview}
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Book Info slide-out drawer */}
          <AnimatePresence>
            {showInfoPanel && !isReaderMode && directorInfo && (
              <motion.aside
                initial={{ opacity: 0, x: 40 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 40 }}
                transition={{ duration: 0.35, ease: 'easeOut' }}
                className="fixed right-4 top-20 bottom-6 w-80 max-w-[80vw] z-40 rounded-2xl border border-white/15 bg-black/85 backdrop-blur-2xl shadow-[0_30px_80px_rgba(0,0,0,0.95)] p-5 text-sm"
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="text-xs uppercase tracking-[0.22em] text-white/70">
                    Book Info
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowInfoPanel(false)}
                    className="text-[11px] text-white/50 hover:text-white/80"
                  >
                    Close
                  </button>
                </div>
                <div className="space-y-3 text-neutral-100/90">
                  <div>
                    <div className="text-[11px] uppercase tracking-[0.18em] text-white/50">
                      Title
                    </div>
                    <div className="mt-1 text-base font-medium text-white">
                      {directorInfo.title || 'Unknown Title'}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] uppercase tracking-[0.18em] text-white/50">
                      Author
                    </div>
                    <div className="mt-1 text-[13px] text-white/80">
                      {directorInfo.author || 'Unknown Author'}
                    </div>
                  </div>
                  {directorInfo.description && (
                    <div>
                      <div className="text-[11px] uppercase tracking-[0.18em] text-white/50 mb-1">
                        Description
                      </div>
                      <p className="text-[12px] leading-relaxed text-white/80">
                        {directorInfo.description}
                      </p>
                    </div>
                  )}
                  <div>
                    <div className="text-[11px] uppercase tracking-[0.18em] text-white/50 mb-1">
                      Table of Contents
                    </div>
                    <div className="max-h-36 overflow-y-auto space-y-1 pr-1">
                      {chapters.length === 0 && (
                        <div className="text-white/40 italic">No chapter data</div>
                      )}
                      {chapters.map((ch) => (
                        <button
                          key={`info-${ch.href}`}
                          type="button"
                          onClick={() => jumpToChapter(ch.href)}
                          className="block w-full text-left rounded-md px-2 py-1 text-[11px] text-white/80 hover:bg-white/10"
                        >
                          {ch.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </motion.aside>
            )}
          </AnimatePresence>

          <AnimatePresence mode="wait">
            <motion.div
              key={currentLocation || (bookFile ? 'reader-loaded' : 'reader-empty')}
              ref={readerShellRef}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -16 }}
              transition={{ duration: 0.8, ease: 'easeOut' }}
              className="relative w-full max-w-6xl flex flex-col md:flex-row items-stretch justify-center md:items-start md:justify-between gap-6 md:gap-10"
            >
              {/* Full-screen tap zones for navigation (mouse + touch) */}
              <button
                type="button"
                aria-label="Previous page"
                className="fixed inset-y-0 left-0 w-[20%] z-30 bg-transparent"
                onClick={() => renditionRef.current?.prev()}
              />
              <button
                type="button"
                aria-label="Next page"
                className="fixed inset-y-0 right-0 w-[20%] z-30 bg-transparent"
                onClick={() => renditionRef.current?.next()}
              />

              {/* Book Card */}
              <div
                className={
                  theme === 'cinematic-dark'
                    ? 'relative flex-1 min-w-0 bg-[#050509] rounded-3xl shadow-[0_60px_160px_rgba(0,0,0,1)] overflow-hidden border border-white/10'
                    : 'relative flex-1 min-w-0 bg-[#f4f1ea] rounded-3xl shadow-[0_60px_160px_rgba(0,0,0,0.9)] overflow-hidden border border-black/5'
                }
              >
                {/* Spotlight-style vignette */}
                <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.12)_0,transparent_45%,rgba(0,0,0,0.8)_85%,rgba(0,0,0,0.98)_100%)]" />

                {/* Viewer with subtle page fade */}
                <motion.div
                  ref={viewerRef}
                  key={currentLocation || 'initial'}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.3, ease: 'easeOut' }}
                  className="relative h-[78vh] md:h-[82vh] w-full px-5 sm:px-8 md:px-14 py-10 md:py-14 text-[18px] leading-relaxed transition-opacity duration-500 ease-out opacity-0 overflow-hidden"
                />
              </div>
            </motion.div>
          </AnimatePresence>
        </div>
      )}
    </main>
  )
}