// All API calls go to /api-proxy/* — Next.js rewrites this server-side to the real API.
// Set API_URL env var in Railway (Web service) to point to the API service URL.
const API_URL = '/api-proxy'

export const getApiUrl = () => API_URL

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
