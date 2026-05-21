'use client'

import { useEffect, useRef, useState } from 'react'
import Image from 'next/image'

const API_BASE = 'https://api.codeclinicemr.com'

function getSessionId() {
  const k = 'cc_wid_session'
  let v = localStorage.getItem(k)
  if (!v) { v = 'ws_' + Math.random().toString(36).slice(2) + '_' + Date.now(); localStorage.setItem(k, v) }
  return v
}

interface Msg { role: 'agent' | 'user'; text: string }

export default function ChatbotWidgetPage() {
  const [messages, setMessages] = useState<Msg[]>([
    { role: 'agent', text: "Hi there! 👋 I'm Sarah from Code Clinic 😊 How can I help you today?" },
  ])
  const [input,   setInput]   = useState('')
  const [sending, setSending] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const sessionId = useRef<string>('')

  useEffect(() => { sessionId.current = getSessionId() }, [])
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  async function send() {
    const text = input.trim()
    if (!text || sending) return
    setInput('')
    setSending(true)
    setMessages(m => [...m, { role: 'user', text }])
    try {
      const res  = await fetch(`${API_BASE}/ai-suite/website/message`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ message: text, sessionId: sessionId.current }),
      })
      const data = await res.json()
      setMessages(m => [...m, { role: 'agent', text: data.reply || "I'm having trouble responding. Please try again!" }])
    } catch {
      setMessages(m => [...m, { role: 'agent', text: 'Connection error. Please try again!' }])
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="flex flex-col h-screen bg-[#F8FAFF]" style={{ fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif' }}>

      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 flex-shrink-0"
        style={{ background: 'linear-gradient(135deg,#0c1e50,#29ABE2)' }}>
        <div className="relative w-10 h-10 rounded-full overflow-hidden border-2 border-white/40 flex-shrink-0">
          <Image src="/sarah.jpg" alt="Sarah" fill style={{ objectFit: 'cover', objectPosition: 'center top' }} />
        </div>
        <div>
          <p className="text-white font-bold text-sm leading-tight">Sarah</p>
          <p className="text-white/80 text-xs flex items-center gap-1 mt-0.5">
            <span className="w-2 h-2 bg-green-400 rounded-full inline-block" />
            Code Clinic &bull; Online
          </p>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-3">
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[82%] px-3.5 py-2.5 rounded-xl text-sm leading-relaxed whitespace-pre-wrap ${
              m.role === 'user'
                ? 'text-white rounded-br-sm'
                : 'bg-white text-gray-800 rounded-bl-sm shadow-sm'
            }`}
              style={m.role === 'user' ? { background: 'linear-gradient(135deg,#1A237E,#29ABE2)' } : {}}>
              {m.text}
            </div>
          </div>
        ))}
        {sending && (
          <div className="flex justify-start">
            <div className="bg-white px-4 py-3 rounded-xl rounded-bl-sm shadow-sm flex gap-1">
              {[0, 1, 2].map(i => (
                <span key={i} className="w-2 h-2 bg-gray-300 rounded-full inline-block"
                  style={{ animation: `bounce 1.2s ease-in-out ${i * 0.15}s infinite` }} />
              ))}
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="flex gap-2 items-center px-4 py-3 border-t border-gray-200 bg-white flex-shrink-0">
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
          placeholder="Type a message..."
          className="flex-1 px-4 py-2.5 text-sm border border-gray-200 rounded-full outline-none focus:border-cyan-400 transition-colors"
        />
        <button
          onClick={send}
          disabled={!input.trim() || sending}
          className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 disabled:opacity-50 transition-opacity"
          style={{ background: 'linear-gradient(135deg,#1A237E,#29ABE2)' }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="white">
            <path d="M2 21l21-9L2 3v7l15 2-15 2v7z"/>
          </svg>
        </button>
      </div>

      <style>{`
        @keyframes bounce {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-4px); }
        }
      `}</style>
    </div>
  )
}
