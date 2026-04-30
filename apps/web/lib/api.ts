// All API calls go to /api-proxy/* — Next.js rewrites this server-side to the real API.
// Set API_URL env var in Railway (Web service) to point to the API service URL.
const API_URL = '/api-proxy'

// Cookie helpers — keep cc_token in sync as a regular (non-HttpOnly) cookie so that
// Next.js middleware can read it server-side to guard protected routes.
export function setAuthCookie(token: string) {
  if (typeof document === 'undefined') return
  document.cookie = `cc_token=${token}; path=/; SameSite=Lax; max-age=900`
}
export function clearAuthCookie() {
  if (typeof document === 'undefined') return
  document.cookie = 'cc_token=; path=/; SameSite=Lax; max-age=0'
}

export const getApiUrl = () => API_URL

// ── Auto-refresh logic ────────────────────────────────────────
let _refreshing: Promise<string | null> | null = null

async function refreshToken(): Promise<string | null> {
  if (_refreshing) return _refreshing
  _refreshing = (async () => {
    try {
      const r = await fetch(`${API_URL}/auth/refresh`, { method: 'POST', credentials: 'include' })
      if (!r.ok) return null
      const d = await r.json()
      if (d.accessToken) { localStorage.setItem('cc_token', d.accessToken); setAuthCookie(d.accessToken); return d.accessToken }
    } catch {}
    return null
  })().finally(() => { _refreshing = null })
  return _refreshing
}

// fetchWithAuth — auto-refreshes expired access tokens, redirects to /login if refresh fails
export async function fetchWithAuth(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('cc_token') : null
  const hdrs  = new Headers(init.headers)
  if (token) hdrs.set('Authorization', `Bearer ${token}`)

  let res = await fetch(input, { ...init, headers: hdrs, credentials: 'include' })

  if (res.status === 401) {
    const fresh = await refreshToken()
    if (fresh) {
      hdrs.set('Authorization', `Bearer ${fresh}`)
      res = await fetch(input, { ...init, headers: hdrs, credentials: 'include' })
    } else if (typeof window !== 'undefined') {
      clearAuthCookie()
      window.location.replace('/login')
    }
  }
  return res
}

export async function apiFetch<T = any>(
  path: string,
  options: RequestInit & { token?: string } = {},
): Promise<T> {
  const { token, ...rest } = options

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(rest.headers as Record<string, string>),
  }

  const res = await fetch(`${API_URL}${path}`, {
    ...rest,
    headers,
    credentials: 'include',
  })

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(error.error || `HTTP ${res.status}`)
  }

  return res.json()
}

export async function uploadAvatar(
  userId: string,
  file: File,
  token: string,
): Promise<{ avatarUrl: string; r2Key: string }> {
  const form = new FormData()
  form.append('avatar', file)

  const res = await fetch(`${API_URL}/employees/${userId}/avatar`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
    credentials: 'include',
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error || 'Upload failed')
  }

  return res.json()
}
