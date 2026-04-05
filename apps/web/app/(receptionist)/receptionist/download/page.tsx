'use client'

import { useEffect, useState } from 'react'
import Image from 'next/image'
import {
  Smartphone, Monitor, Globe, Download, CheckCircle2,
  Chrome, Apple, Play, QrCode, Wifi, Bell, Zap,
} from 'lucide-react'
import { cn } from '@/lib/utils'

export default function DownloadPage() {
  const [installPrompt, setInstallPrompt] = useState<any>(null)
  const [installed, setInstalled]         = useState(false)
  const [platform, setPlatform]           = useState<'windows' | 'mac' | 'android' | 'ios' | 'other'>('other')

  useEffect(() => {
    // Detect OS
    const ua = navigator.userAgent
    if (/Windows/i.test(ua))       setPlatform('windows')
    else if (/Mac/i.test(ua))      setPlatform('mac')
    else if (/Android/i.test(ua))  setPlatform('android')
    else if (/iPhone|iPad/i.test(ua)) setPlatform('ios')

    // PWA install prompt
    const handler = (e: Event) => { e.preventDefault(); setInstallPrompt(e) }
    window.addEventListener('beforeinstallprompt', handler)
    window.addEventListener('appinstalled', () => setInstalled(true))
    if (window.matchMedia('(display-mode: standalone)').matches) setInstalled(true)
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  async function handleInstall() {
    if (!installPrompt) return
    installPrompt.prompt()
    const { outcome } = await installPrompt.userChoice
    if (outcome === 'accepted') setInstalled(true)
    setInstallPrompt(null)
  }

  const features = [
    { icon: Wifi,  label: 'Works offline', desc: 'Access key features even without internet' },
    { icon: Bell,  label: 'Push notifications', desc: 'Get alerts for new appointments & escalations' },
    { icon: Zap,   label: 'Lightning fast', desc: 'Native app performance on any device' },
    { icon: Globe, label: 'Cross-platform', desc: 'One app for all your devices' },
  ]

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-8">

      {/* Header */}
      <div className="text-center">
        <div className="inline-flex items-center justify-center w-20 h-20 rounded-3xl mb-4 shadow-xl"
          style={{ background: 'linear-gradient(135deg, #0c1e50, #29ABE2)' }}>
          <Image src="/logo.png" alt="Code Clinic" width={50} height={50} className="object-contain brightness-0 invert" />
        </div>
        <h1 className="text-3xl font-black text-gray-800 dark:text-white mb-2">Download Code Clinic</h1>
        <p className="text-gray-500 dark:text-white/50 max-w-md mx-auto">
          Install the app on your phone or desktop for the full experience — works offline, instant notifications.
        </p>
      </div>

      {/* PWA install card */}
      {!installed ? (
        <div className="relative overflow-hidden rounded-3xl p-6 text-white text-center shadow-2xl"
          style={{ background: 'linear-gradient(135deg, #0c1e50, #1565C0, #29ABE2)' }}>
          <div className="absolute inset-0 opacity-10" style={{
            backgroundImage: 'radial-gradient(circle at 20% 80%, white 0%, transparent 50%), radial-gradient(circle at 80% 20%, white 0%, transparent 50%)',
          }} />
          <div className="relative z-10">
            <p className="text-xs font-bold uppercase tracking-widest text-cyan-300 mb-2">Recommended</p>
            <h2 className="text-2xl font-black mb-2">Install App Now</h2>
            <p className="text-white/70 text-sm mb-5">One click to install — no app store needed</p>
            {installPrompt ? (
              <button onClick={handleInstall}
                className="inline-flex items-center gap-2 px-8 py-3.5 rounded-2xl bg-white text-blue-900 font-black text-sm hover:shadow-xl hover:-translate-y-1 transition-all">
                <Download size={18} /> Install on this Device
              </button>
            ) : (
              <div className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-white/10 text-sm font-medium">
                <CheckCircle2 size={16} className="text-green-400" />
                Open this page in Chrome/Edge to install
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-3 p-5 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-700/30 rounded-2xl">
          <CheckCircle2 size={24} className="text-emerald-500 flex-shrink-0" />
          <div>
            <p className="font-bold text-emerald-700 dark:text-emerald-400">App installed!</p>
            <p className="text-sm text-emerald-600 dark:text-emerald-500">Code Clinic is now on your device. Look for it in your apps.</p>
          </div>
        </div>
      )}

      {/* App features */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {features.map(({ icon: Icon, label, desc }) => (
          <div key={label} className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/8 p-4 text-center shadow-sm hover:shadow-md transition-all">
            <div className="w-11 h-11 rounded-xl flex items-center justify-center mx-auto mb-3"
              style={{ background: 'linear-gradient(135deg,#0c1e50,#29ABE2)' }}>
              <Icon size={18} className="text-white" />
            </div>
            <p className="text-sm font-bold text-gray-800 dark:text-white mb-1">{label}</p>
            <p className="text-xs text-gray-400 dark:text-white/40 leading-relaxed">{desc}</p>
          </div>
        ))}
      </div>

      {/* Platform-specific instructions */}
      <div className="grid md:grid-cols-2 gap-6">

        {/* Desktop */}
        <div className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/8 shadow-sm overflow-hidden">
          <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-100 dark:border-white/8"
            style={{ background: platform === 'windows' || platform === 'mac' ? 'linear-gradient(135deg,#0c1e5010,#29ABE210)' : 'transparent' }}>
            <Monitor size={20} className="text-blue-600 dark:text-cyan-400" />
            <div>
              <h3 className="font-bold text-gray-800 dark:text-white">Desktop App</h3>
              <p className="text-xs text-gray-400 dark:text-white/40">Windows & Mac</p>
            </div>
            {(platform === 'windows' || platform === 'mac') && (
              <span className="ml-auto text-xs font-bold bg-cyan-500 text-white px-2 py-0.5 rounded-full">Your Device</span>
            )}
          </div>
          <div className="p-5 space-y-3">
            <p className="text-sm text-gray-600 dark:text-white/60 font-medium">Install via Chrome or Edge browser:</p>
            {[
              { step: '1', text: 'Open Code Clinic in Chrome or Microsoft Edge' },
              { step: '2', text: 'Click the install icon (⊕) in the address bar' },
              { step: '3', text: 'Click "Install" in the popup that appears' },
              { step: '4', text: 'App opens in its own window — find it in your Start Menu or Dock' },
            ].map(({ step, text }) => (
              <div key={step} className="flex items-start gap-3">
                <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-black text-white flex-shrink-0 mt-0.5"
                  style={{ background: 'linear-gradient(135deg,#0c1e50,#29ABE2)' }}>
                  {step}
                </div>
                <p className="text-sm text-gray-700 dark:text-white/70">{text}</p>
              </div>
            ))}
            <div className="flex gap-2 pt-2">
              <div className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-100 dark:bg-white/8 rounded-lg">
                <Chrome size={13} className="text-blue-500" />
                <span className="text-xs font-medium text-gray-600 dark:text-white/60">Chrome</span>
              </div>
              <div className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-100 dark:bg-white/8 rounded-lg">
                <Globe size={13} className="text-blue-700" />
                <span className="text-xs font-medium text-gray-600 dark:text-white/60">Edge</span>
              </div>
            </div>
          </div>
        </div>

        {/* Mobile */}
        <div className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/8 shadow-sm overflow-hidden">
          <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-100 dark:border-white/8"
            style={{ background: platform === 'android' || platform === 'ios' ? 'linear-gradient(135deg,#0c1e5010,#29ABE210)' : 'transparent' }}>
            <Smartphone size={20} className="text-purple-600 dark:text-purple-400" />
            <div>
              <h3 className="font-bold text-gray-800 dark:text-white">Mobile App</h3>
              <p className="text-xs text-gray-400 dark:text-white/40">Android & iOS</p>
            </div>
            {(platform === 'android' || platform === 'ios') && (
              <span className="ml-auto text-xs font-bold bg-purple-500 text-white px-2 py-0.5 rounded-full">Your Device</span>
            )}
          </div>
          <div className="p-5 space-y-4">
            {/* Android */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Play size={14} className="text-emerald-500" />
                <p className="text-sm font-bold text-gray-700 dark:text-white/70">Android (Chrome)</p>
              </div>
              {[
                'Open Code Clinic in Chrome on your Android phone',
                'Tap the 3-dot menu (⋮) in the top right',
                'Tap "Add to Home screen" or "Install App"',
                'Tap "Install" — the app icon appears on your home screen',
              ].map((text, i) => (
                <div key={i} className="flex items-start gap-2.5 mb-2">
                  <span className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-black text-white flex-shrink-0 mt-0.5 bg-emerald-500">{i + 1}</span>
                  <p className="text-xs text-gray-600 dark:text-white/60">{text}</p>
                </div>
              ))}
            </div>

            <div className="border-t border-gray-100 dark:border-white/8 pt-4">
              <div className="flex items-center gap-2 mb-2">
                <Apple size={14} className="text-gray-700 dark:text-white/70" />
                <p className="text-sm font-bold text-gray-700 dark:text-white/70">iPhone / iPad (Safari)</p>
              </div>
              {[
                'Open Code Clinic in Safari on your iPhone or iPad',
                'Tap the Share button (square with arrow) at the bottom',
                'Scroll down and tap "Add to Home Screen"',
                'Tap "Add" — the app icon appears on your home screen',
              ].map((text, i) => (
                <div key={i} className="flex items-start gap-2.5 mb-2">
                  <span className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-black text-white flex-shrink-0 mt-0.5 bg-gray-700 dark:bg-white/30">{i + 1}</span>
                  <p className="text-xs text-gray-600 dark:text-white/60">{text}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* QR Code */}
      <div className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/8 shadow-sm p-6">
        <div className="flex items-center gap-6">
          <div className="flex-shrink-0">
            <div className="w-28 h-28 rounded-2xl bg-gray-100 dark:bg-white/10 flex items-center justify-center">
              <QrCode size={64} className="text-gray-400 dark:text-white/30" />
            </div>
          </div>
          <div>
            <div className="flex items-center gap-2 mb-1">
              <QrCode size={16} className="text-cyan-500" />
              <h3 className="font-bold text-gray-800 dark:text-white">Scan to Open on Mobile</h3>
            </div>
            <p className="text-sm text-gray-500 dark:text-white/50 mb-3">
              Point your phone camera at the QR code to open Code Clinic on your mobile device, then follow the installation steps above.
            </p>
            <p className="text-xs text-gray-400 dark:text-white/30 font-mono bg-gray-50 dark:bg-white/5 px-3 py-1.5 rounded-lg inline-block">
              {typeof window !== 'undefined' ? window.location.origin : 'https://codeclinic.ug'}
            </p>
          </div>
        </div>
      </div>

      {/* Share with team */}
      <div className="bg-gradient-to-r from-[#0c1e50] to-[#1565C0] rounded-2xl p-6 text-white text-center">
        <h3 className="font-black text-lg mb-1">Share with your team</h3>
        <p className="text-white/70 text-sm mb-4">Send the install link to doctors, staff, and other receptionists</p>
        <div className="flex items-center gap-3 max-w-sm mx-auto">
          <input
            readOnly
            value={typeof window !== 'undefined' ? window.location.origin : 'https://codeclinic.ug'}
            className="flex-1 px-4 py-2.5 rounded-xl bg-white/10 text-white text-sm outline-none border border-white/20 font-mono"
          />
          <button
            onClick={() => { navigator.clipboard.writeText(typeof window !== 'undefined' ? window.location.origin : 'https://codeclinic.ug'); }}
            className="px-4 py-2.5 rounded-xl bg-white text-blue-900 font-bold text-sm hover:shadow-lg transition-all">
            Copy
          </button>
        </div>
      </div>
    </div>
  )
}
