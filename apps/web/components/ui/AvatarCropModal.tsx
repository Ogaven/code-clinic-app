'use client'

import { useRef, useState, useCallback } from 'react'
import { X, ZoomIn, Check } from 'lucide-react'

interface AvatarCropModalProps {
  src: string
  onCancel: () => void
  onConfirm: (blob: Blob) => void
}

const VIEWPORT = 240
const OUTPUT = 480

// Simple drag-to-reposition + zoom-slider crop, built on the plain
// browser Canvas API — no cropping library added.
export default function AvatarCropModal({ src, onCancel, onConfirm }: AvatarCropModalProps) {
  const imgRef = useRef<HTMLImageElement>(null)
  const [zoom, setZoom] = useState(1)
  const [pos, setPos] = useState({ x: 0, y: 0 })
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null)
  const [busy, setBusy] = useState(false)
  // Natural pixel size of the loaded source image — needed to compute the
  // same "cover" baseline scale used by confirm()'s canvas math below. See
  // the comment on the preview <img>'s style for why this fixed a real bug.
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null)

  function onPointerDown(e: React.PointerEvent) {
    dragRef.current = { startX: e.clientX, startY: e.clientY, origX: pos.x, origY: pos.y }
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!dragRef.current) return
    const dx = e.clientX - dragRef.current.startX
    const dy = e.clientY - dragRef.current.startY
    setPos({ x: dragRef.current.origX + dx, y: dragRef.current.origY + dy })
  }
  function onPointerUp() { dragRef.current = null }

  const confirm = useCallback(() => {
    const img = imgRef.current
    if (!img) return
    setBusy(true)
    const canvas = document.createElement('canvas')
    canvas.width = OUTPUT
    canvas.height = OUTPUT
    const ctx = canvas.getContext('2d')
    if (!ctx) { setBusy(false); return }

    // Natural image size scaled to fill the viewport (object-fit: cover baseline), then zoom/pan applied on top.
    const scale = Math.max(VIEWPORT / img.naturalWidth, VIEWPORT / img.naturalHeight) * zoom
    const drawW = img.naturalWidth * scale
    const drawH = img.naturalHeight * scale
    const outputScale = OUTPUT / VIEWPORT
    const dx = (VIEWPORT / 2 - drawW / 2 + pos.x) * outputScale
    const dy = (VIEWPORT / 2 - drawH / 2 + pos.y) * outputScale

    ctx.save()
    ctx.beginPath()
    ctx.rect(0, 0, OUTPUT, OUTPUT)
    ctx.clip()
    ctx.drawImage(img, dx, dy, drawW * outputScale, drawH * outputScale)
    ctx.restore()

    canvas.toBlob(blob => {
      setBusy(false)
      if (blob) onConfirm(blob)
    }, 'image/jpeg', 0.92)
  }, [zoom, pos, onConfirm])

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onCancel}>
      <div className="w-full max-w-sm rounded-3xl bg-white dark:bg-[#152040] p-5 shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-sm font-bold text-gray-800 dark:text-white">Adjust Photo</h3>
          <button onClick={onCancel} className="grid h-8 w-8 place-items-center rounded-xl text-gray-400 hover:bg-gray-100 dark:hover:bg-white/10">
            <X size={16} />
          </button>
        </div>

        <div
          className="relative mx-auto overflow-hidden rounded-full border border-gray-200 dark:border-white/10 cursor-move select-none"
          style={{ width: VIEWPORT, height: VIEWPORT, touchAction: 'none' }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerUp}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            ref={imgRef}
            src={src}
            alt="Crop preview"
            draggable={false}
            onLoad={e => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
            className="pointer-events-none absolute left-1/2 top-1/2"
            style={{
              transform: `translate(-50%, -50%) translate(${pos.x}px, ${pos.y}px) scale(${zoom})`,
              maxWidth: 'none',
              // Previously fixed at `width: VIEWPORT, height: 'auto'`, which
              // scales purely by width — for a landscape source photo that
              // is a SMALLER baseline than the "cover" scale confirm() uses
              // below (Math.max of width/height ratios). The two only agreed
              // for portrait/square images. That mismatch meant the visible
              // preview didn't match what actually got exported: the saved
              // avatar came out more zoomed-in/cropped than what the user
              // positioned here — a "double crop". Computing the same
              // cover-fit baseline for the preview keeps what's shown and
              // what's exported identical for every photo orientation.
              width:  natural ? natural.w * Math.max(VIEWPORT / natural.w, VIEWPORT / natural.h) : VIEWPORT,
              height: natural ? natural.h * Math.max(VIEWPORT / natural.w, VIEWPORT / natural.h) : 'auto',
            }}
          />
        </div>

        <div className="mt-4 flex items-center gap-2">
          <ZoomIn size={14} className="text-gray-400 flex-shrink-0" />
          <input type="range" min={1} max={3} step={0.01} value={zoom} onChange={e => setZoom(parseFloat(e.target.value))}
            className="w-full accent-cyan-500" />
        </div>

        <div className="mt-4 flex gap-3">
          <button onClick={onCancel} className="flex-1 rounded-xl border border-gray-200 dark:border-white/10 py-2.5 text-sm font-bold text-gray-600 dark:text-white/60 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors">
            Cancel
          </button>
          <button onClick={confirm} disabled={busy}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2.5 text-sm font-bold text-white transition-all hover:-translate-y-0.5 disabled:opacity-60"
            style={{ background: 'linear-gradient(135deg,#1A237E,#29ABE2)' }}>
            <Check size={14} /> Use Photo
          </button>
        </div>
      </div>
    </div>
  )
}
