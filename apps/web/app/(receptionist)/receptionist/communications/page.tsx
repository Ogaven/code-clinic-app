'use client'

import { useState, useRef, useEffect } from 'react'
import {
  Search, Send, ArrowLeft, Phone, Video, MoreVertical,
  Paperclip, Smile, Mail, Check, CheckCheck,
  Star, Archive, Trash2, Reply, Forward, Download,
} from 'lucide-react'

// ── Types ────────────────────────────────────────────────────
interface Conversation {
  id: string
  contact: string
  phone?: string
  email?: string
  avatar: string
  lastMessage: string
  time: string
  unread: number
}

interface Message {
  id: string
  from: 'me' | 'them'
  text: string
  time: string
  status?: 'sent' | 'delivered' | 'read'
}

interface EmailMessage {
  id: string
  subject: string
  from: string
  to: string
  body: string
  time: string
  read: boolean
}

// ── Demo Data ────────────────────────────────────────────────
const waConversations: Conversation[] = [
  { id: 'wa1', contact: 'Sarah Namukasa', phone: '+256 701 234 567', avatar: 'SN', lastMessage: 'Thank you doctor, I will come on Tuesday', time: '10:42 AM', unread: 0 },
  { id: 'wa2', contact: 'John Ssebulime', phone: '+256 772 345 678', avatar: 'JS', lastMessage: 'Can I reschedule my appointment?', time: '9:15 AM', unread: 2 },
  { id: 'wa3', contact: 'Mary Nakato', phone: '+256 755 456 789', avatar: 'MN', lastMessage: 'I have a toothache, is there a slot today?', time: 'Yesterday', unread: 1 },
  { id: 'wa4', contact: 'Peter Ochieng', phone: '+256 700 567 890', avatar: 'PO', lastMessage: 'Appointment confirmed ✓', time: 'Yesterday', unread: 0 },
  { id: 'wa5', contact: 'Grace Auma', phone: '+256 782 678 901', avatar: 'GA', lastMessage: 'How much is teeth whitening?', time: 'Mon', unread: 3 },
  { id: 'wa6', contact: 'David Tumwine', phone: '+256 701 789 012', avatar: 'DT', lastMessage: 'Thanks for the reminder!', time: 'Sun', unread: 0 },
]

const waMessagesInit: Record<string, Message[]> = {
  wa1: [
    { id: '1', from: 'them', text: 'Hello, I wanted to confirm my appointment for Monday', time: '10:30 AM' },
    { id: '2', from: 'me', text: 'Hi Sarah! Your appointment is confirmed for Monday at 9:00 AM with Dr. Mugabe for Periodontal Therapy.', time: '10:35 AM', status: 'read' },
    { id: '3', from: 'them', text: 'Thank you doctor, I will come on Tuesday', time: '10:42 AM' },
  ],
  wa2: [
    { id: '1', from: 'them', text: 'Good morning! I had an appointment booked for Thursday', time: '9:00 AM' },
    { id: '2', from: 'them', text: 'Can I reschedule my appointment?', time: '9:15 AM' },
  ],
  wa3: [
    { id: '1', from: 'them', text: 'I have a toothache, is there a slot today?', time: 'Yesterday 2:30 PM' },
  ],
  wa4: [
    { id: '1', from: 'me', text: 'Hi Peter, reminder: your appointment is tomorrow at 11:00 AM', time: 'Yesterday 9:00 AM', status: 'read' },
    { id: '2', from: 'them', text: 'Appointment confirmed ✓', time: 'Yesterday 9:45 AM' },
  ],
  wa5: [
    { id: '1', from: 'them', text: 'Hi, how much is teeth whitening?', time: 'Mon 3:00 PM' },
    { id: '2', from: 'them', text: 'And do you offer any discounts?', time: 'Mon 3:01 PM' },
    { id: '3', from: 'them', text: 'How much is teeth whitening?', time: 'Mon 4:00 PM' },
  ],
  wa6: [
    { id: '1', from: 'me', text: 'Hi David, reminder: appointment tomorrow at 2:00 PM', time: 'Sun 10:00 AM', status: 'read' },
    { id: '2', from: 'them', text: 'Thanks for the reminder!', time: 'Sun 10:30 AM' },
  ],
}

