'use client'

// Global Sarah chatbot bubble — previously mounted only inside the Dashboard
// page, so it disappeared on every other Receptionist route. Extracted
// unchanged (same design, same /assistant/chat backend, same session state
// shape) and mounted once in (receptionist)/layout.tsx so it persists across
// navigation. `context.page` is now derived from the real current route
// instead of being hardcoded to 'Dashboard', so the assistant still knows
// where the receptionist actually is.

import { useEffect, useRef, useState } from 'react'
import Image from 'next/image'
import { useRouter, usePathname } from 'next/navigation'
import { Minimize2, Maximize2, Mic, MicOff, Send, X } from 'lucide-react'

type Msg = { from: 'sarah' | 'user'; text: string; time: string }

const PAGE_LABELS: { prefix: string; label: string }[] = [
  { prefix: '/receptionist/dashboard', label: 'Dashboard' },
  { prefix: '/receptionist/patients', label: 'Patients' },
  { prefix: '/receptionist/appointments', label: 'Appointments' },
  { prefix: '/receptionist/scheduling', label: 'Scheduling' },
  { prefix: '/receptionist/flow', label: 'Live Flow' },
  { prefix: '/receptionist/treatment-pipeline', label: 'Treatment Pipeline' },
  { prefix: '/receptionist/leads', label: 'Leads' },
  { prefix: '/receptionist/referrals', label: 'Referrals' },
  { prefix: '/receptionist/campaigns', label: 'Campaigns' },
  { prefix: '/receptionist/reports', label: 'Reports' },
  { prefix: '/receptionist/profile', label: 'Profile' },
  { prefix: '/receptionist/settings', label: 'Settings' },
  { prefix: '/receptionist/ai-suite', label: 'AI Suite' },
]

function pageLabelFor(pathname: string) {
  return PAGE_LABELS.find(p => pathname.startsWith(p.prefix))?.label || pathname
}

function nowTime() {
  return new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Nairobi' })
}

