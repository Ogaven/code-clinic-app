'use client'

import { Search, Bell, ChevronDown, Sun, Moon } from 'lucide-react'
import { useState } from 'react'
import { getInitials } from '@/lib/utils'

interface TopBarProps {
  title: string
  dark?: boolean
  onThemeToggle?: (dark: boolean) => void
  user?: {
    firstName: string
    lastName: string
    role: string
    avatarUrl?: string | null
  }
}

const roleLabels: Record<string, string> = {
  ADMIN:        'Administrator',
  DOCTOR:       'Doctor',
  RECEPTIONIST: 'Receptionist',
  ACCOUNTS:     'Accounts',
  DEVELOPER:    'Developer',
}

const roleColors: Record<string, string> = {
  ADMIN:        '#1A237E',
  DOCTOR:       '#29ABE2',
  RECEPTIONIST: '#10B981',
  ACCOUNTS:     '#F59E0B',
  DEVELOPER:    '#8B5CF6',
}

const notifications = [
  { id: 1, text: 'Sarah Namukasa checked in for Teeth Whitening', time: '2 min ago', dot: '#29ABE2' },
  { id: 2, text: 'Invoice #CC-2024-00042 is overdue — UGX 380,000', time: '1h ago',  dot: '#F59E0B' },
  { id: 3, text: 'Maya AI: 3 new leads captured from website', time: '2h ago',  dot: '#10B981' },
  { id: 4, text: 'Dr. Kutesa blocked time Fri 3–5pm', time: '4h ago',  dot: '#6B7280' },
]

