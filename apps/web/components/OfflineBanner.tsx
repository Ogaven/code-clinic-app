'use client'

import { useEffect, useState } from 'react'

export default function OfflineBanner() {
  const [offline, setOffline] = useState(false)

  useEffect(() => {
    setOffline(!navigator.onLine)

    const handleOffline = () => setOffline(true)
    const handleOnline  = () => {
      setOffline(false)
      // Reload to get fresh data once connection is restored
      window.location.reload()
    }

    window.addEventListener('offline', handleOffline)
    window.addEventListener('online',  handleOnline)
    return () => {
      window.removeEventListener('offline', handleOffline)
      window.removeEventListener('online',  handleOnline)
    }
  }, [])

  if (!offline) return null

  return (
    <div
      role="alert"
      aria-live="assertive"
      style={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 9999 }}
      className="flex items-center justify-center gap-2 bg-amber-400 text-amber-900 text-sm font-semibold py-2 px-4 shadow-md"
    >
      <span>⚠️</span>
      <span>You are offline — some features may not work</span>
    </div>
  )
}
