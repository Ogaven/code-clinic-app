'use client'

import React, { useEffect, useRef, useState } from 'react'
import Image from 'next/image'
import { X, Send, Minimize2, Mic, MicOff, GripHorizontal } from 'lucide-react'

type Msg = { from: 'sarah' | 'user'; text: string; time: string }

function nowTime() {
  return new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Nairobi' })
}

const GREETINGS: Msg[] = [
  { from: 'sarah', text: "Hello Doctor! 👋 I'm Sarah, your personal AI assistant at Code Clinic.", time: nowTime() },
  { from: 'sarah', text: "Ask me about your schedule, patient records, clinical features, or navigating the app. 🦷", time: nowTime() },
]

export default function DoctorSarahChatbot() {
  const [open, setOpen]         = useState(false)
  const [minimised, setMin]     = useState(false)
  const [msgs, setMsgs]         = useState<Msg[]>(GREETINGS)
  const [input, setInput]       = useState('')
  const [typing, setTyping]     = useState(false)
  const [recording, setRec]     = useState(false)
  const [chatHistory, setHistory] = useState<{ role: string; content: string }[]>([])
  const [user, setUser]         = useState<any>(null)
  const [isMobile, setIsMobile] = useState(false)

  // Drag state (desktop only)
  const [pos, setPos]           = useState({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const [hasMoved, setHasMoved] = useState(false)
  const dragStart               = useRef({ mx: 0, my: 0, bx: 0, by: 0 })
  const bubbleRef               = useRef<HTMLDivElement>(null)
  const messagesEl              = useRef<HTMLDivElement>(null)
  const recRef                  = useRef<any>(null)

  useEffect(() => {
    const stored = localStorage.getItem('cc_user')
    if (stored) setUser(JSON.parse(stored))
  }, [])

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 640)
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  useEffect(() => {
    if (messagesEl.current) messagesEl.current.scrollTop = messagesEl.current.scrollHeight
  }, [msgs, typing])

  // Mouse drag (desktop)
  function onMouseDown(e: React.MouseEvent) {
    if (isMobile) return
    if ((e.target as HTMLElement).closest('button,input,textarea,a')) return
    e.preventDefault()
    setDragging(true)
    dragStart.current = { mx: e.clientX, my: e.clientY, bx: pos.x, by: pos.y }
  }
  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!dragging) return
      const dx = e.clientX - dragStart.current.mx
      const dy = e.clientY - dragStart.current.my
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) setHasMoved(true)
      setPos({ x: dragStart.current.bx + dx, y: dragStart.current.by + dy })
    }
    function onUp() { if (dragging) { setDragging(false); setTimeout(() => setHasMoved(false), 100) } }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    return () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp) }
  }, [dragging])

  // Touch drag (desktop only — mobile uses full-screen)
  function onTouchStart(e: React.TouchEvent) {
    if (isMobile) return
    const t = e.touches[0]
    setDragging(true)
    dragStart.current = { mx: t.clientX, my: t.clientY, bx: pos.x, by: pos.y }
  }
  useEffect(() => {
    function onMove(e: TouchEvent) {
      if (!dragging || isMobile) return
      const t = e.touches[0]
      setPos({ x: dragStart.current.bx + t.clientX - dragStart.current.mx, y: dragStart.current.by + t.clientY - dragStart.current.my })
      setHasMoved(true)
    }
    function onEnd() { setDragging(false); setTimeout(() => setHasMoved(false), 100) }
    document.addEventListener('touchmove', onMove, { passive: false })
    document.addEventListener('touchend', onEnd)
    return () => { document.removeEventListener('touchmove', onMove); document.removeEventListener('touchend', onEnd) }
  }, [dragging, isMobile])

  function handleBubbleClick() { if (!hasMoved) setOpen(o => !o) }

  function toggleRecording() {
    if (recording) { recRef.current?.stop(); setRec(false); return }
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SR) { sendMessage("Voice input isn't supported in this browser."); return }
    const r = new SR(); r.lang = 'en-GB'; r.interimResults = false
    r.onresult = (e: any) => { const t = e.results[0][0].transcript; setInput(t); sendMessage(t) }
    r.onend = () => setRec(false); r.onerror = () => setRec(false)
    recRef.current = r; r.start(); setRec(true)
  }

  async function sendMessage(text?: string) {
    const msg = text || input.trim()
    if (!msg) return
    const time = nowTime()
    setMsgs(m => [...m, { from: 'user', text: msg, time }])
    setInput('')
    setTyping(true)
    const doctorName = user ? `Dr. ${user.firstName} ${user.lastName}` : 'the doctor'
    const newHistory = [...chatHistory, { role: 'user', content: msg }]
    setHistory(newHistory)
    try {
      const token = localStorage.getItem('cc_token')
      const res = await fetch('/api-proxy/assistant/chat', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: newHistory,
          context: {
            page: window.location.pathname,
            systemOverride: `You are Sarah, AI assistant for ${doctorName} at Code Clinic dental practice, Kampala Uganda. Help them navigate the app, check their schedule, find patient records, and understand clinical features. Be concise and professional. If they ask about patients, remind them to use the My Patients page.`,
          },
        }),
      })
      const data = await res.json()
      const reply = data.content || "I'm here to help! 🦷"
      setHistory(h => [...h, { role: 'assistant', content: reply }])
      setMsgs(m => [...m, { from: 'sarah', text: reply, time: nowTime() }])
    } catch {
      setMsgs(m => [...m, { from: 'sarah', text: "Sorry, I couldn't connect right now. Please try again! 🙏", time: nowTime() }])
    } finally { setTyping(false) }
  }

  // Desktop wrapper style (fixed, draggable)
  const wrapStyle: React.CSSProperties = {
    position: 'fixed',
    right: `${-pos.x + 24}px`,
    bottom: `${-pos.y + 24}px`,
    zIndex: 9999,
    cursor: dragging ? 'grabbing' : 'grab',
    userSelect: 'none',
    transition: dragging ? 'none' : 'right 0.2s, bottom 0.2s',
  }

  // ── Mobile full-screen overlay ─────────────────────────────────────────────
  if (isMobile && open && !minimised) {
    return (
      <div className="fixed inset-0 z-[9999] flex flex-col"
        style={{ background: 'linear-gradient(145deg,#0d1b6e,#1A237E)' }}>
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10"
          style={{ paddingTop: 'calc(env(safe-area-inset-top) + 12px)' }}>
          <div className="flex items-center gap-3">
            <div className="relative w-9 h-9 rounded-full overflow-hidden border-2 border-white/30">
              <Image src="/sarah.jpg" alt="Sarah" fill style={{ objectFit: 'cover', objectPosition: 'center top' }} />
            </div>
            <div>
              <p className="text-white text-sm font-bold">Sarah</p>
              <div className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                <p className="text-[10px] text-emerald-300">Doctor Assistant · Online</p>
              </div>
            </div>
          </div>
          <button onClick={() => setOpen(false)}
            className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-white/10 text-white/70 transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Messages */}
        <div ref={messagesEl} className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
          {msgs.map((m, i) => (
            <div key={i} className={`flex gap-2 ${m.from === 'user' ? 'justify-end' : 'items-start'}`}>
              {m.from === 'sarah' && (
                <div className="relative w-7 h-7 rounded-full overflow-hidden flex-shrink-0 border border-white/20">
                  <Image src="/sarah.jpg" alt="Sarah" fill style={{ objectFit: 'cover', objectPosition: 'center top' }} />
                </div>
              )}
              <div className={`max-w-[80%] px-3 py-2 rounded-2xl text-sm leading-relaxed ${
                m.from === 'user'
                  ? 'bg-white/20 text-white rounded-tr-sm'
                  : 'bg-white/10 text-white/90 rounded-tl-sm'
              }`}>
                {m.text}
                <p className="text-[9px] text-white/40 mt-1 text-right">{m.time}</p>
              </div>
            </div>
          ))}
          {typing && (
            <div className="flex items-center gap-2">
              <div className="relative w-7 h-7 rounded-full overflow-hidden border border-white/20">
                <Image src="/sarah.jpg" alt="Sarah" fill style={{ objectFit: 'cover', objectPosition: 'center top' }} />
              </div>
              <div className="bg-white/10 rounded-2xl rounded-tl-sm px-3 py-2 flex gap-1">
                {[0,1,2].map(i => <span key={i} className="w-1.5 h-1.5 bg-white/60 rounded-full animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />)}
              </div>
            </div>
          )}
        </div>

        {/* Input */}
        <div className="px-4 py-3 border-t border-white/10"
          style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 12px)' }}>
          <form onSubmit={e => { e.preventDefault(); sendMessage() }} className="flex gap-2 items-center">
            <button type="button" onClick={toggleRecording}
              className={`w-10 h-10 flex items-center justify-center rounded-full flex-shrink-0 transition-colors ${recording ? 'bg-red-500 animate-pulse' : 'bg-white/10 hover:bg-white/20'}`}>
              {recording ? <MicOff size={16} className="text-white" /> : <Mic size={16} className="text-white/60" />}
            </button>
            <input value={input} onChange={e => setInput(e.target.value)}
              placeholder="Ask Sarah anything…"
              className="flex-1 bg-white/10 text-white placeholder-white/40 text-base rounded-2xl px-4 py-3 focus:outline-none focus:ring-1 focus:ring-white/30"
              style={{ fontSize: 16 }}
            />
            <button type="submit" disabled={!input.trim()}
              className="w-10 h-10 flex items-center justify-center rounded-full bg-white/20 hover:bg-white/30 disabled:opacity-40 transition-colors flex-shrink-0">
              <Send size={16} className="text-white" />
            </button>
          </form>
        </div>
      </div>
    )
  }

  // ── Desktop floating chatbot ───────────────────────────────────────────────
  return (
    <div ref={bubbleRef} style={wrapStyle} onMouseDown={onMouseDown} onTouchStart={onTouchStart}>

      {/* Chat panel */}
      {open && !minimised && (
        <div className="mb-4 rounded-3xl shadow-2xl overflow-hidden"
          style={{ width: 380, background: 'linear-gradient(145deg,#0d1b6e,#1A237E)', border: '1px solid rgba(255,255,255,0.15)', cursor: 'default' }}
          onMouseDown={e => e.stopPropagation()}>

          {/* Drag handle */}
          <div className="flex items-center justify-center py-1.5 cursor-grab active:cursor-grabbing"
            style={{ background: 'rgba(0,0,0,0.15)' }}
            onMouseDown={e => { e.stopPropagation(); onMouseDown(e as any) }}>
            <GripHorizontal size={16} className="text-white/40" />
          </div>

          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3"
            style={{ background: 'rgba(255,255,255,0.08)', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
            <div className="flex items-center gap-3">
              <div className="relative w-9 h-9 rounded-full overflow-hidden border-2 border-white/30">
                <Image src="/sarah.jpg" alt="Sarah" fill style={{ objectFit: 'cover', objectPosition: 'center top' }} />
              </div>
              <div>
                <p className="text-white text-sm font-bold">Sarah</p>
                <div className="flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  <p className="text-[10px] text-emerald-300">Doctor Assistant · Online</p>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button onClick={() => setMin(true)}
                className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-white/10 text-white/60 transition-colors">
                <Minimize2 size={13} />
              </button>
              <button onClick={() => setOpen(false)}
                className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-white/10 text-white/60 transition-colors">
                <X size={13} />
              </button>
            </div>
          </div>

          {/* Messages */}
          <div ref={messagesEl} className="overflow-y-auto px-4 py-3 space-y-3" style={{ height: 380 }}>
            {msgs.map((m, i) => (
              <div key={i} className={`flex gap-2 ${m.from === 'user' ? 'justify-end' : 'items-start'}`}>
                {m.from === 'sarah' && (
                  <div className="relative w-7 h-7 rounded-full overflow-hidden flex-shrink-0 border border-white/20">
                    <Image src="/sarah.jpg" alt="Sarah" fill style={{ objectFit: 'cover', objectPosition: 'center top' }} />
                  </div>
                )}
                <div className={`max-w-[80%] px-3 py-2 rounded-2xl text-sm leading-relaxed ${
                  m.from === 'user'
                    ? 'bg-white/20 text-white rounded-tr-sm'
                    : 'bg-white/10 text-white/90 rounded-tl-sm'
                }`}>
                  {m.text}
                  <p className="text-[9px] text-white/40 mt-1 text-right">{m.time}</p>
                </div>
              </div>
            ))}
            {typing && (
              <div className="flex items-center gap-2">
                <div className="relative w-7 h-7 rounded-full overflow-hidden border border-white/20">
                  <Image src="/sarah.jpg" alt="Sarah" fill style={{ objectFit: 'cover', objectPosition: 'center top' }} />
                </div>
                <div className="bg-white/10 rounded-2xl rounded-tl-sm px-3 py-2 flex gap-1">
                  {[0,1,2].map(i => <span key={i} className="w-1.5 h-1.5 bg-white/60 rounded-full animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />)}
                </div>
              </div>
            )}
          </div>

          {/* Input */}
          <div className="px-3 py-3 border-t border-white/10">
            <form onSubmit={e => { e.preventDefault(); sendMessage() }} className="flex gap-2 items-center">
              <button type="button" onClick={toggleRecording}
                className={`w-8 h-8 flex items-center justify-center rounded-full flex-shrink-0 transition-colors ${recording ? 'bg-red-500 animate-pulse' : 'bg-white/10 hover:bg-white/20'}`}>
                {recording ? <MicOff size={14} className="text-white" /> : <Mic size={14} className="text-white/60" />}
              </button>
              <input value={input} onChange={e => setInput(e.target.value)}
                placeholder="Ask Sarah anything…"
                className="flex-1 bg-white/10 text-white placeholder-white/40 text-sm rounded-2xl px-3 py-2 focus:outline-none focus:ring-1 focus:ring-white/30"
              />
              <button type="submit" disabled={!input.trim()}
                className="w-8 h-8 flex items-center justify-center rounded-full bg-white/20 hover:bg-white/30 disabled:opacity-40 transition-colors flex-shrink-0">
                <Send size={13} className="text-white" />
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Minimised bar */}
      {open && minimised && (
        <div className="mb-4 flex items-center gap-3 px-4 py-2.5 rounded-2xl shadow-xl cursor-pointer"
          style={{ background: 'linear-gradient(135deg,#0d1b6e,#1A237E)', border: '1px solid rgba(255,255,255,0.15)' }}
          onMouseDown={e => e.stopPropagation()}
          onClick={() => setMin(false)}>
          <div className="relative w-7 h-7 rounded-full overflow-hidden border border-white/30">
            <Image src="/sarah.jpg" alt="Sarah" fill style={{ objectFit: 'cover', objectPosition: 'center top' }} />
          </div>
          <div>
            <p className="text-white text-xs font-bold">Sarah</p>
            <p className="text-[9px] text-emerald-300">Doctor Assistant</p>
          </div>
          <button onClick={e => { e.stopPropagation(); setOpen(false); setMin(false) }}
            className="w-5 h-5 flex items-center justify-center rounded-full hover:bg-white/10 text-white/50 ml-2">
            <X size={10} />
          </button>
        </div>
      )}

      {/* Bubble — bounces when chat is closed */}
      <div onClick={handleBubbleClick}
        className={`relative w-14 h-14 rounded-full shadow-2xl overflow-hidden border-2 border-white/40 hover:scale-110 transition-transform ${!open ? 'animate-bounce' : ''}`}
        style={{ background: 'linear-gradient(135deg,#1A237E,#29ABE2)' }}>
        <Image src="/sarah.jpg" alt="Sarah" fill style={{ objectFit: 'cover', objectPosition: 'center top' }} />
        {/* Online dot */}
        <span className="absolute bottom-0.5 right-0.5 w-3 h-3 bg-emerald-400 rounded-full border-2 border-white" />
      </div>
    </div>
  )
}