const emailConversations: Conversation[] = [
  { id: 'em1', contact: 'Dr. Lois Kisakye', email: 'lois.kisakye@codeclinic.ug', avatar: 'LK', lastMessage: 'Patient report for April attached', time: '8:50 AM', unread: 1 },
  { id: 'em2', contact: 'Kampala Dental Supplies', email: 'orders@kampalad.co.ug', avatar: 'KD', lastMessage: 'Your order #KD-4421 has been dispatched', time: 'Yesterday', unread: 0 },
  { id: 'em3', contact: 'Sarah Namukasa', email: 'sarah.namukasa@gmail.com', avatar: 'SN', lastMessage: 'Re: Appointment booking confirmation', time: 'Yesterday', unread: 0 },
  { id: 'em4', contact: 'Uganda Revenue Authority', email: 'efris@ura.go.ug', avatar: 'UR', lastMessage: 'EFRIS: Your tax report is due', time: 'Mon', unread: 1 },
  { id: 'em5', contact: 'MTN MoMo Business', email: 'business@mtn.co.ug', avatar: 'MM', lastMessage: 'April statement ready for download', time: 'Mon', unread: 0 },
]

const emailMessages: Record<string, EmailMessage[]> = {
  em1: [{ id: 'e1', subject: 'Patient report for April', from: 'lois.kisakye@codeclinic.ug', to: 'reception@codeclinic.ug', body: `Dear Reception,\n\nPlease find attached the patient summary report for April 2026. We had 42 patients this month with a 94% satisfaction rate.\n\nKind regards,\nDr. Lois Kisakye`, time: '8:50 AM', read: false }],
  em2: [{ id: 'e1', subject: 'Order #KD-4421 Dispatched', from: 'orders@kampalad.co.ug', to: 'reception@codeclinic.ug', body: `Dear Code Clinic,\n\nYour order #KD-4421 (Dental composite kit × 3, Scaling tips × 10) has been dispatched and will arrive within 2 business days.\n\nTracking: UG-4421-KC\n\nBest regards,\nKampala Dental Supplies`, time: 'Yesterday 3:00 PM', read: true }],
  em3: [{ id: 'e1', subject: 'Re: Appointment booking confirmation', from: 'sarah.namukasa@gmail.com', to: 'reception@codeclinic.ug', body: `Hello,\n\nThank you for the confirmation email. I will be there on Monday at 9:00 AM.\n\nBest,\nSarah`, time: 'Yesterday 11:30 AM', read: true }],
  em4: [{ id: 'e1', subject: 'EFRIS: Tax report due - April 2026', from: 'efris@ura.go.ug', to: 'accounts@codeclinic.ug', body: `Dear Taxpayer,\n\nThis is a reminder that your EFRIS tax report for April 2026 is due by April 15, 2026.\n\nPlease log in to your EFRIS portal to submit.\n\nUganda Revenue Authority`, time: 'Mon 9:00 AM', read: false }],
  em5: [{ id: 'e1', subject: 'April 2026 Account Statement', from: 'business@mtn.co.ug', to: 'accounts@codeclinic.ug', body: `Dear Valued Customer,\n\nYour MTN MoMo Business statement for April 2026 is now available.\n\nTotal received: UGX 4,280,000\nTotal sent: UGX 1,200,000\n\nMTN MoMo Business Team`, time: 'Mon 8:00 AM', read: true }],
}

