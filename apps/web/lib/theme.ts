export type AppTheme = 'light' | 'dark' | 'system'

export function readTheme(): AppTheme {
  if (typeof window === 'undefined') return 'system'
  const value = localStorage.getItem('cc_theme')
  return value === 'light' || value === 'dark' || value === 'system' ? value : 'system'
}

export function applyTheme(theme: AppTheme): boolean {
  if (typeof window === 'undefined') return false
  const dark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.classList.toggle('dark', dark)
  return dark
}

export function saveTheme(theme: AppTheme): boolean {
  localStorage.setItem('cc_theme', theme)
  const dark = applyTheme(theme)
  window.dispatchEvent(new CustomEvent('cc-theme', { detail: theme }))
  return dark
}