export default function SarahChatbot() {
  const router   = useRouter()
  const pathname = usePathname()
  const API      = '/api-proxy'

  const [chatOpen, setChatOpen]     = useState(false)
  const [chatMin, setChatMin]       = useState(false)
  const [msgs, setMsgs]             = useState<Msg[]>([])
  const [chatInput, setChatInput]   = useState('')
  const [typing, setTyping]         = useState(false)
  const [recording, setRec]         = useState(false)
  const [dragging, setDrag]         = useState(false)
  const [chatPos, setChatPos]       = useState({ x: 0, y: 0 })
  const [hasMoved, setHasMoved]     = useState(false)
  const [chatMessages, setChatMsgs] = useState<any[]>([])
  const messagesEnd = useRef<HTMLDivElement>(null)
  const recRef      = useRef<any>(null)
  const dragStart   = useRef({ mx: 0, my: 0, bx: 0, by: 0 })
  const bubbleRef   = useRef<HTMLDivElement>(null)

  const token = typeof window !== 'undefined' ? localStorage.getItem('cc_token') : null
  const authH = { Authorization: `Bearer ${token}` }

  const quickChips = [
    "Today's schedule", 'AI agent status', 'Any escalations?', 'Add patient',
  ]

  useEffect(() => {
    const stored = localStorage.getItem('cc_user')
    if (stored) {
      const u = JSON.parse(stored)
      setMsgs([{
        from: 'sarah',
        text: `Hello ${u.firstName}! 😊 I'm Sarah, your AI assistant. How can I help you today?`,
        time: nowTime(),
      }])
    }
  }, [])

  useEffect(() => {
    messagesEnd.current?.scrollIntoView({ behavior: 'smooth' })
  }, [msgs, typing])

  // Drag logic for chat bubble
  function onBubbleMouseDown(e: React.MouseEvent) {
    if ((e.target as HTMLElement).closest('button, input, textarea')) return
    e.preventDefault()
    setDrag(true)
    dragStart.current = { mx: e.clientX, my: e.clientY, bx: chatPos.x, by: chatPos.y }
  }
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging) return
      const dx = e.clientX - dragStart.current.mx
      const dy = e.clientY - dragStart.current.my
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) setHasMoved(true)
      setChatPos({ x: dragStart.current.bx + dx, y: dragStart.current.by + dy })
    }
    const onUp = () => { if (dragging) { setDrag(false); setTimeout(() => setHasMoved(false), 100) } }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    return () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp) }
  }, [dragging])

  async function sendChat(text?: string) {
    const msg = text || chatInput.trim()
    if (!msg) return
    setChatInput('')
    const userMsg: Msg = { from: 'user', text: msg, time: nowTime() }
    setMsgs(m => [...m, userMsg])
    setTyping(true)

    const newMessages = [...chatMessages, { role: 'user', content: msg }]
    setChatMsgs(newMessages)

    try {
      const res = await fetch(`${API}/assistant/chat`, {
        method: 'POST',
        headers: { ...authH, 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: newMessages, context: { page: pageLabelFor(pathname) } }),
      })
      const data = await res.json()
      const reply = data.content || data.error || 'Sorry, I had trouble with that.'
      setChatMsgs(m => [...m, { role: 'assistant', content: reply }])
      setMsgs(m => [...m, { from: 'sarah', text: reply, time: nowTime() }])

      // Handle client-side actions
      if (data.clientActions?.length) {
        for (const action of data.clientActions) {
          if (action.type === 'open_page') router.push(action.route)
        }
      }
    } catch {
      setMsgs(m => [...m, { from: 'sarah', text: "Sorry, I couldn't connect right now. Please try again! 🙏", time: nowTime() }])
    } finally { setTyping(false) }
  }

  function toggleRecording() {
    if (recording) { recRef.current?.stop(); setRec(false); return }
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SR) { sendChat("Voice input isn't supported in this browser."); return }
    const rec = new SR(); rec.lang = 'en-GB'; rec.interimResults = false
    rec.onresult = (e: any) => { const t = e.results[0][0].transcript; setChatInput(t); sendChat(t) }
    rec.onend = () => setRec(false); rec.onerror = () => setRec(false)
    recRef.current = rec; rec.start(); setRec(true)
  }

  return (
    <div
      ref={bubbleRef}
      style={{
        position: 'fixed',
        right: `${-chatPos.x + 24}px`,
        bottom: `${-chatPos.y + 24}px`,
        zIndex: 9999,
        cursor: dragging ? 'grabbing' : 'grab',
        userSelect: 'none',
        transition: dragging ? 'none' : 'right 0.2s, bottom 0.2s',
      }}
      onMouseDown={onBubbleMouseDown}
    >
      {/* Chat panel */}
      {chatOpen && !chatMin && (
        <div className="mb-4 rounded-3xl shadow-2xl overflow-hidden animate-slide-right"
          style={{ width: 360, background: 'linear-gradient(165deg, #0c1e50, #1a3a8f)', border: '1px solid rgba(255,255,255,0.12)', cursor: 'default' }}
          onMouseDown={e => e.stopPropagation()}>

          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/10"
            style={{ background: 'rgba(255,255,255,0.07)' }}>
            <div className="flex items-center gap-3">
              <div className="relative w-9 h-9 rounded-full overflow-hidden border-2 border-white/30">
                <Image src="/sarah.jpg" alt="Sarah" fill style={{ objectFit: 'cover', objectPosition: 'center top' }} />
              </div>
              <div>
                <p className="text-white text-sm font-bold">Sarah</p>
                <div className="flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse-dot" />
                  <p className="text-[10px] text-emerald-300">AI Assistant · Online</p>
                </div>
              </div>
            </div>
            <div className="flex gap-1">
              <button onClick={() => setChatMin(true)} className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-white/10 transition-colors">
                <Minimize2 size={13} color="rgba(255,255,255,0.6)" />
              </button>
              <button onClick={() => setChatOpen(false)} className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-white/10 transition-colors">
                <X size={13} color="rgba(255,255,255,0.6)" />
              </button>
            </div>
          </div>

          {/* Messages */}
          <div className="space-y-3 px-4 py-4 overflow-y-auto" style={{ maxHeight: 320 }}>
            {msgs.map((m, i) => (
              <div key={i} className={`flex ${m.from === 'user' ? 'justify-end' : 'items-start gap-2'}`}>
                {m.from === 'sarah' && (
                  <div className="w-7 h-7 rounded-full overflow-hidden flex-shrink-0 border border-white/20">
                    <Image src="/sarah.jpg" alt="Sarah" width={28} height={28} style={{ objectFit: 'cover', objectPosition: 'center top' }} />
                  </div>
                )}
                <div>
                  <div className="rounded-2xl px-3.5 py-2.5 text-xs leading-relaxed max-w-[230px] whitespace-pre-line"
                    style={{
                      background: m.from === 'sarah' ? 'rgba(255,255,255,0.1)' : 'linear-gradient(135deg,#29ABE2,#1A237E)',
                      color: 'white',
                      borderRadius: m.from === 'sarah' ? '4px 16px 16px 16px' : '16px 4px 16px 16px',
                    }}>
                    {m.text}
                  </div>
                  <p className="text-[9px] text-blue-300/40 mt-1 px-1">{m.time}</p>
                </div>
              </div>
            ))}
            {typing && (
              <div className="flex items-start gap-2">
                <div className="w-7 h-7 rounded-full overflow-hidden border border-white/20">
                  <Image src="/sarah.jpg" alt="" width={28} height={28} style={{ objectFit: 'cover', objectPosition: 'center top' }} />
                </div>
                <div className="rounded-2xl px-4 py-3" style={{ background: 'rgba(255,255,255,0.1)', borderRadius: '4px 16px 16px 16px' }}>
                  <div className="flex gap-1 items-center h-3">
                    {[0,1,2].map(j => <span key={j} className="w-1.5 h-1.5 rounded-full bg-blue-300 animate-bounce" style={{ animationDelay: `${j*0.15}s` }} />)}
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEnd} />
          </div>

          {/* Quick chips */}
          <div className="px-4 pb-2 flex flex-wrap gap-1.5">
            {quickChips.map(q => (
              <button key={q} onClick={() => sendChat(q)}
                className="text-[10px] font-medium px-2.5 py-1 rounded-full transition-all hover:bg-white/20"
                style={{ background: 'rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.8)', border: '1px solid rgba(255,255,255,0.15)' }}>
                {q}
              </button>
            ))}
          </div>

          {/* Input */}
          <div className="flex items-center gap-2 px-4 py-3 border-t border-white/10">
            <input
              value={chatInput}
              onChange={e => setChatInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendChat()}
              placeholder={recording ? '🎙 Listening...' : 'Ask Sarah anything...'}
              className="flex-1 text-xs py-2.5 px-3.5 rounded-xl outline-none placeholder-blue-300/50 text-white"
              style={{ background: 'rgba(255,255,255,0.08)', border: `1px solid ${recording ? 'rgba(236,72,153,0.5)' : 'rgba(255,255,255,0.14)'}` }}
              onMouseDown={e => e.stopPropagation()}
            />
            <button onClick={toggleRecording}
              className="w-9 h-9 rounded-xl flex items-center justify-center transition-all hover:scale-110 flex-shrink-0"
              style={{ background: recording ? 'rgba(236,72,153,0.4)' : 'rgba(255,255,255,0.1)', border: `1px solid ${recording ? 'rgba(236,72,153,0.5)' : 'rgba(255,255,255,0.15)'}` }}>
              {recording ? <MicOff size={14} color="#EC4899" className="animate-pulse" /> : <Mic size={14} color="rgba(255,255,255,0.7)" />}
            </button>
            <button onClick={() => sendChat()}
              className="w-9 h-9 rounded-xl flex items-center justify-center transition-all hover:scale-110 flex-shrink-0"
              style={{ background: 'linear-gradient(135deg,#29ABE2,#1A237E)' }}>
              <Send size={14} color="white" />
            </button>
          </div>
        </div>
      )}

      {/* Minimised bar */}
      {chatOpen && chatMin && (
        <div className="mb-4 flex items-center gap-3 px-4 py-2.5 rounded-2xl shadow-xl cursor-pointer"
          style={{ background: 'linear-gradient(135deg, #0c1e50, #1a3a8f)', border: '1px solid rgba(255,255,255,0.15)' }}
          onClick={() => setChatMin(false)} onMouseDown={e => e.stopPropagation()}>
          <div className="relative w-7 h-7 rounded-full overflow-hidden border border-white/30">
            <Image src="/sarah.jpg" alt="Sarah" fill style={{ objectFit: 'cover', objectPosition: 'center top' }} />
          </div>
          <span className="text-white text-xs font-semibold">Sarah AI</span>
          <Maximize2 size={12} color="rgba(255,255,255,0.5)" />
        </div>
      )}

      {/* Floating bubble */}
      <div
        onClick={() => { if (!hasMoved) setChatOpen(o => !o) }}
        className={`select-none cursor-pointer ${!dragging && !chatOpen ? 'animate-float' : ''}`}
        style={{ position: 'relative', width: 64, height: 64 }}
      >
        <div className="absolute rounded-full animate-pulse pointer-events-none"
          style={{ inset: -8, background: 'radial-gradient(circle,rgba(41,171,226,0.5),transparent)', opacity: 0.7 }} />
        <div style={{ width: 64, height: 64, borderRadius: '50%', overflow: 'hidden', border: '3px solid rgba(255,255,255,0.35)', boxShadow: '0 8px 32px rgba(0,0,0,0.3)', position: 'relative' }}>
          <Image src="/sarah.jpg" alt="Sarah" fill sizes="64px" style={{ objectFit: 'cover', objectPosition: 'center top' }} />
        </div>
        <span className="absolute animate-pulse-dot"
          style={{ bottom: 2, right: 2, width: 14, height: 14, borderRadius: '50%', background: '#34D399', border: '2.5px solid white', display: 'block' }} />
      </div>
    </div>
  )
}
