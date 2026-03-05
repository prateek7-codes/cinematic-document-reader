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
  previewText: string
  logline: string
}

type ChapterItem = {
  label: string
  href: string
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
  const readerShellRef = useRef<HTMLDivElement>(null)

  const bookRef = useRef<any | null>(null)
  const renditionRef = useRef<any | null>(null)
  const keyHandlerRef = useRef<((e: KeyboardEvent) => void) | null>(null)
  const touchStartXRef = useRef<number | null>(null)
  const currentLocationRef = useRef<string | null>(null)

  const [bookFile, setBookFile] = useState<File | null>(null)
  const [progress, setProgress] = useState(0)
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
  const [bookmarks, setBookmarks] = useState<string[]>(() => {
    if (typeof window === 'undefined') return []
    try {
      const raw = window.localStorage.getItem(BOOKMARKS_KEY)
      if (!raw) return []
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  })
  const [chapters, setChapters] = useState<ChapterItem[]>([])
  const [showBookmarksPanel, setShowBookmarksPanel] = useState(false)

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
        currentLocationRef.current = cfi
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
    setIsReaderMode((prev) => !prev)
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

  const persistBookmarks = (next: string[]) => {
    setBookmarks(next)
    try {
      window.localStorage.setItem(BOOKMARKS_KEY, JSON.stringify(next))
    } catch {
      // ignore
    }
  }

  const addBookmark = () => {
    const cfi = currentLocationRef.current
    if (!cfi) return
    if (bookmarks.includes(cfi)) return
    persistBookmarks([...bookmarks, cfi])
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

  return (
    <main className="min-h-screen bg-[#050509] bg-[radial-gradient(circle_at_center,_rgba(30,30,40,0.9)_0,_#050509_55%,_#000_100%)] text-white">
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
          <div className="fixed bottom-0 left-0 w-full h-1.5 bg-black/70 backdrop-blur-sm z-40">
            <div
              className="h-full bg-gradient-to-r from-emerald-400 via-sky-400 to-violet-500 shadow-[0_0_18px_rgba(56,189,248,0.7)] transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>

          {/* Floating control pills */}
          <div className="fixed top-4 right-4 z-40 flex flex-col items-end gap-2">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-black/60 px-3 py-1.5 text-[10px] uppercase tracking-[0.18em] text-white/80 backdrop-blur-xl shadow-[0_18px_45px_rgba(0,0,0,0.65)]">
              <button
                onClick={toggleTheme}
                className="px-2 py-0.5 rounded-full bg-white/5 hover:bg-white/10 transition"
              >
                {theme === 'cinematic-dark' ? 'Cinematic · Dark' : 'Classic · Sepia'}
              </button>
              <span className="h-4 w-px bg-white/15" />
              <button
                onClick={toggleSpreadMode}
                className="px-2 py-0.5 rounded-full bg-white/5 hover:bg-white/10 transition"
              >
                {spreadMode === 'none' ? 'Single Page' : 'Two‑Page'}
              </button>
            </div>
            <div className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-black/60 px-3 py-1.5 text-[10px] uppercase tracking-[0.18em] text-white/80 backdrop-blur-xl shadow-[0_18px_45px_rgba(0,0,0,0.65)]">
              <button
                onClick={toggleFullscreen}
                className="px-2 py-0.5 rounded-full bg-white/5 hover:bg-white/10 transition"
              >
                Full Screen
              </button>
              <span className="h-4 w-px bg-white/15" />
              <button
                onClick={toggleReaderMode}
                className="px-2 py-0.5 rounded-full bg-white/5 hover:bg-white/10 transition"
              >
                {isReaderMode ? 'Exit Reader' : 'Reader Mode'}
              </button>
            </div>
          </div>

          {/* Chapters & Bookmarks pill */}
          <button
            type="button"
            onClick={() => setShowBookmarksPanel((prev) => !prev)}
            className="fixed left-4 bottom-6 z-40 rounded-full border border-white/20 bg-black/70 px-4 py-2 text-[11px] font-medium uppercase tracking-[0.18em] text-white/80 backdrop-blur-xl shadow-[0_18px_45px_rgba(0,0,0,0.65)] hover:bg-white/10 transition"
          >
            Chapters &amp; Bookmarks
          </button>

          {/* Chapters & Bookmarks overlay */}
          {showBookmarksPanel && (
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
                      key={bm}
                      type="button"
                      onClick={() => jumpToBookmark(bm)}
                      className="block w-full text-left rounded-md px-2 py-1 text-[11px] text-white/80 hover:bg-white/10"
                    >
                      Bookmark {idx + 1}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          <AnimatePresence mode="wait">
            <motion.div
              key={bookFile ? 'reader-loaded' : 'reader-empty'}
              ref={readerShellRef}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -16 }}
              transition={{ duration: 0.8, ease: 'easeOut' }}
              className="relative w-full max-w-6xl flex flex-col md:flex-row items-stretch justify-center md:items-start md:justify-between gap-6 md:gap-10"
            >
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

                {/* Tap Zones */}
                <button
                  type="button"
                  aria-label="Previous page"
                  className="absolute inset-y-0 left-0 w-[20%] z-20 bg-gradient-to-r from-black/20 via-transparent to-transparent opacity-0 hover:opacity-40 transition-opacity md:opacity-0 md:hover:opacity-25"
                  onClick={() => renditionRef.current?.prev()}
                />
                <button
                  type="button"
                  aria-label="Next page"
                  className="absolute inset-y-0 right-0 w-[20%] z-20 bg-gradient-to-l from-black/20 via-transparent to-transparent opacity-0 hover:opacity-40 transition-opacity md:opacity-0 md:hover:opacity-25"
                  onClick={() => renditionRef.current?.next()}
                />

                {/* Viewer */}
                <div
                  ref={viewerRef}
                  className="relative h-[78vh] md:h-[82vh] w-full px-5 sm:px-8 md:px-14 py-10 md:py-14 text-[18px] leading-relaxed transition-opacity duration-500 ease-out opacity-0 overflow-hidden"
                />
              </div>

              {!isReaderMode && directorInfo && <DirectorSummary info={directorInfo} />}
            </motion.div>
          </AnimatePresence>
        </div>
      )}
    </main>
  )
}