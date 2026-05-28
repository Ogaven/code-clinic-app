'use client'

import { useEffect } from 'react'
import Image from 'next/image'

declare global {
  interface Window {
    CodeClinicChatConfig?: Record<string, unknown>
  }
}

export default function ChatbotWidgetPage() {
  // Load the widget script
  useEffect(() => {
    window.CodeClinicChatConfig = {
      clinicId:     'codeclinic',
      primaryColor: '#29ABE2',
      avatarUrl:    'https://codeclinicemr.com/sarah.jpg',
    }

    const script = document.createElement('script')
    script.src   = 'https://api.codeclinicemr.com/widget.js'
    script.async = true
    document.body.appendChild(script)

    return () => { script.remove() }
  }, [])

  // Auto-open after 2 seconds by clicking the widget's own button
  useEffect(() => {
    const timer = setTimeout(() => {
      const btn = document.getElementById('cc-w-btn')
      if (btn) btn.click()
    }, 2000)
    return () => clearTimeout(timer)
  }, [])

  function openChat() {
    const btn = document.getElementById('cc-w-btn')
    if (btn) btn.click()
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'linear-gradient(160deg, #0c1e50 0%, #1A237E 45%, #0e3a5c 100%)' }}>

      {/* Top bar */}
      <header className="flex items-center justify-between px-6 py-4 sm:px-10 sm:py-5">
        <div className="flex items-center gap-3">
          <Image src="/icon.png" alt="Code Clinic" width={36} height={36} className="rounded-xl" />
          <span className="text-white font-black text-lg tracking-tight">Code Clinic</span>
        </div>
        <a
          href="https://codeclinicemr.com"
          className="text-xs text-white/50 hover:text-white/80 transition-colors"
        >
          codeclinicemr.com
        </a>
      </header>

      {/* Hero */}
      <main className="flex-1 flex flex-col items-center justify-center px-6 py-16 text-center">

        {/* Avatar ring */}
        <div className="relative mb-8">
          <div className="w-24 h-24 rounded-full overflow-hidden ring-4 ring-white/20 shadow-2xl shadow-cyan-500/30">
            <img
              src="/sarah.jpg"
              alt="Sarah"
              className="w-full h-full object-cover"
            />
          </div>
          {/* Online dot */}
          <span className="absolute bottom-1 right-1 w-5 h-5 bg-emerald-400 rounded-full border-2 border-[#0c1e50] shadow" />
        </div>

        <h1 className="text-3xl sm:text-4xl font-black text-white leading-tight mb-4 max-w-lg">
          Chat with Sarah,<br className="hidden sm:block" /> your AI dental assistant
        </h1>
        <p className="text-base text-white/60 max-w-md leading-relaxed mb-10">
          Get instant answers about appointments, services, and our doctors — available 24/7
        </p>

        <button
          onClick={openChat}
          className="flex items-center gap-3 px-8 py-4 rounded-2xl text-white font-bold text-base shadow-xl transition-all hover:-translate-y-0.5 hover:shadow-cyan-500/40 active:scale-95"
          style={{ background: 'linear-gradient(135deg, #29ABE2, #0e8fc0)' }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
          Start a conversation
        </button>

        {/* Feature pills */}
        <div className="flex flex-wrap justify-center gap-3 mt-12">
          {[
            'Book an appointment',
            'Ask about services',
            'Meet our doctors',
            'Operating hours',
          ].map(label => (
            <button
              key={label}
              onClick={openChat}
              className="px-4 py-2 rounded-full text-xs font-semibold text-white/70 border border-white/10 bg-white/5 hover:bg-white/10 hover:text-white/90 transition-all cursor-pointer"
            >
              {label}
            </button>
          ))}
        </div>
      </main>

      {/* Footer */}
      <footer className="py-6 text-center">
        <p className="text-xs text-white/25">
          Painless Dentistry, Lifesaving Smiles &bull; Kampala, Uganda
        </p>
      </footer>
    </div>
  )
}
