'use client'

import { useRef, useState } from 'react'
import { Camera, Loader2, X } from 'lucide-react'
import { cn, getInitials } from '@/lib/utils'

interface AvatarUploadProps {
  userId: string
  firstName: string
  lastName: string
  currentAvatarUrl?: string | null
  colour?: string
  size?: 'md' | 'lg' | 'xl'
  onUploaded?: (avatarUrl: string) => void
  token?: string
}

const sizes = {
  md: { wrapper: 'w-12 h-12', text: 'text-sm', icon: 14 },
  lg: { wrapper: 'w-20 h-20', text: 'text-lg', icon: 16 },
  xl: { wrapper: 'w-28 h-28', text: 'text-2xl', icon: 20 },
}

export default function AvatarUpload({
  userId, firstName, lastName, currentAvatarUrl, colour, size = 'lg', onUploaded, token,
}: AvatarUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [preview, setPreview] = useState<string | null>(currentAvatarUrl || null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const s = sizes[size]

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setError('Only JPEG, PNG or WebP images allowed')
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      setError('Image must be under 5MB')
      return
    }

    setError(null)
    setUploading(true)

    // Capture base64 for fallback before attempting server upload
    let base64DataUrl = ''
    await new Promise<void>((resolve) => {
      const reader = new FileReader()
      reader.onload = (ev) => { base64DataUrl = ev.target?.result as string; setPreview(base64DataUrl); resolve() }
      reader.readAsDataURL(file)
    })

    try {
      const form = new FormData()
      form.append('avatar', file)

      const res = await fetch(
        `/api-proxy/employees/${userId}/avatar`,
        {
          method: 'POST',
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          body: form,
          credentials: 'include',
        },
      )

      if (!res.ok) {
        // Fallback: keep base64 preview and call onUploaded with it so UI stays intact
        if (res.status === 403 || res.status === 500) {
          onUploaded?.(base64DataUrl)
          return
        }
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Upload failed')
      }

      const { avatarUrl } = await res.json()
      setPreview(avatarUrl)
      onUploaded?.(avatarUrl)

      // If this upload is for the currently logged-in user, update cc_user in
      // localStorage and broadcast so all layouts refresh their TopBar avatar.
      try {
        const stored = localStorage.getItem('cc_user')
        if (stored) {
          const current = JSON.parse(stored)
          if (current.id === userId) {
            localStorage.setItem('cc_user', JSON.stringify({ ...current, avatarUrl }))
            localStorage.setItem('cc_avatar', avatarUrl)
            window.dispatchEvent(new CustomEvent('cc-avatar-updated', { detail: avatarUrl }))
          }
        }
      } catch {}
    } catch (err: any) {
      // On any failure: keep the preview and silently fall back to base64
      if (base64DataUrl) { onUploaded?.(base64DataUrl); return }
      setError(err.message)
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="relative inline-block group">
      {/* Avatar circle */}
      <div
        className={cn('rounded-full border-4 border-white shadow-md overflow-hidden flex items-center justify-center', s.wrapper)}
        style={{ backgroundColor: !preview ? (colour || '#1A237E') : undefined }}
      >
        {preview ? (
          <img src={preview} alt={`${firstName} ${lastName}`} className="w-full h-full object-cover object-top" />
        ) : (
          <span className={cn('font-bold text-white', s.text)}>
            {getInitials(firstName, lastName)}
          </span>
        )}

        {/* Upload overlay */}
        <div className="absolute inset-0 bg-black/40 rounded-full opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center cursor-pointer"
          onClick={() => inputRef.current?.click()}
        >
          {uploading ? (
            <Loader2 size={s.icon} className="text-white animate-spin" />
          ) : (
            <Camera size={s.icon} className="text-white" />
          )}
        </div>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={handleFile}
      />

      {error && (
        <div className="absolute top-full left-0 mt-1 w-48 bg-red-50 border border-red-200 text-red-600 text-xs rounded-lg p-2 flex items-start gap-1 z-10">
          <X size={12} className="mt-0.5 flex-shrink-0" />
          {error}
        </div>
      )}
    </div>
  )
}
