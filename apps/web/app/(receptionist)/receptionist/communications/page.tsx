'use client'

import { useState } from 'react'
import { MessageSquare, Send, Mail, Filter, Bot, User, AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'

type Tab = 'whatsapp' | 'email' | 'internal'
type Filter2 = 'all' | 'ai' | 'attention' | 'resolved'

const mockConvos = [
  { id: '1', name: 'Grace Atuhaire', phone: '+256 701 234 567', lastMsg: 'Can I reschedule my appointment to Thursday?', time: '10:32 AM', status: 'attention', channel: 'whatsapp', unread: 2 },
  { id: '2', name: 'John Musoke', phone: '+256 772 888 999', lastMsg: 'Thank you for the reminder, I will be there.', time: '09:15 AM', status: 'ai', channel: 'whatsapp', unread: 0 },
  { id: '3', name: 'Nakato Sarah', phone: '+256 750 333 444', lastMsg: 'How much is a teeth cleaning?', time: '08:47 AM', status: 'ai', channel: 'whatsapp', unread: 1 },
  { id: '4', name: 'Dr. Arnold Kisakye', email: 'arnold@codeclinic.ug', lastMsg: 'Please confirm the 2pm patient.', time: 'Yesterday', status: 'resolved', channel: 'internal', unread: 0 },
]

const statusLabel: Record<string, { label: string; color: string; bg: string }> = {
  ai:        { label: 'AI Handling', color: 'text-blue-600', bg: 'bg-blue-50' },
  attention: { label: 'Needs Attention', color: 'text-red-600', bg: 'bg-red-50' },
  resolved:  { label: 'Resolved', color: 'text-emerald-600', bg: 'bg-emerald-50' },
}

const mockMessages: Record<string, Array<{ from: 'patient' | 'ai' | 'receptionist'; text: string; time: string }>> = {
  '1': [
    { from: 'patient', text: 'Hello, I had an appointment next Tuesday with Dr. Arnold.', time: '10:25 AM' },
    { from: 'ai', text: 'Hello Grace! I can see your appointment is on Tuesday 8th at 10:00 AM with Dr. Arnold Kisakye for a Dental Check-up. Would you like to reschedule?', time: '10:26 AM' },
    { from: 'patient', text: 'Can I reschedule my appointment to Thursday?', time: '10:32 AM' },
  ],
  '2': [
    { from: 'ai', text: 'Hi John! This is a reminder about your appointment tomorrow at 2:00 PM with Dr. Lois for a Root Canal Treatment.', time: '09:00 AM' },
    { from: 'patient', text: 'Thank you for the reminder, I will be there.', time: '09:15 AM' },
  ],
  '3': [
    { from: 'patient', text: 'How much is a teeth cleaning?', time: '08:47 AM' },
    { from: 'ai', text: 'Great question! A professional teeth cleaning at Code Clinic is UGX 80,000. It includes scaling, polishing, and a fluoride treatment. Would you like to book an appointment?', time: '08:48 AM' },
  ],
}

export default function CommunicationsPage() {
  const [tab, setTab]           = useState<Tab>('whatsapp')
  const [filterStatus, setFilt] = useState<Filter2>('all')
  const [active, setActive]     = useState<string | null>('1')
  const [replyText, setReply]   = useState('')
  const [takingOver, setTakeover] = useState<Record<string, boolean>>({})

  const convos = mockConvos.filter(c => {
    if (tab === 'whatsapp' && c.channel !== 'whatsapp') return false
    if (tab === 'internal' && c.channel !== 'internal') return false
    if (filterStatus !== 'all' && c.status !== filterStatus) return false
    return true
  })

  const activeConvo  = mockConvos.find(c => c.id === active)
  const activeMessages = active ? (mockMessages[active] || []) : []

  const unreadTotal = mockConvos.filter(c => c.unread > 0).length

  return (
    <div className="flex h-full bg-white">
      {/* Conversation list */}
      <div className="w-80 flex-shrink-0 border-r border-gray-100 flex flex-col">
        {/* Tabs */}
        <div className="flex border-b border-gray-100">
          {([
            { key: 'whatsapp', label: 'WhatsApp', icon: MessageSquare },
            { key: 'email',    label: 'Email',     icon: Mail },
            { key: 'internal', label: 'Internal',  icon: User },
          ] as const).map(({ key, label, icon: Icon }) => (
            <button key={key} onClick={() => setTab(key)}
              className={cn('flex-1 flex items-center justify-center gap-1.5 py-3 text-xs font-bold transition-colors',
                tab === key ? 'text-cyan-600 border-b-2 border-cyan-500' : 'text-gray-400 hover:text-gray-600')}>
              <Icon size={13} /> {label}
            </button>
          ))}
        </div>

        {/* Filter row */}
        <div className="px-3 py-2 border-b border-gray-50 flex gap-1.5 flex-wrap">
          {(['all', 'ai', 'attention', 'resolved'] as const).map(f => (
            <button key={f} onClick={() => setFilt(f)}
              className={cn('px-2.5 py-1 rounded-lg text-[10px] font-bold capitalize transition-all',
                filterStatus === f ? 'bg-cyan-500 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200')}>
              {f === 'all' ? 'All' : f === 'ai' ? 'AI Handling' : f === 'attention' ? 'Attention' : 'Resolved'}
            </button>
          ))}
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto divide-y divide-gray-50">
          {convos.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 text-gray-400 p-4">
              <MessageSquare size={24} className="mb-2 text-gray-200" />
              <p className="text-xs text-center">No conversations</p>
            </div>
          ) : convos.map(c => {
            const st = statusLabel[c.status]
            return (
              <button key={c.id} onClick={() => setActive(c.id)}
                className={cn('w-full px-4 py-3 text-left hover:bg-gray-50 transition-colors',
                  active === c.id && 'bg-cyan-50 border-l-4 border-l-cyan-500')}>
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 rounded-full bg-gradient-to-br from-cyan-400 to-blue-600 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                    {c.name.split(' ').map(n => n[0]).join('').slice(0, 2)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-0.5">
                      <p className="text-sm font-semibold text-gray-800 truncate">{c.name}</p>
                      <span className="text-[10px] text-gray-400 flex-shrink-0">{c.time}</span>
                    </div>
                    <p className="text-xs text-gray-400 truncate mb-1">{c.lastMsg}</p>
                    <div className="flex items-center gap-2">
                      <span className={cn('text-[9px] font-bold px-1.5 py-0.5 rounded-full', st.color, st.bg)}>{st.label}</span>
                      {c.unread > 0 && (
                        <span className="w-4 h-4 bg-red-500 rounded-full text-white text-[8px] font-black flex items-center justify-center">{c.unread}</span>
                      )}
                    </div>
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {/* Conversation thread */}
      <div className="flex-1 flex flex-col">
        {activeConvo ? (
          <>
            {/* Thread header */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 bg-white">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-cyan-400 to-blue-600 flex items-center justify-center text-white text-sm font-bold">
                  {activeConvo.name.split(' ').map(n => n[0]).join('').slice(0, 2)}
                </div>
                <div>
                  <p className="font-bold text-gray-800">{activeConvo.name}</p>
                  <p className="text-xs text-gray-400">{activeConvo.phone || activeConvo.email}</p>
                </div>
              </div>
              <div className="flex gap-2">
                {activeConvo.status === 'attention' && (
                  <div className="flex items-center gap-1.5 px-3 py-1.5 bg-red-50 border border-red-100 rounded-xl">
                    <AlertTriangle size={12} className="text-red-500" />
                    <span className="text-xs font-bold text-red-600">Needs Attention</span>
                  </div>
                )}
                {!takingOver[activeConvo.id] ? (
                  <button onClick={() => setTakeover(t => ({ ...t, [activeConvo.id]: true }))}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-cyan-500 text-white rounded-xl text-xs font-bold hover:bg-cyan-600 transition-colors">
                    <User size={12} /> Take Over
                  </button>
                ) : (
                  <div className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 border border-emerald-100 rounded-xl">
                    <User size={12} className="text-emerald-600" />
                    <span className="text-xs font-bold text-emerald-600">You're handling this</span>
                  </div>
                )}
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3 bg-slate-50">
              {activeMessages.map((m, i) => {
                const isMe = m.from === 'receptionist'
                const isAI = m.from === 'ai'
                return (
                  <div key={i} className={cn('flex items-end gap-2', isMe && 'flex-row-reverse')}>
                    {!isMe && (
                      <div className={cn('w-7 h-7 rounded-full flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0',
                        isAI ? 'bg-gradient-to-br from-blue-500 to-purple-600' : 'bg-gradient-to-br from-cyan-400 to-blue-500')}>
                        {isAI ? <Bot size={13} /> : activeConvo.name[0]}
                      </div>
                    )}
                    <div className={cn('max-w-[65%]')}>
                      {!isMe && <p className="text-[9px] text-gray-400 mb-0.5 ml-1">{isAI ? 'Sarah AI' : activeConvo.name}</p>}
                      <div className={cn('rounded-2xl px-4 py-2.5 text-sm leading-relaxed',
                        isMe ? 'bg-cyan-500 text-white rounded-br-sm' :
                        isAI ? 'bg-white border border-blue-100 text-gray-700 rounded-bl-sm shadow-sm' :
                               'bg-white border border-gray-100 text-gray-700 rounded-bl-sm shadow-sm')}>
                        {m.text}
                      </div>
                      <p className={cn('text-[9px] text-gray-400 mt-0.5', isMe ? 'text-right mr-1' : 'ml-1')}>{m.time}</p>
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Reply bar */}
            {takingOver[activeConvo.id] && (
              <div className="px-5 py-3 bg-white border-t border-gray-100">
                <div className="flex gap-3 mb-2">
                  <button className="text-xs font-bold px-3 py-1.5 bg-cyan-50 text-cyan-600 rounded-lg border border-cyan-100 hover:bg-cyan-100 transition-colors">
                    Reply as AI
                  </button>
                  <button className="text-xs font-bold px-3 py-1.5 bg-gray-50 text-gray-600 rounded-lg border border-gray-100 hover:bg-gray-100 transition-colors">
                    Reply Manually
                  </button>
                </div>
                <div className="flex gap-2">
                  <input value={replyText} onChange={e => setReply(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && !e.shiftKey && setReply('')}
                    placeholder="Type a message..."
                    className="flex-1 px-4 py-2.5 text-sm bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-500 transition-all" />
                  <button onClick={() => setReply('')}
                    className="w-10 h-10 flex items-center justify-center bg-cyan-500 text-white rounded-xl hover:bg-cyan-600 transition-colors flex-shrink-0">
                    <Send size={15} />
                  </button>
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <MessageSquare size={40} className="mx-auto mb-3 text-gray-200" />
              <p className="text-gray-400 font-medium">Select a conversation</p>
              <p className="text-sm text-gray-300 mt-1">Choose a chat from the left panel</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
