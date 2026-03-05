'use client'

import { useRef, useState, useEffect } from "react"
import ePub from "epubjs"

export default function Home() {

  const viewerRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const bookRef = useRef<any>(null)
  const renditionRef = useRef<any>(null)

  const [bookFile, setBookFile] = useState<File | null>(null)
  const [progress, setProgress] = useState(0)

  function cleanup() {
    if (renditionRef.current) {
      renditionRef.current.destroy()
      renditionRef.current = null
    }

    if (bookRef.current) {
      bookRef.current.destroy()
      bookRef.current = null
    }

    if (viewerRef.current) {
      viewerRef.current.innerHTML = ""
    }
  }

  function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    cleanup()
    setBookFile(file)
  }

  function openFilePicker() {
    fileInputRef.current?.click()
  }

  useEffect(() => {

    if (!bookFile || !viewerRef.current) return

    const reader = new FileReader()

    reader.onload = (e) => {

      const buffer = e.target?.result as ArrayBuffer

      const book = ePub(buffer)
      bookRef.current = book

      const rendition = book.renderTo(viewerRef.current!, {
        width: "100%",
        height: "100%",
        flow: "paginated",
        spread: "auto"
      })

      renditionRef.current = rendition

      rendition.display()

      rendition.on("relocated", (location: any) => {

        const percent = location.start.percentage || 0
        setProgress(Math.floor(percent * 100))

      })

    }

    reader.readAsArrayBuffer(bookFile)

    return cleanup

  }, [bookFile])

  return (

    <main className="min-h-screen bg-black text-white flex flex-col items-center justify-center">

      {!bookFile && (

        <div className="text-center">

          <h1 className="text-3xl mb-6">
            Cinematic EPUB Reader
          </h1>

          <button
            onClick={openFilePicker}
            className="bg-white text-black px-6 py-3 rounded-xl"
          >
            Upload EPUB
          </button>

          <input
            ref={fileInputRef}
            type="file"
            accept=".epub"
            onChange={handleUpload}
            className="hidden"
          />

        </div>

      )}

      {bookFile && (

        <div className="w-full max-w-6xl h-[80vh] relative">

          <div
            ref={viewerRef}
            className="w-full h-full bg-neutral-900 rounded-2xl"
          />

          <div className="absolute bottom-0 left-0 w-full h-[3px] bg-white/20">

            <div
              className="h-full bg-white"
              style={{ width: `${progress}%` }}
            />

          </div>

          <button
            onClick={() => renditionRef.current?.prev()}
            className="absolute left-0 top-0 bottom-0 w-[20%]"
          />

          <button
            onClick={() => renditionRef.current?.next()}
            className="absolute right-0 top-0 bottom-0 w-[20%]"
          />

        </div>

      )}

    </main>

  )
}