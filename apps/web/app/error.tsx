'use client'

import { useEffect } from 'react'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[GlobalError]', error)
    const isChunkError =
      error.name === 'ChunkLoadError' ||
      error.message?.includes('Loading chunk') ||
      error.message?.includes('ChunkLoadError')
    if (isChunkError) {
      const key = 'cc_chunk_reloaded'
      if (!sessionStorage.getItem(key)) {
        sessionStorage.setItem(key, '1')
        window.location.reload()
      }
    }
  }, [error])

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 p-6">
      <div className="max-w-md w-full text-center space-y-4">
        <div className="text-5xl">🦷</div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
          Something went wrong
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {error.message || 'An unexpected error occurred. Our team has been notified.'}
        </p>
        {error.digest && (
          <p className="text-xs text-gray-400 font-mono">Error ID: {error.digest}</p>
        )}
        <div className="flex gap-3 justify-center pt-2">
          <button
            onClick={reset}
            className="px-4 py-2 bg-[#29ABE2] text-white rounded-xl text-sm font-medium hover:bg-[#1e96cc] transition-colors"
          >
            Try again
          </button>
          <button
            onClick={() => (window.location.href = '/')}
            className="px-4 py-2 border border-gray-200 dark:border-gray-700 rounded-xl text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          >
            Go home
          </button>
        </div>
      </div>
    </div>
  )
}
