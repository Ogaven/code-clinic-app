// Real PWA install detection/trigger — no fake "download" flow.
//
// Chromium (Android/Windows/desktop Chrome/Edge): captures the browser's own
// `beforeinstallprompt` event. The install action is only shown once that
// event has actually fired and been captured — before that, there is
// nothing to invoke, so we don't show a dead button (per spec).
//
// iOS/iPadOS: there is no `beforeinstallprompt` equivalent — Apple never
// exposes one. We only detect whether we're on iOS/iPadOS and not already
// installed; the caller is expected to show its own instruction UI (this
// hook never pretends to trigger a real install there).
'use client'

import { useCallback, useEffect, useState } from 'react'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

export type InstallOutcome = 'accepted' | 'dismissed' | 'unavailable'

export interface PwaInstallState {
  /** True once the browser has actually fired beforeinstallprompt (Chromium only). */
  canInstallNative: boolean
  /** iOS or iPadOS (iPadOS 13+ reports as "Macintosh" but has touch support). */
  isIOS: boolean
  /** Running as an installed PWA right now (any platform). */
  isStandalone: boolean
  /** Invokes the real native install prompt. No-op (resolves 'unavailable') if not captured. */
  promptInstall: () => Promise<InstallOutcome>
}

export function detectIOS(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  const isAppleTouch = /iPad|iPhone|iPod/.test(ua)
  // iPadOS 13+ Safari identifies as "MacIntel" but exposes multi-touch — the
  // standard way to distinguish a real Mac from an iPad requesting desktop sites.
  const isIPadOS13Plus = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1
  return isAppleTouch || isIPadOS13Plus
}

export function detectStandalone(): boolean {
  if (typeof window === 'undefined') return false
  // iOS Safari's own non-standard flag; every other platform uses the media query.
  const iosStandalone = (window.navigator as unknown as { standalone?: boolean }).standalone === true
  return iosStandalone || window.matchMedia('(display-mode: standalone)').matches
}

export function usePwaInstall(): PwaInstallState {
  const [deferredEvent, setDeferredEvent] = useState<BeforeInstallPromptEvent | null>(null)
  const [isStandalone, setIsStandalone] = useState(false)
  const [isIOS, setIsIOS] = useState(false)

  useEffect(() => {
    setIsIOS(detectIOS())
    setIsStandalone(detectStandalone())

    function onBeforeInstallPrompt(e: Event) {
      e.preventDefault()
      setDeferredEvent(e as BeforeInstallPromptEvent)
    }
    function onInstalled() {
      setDeferredEvent(null)
      setIsStandalone(true)
    }
    const media = window.matchMedia('(display-mode: standalone)')
    const onDisplayModeChange = () => setIsStandalone(detectStandalone())

    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt)
    window.addEventListener('appinstalled', onInstalled)
    media.addEventListener('change', onDisplayModeChange)
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt)
      window.removeEventListener('appinstalled', onInstalled)
      media.removeEventListener('change', onDisplayModeChange)
    }
  }, [])

  const promptInstall = useCallback(async (): Promise<InstallOutcome> => {
    if (!deferredEvent) return 'unavailable'
    await deferredEvent.prompt()
    const { outcome } = await deferredEvent.userChoice
    if (outcome === 'accepted') setIsStandalone(true)
    setDeferredEvent(null)
    return outcome
  }, [deferredEvent])

  return { canInstallNative: !!deferredEvent, isIOS, isStandalone, promptInstall }
}