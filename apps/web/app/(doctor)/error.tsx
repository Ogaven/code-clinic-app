'use client'

import { useEffect } from 'react'

export default function DoctorError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[DoctorError]', error)
  }, [error])

  return (
    <div className="flex flex-col items-center justify-center h-full min-h-[300px] gap-4 p-6">
      <div className="text-4xl">⚠️</div>
      <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
        Something went wrong
      </h2>
      <p className="text-sm text-gray-500 dark:text-gray-400 text-center max-w-xs">
        {error.message || 'An error occurred loading this view.'}
      </p>
      <button
        onClick={reset}
        className="px-4 py-2 bg-[#29ABE2] text-white rounded-xl text-sm font-medium hover:bg-[#1e96cc] transition-colors"
      >
        Try again
      </button>
    </div>
  )
}