// ── Helpers ───────────────────────────────────────────────────
const avatarColors: Record<string, string> = {
  SN: '#E91E63', JS: '#1565C0', MN: '#00897B', PO: '#F57F17',
  GA: '#6A1B9A', DT: '#2E7D32', LK: '#AD1457', KD: '#0277BD',
  UR: '#4E342E', MM: '#FF6F00',
}

function Avatar({ initials, size = 40 }: { initials: string; size?: number }) {
  return (
    <div className="rounded-full flex items-center justify-center flex-shrink-0 text-white font-bold"
      style={{ width: size, height: size, background: avatarColors[initials] || '#1A237E', fontSize: size * 0.35 }}>
      {initials}
    </div>
  )
}

function MsgStatus({ status }: { status?: string }) {
  if (status === 'read') return <CheckCheck size={13} style={{ color: '#53BDEB', flexShrink: 0 }} />
  if (status === 'delivered') return <CheckCheck size={13} style={{ color: '#aaa', flexShrink: 0 }} />
  if (status === 'sent') return <Check size={13} style={{ color: '#aaa', flexShrink: 0 }} />
  return null
}

const WA_DARK  = '#075E54'
const WA_GREEN = '#25D366'
const NAVY     = '#1A237E'

// ── Page ─────────────────────────────────────────────────────
export default function CommunicationsPage() {
  const [channel, setChannel]       = useState<'whatsapp' | 'email'>('whatsapp')
  const [activeWa, setActiveWa]     = useState<string | null>(null)
  const [activeEm, setActiveEm]     = useState<string | null>(null)
  const [waSearch, setWaSearch]     = useState('')
  const [emSearch, setEmSearch]     = useState('')
  const [reply, setReply]           = useState('')
  const [showThread, setShowThread] = useState(false)
  const [waMsgs, setWaMsgs]         = useState(waMessagesInit)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [activeWa, activeEm, waMsgs])

  function sendWa() {
    if (!reply.trim() || !activeWa) return
    const msg: Message = {
      id: Date.now().toString(),
      from: 'me',
      text: reply.trim(),
      time: new Date().toLocaleTimeString('en-UG', { hour: '2-digit', minute: '2-digit' }),
      status: 'sent',
    }
    setWaMsgs(p => ({ ...p, [activeWa]: [...(p[activeWa] || []), msg] }))
    setReply('')
  }

  const waFiltered = waConversations.filter(c =>
    c.contact.toLowerCase().includes(waSearch.toLowerCase()) || (c.phone || '').includes(waSearch)
  )
  const emFiltered = emailConversations.filter(c =>
    c.contact.toLowerCase().includes(emSearch.toLowerCase()) || (c.email || '').toLowerCase().includes(emSearch.toLowerCase())
  )

  const convWa  = waConversations.find(c => c.id === activeWa)
  const convEm  = emailConversations.find(c => c.id === activeEm)
  const emMsgs  = activeEm ? emailMessages[activeEm] || [] : []
  const topEmail = emMsgs[0]

  return (
    <div className="h-full flex flex-col bg-gray-50" style={{ minHeight: 0 }}>

      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 bg-white border-b border-gray-100 flex-shrink-0">
        <div>
          <h1 className="text-xl font-black text-gray-800">Communications</h1>
          <p className="text-xs text-gray-400 mt-0.5">Manage patient messages and emails</p>
        </div>
        <div className="flex gap-1 p-1 bg-gray-100 rounded-xl">
          <button onClick={() => { setChannel('whatsapp'); setShowThread(false) }}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all"
            style={channel === 'whatsapp' ? { background: WA_GREEN, color: '#fff' } : { color: '#6B7280' }}>
            <svg viewBox="0 0 24 24" fill="currentColor" width="15" height="15">
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
            </svg>
            WhatsApp
          </button>
          <button onClick={() => { setChannel('email'); setShowThread(false) }}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all"
            style={channel === 'email' ? { background: NAVY, color: '#fff' } : { color: '#6B7280' }}>
            <Mail size={15} />
            Email
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 flex overflow-hidden">

        {/* ══ WhatsApp ══════════════════════════════════════ */}
        {channel === 'whatsapp' && (
          <>
            {/* List panel */}
            <div className={`w-[320px] flex-shrink-0 flex flex-col bg-white border-r border-gray-100 ${showThread ? 'hidden md:flex' : 'flex'}`}>
              <div className="px-3 py-3 flex-shrink-0" style={{ background: WA_DARK }}>
                <p className="text-white font-bold text-sm mb-2.5">WhatsApp Inbox</p>
                <div className="relative">
                  <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input value={waSearch} onChange={e => setWaSearch(e.target.value)}
                    placeholder="Search or start new chat"
                    className="w-full pl-8 pr-3 py-2 text-xs rounded-lg outline-none" />
                </div>
              </div>
              <div className="flex-1 overflow-y-auto">
                {waFiltered.map(c => (
                  <button key={c.id}
                    onClick={() => { setActiveWa(c.id); setShowThread(true) }}
                    className={`w-full flex items-center gap-3 px-4 py-3 border-b border-gray-50 hover:bg-gray-50 text-left transition-colors ${activeWa === c.id ? 'bg-green-50' : ''}`}>
                    <div className="relative">
                      <Avatar initials={c.avatar} size={46} />
                      <span className="absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-white" style={{ background: WA_GREEN }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between items-center">
                        <p className="text-sm font-semibold text-gray-800 truncate">{c.contact}</p>
                        <p className="text-[10px] text-gray-400 flex-shrink-0 ml-2">{c.time}</p>
                      </div>
                      <div className="flex justify-between items-center mt-0.5">
                        <p className="text-xs text-gray-400 truncate">{c.lastMessage}</p>
                        {c.unread > 0 && (
                          <span className="ml-2 w-5 h-5 rounded-full flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0"
                            style={{ background: WA_GREEN }}>{c.unread}</span>
                        )}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Thread panel */}
            <div className={`flex-1 flex flex-col ${showThread ? 'flex' : 'hidden md:flex'}`}
              style={{ background: '#e5ddd5' }}>
              {convWa ? (
                <>
                  {/* Header */}
                  <div className="flex items-center gap-3 px-4 py-3 flex-shrink-0" style={{ background: WA_DARK }}>
                    <button onClick={() => setShowThread(false)} className="md:hidden text-white mr-1"><ArrowLeft size={20} /></button>
                    <Avatar initials={convWa.avatar} size={38} />
                    <div className="flex-1">
                      <p className="text-white font-bold text-sm">{convWa.contact}</p>
                      <p className="text-[11px]" style={{ color: '#90cbb7' }}>online</p>
                    </div>
                    <div className="flex gap-2">
                      <button className="w-9 h-9 rounded-full flex items-center justify-center hover:bg-white/10 text-white"><Phone size={17} /></button>
                      <button className="w-9 h-9 rounded-full flex items-center justify-center hover:bg-white/10 text-white"><Video size={17} /></button>
                      <button className="w-9 h-9 rounded-full flex items-center justify-center hover:bg-white/10 text-white"><MoreVertical size={17} /></button>
                    </div>
                  </div>

                  {/* Messages */}
                  <div className="flex-1 overflow-y-auto px-4 py-4 space-y-1.5">
                    {(waMsgs[activeWa!] || []).map(m => (
                      <div key={m.id} className={`flex ${m.from === 'me' ? 'justify-end' : 'justify-start'}`}>
                        <div className="max-w-[72%] px-3 py-2 rounded-2xl shadow-sm text-sm leading-relaxed"
                          style={m.from === 'me'
                            ? { background: '#d9fdd3', borderBottomRightRadius: 4 }
                            : { background: '#fff', borderBottomLeftRadius: 4 }}>
                          {m.text}
                          <div className="flex items-center justify-end gap-1 mt-0.5">
                            <span className="text-[10px] text-gray-400">{m.time}</span>
                            {m.from === 'me' && <MsgStatus status={m.status} />}
                          </div>
                        </div>
                      </div>
                    ))}
                    <div ref={bottomRef} />
                  </div>

                  {/* Input */}
                  <div className="flex items-center gap-2 px-3 py-2.5 flex-shrink-0" style={{ background: '#f0f2f5' }}>
                    <button className="w-9 h-9 rounded-full flex items-center justify-center hover:bg-black/5 text-gray-500"><Smile size={20} /></button>
                    <button className="w-9 h-9 rounded-full flex items-center justify-center hover:bg-black/5 text-gray-500"><Paperclip size={20} /></button>
                    <input
                      value={reply}
                      onChange={e => setReply(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendWa() } }}
                      placeholder="Type a message"
                      className="flex-1 px-4 py-2.5 rounded-2xl bg-white text-sm outline-none shadow-sm"
                    />
                    <button onClick={sendWa}
                      className="w-11 h-11 rounded-full flex items-center justify-center transition-all hover:scale-105"
                      style={{ background: reply.trim() ? WA_GREEN : '#b0b8b4' }}>
                      <Send size={17} className="text-white" style={{ transform: 'translateX(1px)' }} />
                    </button>
                  </div>
                </>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center p-8">
                  <div className="w-20 h-20 rounded-full flex items-center justify-center" style={{ background: `${WA_GREEN}20` }}>
                    <svg viewBox="0 0 24 24" fill={WA_GREEN} width="40" height="40">
                      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                    </svg>
                  </div>
                  <p className="text-gray-600 font-semibold">WhatsApp Inbox</p>
                  <p className="text-gray-400 text-sm">Select a conversation to start messaging</p>
                </div>
              )}
            </div>
          </>
        )}

        {/* ══ Email ═════════════════════════════════════════ */}
        {channel === 'email' && (
          <>
            {/* List panel */}
            <div className={`w-[320px] flex-shrink-0 flex flex-col bg-white border-r border-gray-100 ${showThread ? 'hidden md:flex' : 'flex'}`}>
              <div className="px-3 py-3 flex-shrink-0" style={{ background: NAVY }}>
                <p className="text-white font-bold text-sm mb-2.5">Email Inbox</p>
                <div className="relative">
                  <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input value={emSearch} onChange={e => setEmSearch(e.target.value)}
                    placeholder="Search emails..."
                    className="w-full pl-8 pr-3 py-2 text-xs rounded-lg outline-none" />
                </div>
              </div>
              <div className="flex-1 overflow-y-auto">
                {emFiltered.map(c => {
                  const unread = (emailMessages[c.id] || []).some(m => !m.read)
                  return (
                    <button key={c.id}
                      onClick={() => { setActiveEm(c.id); setShowThread(true) }}
                      className={`w-full flex items-center gap-3 px-4 py-3 border-b border-gray-50 hover:bg-gray-50 text-left transition-colors ${activeEm === c.id ? 'bg-blue-50' : ''}`}>
                      <Avatar initials={c.avatar} size={42} />
                      <div className="flex-1 min-w-0">
                        <div className="flex justify-between items-center">
                          <p className={`text-sm truncate ${unread ? 'font-bold text-gray-900' : 'font-medium text-gray-700'}`}>{c.contact}</p>
                          <p className="text-[10px] text-gray-400 flex-shrink-0 ml-2">{c.time}</p>
                        </div>
                        <p className={`text-xs truncate mt-0.5 ${unread ? 'text-gray-700' : 'text-gray-400'}`}>{c.lastMessage}</p>
                      </div>
                      {unread && <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: '#29ABE2' }} />}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Thread panel */}
            <div className={`flex-1 flex flex-col bg-gray-50 ${showThread ? 'flex' : 'hidden md:flex'}`}>
              {convEm && topEmail ? (
                <>
                  {/* Email thread header */}
                  <div className="flex items-center gap-3 px-6 py-4 bg-white border-b border-gray-100 flex-shrink-0">
                    <button onClick={() => setShowThread(false)} className="md:hidden mr-1 text-gray-600"><ArrowLeft size={20} /></button>
                    <div className="flex-1">
                      <h2 className="font-bold text-gray-800">{topEmail.subject}</h2>
                      <p className="text-xs text-gray-400 mt-0.5">{emMsgs.length} message{emMsgs.length !== 1 ? 's' : ''}</p>
                    </div>
                    <div className="flex gap-1">
                      <button className="w-9 h-9 flex items-center justify-center rounded-xl hover:bg-gray-100 text-gray-400"><Star size={16} /></button>
                      <button className="w-9 h-9 flex items-center justify-center rounded-xl hover:bg-gray-100 text-gray-400"><Archive size={16} /></button>
                      <button className="w-9 h-9 flex items-center justify-center rounded-xl hover:bg-red-50 text-red-400"><Trash2 size={16} /></button>
                    </div>
                  </div>

                  {/* Messages */}
                  <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
                    {emMsgs.map(em => (
                      <div key={em.id} className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                        <div className="flex items-start gap-3 px-5 py-4 border-b border-gray-50">
                          <Avatar initials={convEm.avatar} size={40} />
                          <div className="flex-1 min-w-0">
                            <div className="flex justify-between items-start">
                              <p className="font-semibold text-gray-800 text-sm">{convEm.contact}</p>
                              <div className="flex items-center gap-2 flex-shrink-0 ml-3">
                                <p className="text-xs text-gray-400">{em.time}</p>
                                <button className="text-gray-400 hover:text-gray-600"><Reply size={14} /></button>
                                <button className="text-gray-400 hover:text-gray-600"><Forward size={14} /></button>
                              </div>
                            </div>
                            <p className="text-[11px] text-gray-400">From: {em.from}</p>
                            <p className="text-[11px] text-gray-400">To: {em.to}</p>
                          </div>
                        </div>
                        <div className="px-5 py-4">
                          <pre className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed font-sans">{em.body}</pre>
                        </div>
                      </div>
                    ))}
                    <div ref={bottomRef} />
                  </div>

                  {/* Reply compose */}
                  <div className="flex-shrink-0 px-6 pb-5 pt-1">
                    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
                      <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-100">
                        <Reply size={13} className="text-gray-400" />
                        <p className="text-xs text-gray-500">Reply to <span className="font-medium text-gray-700">{convEm.contact}</span></p>
                      </div>
                      <textarea
                        value={reply}
                        onChange={e => setReply(e.target.value)}
                        placeholder="Write your reply..."
                        rows={4}
                        className="w-full px-4 py-3 text-sm text-gray-700 outline-none resize-none"
                      />
                      <div className="flex items-center justify-between px-4 py-3 bg-gray-50 border-t border-gray-100">
                        <div className="flex gap-1.5">
                          <button className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-200 text-gray-400"><Paperclip size={14} /></button>
                          <button className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-200 text-gray-400"><Download size={14} /></button>
                        </div>
                        <button
                          onClick={() => setReply('')}
                          disabled={!reply.trim()}
                          className="flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-bold text-white transition-all hover:scale-105 disabled:opacity-40"
                          style={{ background: `linear-gradient(135deg, ${NAVY}, #29ABE2)` }}>
                          <Send size={14} />
                          Send Reply
                        </button>
                      </div>
                    </div>
                  </div>
                </>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center p-8">
                  <div className="w-20 h-20 rounded-full flex items-center justify-center" style={{ background: `${NAVY}15` }}>
                    <Mail size={40} style={{ color: NAVY }} />
                  </div>
                  <p className="text-gray-600 font-semibold">Email Inbox</p>
                  <p className="text-gray-400 text-sm">Select an email to read and reply</p>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
