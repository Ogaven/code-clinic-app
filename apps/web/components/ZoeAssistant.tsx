'use client'

import { useEffect, useRef, useState } from 'react'
import { X, Send, Minimize2, Maximize2, Mic, MicOff, Bot } from 'lucide-react'

type Msg = { from: 'zoe' | 'user'; text: string; time: string }

function now() {
  return new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Nairobi' })
}

function buildGreetings(): Msg[] {
  return [
    { from: 'zoe', text: "Hello! 👋 I'm Zoe, your AI assistant at Code Clinic. How can I help you today?", time: now() },
    { from: 'zoe', text: "I can help with scheduling, patient records, billing, and more. Just ask! 🦷", time: now() },
  ]
}

const QUICK_REPLIES_BY_ROLE: Record<string, string[]> = {
  ADMIN:        ["Today's stats", 'View escalations', 'Run scheduler', 'System health'],
  RECEPTIONIST: ["Today's appointments", 'Book appointment', 'Check patient', 'New escalation'],
  DOCTOR:       ["My schedule today", 'Patient history', 'Next appointment', 'Check notes'],
  ACCOUNTS:     ['Outstanding invoices', 'Today revenue', 'Overdue payments', 'Send reminder'],
  default:      ["Today's appointments", 'Check patient records', 'Book appointment', 'View invoices'],
}

interface Props {
  role?: string
}

