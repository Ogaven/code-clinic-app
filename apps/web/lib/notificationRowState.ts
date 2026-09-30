// Pure decision logic for the profile card's "Notifications" row — kept
// separate from MobileProfileSheet.tsx so it's directly unit-testable
// without rendering React. Mirrors the real states the browser can report:
// unsupported, iOS-needs-install, denied, already subscribed, or available
// to enable.
export type NotificationRowState = 'unsupported' | 'ios-needs-safari' | 'ios-needs-install' | 'denied' | 'subscribed' | 'offer'

export function getNotificationRowState(params: {
  supported: boolean
  permission: NotificationPermission | 'unsupported'
  subscribed: boolean
  /** iPhone/iPad (incl. iPadOS reporting as "Mac" with touch support). */
  isIOS?: boolean
  /** Launched from the Home Screen (installed PWA), not a regular Safari tab. */
  isStandalone?: boolean
  /** iOS in Chrome/Firefox/Edge/Opera rather than Safari — Add to Home Screen there never unlocks Web Push. */
  isIOSNonSafari?: boolean
}): NotificationRowState {
  if (!params.supported) {
    // iOS/iPadOS Safari only exposes the Push API to an installed
    // (Add to Home Screen) PWA, even on versions that otherwise support Web
    // Push — a regular Safari tab always reports unsupported here. Give
    // staff the real fix instead of a dead-end "not supported" message.
    if (params.isIOS && !params.isStandalone) {
      return params.isIOSNonSafari ? 'ios-needs-safari' : 'ios-needs-install'
    }
    return 'unsupported'
  }
  if (params.permission === 'denied') return 'denied'
  if (params.subscribed) return 'subscribed'
  return 'offer'
}