export default function TopBar({ title, user, dark = false, onThemeToggle }: TopBarProps) {
  const [notifOpen, setNotifOpen] = useState(false)
  const [search, setSearch]       = useState('')

  const initials  = user ? getInitials(user.firstName, user.lastName) : '??'
  const roleColor = user ? (roleColors[user.role] || '#1A237E') : '#1A237E'

  function toggleTheme() {
    const next = !dark
    localStorage.setItem('cc_theme', next ? 'dark' : 'light')
    document.documentElement.classList.toggle('dark', next)
    onThemeToggle?.(next)
    window.dispatchEvent(new CustomEvent('cc-theme', { detail: next ? 'dark' : 'light' }))
  }

  const bg       = dark ? 'rgba(10,18,60,0.85)' : 'rgba(255,255,255,0.85)'
  const bdr      = dark ? 'rgba(255,255,255,0.08)' : 'rgba(229,231,235,0.9)'
  const titleC   = dark ? '#E0E8FF' : '#1A237E'
  const searchBg = dark ? 'rgba(255,255,255,0.06)' : '#F3F4F6'
  const searchBdr= dark ? 'rgba(255,255,255,0.1)'  : '#E5E7EB'
  const searchCl = dark ? '#C8D8F0' : '#374151'
  const iconCl   = dark ? '#8BA0C0' : '#6B7280'
  const nameCl   = dark ? '#E0E8FF' : '#111827'
  const btnBg    = dark ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.9)'
  const btnBdr   = dark ? 'rgba(255,255,255,0.12)' : '#E5E7EB'

  return (
    <header className="h-[60px] flex items-center justify-between px-5 sticky top-0 z-20 gap-4 flex-shrink-0"
      style={{
        background: bg,
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        borderBottom: `1px solid ${bdr}`,
        transition: 'background 0.3s, border-color 0.3s',
      }}>

      {/* Page title */}
      <h1 className="text-[17px] font-bold whitespace-nowrap flex-shrink-0"
        style={{ fontFamily: 'Plus Jakarta Sans', color: titleC, transition: 'color 0.3s' }}>
        {title}
      </h1>

      {/* Search */}
      <div className="flex-1 max-w-md">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: iconCl }} />
          <input type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search patients, appointments, invoices..."
            className="w-full pl-9 pr-4 py-2 rounded-xl text-xs outline-none transition-all"
            style={{ background: searchBg, border: `1px solid ${searchBdr}`, color: searchCl }} />
        </div>
      </div>

      {/* Right group */}
      <div className="flex items-center gap-2 flex-shrink-0">

        {/* Theme toggle */}
        <button onClick={toggleTheme}
          className="w-9 h-9 rounded-xl flex items-center justify-center transition-all hover:scale-105"
          style={{ background: btnBg, border: `1px solid ${btnBdr}` }}>
          {dark ? <Sun size={15} color="#FCD34D" /> : <Moon size={15} color="#1A237E" />}
        </button>

        {/* Notification bell */}
        <div className="relative">
          <button onClick={() => setNotifOpen(!notifOpen)}
            className="relative w-9 h-9 rounded-xl flex items-center justify-center transition-all hover:scale-105"
            style={{ background: btnBg, border: `1px solid ${btnBdr}` }}>
            <Bell size={16} style={{ color: iconCl }} />
            <span className="absolute top-2 right-2 w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse-dot" />
          </button>

          {notifOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setNotifOpen(false)} />
              <div className="absolute right-0 mt-2 w-80 rounded-2xl shadow-xl z-50 animate-fade-in-up overflow-hidden"
                style={{ background: dark ? 'rgba(12,20,75,0.97)' : '#fff', border: `1px solid ${bdr}`, backdropFilter: 'blur(20px)' }}>
                <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: `1px solid ${bdr}` }}>
                  <p className="font-bold text-sm" style={{ fontFamily: 'Plus Jakarta Sans', color: titleC }}>Notifications</p>
                  <span className="text-[10px] font-bold text-white bg-red-500 rounded-full px-1.5 py-0.5">{notifications.length}</span>
                </div>
                <div className="divide-y max-h-72 overflow-y-auto" style={{ borderColor: bdr }}>
                  {notifications.map(n => (
                    <div key={n.id} className="flex items-start gap-3 px-4 py-3 cursor-pointer transition-all hover:bg-white/5">
                      <div className="w-2 h-2 rounded-full mt-1.5 flex-shrink-0" style={{ background: n.dot }} />
                      <div className="flex-1">
                        <p className="text-xs font-medium leading-snug" style={{ color: dark ? '#C8D8F0' : '#374151' }}>{n.text}</p>
                        <p className="text-[10px] mt-0.5" style={{ color: iconCl }}>{n.time}</p>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="px-4 py-2.5" style={{ borderTop: `1px solid ${bdr}` }}>
                  <button className="text-xs text-clinic-blue font-semibold hover:underline">Mark all as read</button>
                </div>
              </div>
            </>
          )}
        </div>

        <div className="w-px h-6" style={{ background: bdr }} />

        {/* User */}
        {user && (
          <div className="flex items-center gap-2.5 cursor-pointer group">
            {user.avatarUrl ? (
              <img src={user.avatarUrl} alt={`${user.firstName} ${user.lastName}`}
                className="w-8 h-8 rounded-xl object-cover" style={{ border: `2px solid ${bdr}` }} />
            ) : (
              <div className="w-8 h-8 rounded-xl flex items-center justify-center text-white text-[11px] font-bold flex-shrink-0"
                style={{ background: `linear-gradient(135deg, ${roleColor}, ${roleColor}99)` }}>
                {initials}
              </div>
            )}
            <div className="hidden md:block">
              <p className="text-[13px] font-semibold leading-tight group-hover:text-clinic-blue transition-colors"
                style={{ color: nameCl }}>
                {user.role === 'DOCTOR' ? 'Dr. ' : ''}{user.firstName} {user.lastName}
              </p>
              <p className="text-[10px] font-medium" style={{ color: roleColor }}>
                {roleLabels[user.role] || user.role}
              </p>
            </div>
            <ChevronDown size={13} className="hidden md:block" style={{ color: iconCl }} />
          </div>
        )}
      </div>
    </header>
  )
}