export default function ZoeAssistant({ role }: Props) {
  const greetings = buildGreetings()
  const [open, setOpen]         = useState(false)
  const [minimised, setMin]     = useState(false)
  const [msgs, setMsgs]         = useState<Msg[]>(greetings)
  const [input, setInput]       = useState('')
  const [typing, setTyping]     = useState(false)
  const [dragging, setDragging] = useState(false)
  const [pos, setPos]           = useState({ x: 0, y: 0 })
  const [hasMoved, setHasMoved] = useState(false)
  const [recording, setRec]     = useState(false)
  const recRef                  = useRef<any>(null)
  const [chatHistory, setChatHistory] = useState<Array<{ role: string; content: string }>>([])
  const bubbleRef  = useRef<HTMLDivElement>(null)
  const dragStart  = useRef({ mx: 0, my: 0, bx: 0, by: 0 })
  const messagesEl = useRef<HTMLDivElement>(null)

  const quickReplies = QUICK_REPLIES_BY_ROLE[role || 'default'] || QUICK_REPLIES_BY_ROLE.default

  useEffect(() => {
    if (messagesEl.current) messagesEl.current.scrollTop = messagesEl.current.scrollHeight
  }, [msgs, typing])

  function onMouseDown(e: React.MouseEvent) {
    if ((e.target as HTMLElement).closest('button, input, textarea')) return
    e.preventDefault()
    setDragging(true)
    dragStart.current = { mx: e.clientX, my: e.clientY, bx: pos.x, by: pos.y }
  }

  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      if (!dragging) return
      const dx = e.clientX - dragStart.current.mx
      const dy = e.clientY - dragStart.current.my
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) setHasMoved(true)
      setPos({ x: dragStart.current.bx + dx, y: dragStart.current.by + dy })
    }
    function onMouseUp() {
      if (dragging) { setDragging(false); setTimeout(() => setHasMoved(false), 100) }
    }
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
    return () => { document.removeEventListener('mousemove', onMouseMove); document.removeEventListener('mouseup', onMouseUp) }
  }, [dragging])

  function onTouchStart(e: React.TouchEvent) {
    const t = e.touches[0]
    setDragging(true)
    dragStart.current = { mx: t.clientX, my: t.clientY, bx: pos.x, by: pos.y }
  }
  useEffect(() => {
    function onTouchMove(e: TouchEvent) {
      if (!dragging) return
      const t = e.touches[0]
      setPos({ x: dragStart.current.bx + t.clientX - dragStart.current.mx, y: dragStart.current.by + t.clientY - dragStart.current.my })
      setHasMoved(true)
    }
    function onTouchEnd() { setDragging(false); setTimeout(() => setHasMoved(false), 100) }
    document.addEventListener('touchmove', onTouchMove, { passive: false })
    document.addEventListener('touchend', onTouchEnd)
    return () => { document.removeEventListener('touchmove', onTouchMove); document.removeEventListener('touchend', onTouchEnd) }
  }, [dragging])

  function handleClick() {
    if (!hasMoved) setOpen(o => !o)
  }

  function toggleRecording() {
    if (recording) { recRef.current?.stop(); setRec(false); return }
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SR) { sendMessage("Sorry, voice input isn't supported in this browser."); return }
    const recognition = new SR()
    recognition.lang = 'en-GB'
    recognition.interimResults = false
    recognition.onresult = (e: any) => { const t = e.results[0][0].transcript; setInput(t); sendMessage(t) }
    recognition.onend = () => setRec(false)
    recognition.onerror = () => setRec(false)
    recRef.current = recognition
    recognition.start()
    setRec(true)
  }

  async function sendMessage(text?: string) {
    const msg = text || input.trim()
    if (!msg) return
    const t = now()
    setMsgs(m => [...m, { from: 'user', text: msg, time: t }])
    setInput('')
    setTyping(true)
    const newHistory = [...chatHistory, { role: 'user', content: msg }]
    setChatHistory(newHistory)

    try {
      const token = localStorage.getItem('cc_token')
      const res = await fetch('/api-proxy/assistant/chat', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: newHistory, context: { page: window.location.pathname, role } }),
      })
      const data = await res.json()
      const reply = data.content || "I'm here to help! 🦷"
      setChatHistory(h => [...h, { role: 'assistant', content: reply }])
      setMsgs(m => [...m, { from: 'zoe', text: reply, time: now() }])
    } catch {
      setMsgs(m => [...m, { from: 'zoe', text: "Sorry, I couldn't connect right now. Please try again! 🙏", time: now() }])
    } finally {
      setTyping(false)
    }
  }

  const wrapStyle: React.CSSProperties = {
    position: 'fixed',
    right:  `${-pos.x + 24}px`,
    bottom: `${-pos.y + 24}px`,
    zIndex: 9999,
    cursor: dragging ? 'grabbing' : 'grab',
    userSelect: 'none',
    transition: dragging ? 'none' : 'right 0.2s, bottom 0.2s',
  }

  // Zoe avatar — teal gradient circle with Bot icon
  const ZoeAvatar = ({ size = 28 }: { size?: number }) => (
    <div style={{
      width: size, height: size, borderRadius: '50%', flexShrink: 0,
      background: 'linear-gradient(135deg, #00BCD4, #7C3AED)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      border: '2px solid rgba(255,255,255,0.25)',
    }}>
      <Bot size={size * 0.5} color="white" />
    </div>
  )

  return (
    <div ref={bubbleRef} style={wrapStyle} onMouseDown={onMouseDown} onTouchStart={onTouchStart}>

      {/* ── Chat Panel ── */}
      {open && !minimised && (
        <div
          className="mb-4 rounded-3xl shadow-2xl overflow-hidden animate-slide-right"
          style={{
            width: '340px',
            background: 'linear-gradient(145deg, #0A0F1E, #0F1A2E)',
            border: '1px solid rgba(0,188,212,0.25)',
            cursor: 'default',
          }}
          onMouseDown={e => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3"
            style={{ background: 'rgba(0,188,212,0.08)', borderBottom: '1px solid rgba(0,188,212,0.15)' }}>
            <div className="flex items-center gap-3">
              <ZoeAvatar size={36} />
              <div>
                <p className="text-white text-sm font-bold">Zoe</p>
                <div className="flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  <p className="text-[10px] text-emerald-300">AI Assistant · Online</p>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button onClick={() => setMin(true)}
                className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-white/10 transition-colors">
                <Minimize2 size={13} color="rgba(255,255,255,0.6)" />
              </button>
              <button onClick={() => setOpen(false)}
                className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-white/10 transition-colors">
                <X size={13} color="rgba(255,255,255,0.6)" />
              </button>
            </div>
          </div>

          {/* Messages */}
          <div ref={messagesEl} className="space-y-3 px-4 py-4 overflow-y-auto" style={{ maxHeight: '300px' }}>
            {msgs.map((m, i) => (
              <div key={i} className={`flex ${m.from === 'user' ? 'justify-end' : 'items-start gap-2'}`}>
                {m.from === 'zoe' && <ZoeAvatar size={28} />}
                <div>
                  <div className="rounded-2xl px-3.5 py-2.5 text-xs leading-relaxed max-w-[220px] whitespace-pre-line"
                    style={{
                      background: m.from === 'zoe'
                        ? 'rgba(0,188,212,0.12)'
                        : 'linear-gradient(135deg, #00BCD4, #7C3AED)',
                      color: 'white',
                      borderRadius: m.from === 'zoe' ? '4px 16px 16px 16px' : '16px 4px 16px 16px',
                    }}>
                    {m.text}
                  </div>
                  <p className="text-[9px] text-cyan-300/50 mt-1 px-1">{m.time}</p>
                </div>
              </div>
            ))}
            {typing && (
              <div className="flex items-start gap-2">
                <ZoeAvatar size={28} />
                <div className="rounded-2xl px-4 py-3" style={{ background: 'rgba(0,188,212,0.12)', borderRadius: '4px 16px 16px 16px' }}>
                  <div className="flex gap-1 items-center h-3">
                    {[0, 1, 2].map(i => (
                      <span key={i} className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-bounce"
                        style={{ animationDelay: `${i * 0.15}s` }} />
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Quick replies */}
          <div className="px-4 pb-2 flex flex-wrap gap-1.5">
            {quickReplies.map(q => (
              <button key={q} onClick={() => sendMessage(q)}
                className="text-[10px] font-medium px-2.5 py-1 rounded-full transition-all hover:bg-cyan-500/20"
                style={{ background: 'rgba(0,188,212,0.1)', color: 'rgba(0,188,212,0.9)', border: '1px solid rgba(0,188,212,0.2)' }}>
                {q}
              </button>
            ))}
          </div>

          {/* Input */}
          <div className="flex items-center gap-2 px-4 py-3" style={{ borderTop: '1px solid rgba(0,188,212,0.1)' }}>
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendMessage()}
              placeholder={recording ? '🎙 Listening...' : 'Ask Zoe anything...'}
              className="flex-1 text-xs py-2.5 px-3.5 rounded-xl outline-none text-white"
              style={{
                background: 'rgba(0,188,212,0.06)',
                border: `1px solid ${recording ? 'rgba(236,72,153,0.5)' : 'rgba(0,188,212,0.2)'}`,
              }}
              onMouseDown={e => e.stopPropagation()}
            />
            <button onClick={toggleRecording}
              className="w-9 h-9 rounded-xl flex items-center justify-center transition-all hover:scale-110 flex-shrink-0"
              style={{ background: recording ? 'rgba(236,72,153,0.4)' : 'rgba(0,188,212,0.1)', border: `1px solid ${recording ? 'rgba(236,72,153,0.5)' : 'rgba(0,188,212,0.2)'}` }}>
              {recording
                ? <MicOff size={14} color="#EC4899" className="animate-pulse" />
                : <Mic size={14} color="rgba(0,188,212,0.8)" />}
            </button>
            <button onClick={() => sendMessage()}
              className="w-9 h-9 rounded-xl flex items-center justify-center transition-all hover:scale-110 flex-shrink-0"
              style={{ background: 'linear-gradient(135deg, #00BCD4, #7C3AED)' }}>
              <Send size={14} color="white" />
            </button>
          </div>
        </div>
      )}

      {/* Minimised bar */}
      {open && minimised && (
        <div
          className="mb-4 flex items-center gap-3 px-4 py-2.5 rounded-2xl shadow-xl cursor-pointer"
          style={{ background: 'linear-gradient(135deg, #0A0F1E, #0F1A2E)', border: '1px solid rgba(0,188,212,0.25)' }}
          onClick={() => setMin(false)}
          onMouseDown={e => e.stopPropagation()}
        >
          <ZoeAvatar size={28} />
          <span className="text-white text-xs font-semibold">Zoe AI</span>
          <Maximize2 size={12} color="rgba(0,188,212,0.6)" />
        </div>
      )}

      {/* ── Floating Bubble ── */}
      <div
        onClick={handleClick}
        className={`select-none cursor-pointer ${!dragging && !open ? 'animate-float' : ''}`}
        style={{ position: 'relative', width: 64, height: 64 }}
      >
        {/* Glow ring */}
        <div className="absolute rounded-full animate-pulse pointer-events-none"
          style={{ inset: -8, background: 'radial-gradient(circle, rgba(0,188,212,0.5), transparent)', opacity: 0.8 }} />

        {/* Circle */}
        <div style={{
          width: 64, height: 64, borderRadius: '50%', overflow: 'hidden',
          background: 'linear-gradient(135deg, #00BCD4, #7C3AED)',
          border: '3px solid rgba(255,255,255,0.3)',
          boxShadow: '0 8px 32px rgba(0,188,212,0.4)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          position: 'relative',
        }}>
          <Bot size={28} color="white" />
        </div>

        {/* Online dot */}
        <span className="absolute animate-pulse"
          style={{ bottom: 2, right: 2, width: 14, height: 14, borderRadius: '50%', background: '#34D399', border: '2.5px solid white', display: 'block' }} />
      </div>
    </div>
  )
}
