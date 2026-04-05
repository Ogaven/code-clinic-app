'use client'

import { useEffect, useRef, useState } from 'react'
import Image from 'next/image'
import { Camera, Save, Lock, Mail, User, AlertCircle, CheckCircle, Loader2, Eye, EyeOff } from 'lucide-react'
import { cn, getInitials } from '@/lib/utils'

const roleColors: Record<string, string> = {
  ADMIN: '#1A237E', DOCTOR: '#29ABE2', RECEPTIONIST: '#10B981',
  ACCOUNTS: '#F59E0B', DEVELOPER: '#8B5CF6',
}

export default function SettingsPage() {
  const [user,      setUser]      = useState<any>(null)
  const [preview,   setPreview]   = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [saving,    setSaving]    = useState(false)
  const [toast,     setToast]     = useState<{ msg: string; type: 'success' | 'error' } | null>(null)

  const [firstName, setFirstName] = useState('')
  const [lastName,  setLastName]  = useState('')
  const [email,     setEmail]     = useState('')

  const [oldPwd,  setOldPwd]  = useState('')
  const [newPwd,  setNewPwd]  = useState('')
  const [confPwd, setConfPwd] = useState('')
  const [showOld, setShowOld] = useState(false)
  const [showNew, setShowNew] = useState(false)

  const fileRef = useRef<HTMLInputElement>(null)
  const token   = typeof window !== 'undefined' ? localStorage.getItem('cc_token') : null

  useEffect(() => {
    const stored = localStorage.getItem('cc_user')
    if (stored) {
      const u = JSON.parse(stored)
      setUser(u)
      setFirstName(u.firstName || '')
      setLastName(u.lastName  || '')
      setEmail(u.email || '')
      if (u.avatarUrl) setPreview(u.avatarUrl)
    }
  }, [])

  function showToast(msg: string, type: 'success' | 'error') {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3500)
  }

  async function handleAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 5 * 1024 * 1024) { showToast('Image must be under 5MB', 'error'); return }

    // Preview immediately
    const reader = new FileReader()
    reader.onload = ev => setPreview(ev.target?.result as string)
    reader.readAsDataURL(file)

    setUploading(true)
    try {
      const form = new FormData()
      form.append('avatar', file)
      const res = await fetch(`/api-proxy/employees/${user.id}/avatar`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      })
      if (res.ok) {
        const data = await res.json()
        const updated = { ...user, avatarUrl: data.signedUrl }
        setUser(updated)
        localStorage.setItem('cc_user', JSON.stringify(updated))
        showToast('Profile photo updated!', 'success')
      } else {
        showToast('Upload failed. Try again.', 'error')
      }
    } catch {
      showToast('Upload failed. Check connection.', 'error')
    } finally { setUploading(false) }
  }

  async function handleProfileSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      const res = await fetch(`/api-proxy/employees/${user.id}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ firstName, lastName, email }),
      })
      if (res.ok) {
        const updated = { ...user, firstName, lastName, email }
        setUser(updated)
        localStorage.setItem('cc_user', JSON.stringify(updated))
        showToast('Profile updated successfully!', 'success')
      } else {
        const d = await res.json()
        showToast(d.error || 'Failed to update profile', 'error')
      }
    } catch { showToast('Network error', 'error') }
    finally { setSaving(false) }
  }

  async function handlePasswordChange(e: React.FormEvent) {
    e.preventDefault()
    if (newPwd !== confPwd) { showToast('New passwords do not match', 'error'); return }
    if (newPwd.length < 8)  { showToast('Password must be at least 8 characters', 'error'); return }
    setSaving(true)
    try {
      const res = await fetch(`/api-proxy/auth/change-password`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword: oldPwd, newPassword: newPwd }),
      })
      if (res.ok) {
        setOldPwd(''); setNewPwd(''); setConfPwd('')
        showToast('Password changed successfully!', 'success')
      } else {
        const d = await res.json()
        showToast(d.error || 'Failed to change password', 'error')
      }
    } catch { showToast('Network error', 'error') }
    finally { setSaving(false) }
  }

  if (!user) return null

  const initials   = getInitials(user.firstName, user.lastName)
  const roleColor  = roleColors[user.role] || '#1A237E'
  const inputCls   = "w-full px-4 py-3 rounded-xl text-sm border border-gray-200 bg-gray-50/50 focus:outline-none focus:ring-2 focus:ring-clinic-blue/20 focus:border-clinic-blue focus:bg-white transition-all"

  return (
    <div className="max-w-3xl mx-auto space-y-6 animate-fade-in">

      {/* Toast */}
      {toast && (
        <div className={cn(
          'fixed top-5 right-5 z-50 flex items-center gap-3 px-5 py-3.5 rounded-2xl shadow-2xl text-sm font-semibold animate-slide-right',
          toast.type === 'success' ? 'bg-emerald-500 text-white' : 'bg-red-500 text-white',
        )}>
          {toast.type === 'success' ? <CheckCircle size={18}/> : <AlertCircle size={18}/>}
          {toast.msg}
        </div>
      )}

      {/* Header */}
      <div>
        <h2 className="text-xl font-bold text-clinic-navy" style={{ fontFamily: 'Plus Jakarta Sans' }}>Account Settings</h2>
        <p className="text-sm text-gray-400 mt-0.5">Manage your profile, photo and security</p>
      </div>

      {/* ── Profile Photo ── */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
        <h3 className="font-bold text-clinic-navy mb-4 flex items-center gap-2">
          <User size={16} className="text-clinic-blue" /> Profile Photo
        </h3>
        <div className="flex items-center gap-6">
          {/* Avatar */}
          <div className="relative flex-shrink-0">
            <div className="w-24 h-24 rounded-2xl overflow-hidden border-2 border-gray-100 shadow-md">
              {preview ? (
                <img src={preview} alt="Avatar" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-white text-2xl font-bold"
                  style={{ background: `linear-gradient(135deg,${roleColor},${roleColor}99)` }}>
                  {initials}
                </div>
              )}
            </div>
            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="absolute -bottom-2 -right-2 w-8 h-8 rounded-xl flex items-center justify-center text-white shadow-lg hover:scale-110 transition-all"
              style={{ background: 'linear-gradient(135deg,#1A237E,#29ABE2)' }}>
              {uploading ? <Loader2 size={14} className="animate-spin"/> : <Camera size={14}/>}
            </button>
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp"
              className="hidden" onChange={handleAvatarChange} />
          </div>

          <div>
            <p className="text-sm font-semibold text-gray-800">
              {user.role === 'DOCTOR' ? 'Dr. ' : ''}{user.firstName} {user.lastName}
            </p>
            <p className="text-xs font-medium mt-0.5" style={{ color: roleColor }}>{user.role}</p>
            <p className="text-xs text-gray-400 mt-3 leading-relaxed">
              Click the camera icon to upload a new photo.<br/>
              JPEG, PNG or WebP — max 5MB.
            </p>
          </div>
        </div>
      </div>

      {/* ── Profile Info ── */}
      <form onSubmit={handleProfileSave} className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-4">
        <h3 className="font-bold text-clinic-navy flex items-center gap-2">
          <Mail size={16} className="text-clinic-blue" /> Personal Information
        </h3>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1.5">First Name</label>
            <input type="text" value={firstName} onChange={e => setFirstName(e.target.value)}
              placeholder="First name" required className={inputCls} />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1.5">Last Name</label>
            <input type="text" value={lastName} onChange={e => setLastName(e.target.value)}
              placeholder="Last name" required className={inputCls} />
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-gray-500 mb-1.5">Email Address</label>
          <div className="relative">
            <Mail size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input type="email" value={email} onChange={e => setEmail(e.target.value)}
              placeholder="your@email.com" required
              className={cn(inputCls, 'pl-10')} />
          </div>
        </div>

        <div className="flex justify-end pt-2">
          <button type="submit" disabled={saving}
            className="flex items-center gap-2 px-6 py-2.5 rounded-xl font-bold text-white text-sm transition-all hover:-translate-y-0.5 hover:shadow-lg disabled:opacity-60"
            style={{ background: 'linear-gradient(135deg,#1A237E,#29ABE2)', boxShadow: '0 4px 14px rgba(41,171,226,0.3)' }}>
            {saving ? <Loader2 size={14} className="animate-spin"/> : <Save size={14}/>}
            Save Changes
          </button>
        </div>
      </form>

      {/* ── Change Password ── */}
      <form onSubmit={handlePasswordChange} className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-4">
        <h3 className="font-bold text-clinic-navy flex items-center gap-2">
          <Lock size={16} className="text-clinic-blue" /> Change Password
        </h3>

        <div>
          <label className="block text-xs font-semibold text-gray-500 mb-1.5">Current Password</label>
          <div className="relative">
            <Lock size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input type={showOld ? 'text' : 'password'} value={oldPwd} onChange={e => setOldPwd(e.target.value)}
              placeholder="••••••••" required className={cn(inputCls, 'pl-10 pr-11')} />
            <button type="button" onClick={() => setShowOld(!showOld)}
              className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
              {showOld ? <EyeOff size={14}/> : <Eye size={14}/>}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1.5">New Password</label>
            <div className="relative">
              <input type={showNew ? 'text' : 'password'} value={newPwd} onChange={e => setNewPwd(e.target.value)}
                placeholder="Min. 8 characters" required className={cn(inputCls, 'pr-11')} />
              <button type="button" onClick={() => setShowNew(!showNew)}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                {showNew ? <EyeOff size={14}/> : <Eye size={14}/>}
              </button>
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1.5">Confirm New Password</label>
            <input type="password" value={confPwd} onChange={e => setConfPwd(e.target.value)}
              placeholder="Repeat new password" required className={inputCls}
              style={{ borderColor: confPwd && confPwd !== newPwd ? '#EF4444' : '' }} />
          </div>
        </div>

        {confPwd && confPwd !== newPwd && (
          <p className="text-xs text-red-500 flex items-center gap-1"><AlertCircle size={12}/> Passwords do not match</p>
        )}

        <div className="flex justify-end pt-2">
          <button type="submit" disabled={saving || (!!confPwd && confPwd !== newPwd)}
            className="flex items-center gap-2 px-6 py-2.5 rounded-xl font-bold text-white text-sm transition-all hover:-translate-y-0.5 hover:shadow-lg disabled:opacity-60"
            style={{ background: 'linear-gradient(135deg,#DC2626,#EF4444)', boxShadow: '0 4px 14px rgba(239,68,68,0.25)' }}>
            {saving ? <Loader2 size={14} className="animate-spin"/> : <Lock size={14}/>}
            Update Password
          </button>
        </div>
      </form>

      {/* ── Danger Zone ── */}
      <div className="rounded-2xl border border-red-200 p-6" style={{ background: 'rgba(254,242,242,0.5)' }}>
        <h3 className="font-bold text-red-700 mb-2 flex items-center gap-2">
          <AlertCircle size={16}/> Danger Zone
        </h3>
        <p className="text-xs text-red-500 mb-4">Once you log out all sessions, you will need to sign in again on all devices.</p>
        <button
          onClick={() => {
            localStorage.removeItem('cc_token')
            localStorage.removeItem('cc_user')
            window.location.href = '/login'
          }}
          className="px-5 py-2.5 rounded-xl text-sm font-bold text-red-600 border border-red-200 hover:bg-red-50 transition-all">
          Log Out All Sessions
        </button>
      </div>

    </div>
  )
}
