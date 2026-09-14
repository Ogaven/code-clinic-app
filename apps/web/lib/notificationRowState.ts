// Pure decision logic for the profile card's "Notifications" row — kept
// separate from MobileProfileSheet.tsx so it's directly unit-testable
// without rendering React. Mirrors the four real states the browser can
// report: unsupported, denied, already subscribed, or available to enable.
export type NotificationRowState = 'unsupported' | 'denied' | 'subscribed' | 'offer'

export function getNotificationRowState(params: {
  supported: boolean
  permission: NotificationPermission | 'unsupported'
  subscribed: boolean
}): NotificationRowState {
  if (!params.supported) return 'unsupported'
  if (params.permission === 'denied') return 'denied'
  if (params.subscribed) return 'subscribed'
  return 'offer'
}