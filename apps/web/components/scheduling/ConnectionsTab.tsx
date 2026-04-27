'use client'

import React, { useState } from 'react'
import { Check, Upload } from 'lucide-react'
import { cn } from '@/lib/utils'

// ── Shared UI atoms ────────────────────────────────────────────────────────────
function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button onClick={() => onChange(!on)}
      className={cn('relative inline-flex h-6 w-11 items-center rounded-full transition-colors', on ? 'bg-cyan-500' : 'bg-gray-200 dark:bg-white/20')}>
      <span className={cn('inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform', on ? 'translate-x-6' : 'translate-x-1')} />
    </button>
  )
}

// ── Google Organic Booking tab ─────────────────────────────────────────────────
function GoogleOrganicBookingTab() {
  const fileRef = React.useRef<HTMLInputElement>(null)
  const [disabled,     setDisabled]     = useState(false)
  const [confirmAll,   setConfirmAll]   = useState(false)
  const [primaryFeed,  setPrimaryFeed]  = useState('book_online')
  const [servicesFeed, setServicesFeed] = useState('')

  return (
    <div className="p-6 max-w-2xl">
      <h2 className="text-base font-black text-gray-800 dark:text-white mb-1">Google Organic Booking</h2>
      <p className="text-xs text-gray-400 dark:text-white/40 mb-4">Allow patients to book directly from Google Search results</p>

      <div className="mb-5 p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700/40 rounded-xl text-xs text-blue-700 dark:text-blue-400 space-y-1.5">
        <p className="font-bold">Before you start</p>
        <ul className="space-y-1 pl-3 list-disc">
          <li><strong>Verify Location Details</strong> — Ensure your Google Business Profile address matches what patients see in Google Maps</li>
          <li><strong>Match Descriptions</strong> — Service names should match those in your Google Business listing</li>
          <li>Organic booking is managed through Google Reserve — approval can take 1–2 weeks</li>
        </ul>
      </div>

      <div className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/10 divide-y divide-gray-50 dark:divide-white/5">

        <div className="flex items-center justify-between px-5 py-4">
          <div>
            <p className="text-sm font-semibold text-gray-800 dark:text-white">Disable Google Organic Booking</p>
            <p className="text-xs text-gray-400 dark:text-white/40 mt-0.5">Stop showing your clinic in Google's booking module</p>
          </div>
          <Toggle on={disabled} onChange={setDisabled} />
        </div>

        <div className="flex items-start gap-3 px-5 py-4">
          <button onClick={() => setConfirmAll(v => !v)}
            className={cn('mt-0.5 w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 transition-all', confirmAll ? 'border-cyan-500 bg-cyan-500' : 'border-gray-300 dark:border-white/30')}>
            {confirmAll && <Check size={10} className="text-white" strokeWidth={3} />}
          </button>
          <div>
            <p className="text-sm font-semibold text-gray-800 dark:text-white">Confirm all reservations before adding to calendar</p>
            <p className="text-xs text-gray-400 dark:text-white/40 mt-0.5">New bookings from Google will appear as pending until approved by staff</p>
          </div>
        </div>

        <div className="px-5 py-4 grid sm:grid-cols-2 gap-4">
          <div>
            <label className="text-xs font-bold text-gray-500 dark:text-white/50 uppercase tracking-wide mb-1.5 block">Primary Action Feed</label>
            <select value={primaryFeed} onChange={e => setPrimaryFeed(e.target.value)}
              className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-white/10 rounded-xl bg-gray-50 dark:bg-white/5 dark:text-white focus:outline-none focus:border-cyan-500 transition-all">
              <option value="book_online">Book Online</option>
              <option value="schedule">Schedule Appointment</option>
              <option value="request">Request Appointment</option>
              <option value="quote">Get a Quote</option>
            </select>
            <p className="text-[11px] text-gray-400 dark:text-white/30 mt-1">Primary CTA shown in Google Search</p>
          </div>
          <div>
            <label className="text-xs font-bold text-gray-500 dark:text-white/50 uppercase tracking-wide mb-1.5 block">Services Feed</label>
            <select value={servicesFeed} onChange={e => setServicesFeed(e.target.value)}
              className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-white/10 rounded-xl bg-gray-50 dark:bg-white/5 dark:text-white focus:outline-none focus:border-cyan-500 transition-all">
              <option value="">-- Select a feed --</option>
              <option value="all">All Services</option>
              <option value="general">General Consultations</option>
              <option value="specialist">Specialist Services</option>
            </select>
            <p className="text-[11px] text-gray-400 dark:text-white/30 mt-1">Services shown in Google's booking panel</p>
          </div>
        </div>

        <div className="px-5 py-4">
          <label className="text-xs font-bold text-gray-500 dark:text-white/50 uppercase tracking-wide mb-2 block">Upload Custom Feed</label>
          <p className="text-xs text-gray-400 dark:text-white/40 mb-3">Upload a services feed file to make individual services bookable directly from Google</p>
          <div className="flex items-center gap-3">
            <div className="flex-1 max-w-xs px-3 py-2.5 text-sm border-2 border-dashed border-gray-300 dark:border-white/20 rounded-xl text-gray-400 dark:text-white/30 text-center">
              services-feed.csv or .xml
            </div>
            <input ref={fileRef} type="file" accept=".csv,.xml" className="hidden" />
            <button onClick={() => fileRef.current?.click()}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold text-white transition-all hover:-translate-y-0.5"
              style={{ background: 'linear-gradient(135deg,#1A237E,#29ABE2)' }}>
              <Upload size={14} /> Upload
            </button>
          </div>
        </div>

        <div className="px-5 py-4 flex justify-end">
          <button className="px-5 py-2 rounded-xl text-sm font-bold text-white transition-all hover:-translate-y-0.5"
            style={{ background: 'linear-gradient(135deg,#1A237E,#29ABE2)' }}>
            Save Settings
          </button>
        </div>

      </div>
    </div>
  )
}

// ── Main export ────────────────────────────────────────────────────────────────
export default function ConnectionsTab() {
  return (
    <div className="h-full overflow-y-auto">
      {/* Google Calendar notice */}
      <div className="mx-6 mt-5 p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700/40 rounded-xl">
        <p className="text-sm font-bold text-blue-800 dark:text-blue-300 mb-0.5">Google Calendar</p>
        <p className="text-xs text-blue-700 dark:text-blue-400">
          Google Calendar is managed under the <strong>Google Calendar tab</strong> above. Connect, disconnect, and sync appointments from there.
        </p>
      </div>
      <GoogleOrganicBookingTab />
    </div>
  )
}
