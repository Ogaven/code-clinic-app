'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Smartphone, Apple, MonitorSmartphone, Wifi, Bell, Zap, Shield, Download } from 'lucide-react'
import { cn } from '@/lib/utils'

const APP_URL = 'https://codeclinicemr.com'
const QR_URL  = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(APP_URL)}&bgcolor=ffffff&color=1A237E&margin=10`

const BENEFITS = [
  { icon: Bell,             label: 'Push Notifications',  desc: 'Get instant alerts for new appointments, escalations, and messages' },
  { icon: Wifi,             label: 'Works Offline',        desc: 'View your schedule even without internet — syncs when reconnected' },
  { icon: Zap,              label: 'Fast & Lightweight',   desc: 'Loads instantly, no app store required — add directly to home screen' },
  { icon: Shield,           label: 'Secure',               desc: 'Same secure login as the web — your token never leaves your device' },
  { icon: MonitorSmartphone,label: 'Responsive UI',        desc: 'Optimised for mobile with thumb-friendly navigation and large tap targets' },
]

export default function DoctorDownloadPage() {
  const [tab, setTab] = useState<'ios' | 'android'>('ios')

  return (
    <div className="space-y-5 p-4 md:p-6 pb-24 md:pb-6 animate-fade-in max-w-2xl">

      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href="/doctor/dashboard" className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-white/10 text-gray-400 transition-colors">
          <ArrowLeft size={16} />
        </Link>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-gray-800 dark:text-white">Download App</h1>
          <p className="text-sm text-gray-400 mt-0.5">Add Code Clinic to your home screen</p>
        </div>
      </div>

      {/* Hero card */}
      <div className="bg-gradient-to-br from-[#1A237E] via-[#1565C0] to-[#29ABE2] rounded-2xl p-6 text-center">
        <div className="w-16 h-16 bg-white/20 rounded-2xl flex items-center justify-center mx-auto mb-4">
          <Smartphone size={32} className="text-white" />
        </div>
        <h2 className="text-lg font-bold text-white mb-1">Code Clinic PWA</h2>
        <p className="text-blue-100 text-sm mb-4">No App Store needed — install directly from your browser in seconds</p>
        {/* QR Code */}
        <div className="inline-block bg-white p-3 rounded-xl">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={QR_URL}
            alt="QR code to open Code Clinic"
            width={160}
            height={160}
            className="rounded-lg"
          />
        </div>
        <p className="text-blue-200 text-xs mt-2">Scan to open on your phone</p>
      </div>

      {/* Install instructions tabs */}
      <div className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/10 shadow-sm overflow-hidden">
        <div className="flex border-b border-gray-100 dark:border-white/[0.06]">
          <button
            onClick={() => setTab('ios')}
            className={cn('flex-1 flex items-center justify-center gap-2 py-3.5 text-sm font-semibold transition-colors',
              tab === 'ios' ? 'text-blue-600 dark:text-blue-400 border-b-2 border-blue-500 -mb-px' : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-200')}>
            <Apple size={15} />
            iPhone / iPad
          </button>
          <button
            onClick={() => setTab('android')}
            className={cn('flex-1 flex items-center justify-center gap-2 py-3.5 text-sm font-semibold transition-colors',
              tab === 'android' ? 'text-blue-600 dark:text-blue-400 border-b-2 border-blue-500 -mb-px' : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-200')}>
            <Smartphone size={15} />
            Android
          </button>
        </div>

        <div className="p-5">
          {tab === 'ios' ? (
            <ol className="space-y-4">
              {[
                { step: '1', title: 'Open in Safari', desc: 'Open this URL in Safari (not Chrome): codeclinicemr.com' },
                { step: '2', title: 'Tap the Share button', desc: 'Tap the Share icon at the bottom of the screen — it looks like a box with an arrow pointing up.' },
                { step: '3', title: 'Add to Home Screen', desc: 'Scroll down in the share sheet and tap "Add to Home Screen".' },
                { step: '4', title: 'Name & confirm', desc: 'Leave the name as "Code Clinic" and tap "Add" in the top-right corner.' },
                { step: '5', title: 'Open from home screen', desc: 'The app icon appears on your home screen. Tap it to launch — it opens full screen, no browser chrome.' },
              ].map(({ step, title, desc }) => (
                <li key={step} className="flex gap-4">
                  <div className="w-7 h-7 rounded-full bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-300 flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5">
                    {step}
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-gray-700 dark:text-white">{title}</p>
                    <p className="text-xs text-gray-400 dark:text-gray-400 mt-0.5 leading-relaxed">{desc}</p>
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <ol className="space-y-4">
              {[
                { step: '1', title: 'Open in Chrome', desc: 'Open this URL in Chrome on Android: codeclinicemr.com' },
                { step: '2', title: 'Tap the three-dot menu', desc: 'Tap the ⋮ menu in the top-right corner of Chrome.' },
                { step: '3', title: 'Add to Home screen', desc: 'Tap "Add to Home screen" from the menu.' },
                { step: '4', title: 'Confirm installation', desc: 'A prompt appears — tap "Add". The app installs like a native app.' },
                { step: '5', title: 'Launch from home screen', desc: 'Find the Code Clinic icon on your home screen or app drawer. It opens in its own window.' },
              ].map(({ step, title, desc }) => (
                <li key={step} className="flex gap-4">
                  <div className="w-7 h-7 rounded-full bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-300 flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5">
                    {step}
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-gray-700 dark:text-white">{title}</p>
                    <p className="text-xs text-gray-400 dark:text-gray-400 mt-0.5 leading-relaxed">{desc}</p>
                  </div>
                </li>
              ))}
            </ol>
          )}

          <a
            href={APP_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-5 flex items-center justify-center gap-2 w-full py-3 rounded-xl font-bold text-sm text-white hover:-translate-y-0.5 transition-all"
            style={{ background: 'linear-gradient(135deg,#1A237E,#29ABE2)' }}
          >
            <Download size={15} />
            Open Code Clinic
          </a>
        </div>
      </div>

      {/* Benefits */}
      <div className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/10 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-50 dark:border-white/[0.06]">
          <h2 className="font-bold text-gray-800 dark:text-white">Why install the app?</h2>
        </div>
        <div className="divide-y divide-gray-50 dark:divide-white/[0.04]">
          {BENEFITS.map(({ icon: Icon, label, desc }) => (
            <div key={label} className="flex items-start gap-4 px-5 py-4">
              <div className="w-9 h-9 rounded-xl bg-blue-50 dark:bg-blue-900/30 flex items-center justify-center flex-shrink-0">
                <Icon size={16} className="text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <p className="text-sm font-semibold text-gray-700 dark:text-white">{label}</p>
                <p className="text-xs text-gray-400 mt-0.5 leading-relaxed">{desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
