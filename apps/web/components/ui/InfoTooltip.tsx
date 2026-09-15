'use client'

import { useId, useState } from 'react'

// Small "(i)" affordance that explains what a metric means. Unlike a native
// `title` attribute (hover-only, invisible on touch devices) this opens on
// tap, click, and keyboard focus, and closes on blur/Escape/outside click —
// so it works the same on a phone and a desktop.
export default function InfoTooltip({ text, className = '' }: { text: string; className?: string }) {
  const [open, setOpen] = useState(false)
  const id = useId()

  return (
    <span className={`relative inline-flex ${className}`}>
      <button
        type="button"
        aria-describedby={id}
        aria-label="What does this metric mean?"
        onClick={() => setOpen(o => !o)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={e => { if (e.key === 'Escape') setOpen(false) }}
        className="flex h-4 w-4 items-center justify-center rounded-full border border-gray-300 dark:border-gray-600 text-[10px] leading-none text-gray-500 dark:text-gray-400 hover:border-gray-400 dark:hover:border-gray-500 hover:text-gray-700 dark:hover:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-400"
      >
        i
      </button>
      {open && (
        <span
          id={id}
          role="tooltip"
          className="absolute z-20 top-full mt-1.5 left-1/2 -translate-x-1/2 w-56 rounded-lg bg-gray-900 dark:bg-gray-700 px-2.5 py-1.5 text-xs leading-snug text-white shadow-lg"
        >
          {text}
        </span>
      )}
    </span>
  )
}
