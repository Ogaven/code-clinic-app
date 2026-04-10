'use client'

import { useState, useRef, useEffect } from 'react'
import {
  Search, Send, ArrowLeft, Phone, Video, MoreVertical,
  Paperclip, Smile, Mail, Check, CheckCheck,
  Image as ImageIcon, FileText, Mic, MicOff, Play, Pause,
  X, Download, Film, Music, Reply, Forward, Archive,
  MessageSquare, Users, Plus, Star,
} from 'lucide-react'
import { cn } from '@/lib/utils'

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
  online?: boolean
}

interface Message {
  id: string
  from: 'me' | 'them'
  text?: string
  time: string
  status?: 'sent' | 'delivered' | 'read'
  attachment?: { type: 'image' | 'file' | 'audio' | 'video' | 'voice'; name?: string; url?: string; duration?: string }
}

interface InternalMessage {
  id: string
  from: string
  role: string
  avatar: string
  text: string
  time: string
  channel: 'general' | 'appointments' | 'alerts'
}

// ── Demo Data ────────────────────────────────────────────────
const waConversations: Conversation[] = [
  { id: 'wa1', contact: 'Sarah Namukasa',  phone: '+256 701 234 567', avatar: 'SN', lastMessage: 'Thank you doctor, I will come on Tuesday', time: '10:42 AM', unread: 0, online: true },
  { id: 'wa2', contact: 'John Ssebulime',  phone: '+256 772 345 678', avatar: 'JS', lastMessage: 'Can I reschedule my appointment?', time: '9:15 AM', unread: 2, online: false },
  { id: 'wa3', contact: 'Mary Nakato',     phone: '+256 755 456 789', avatar: 'MN', lastMessage: 'I have a toothache, is there a slot today?', time: 'Yesterday', unread: 1, online: true },
  { id: 'wa4', contact: 'Peter Ochieng',   phone: '+256 700 567 890', avatar: 'PO', lastMessage: 'Appointment confirmed ✓', time: 'Yesterday', unread: 0, online: false },
  { id: 'wa5', contact: 'Grace Auma',      phone: '+256 782 678 901', avatar: 'GA', lastMessage: 'How much is teeth whitening?', time: 'Mon', unread: 3, online: true },
  { id: 'wa6', contact: 'David Tumwine',   phone: '+256 701 789 012', avatar: 'DT', lastMessage: 'Thanks for the reminder!', time: 'Sun', unread: 0, online: false },
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
  { id: 'em1', contact: 'Dr. Lois Kisakye',       email: 'lois.kisakye@codeclinic.ug',     avatar: 'LK', lastMessage: 'Patient report for April attached', time: '8:50 AM', unread: 1 },
  { id: 'em2', contact: 'Kampala Dental Supplies', email: 'orders@kampalad.co.ug',           avatar: 'KD', lastMessage: 'Your order #KD-4421 has been dispatched', time: 'Yesterday', unread: 0 },
  { id: 'em3', contact: 'Sarah Namukasa',          email: 'sarah.namukasa@gmail.com',        avatar: 'SN', lastMessage: 'Re: Appointment booking confirmation', time: 'Yesterday', unread: 0 },
  { id: 'em4', contact: 'Uganda Revenue Authority',email: 'efris@ura.go.ug',                 avatar: 'UR', lastMessage: 'EFRIS: Your tax report is due', time: 'Mon', unread: 1 },
  { id: 'em5', contact: 'MTN MoMo Business',       email: 'business@mtn.co.ug',              avatar: 'MM', lastMessage: 'April statement ready for download', time: 'Mon', unread: 0 },
]

const emailMessages: Record<string, { subject: string; from: string; to: string; body: string; time: string; read: boolean }[]> = {
  em1: [{ subject: 'Patient report for April', from: 'lois.kisakye@codeclinic.ug', to: 'reception@codeclinic.ug', body: `Dear Reception,\n\nPlease find attached the patient summary report for April 2026. We had 42 patients this month with a 94% satisfaction rate.\n\nKind regards,\nDr. Lois Kisakye`, time: '8:50 AM', read: false }],
  em2: [{ subject: 'Order #KD-4421 Dispatched', from: 'orders@kampalad.co.ug', to: 'reception@codeclinic.ug', body: `Dear Code Clinic,\n\nYour order #KD-4421 (Dental composite kit × 3, Scaling tips × 10) has been dispatched and will arrive within 2 business days.\n\nTracking: UG-4421-KC\n\nBest regards,\nKampala Dental Supplies`, time: 'Yesterday 3:00 PM', read: true }],
  em3: [{ subject: 'Re: Appointment booking confirmation', from: 'sarah.namukasa@gmail.com', to: 'reception@codeclinic.ug', body: `Hello,\n\nThank you for the confirmation email. I will be there on Monday at 9:00 AM.\n\nBest,\nSarah`, time: 'Yesterday 11:30 AM', read: true }],
  em4: [{ subject: 'EFRIS: Tax report due - April 2026', from: 'efris@ura.go.ug', to: 'accounts@codeclinic.ug', body: `Dear Taxpayer,\n\nThis is a reminder that your EFRIS tax report for April 2026 is due by April 15, 2026.\n\nPlease log in to your EFRIS portal to submit.\n\nUganda Revenue Authority`, time: 'Mon 9:00 AM', read: false }],
  em5: [{ subject: 'April 2026 Account Statement', from: 'business@mtn.co.ug', to: 'accounts@codeclinic.ug', body: `Dear Valued Customer,\n\nYour MTN MoMo Business statement for April 2026 is now available.\n\nTotal received: UGX 4,280,000\nTotal sent: UGX 1,200,000\n\nMTN MoMo Business Team`, time: 'Mon 8:00 AM', read: true }],
}

const internalMessages: InternalMessage[] = [
  { id: 'i1', from: 'Dr. Mugabe', role: 'Admin', avatar: 'DM', text: 'Please confirm the 3pm slot for Mrs. Nakato has been rescheduled.', time: '11:02 AM', channel: 'appointments' },
  { id: 'i2', from: 'Dr. Lois', role: 'Doctor', avatar: 'DL', text: 'I will be 20 minutes late today, please inform my 9am patient.', time: '8:45 AM', channel: 'alerts' },
  { id: 'i3', from: 'Reception', role: 'Receptionist', avatar: 'R', text: 'All appointments for today are confirmed. 2 pending callbacks.', time: '8:00 AM', channel: 'general' },
  { id: 'i4', from: 'Dr. Mugabe', role: 'Admin', avatar: 'DM', text: 'Great work team! Remember staff meeting at 5PM.', time: 'Yesterday 4:00 PM', channel: 'general' },
]

// ── Helpers ───────────────────────────────────────────────────
const avatarColors: Record<string, string> = {
  SN: '#E91E63', JS: '#1565C0', MN: '#00897B', PO: '#F57F17',
  GA: '#6A1B9A', DT: '#2E7D32', LK: '#AD1457', KD: '#0277BD',
  UR: '#4E342E', MM: '#FF6F00', DM: '#1A237E', DL: '#6A1B9A',
  R: '#0891b2',
}

const WA_DARK  = '#075E54'
const WA_GREEN = '#25D366'
const NAVY     = '#1A237E'

function Avatar({ initials, size = 40 }: { initials: string; size?: number }) {
  return (
    <div className="rounded-full flex items-center justify-center flex-shrink-0 text-white font-bold"
      style={{ width: size, height: size, background: avatarColors[initials] || '#1A237E', fontSize: size * 0.35 }}>
      {initials}
    </div>
  )
}

function MsgStatus({ status }: { status?: string }) {
  if (status === 'read')      return <CheckCheck size={13} style={{ color: '#53BDEB', flexShrink: 0 }} />
  if (status === 'delivered') return <CheckCheck size={13} style={{ color: '#aaa', flexShrink: 0 }} />
  if (status === 'sent')      return <Check size={13} style={{ color: '#aaa', flexShrink: 0 }} />
  return null
}

// ── Attachment Bubble ─────────────────────────────────────────
function AttachmentBubble({ att, fromMe }: { att: NonNullable<Message['attachment']>; fromMe: boolean }) {
  const [playing, setPlaying] = useState(false)
  if (att.type === 'voice' || att.type === 'audio') {
    return (
      <div className="flex items-center gap-2 py-1 min-w-[180px]">
        <button onClick={() => setPlaying(p => !p)}
          className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
          style={{ background: fromMe ? '#25D366' : '#29ABE2' }}>
          {playing ? <Pause size={14} className="text-white" /> : <Play size={14} className="text-white" />}
        </button>
        <div className="flex-1">
          <div className="h-1 rounded-full bg-black/10 w-full">
            <div className="h-1 rounded-full bg-current w-1/3 opacity-40" />
          </div>
          <p className="text-[10px] mt-1 opacity-50">{att.duration || '0:12'}</p>
        </div>
        <Music size={14} className="opacity-40" />
      </div>
    )
  }
  if (att.type === 'image') {
    return (
      <div className="rounded-xl overflow-hidden max-w-[200px]">
        <div className="w-full h-32 bg-black/10 flex items-center justify-center rounded-xl">
          <ImageIcon size={32} className="opacity-30" />
        </div>
        {att.name && <p className="text-[10px] mt-1 opacity-60 truncate">{att.name}</p>}
      </div>
    )
  }
  if (att.type === 'video') {
    return (
      <div className="rounded-xl overflow-hidden max-w-[200px]">
        <div className="w-full h-32 bg-black/20 flex items-center justify-center rounded-xl relative">
          <Film size={32} className="opacity-30" />
          <div className="absolute inset-0 flex items-center justify-center">
            <Play size={24} className="opacity-60" />
          </div>
        </div>
        {att.name && <p className="text-[10px] mt-1 opacity-60 truncate">{att.name}</p>}
      </div>
    )
  }
  // file
  return (
    <div className="flex items-center gap-2 py-1 min-w-[160px]">
      <div className="w-9 h-9 rounded-xl flex items-center justify-center bg-black/10 flex-shrink-0">
        <FileText size={18} className="opacity-50" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold truncate">{att.name || 'Document'}</p>
        <p className="text-[10px] opacity-40">Tap to download</p>
      </div>
      <Download size={14} className="opacity-40 flex-shrink-0" />
    </div>
  )
}

// ── Page ─────────────────────────────────────────────────────
export default function CommunicationsPage() {
  const [channel, setChannel]       = useState<'whatsapp' | 'email' | 'internal'>('whatsapp')
  const [activeWa, setActiveWa]     = useState<string | null>(null)
  const [activeEm, setActiveEm]     = useState<string | null>(null)
  const [waSearch, setWaSearch]     = useState('')
  const [emSearch, setEmSearch]     = useState('')
  const [internalSearch, setInternalSearch] = useState('')
  const [reply, setReply]           = useState('')
  const [emailReply, setEmailReply] = useState('')
  const [internalMsg, setInternalMsg] = useState('')
  const [showThread, setShowThread] = useState(false)
  const [waMsgs, setWaMsgs]         = useState(waMessagesInit)
  const [recording, setRecording]   = useState(false)
  const [showAttachMenu, setShowAttachMenu] = useState(false)
  const [internalChan, setInternalChan] = useState<'general' | 'appointments' | 'alerts'>('general')
  const [internalMsgs, setInternalMsgs] = useState(internalMessages)
  // Human control state: when true the human handles the conversation, agent stops
  const [humanControl, setHumanControl] = useState<Record<string, boolean>>({})

  function takeOver(id: string) {
    setHumanControl(p => ({ ...p, [id]: true }))
    // Show system message in thread
    const sysMsg: Message = {
      id: 'sys_' + Date.now(),
      from: 'me',
      text: '🟡 You have taken over this conversation. The AI agent has been paused.',
      time: nowTime(),
      status: 'sent',
    }
    setWaMsgs(p => ({ ...p, [id]: [...(p[id] || []), sysMsg] }))
  }

  function handBackToAI(id: string) {
    setHumanControl(p => ({ ...p, [id]: false }))
    const sysMsg: Message = {
      id: 'sys_' + Date.now(),
      from: 'me',
      text: '🤖 AI agent resumed. Sarah will continue handling this conversation.',
      time: nowTime(),
      status: 'sent',
    }
    setWaMsgs(p => ({ ...p, [id]: [...(p[id] || []), sysMsg] }))
  }
  const bottomRef   = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const videoInputRef = useRef<HTMLInputElement>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [activeWa, activeEm, waMsgs])

  // ── Send text ────────────────────────────────────────────────
  function sendWa() {
    if (!reply.trim() || !activeWa) return
    const msg: Message = { id: Date.now().toString(), from: 'me', text: reply.trim(), time: nowTime(), status: 'sent' }
    setWaMsgs(p => ({ ...p, [activeWa]: [...(p[activeWa] || []), msg] }))
    setReply('')
  }

  function sendInternal() {
    if (!internalMsg.trim()) return
    const msg: InternalMessage = { id: Date.now().toString(), from: 'Reception', role: 'Receptionist', avatar: 'R', text: internalMsg.trim(), time: nowTime(), channel: internalChan }
    setInternalMsgs(m => [...m, msg])
    setInternalMsg('')
  }

  // ── Send attachment ──────────────────────────────────────────
  type AttachmentType = NonNullable<Message['attachment']>['type']
  function sendAttachment(type: AttachmentType, name: string) {
    if (!activeWa) return
    const msg: Message = { id: Date.now().toString(), from: 'me', time: nowTime(), status: 'sent', attachment: { type, name } }
    setWaMsgs(p => ({ ...p, [activeWa]: [...(p[activeWa] || []), msg] }))
    setShowAttachMenu(false)
  }

  // ── Voice recording ──────────────────────────────────────────
  async function toggleVoiceNote() {
    if (recording) {
      mediaRecorderRef.current?.stop()
      setRecording(false)
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mr = new MediaRecorder(stream)
      chunksRef.current = []
      mr.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data) }
      mr.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
        const url  = URL.createObjectURL(blob)
        if (activeWa) {
          const msg: Message = { id: Date.now().toString(), from: 'me', time: nowTime(), status: 'sent', attachment: { type: 'voice', url, duration: '0:' + Math.floor(Math.random() * 30 + 5).toString().padStart(2, '0') } }
          setWaMsgs(p => ({ ...p, [activeWa]: [...(p[activeWa] || []), msg] }))
        }
        stream.getTracks().forEach(t => t.stop())
      }
      mediaRecorderRef.current = mr
      mr.start()
      setRecording(true)
    } catch {
      alert('Microphone access required for voice notes')
    }
  }

  function nowTime() {
    return new Date().toLocaleTimeString('en-UG', { hour: '2-digit', minute: '2-digit' })
  }

  const waFiltered = waConversations.filter(c =>
    c.contact.toLowerCase().includes(waSearch.toLowerCase()) || (c.phone || '').includes(waSearch)
  )
  const emFiltered = emailConversations.filter(c =>
    c.contact.toLowerCase().includes(emSearch.toLowerCase()) || (c.email || '').toLowerCase().includes(emSearch.toLowerCase())
  )
  const internalFiltered = internalMsgs.filter(m => m.channel === internalChan).filter(m =>
    !internalSearch || m.text.toLowerCase().includes(internalSearch.toLowerCase()) || m.from.toLowerCase().includes(internalSearch.toLowerCase())
  )

  const convWa = waConversations.find(c => c.id === activeWa)
  const convEm = emailConversations.find(c => c.id === activeEm)
  const emMsgs = activeEm ? emailMessages[activeEm] || [] : []
  const topEmail = emMsgs[0]

  const totalUnread = waConversations.reduce((s, c) => s + c.unread, 0)
    + emailConversations.reduce((s, c) => s + ((emailMessages[c.id] || []).some(m => !m.read) ? 1 : 0), 0)

  return (
    <div className="h-full flex flex-col bg-gray-50 dark:bg-transparent" style={{ minHeight: 0 }}>

      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 bg-white dark:bg-white/5 border-b border-gray-100 dark:border-white/8 flex-shrink-0">
        <div>
          <h1 className="text-xl font-black text-gray-800 dark:text-white">Communications</h1>
          <p className="text-xs text-gray-400 dark:text-white/40 mt-0.5">
            {totalUnread > 0 ? `${totalUnread} unread messages` : 'All caught up'}
          </p>
        </div>
        <div className="flex gap-1 p-1 bg-gray-100 dark:bg-white/8 rounded-xl">
          {/* WhatsApp tab */}
          <button onClick={() => { setChannel('whatsapp'); setShowThread(false) }}
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-bold transition-all"
            style={channel === 'whatsapp' ? { background: WA_GREEN, color: '#fff' } : { color: '#6B7280' }}>
            <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14">
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
            </svg>
            WhatsApp
            {waConversations.reduce((s, c) => s + c.unread, 0) > 0 && (
              <span className="ml-1 px-1.5 py-0.5 text-[10px] font-black bg-red-500 text-white rounded-full">
                {waConversations.reduce((s, c) => s + c.unread, 0)}
              </span>
            )}
          </button>
          {/* Email tab */}
          <button onClick={() => { setChannel('email'); setShowThread(false) }}
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-bold transition-all"
            style={channel === 'email' ? { background: NAVY, color: '#fff' } : { color: '#6B7280' }}>
            <Mail size={14} />
            Email
          </button>
          {/* Internal tab */}
          <button onClick={() => setChannel('internal')}
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-bold transition-all"
            style={channel === 'internal' ? { background: '#7c3aed', color: '#fff' } : { color: '#6B7280' }}>
            <Users size={14} />
            Internal
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 flex overflow-hidden">

        {/* ══ WhatsApp ══════════════════════════════════════════ */}
        {channel === 'whatsapp' && (
          <>
            {/* List panel */}
            <div className={`w-[320px] flex-shrink-0 flex flex-col bg-white dark:bg-[#111b21] border-r border-gray-100 dark:border-white/8 ${showThread ? 'hidden md:flex' : 'flex'}`}>
              <div className="px-3 py-3 flex-shrink-0" style={{ background: WA_DARK }}>
                <div className="flex items-center justify-between mb-2.5">
                  <p className="text-white font-bold text-sm">WhatsApp Inbox</p>
                  <Plus size={18} className="text-white/70 cursor-pointer hover:text-white" />
                </div>
                <div className="relative">
                  <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input value={waSearch} onChange={e => setWaSearch(e.target.value)}
                    placeholder="Search or start new chat"
                    className="w-full pl-8 pr-3 py-2 text-xs rounded-lg outline-none bg-white/10 text-white placeholder-white/40" />
                </div>
              </div>
              <div className="flex-1 overflow-y-auto">
                {waFiltered.map(c => (
                  <button key={c.id}
                    onClick={() => { setActiveWa(c.id); setShowThread(true) }}
                    className={`w-full flex items-center gap-3 px-4 py-3 border-b border-gray-50 dark:border-white/5 hover:bg-gray-50 dark:hover:bg-white/5 text-left transition-colors ${activeWa === c.id ? 'bg-green-50 dark:bg-green-900/20' : ''}`}>
                    <div className="relative">
                      <Avatar initials={c.avatar} size={46} />
                      <span className="absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-white dark:border-[#111b21]"
                        style={{ background: c.online ? WA_GREEN : '#9CA3AF' }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between items-center">
                        <p className="text-sm font-semibold text-gray-800 dark:text-white truncate">{c.contact}</p>
                        <p className="text-[10px] text-gray-400 flex-shrink-0 ml-2">{c.time}</p>
                      </div>
                      <div className="flex justify-between items-center mt-0.5">
                        <p className="text-xs text-gray-400 dark:text-white/40 truncate">{c.lastMessage}</p>
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
                    <div className="relative">
                      <Avatar initials={convWa.avatar} size={38} />
                      <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border-2 border-[#075E54]"
                        style={{ background: convWa.online ? WA_GREEN : '#9CA3AF' }} />
                    </div>
                    <div className="flex-1">
                      <p className="text-white font-bold text-sm">{convWa.contact}</p>
                      <p className="text-[11px]" style={{ color: '#90cbb7' }}>
                        {humanControl[activeWa!] ? '🟡 Human control' : '🤖 AI handling'}
                      </p>
                    </div>
                    <div className="flex gap-1 items-center">
                      {/* Take Over / Hand Back button */}
                      {humanControl[activeWa!] ? (
                        <button onClick={() => handBackToAI(activeWa!)}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all hover:opacity-90"
                          style={{ background: '#00BCD4', color: '#fff' }}>
                          🤖 Hand Back to AI
                        </button>
                      ) : (
                        <button onClick={() => takeOver(activeWa!)}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all hover:opacity-90"
                          style={{ background: '#F59E0B', color: '#fff' }}>
                          Take Over
                        </button>
                      )}
                      <button className="w-9 h-9 rounded-full flex items-center justify-center hover:bg-white/10 text-white"><Phone size={17} /></button>
                      <button className="w-9 h-9 rounded-full flex items-center justify-center hover:bg-white/10 text-white"><Video size={17} /></button>
                      <button className="w-9 h-9 rounded-full flex items-center justify-center hover:bg-white/10 text-white"><MoreVertical size={17} /></button>
                    </div>
                  </div>

                  {/* Messages */}
                  <div className="flex-1 overflow-y-auto px-4 py-4 space-y-1.5" style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg width=\'60\' height=\'60\' viewBox=\'0 0 60 60\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cpath d=\'M54.627 0l.83.828-1.415 1.415L51.8 0h2.827zM5.373 0l-.83.828L5.96 2.243 8.2 0H5.374zM48.97 0l3.657 3.657-1.414 1.414L46.143 0h2.828zM11.03 0L7.372 3.657l1.415 1.414L13.857 0H11.03zm32.284 0L49.8 6.485 48.384 7.9l-7.9-7.9h2.83zM16.686 0L10.2 6.485 11.616 7.9l7.9-7.9h-2.83zm20.97 0l9.315 9.314-1.414 1.414L34.828 0h2.83zM22.344 0L13.03 9.314l1.414 1.414L25.172 0h-2.83zM32 0l12.142 12.142-1.414 1.415L30 1.413 17.272 13.557l-1.414-1.415L28 0h4zM.284 0l28 28-1.414 1.414L0 2.544v-2.26zM0 5.373l25.456 25.455-1.414 1.415L0 8.2V5.374zm0 5.656l22.627 22.627-1.414 1.414L0 13.86v-2.83zm0 5.656l19.8 19.8-1.415 1.413L0 19.514v-2.83zm0 5.657l16.97 16.97-1.414 1.415L0 25.172v-2.83zM0 28l14.142 14.142-1.414 1.414L0 30.828V28zm0 5.657L11.314 44.97l-1.414 1.415L0 36.485v-2.83zm0 5.657L8.485 47.8 7.07 49.214 0 42.143v-2.83zm0 5.657l5.657 5.657-1.414 1.415L0 47.8v-2.83zm0 5.657l2.828 2.83-1.414 1.413L0 53.456v-2.828zM54.627 60L30 35.373 5.373 60H8.2L30 38.2 51.8 60h2.827zm-5.656 0L30 41.03 11.03 60h2.828L30 43.858 46.142 60h2.83zm-5.657 0L30 46.686 16.686 60h2.83L30 49.515 40.485 60h2.83zm-5.657 0L30 52.343 22.343 60h2.83L30 55.17 34.828 60h2.83zM32 60l-2-2-2 2h4zM59.716 0l-28 28 1.414 1.414L60 2.544v-2.26zM60 5.373L34.544 30.828l1.414 1.415L60 8.2V5.374zm0 5.656L37.373 33.656l1.414 1.414L60 13.86v-2.83zm0 5.657L40.2 33.8l1.415 1.413L60 19.514v-2.83zm0 5.657L43.03 36.627l1.414 1.415L60 25.172v-2.83zM60 28L45.858 42.142l1.414 1.414L60 30.828V28zm0 5.657L48.686 44.97l1.415 1.415L60 36.485v-2.83zm0 5.657L51.515 47.8l1.414 1.413L60 42.143v-2.83zm0 5.657l-5.657 5.657 1.414 1.415L60 47.8v-2.83zm0 5.657l-2.828 2.83 1.414 1.413L60 53.456v-2.828z\' fill=\'%23000000\' fill-opacity=\'0.03\' fill-rule=\'evenodd\'/%3E%3C/svg%3E")' }}>
                    {(waMsgs[activeWa!] || []).map(m => (
                      <div key={m.id} className={`flex ${m.from === 'me' ? 'justify-end' : 'justify-start'}`}>
                        <div className="max-w-[72%] px-3 py-2 rounded-2xl shadow-sm text-sm leading-relaxed"
                          style={m.from === 'me'
                            ? { background: '#d9fdd3', borderBottomRightRadius: 4, color: '#111' }
                            : { background: '#fff', borderBottomLeftRadius: 4, color: '#111' }}>
                          {m.attachment && <AttachmentBubble att={m.attachment} fromMe={m.from === 'me'} />}
                          {m.text && <span>{m.text}</span>}
                          <div className="flex items-center justify-end gap-1 mt-0.5">
                            <span className="text-[10px] text-gray-400">{m.time}</span>
                            {m.from === 'me' && <MsgStatus status={m.status} />}
                          </div>
                        </div>
                      </div>
                    ))}
                    <div ref={bottomRef} />
                  </div>

                  {/* Attach menu */}
                  {showAttachMenu && (
                    <div className="flex items-center gap-3 px-4 py-3 flex-shrink-0" style={{ background: '#f0f2f5' }}>
                      <input ref={imageInputRef} type="file" accept="image/*" className="hidden"
                        onChange={e => { if (e.target.files?.[0]) sendAttachment('image', e.target.files[0].name); e.target.value = '' }} />
                      <input ref={videoInputRef} type="file" accept="video/*" className="hidden"
                        onChange={e => { if (e.target.files?.[0]) sendAttachment('video', e.target.files[0].name); e.target.value = '' }} />
                      <input ref={fileInputRef} type="file" className="hidden"
                        onChange={e => { if (e.target.files?.[0]) sendAttachment('file', e.target.files[0].name); e.target.value = '' }} />
                      {[
                        { icon: ImageIcon, label: 'Photo', color: '#e91e63', onClick: () => imageInputRef.current?.click() },
                        { icon: Film,      label: 'Video', color: '#9c27b0', onClick: () => videoInputRef.current?.click() },
                        { icon: FileText,  label: 'Document', color: '#1976d2', onClick: () => fileInputRef.current?.click() },
                        { icon: Music,     label: 'Audio', color: '#ff9800', onClick: () => sendAttachment('audio', 'Audio clip') },
                      ].map(({ icon: Icon, label, color, onClick }) => (
                        <button key={label} onClick={onClick}
                          className="flex flex-col items-center gap-1 px-3 py-2 rounded-xl hover:bg-black/5 transition-colors">
                          <div className="w-10 h-10 rounded-full flex items-center justify-center text-white"
                            style={{ background: color }}>
                            <Icon size={18} />
                          </div>
                          <span className="text-[10px] text-gray-500 font-medium">{label}</span>
                        </button>
                      ))}
                      <button onClick={() => setShowAttachMenu(false)} className="ml-auto w-7 h-7 flex items-center justify-center rounded-full hover:bg-black/10">
                        <X size={14} className="text-gray-500" />
                      </button>
                    </div>
                  )}

                  {/* Input — disabled when AI is in control */}
                  {humanControl[activeWa!] ? (
                    <div className="flex items-center gap-2 px-3 py-2.5 flex-shrink-0" style={{ background: '#f0f2f5' }}>
                      <button onClick={() => setShowAttachMenu(s => !s)}
                        className="w-9 h-9 rounded-full flex items-center justify-center hover:bg-black/5 text-gray-500 transition-colors">
                        <Paperclip size={20} className={showAttachMenu ? 'text-cyan-500' : ''} />
                      </button>
                      <button className="w-9 h-9 rounded-full flex items-center justify-center hover:bg-black/5 text-gray-500">
                        <Smile size={20} />
                      </button>
                      <input
                        value={reply}
                        onChange={e => setReply(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendWa() } }}
                        placeholder="Type a message..."
                        className="flex-1 px-4 py-2.5 rounded-2xl bg-white text-sm outline-none shadow-sm text-gray-800"
                      />
                      {reply.trim() ? (
                        <button onClick={sendWa}
                          className="w-11 h-11 rounded-full flex items-center justify-center transition-all hover:scale-105"
                          style={{ background: WA_GREEN }}>
                          <Send size={17} className="text-white" style={{ transform: 'translateX(1px)' }} />
                        </button>
                      ) : (
                        <button onClick={toggleVoiceNote}
                          className={cn(
                            'w-11 h-11 rounded-full flex items-center justify-center transition-all hover:scale-105',
                            recording ? 'animate-pulse' : '',
                          )}
                          style={{ background: recording ? '#ef4444' : WA_GREEN }}>
                          {recording ? <MicOff size={17} className="text-white" /> : <Mic size={17} className="text-white" />}
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 px-4 py-3 flex-shrink-0 border-t" style={{ background: '#f9f9f9' }}>
                      <span className="text-xs text-gray-400 italic flex items-center gap-1.5 flex-1">
                        🤖 AI agent is handling this conversation — click <strong className="text-amber-500 not-italic">Take Over</strong> to respond manually
                      </span>
                    </div>
                  )}
                </>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center p-8">
                  <div className="w-20 h-20 rounded-full flex items-center justify-center" style={{ background: `${WA_GREEN}20` }}>
                    <svg viewBox="0 0 24 24" fill={WA_GREEN} width="40" height="40">
                      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                    </svg>
                  </div>
                  <p className="text-gray-600 font-semibold">WhatsApp Inbox</p>
                  <p className="text-gray-400 text-sm">Select a conversation to reply</p>
                </div>
              )}
            </div>
          </>
        )}

        {/* ══ Email ════════════════════════════════════════════ */}
        {channel === 'email' && (
          <>
            {/* List panel */}
            <div className={`w-[320px] flex-shrink-0 flex flex-col bg-white dark:bg-[#0e1f4d] border-r border-gray-100 dark:border-white/8 ${showThread ? 'hidden md:flex' : 'flex'}`}>
              <div className="px-3 py-3 flex-shrink-0" style={{ background: NAVY }}>
                <p className="text-white font-bold text-sm mb-2.5">Email Inbox</p>
                <div className="relative">
                  <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input value={emSearch} onChange={e => setEmSearch(e.target.value)}
                    placeholder="Search emails..."
                    className="w-full pl-8 pr-3 py-2 text-xs rounded-lg outline-none bg-white/10 text-white placeholder-white/40" />
                </div>
              </div>
              <div className="flex-1 overflow-y-auto">
                {emFiltered.map(c => {
                  const hasUnread = (emailMessages[c.id] || []).some(m => !m.read)
                  return (
                    <button key={c.id}
                      onClick={() => { setActiveEm(c.id); setShowThread(true) }}
                      className={`w-full flex items-center gap-3 px-4 py-3 border-b border-gray-50 dark:border-white/5 hover:bg-gray-50 dark:hover:bg-white/5 text-left transition-colors ${activeEm === c.id ? 'bg-blue-50 dark:bg-blue-900/20' : ''}`}>
                      <Avatar initials={c.avatar} size={42} />
                      <div className="flex-1 min-w-0">
                        <div className="flex justify-between items-center">
                          <p className={`text-sm truncate ${hasUnread ? 'font-bold text-gray-900 dark:text-white' : 'font-medium text-gray-700 dark:text-white/70'}`}>{c.contact}</p>
                          <p className="text-[10px] text-gray-400 flex-shrink-0 ml-2">{c.time}</p>
                        </div>
                        <p className={`text-xs truncate mt-0.5 ${hasUnread ? 'text-gray-700 dark:text-white/70' : 'text-gray-400 dark:text-white/40'}`}>{c.lastMessage}</p>
                      </div>
                      {hasUnread && <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: '#29ABE2' }} />}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Thread panel */}
            <div className={`flex-1 flex flex-col bg-gray-50 dark:bg-transparent ${showThread ? 'flex' : 'hidden md:flex'}`}>
              {convEm && topEmail ? (
                <>
                  <div className="flex items-center gap-3 px-6 py-4 bg-white dark:bg-white/5 border-b border-gray-100 dark:border-white/8 flex-shrink-0">
                    <button onClick={() => setShowThread(false)} className="md:hidden mr-1 text-gray-600"><ArrowLeft size={20} /></button>
                    <div className="flex-1">
                      <h2 className="font-bold text-gray-800 dark:text-white">{topEmail.subject}</h2>
                      <p className="text-xs text-gray-400 dark:text-white/40 mt-0.5">{emMsgs.length} message{emMsgs.length !== 1 ? 's' : ''}</p>
                    </div>
                    <button className="w-8 h-8 flex items-center justify-center rounded-xl hover:bg-gray-100 dark:hover:bg-white/8 text-gray-500"><Archive size={16} /></button>
                  </div>

                  {/* Email body */}
                  <div className="flex-1 overflow-y-auto p-6 space-y-4">
                    {emMsgs.map(em => (
                      <div key={em.subject} className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/8 p-5 shadow-sm">
                        <div className="flex items-start justify-between mb-3">
                          <div className="flex items-center gap-3">
                            <Avatar initials={convEm.avatar} size={36} />
                            <div>
                              <p className="text-sm font-bold text-gray-800 dark:text-white">{em.from}</p>
                              <p className="text-xs text-gray-400 dark:text-white/40">To: {em.to} · {em.time}</p>
                            </div>
                          </div>
                          <div className="flex gap-1">
                            <button className="w-8 h-8 flex items-center justify-center rounded-xl hover:bg-gray-100 dark:hover:bg-white/8 text-gray-400"><Reply size={14} /></button>
                            <button className="w-8 h-8 flex items-center justify-center rounded-xl hover:bg-gray-100 dark:hover:bg-white/8 text-gray-400"><Forward size={14} /></button>
                            <button className="w-8 h-8 flex items-center justify-center rounded-xl hover:bg-gray-100 dark:hover:bg-white/8 text-gray-400"><Star size={14} /></button>
                          </div>
                        </div>
                        <p className="text-sm text-gray-700 dark:text-white/70 whitespace-pre-wrap leading-relaxed">{em.body}</p>
                      </div>
                    ))}
                  </div>

                  {/* Email reply box */}
                  <div className="px-6 py-4 bg-white dark:bg-white/5 border-t border-gray-100 dark:border-white/8 flex-shrink-0">
                    <p className="text-xs font-bold text-gray-400 dark:text-white/40 mb-2">Reply to {convEm.email}</p>
                    <div className="flex gap-2 mb-2">
                      <input ref={fileInputRef} type="file" className="hidden"
                        onChange={e => { if (e.target.files?.[0]) { /* attach to email */ e.target.value = '' } }} />
                    </div>
                    <textarea
                      value={emailReply} onChange={e => setEmailReply(e.target.value)}
                      placeholder="Write your reply..."
                      rows={3}
                      className="w-full px-4 py-3 text-sm bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl resize-none outline-none focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-500 dark:text-white dark:placeholder-white/30 transition-all"
                    />
                    <div className="flex items-center justify-between mt-2">
                      <div className="flex gap-2">
                        <button onClick={() => fileInputRef.current?.click()}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-gray-500 dark:text-white/50 hover:bg-gray-100 dark:hover:bg-white/8 border border-gray-200 dark:border-white/10 transition-colors">
                          <Paperclip size={13} /> Attach
                        </button>
                        <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-gray-500 dark:text-white/50 hover:bg-gray-100 dark:hover:bg-white/8 border border-gray-200 dark:border-white/10 transition-colors">
                          <ImageIcon size={13} /> Image
                        </button>
                      </div>
                      <button
                        onClick={() => { if (emailReply.trim()) { setEmailReply(''); } }}
                        className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold text-white transition-all hover:-translate-y-0.5 hover:shadow-md disabled:opacity-40"
                        disabled={!emailReply.trim()}
                        style={{ background: 'linear-gradient(135deg,#1A237E,#29ABE2)' }}>
                        <Send size={14} /> Send Reply
                      </button>
                    </div>
                  </div>
                </>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center gap-3 p-8 text-center">
                  <div className="w-20 h-20 rounded-full flex items-center justify-center" style={{ background: `${NAVY}15` }}>
                    <Mail size={36} style={{ color: NAVY }} className="opacity-40" />
                  </div>
                  <p className="text-gray-600 dark:text-white/60 font-semibold">Email Inbox</p>
                  <p className="text-gray-400 dark:text-white/30 text-sm">Select a conversation to read and reply</p>
                </div>
              )}
            </div>
          </>
        )}

        {/* ══ Internal Messages ════════════════════════════════ */}
        {channel === 'internal' && (
          <div className="flex-1 flex">
            {/* Channel list */}
            <div className="w-48 flex-shrink-0 bg-white dark:bg-white/[0.03] border-r border-gray-100 dark:border-white/8 flex flex-col">
              <div className="px-3 py-3 border-b border-gray-100 dark:border-white/8">
                <p className="text-xs font-black text-gray-500 dark:text-white/40 uppercase tracking-wide">Channels</p>
              </div>
              {(['general', 'appointments', 'alerts'] as const).map(ch => (
                <button key={ch} onClick={() => setInternalChan(ch)}
                  className={cn(
                    'flex items-center gap-2 px-4 py-2.5 text-sm font-medium capitalize transition-colors text-left',
                    internalChan === ch
                      ? 'bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-400 font-bold border-r-2 border-purple-500'
                      : 'text-gray-600 dark:text-white/60 hover:bg-gray-50 dark:hover:bg-white/5',
                  )}>
                  <span className="text-base">{ch === 'general' ? '#' : ch === 'appointments' ? '📅' : '🚨'}</span>
                  {ch}
                </button>
              ))}
              <div className="px-3 py-3 mt-2 border-t border-gray-100 dark:border-white/8">
                <p className="text-xs font-black text-gray-500 dark:text-white/40 uppercase tracking-wide mb-2">Team</p>
                {['Dr. Mugabe', 'Dr. Lois', 'Reception'].map(m => (
                  <div key={m} className="flex items-center gap-2 px-1 py-1.5">
                    <div className="w-2 h-2 rounded-full bg-emerald-400 flex-shrink-0" />
                    <span className="text-xs text-gray-600 dark:text-white/60 truncate">{m}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Message feed */}
            <div className="flex-1 flex flex-col bg-white dark:bg-white/[0.02]">
              {/* Channel header */}
              <div className="flex items-center gap-2 px-6 py-3 border-b border-gray-100 dark:border-white/8 flex-shrink-0">
                <span className="text-lg">{internalChan === 'general' ? '#' : internalChan === 'appointments' ? '📅' : '🚨'}</span>
                <div>
                  <p className="font-bold text-gray-800 dark:text-white capitalize">{internalChan}</p>
                  <p className="text-xs text-gray-400 dark:text-white/40">Internal team channel</p>
                </div>
                <div className="ml-auto relative">
                  <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input value={internalSearch} onChange={e => setInternalSearch(e.target.value)}
                    placeholder="Search messages..."
                    className="pl-8 pr-3 py-1.5 text-xs bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl outline-none dark:text-white dark:placeholder-white/30" />
                </div>
              </div>

              {/* Messages */}
              <div className="flex-1 overflow-y-auto p-6 space-y-4">
                {internalFiltered.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-32 text-gray-400">
                    <MessageSquare size={28} className="mb-2 text-gray-200 dark:text-white/10" />
                    <p className="text-sm">No messages in #{internalChan}</p>
                  </div>
                ) : internalFiltered.map(m => (
                  <div key={m.id} className={cn('flex gap-3', m.from === 'Reception' && 'flex-row-reverse')}>
                    <div className="w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
                      style={{ background: avatarColors[m.avatar] || '#1A237E' }}>
                      {m.avatar}
                    </div>
                    <div className={cn('max-w-[70%]', m.from === 'Reception' && 'items-end flex flex-col')}>
                      <div className="flex items-baseline gap-2 mb-1">
                        <p className="text-xs font-bold text-gray-700 dark:text-white/70">{m.from}</p>
                        <span className="text-[10px] text-gray-400 dark:text-white/30 font-medium bg-gray-100 dark:bg-white/8 px-1.5 rounded">{m.role}</span>
                        <p className="text-[10px] text-gray-400 dark:text-white/30">{m.time}</p>
                      </div>
                      <div className={cn(
                        'px-4 py-2.5 rounded-2xl text-sm leading-relaxed',
                        m.from === 'Reception'
                          ? 'rounded-tr-sm bg-gradient-to-r from-cyan-500 to-blue-600 text-white'
                          : 'rounded-tl-sm bg-gray-100 dark:bg-white/8 text-gray-700 dark:text-white/80',
                        m.channel === 'alerts' && m.from !== 'Reception' && 'border-l-4 border-red-400',
                      )}>
                        {m.text}
                      </div>
                    </div>
                  </div>
                ))}
                <div ref={bottomRef} />
              </div>

              {/* Internal message input */}
              <div className="px-6 py-4 border-t border-gray-100 dark:border-white/8 flex-shrink-0">
                <div className="flex items-center gap-2">
                  <input ref={fileInputRef} type="file" className="hidden" onChange={e => e.target.value = ''} />
                  <button onClick={() => fileInputRef.current?.click()}
                    className="w-9 h-9 flex items-center justify-center rounded-xl hover:bg-gray-100 dark:hover:bg-white/8 text-gray-400 transition-colors">
                    <Paperclip size={17} />
                  </button>
                  <input
                    value={internalMsg}
                    onChange={e => setInternalMsg(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendInternal() } }}
                    placeholder={`Message #${internalChan}...`}
                    className="flex-1 px-4 py-2.5 rounded-xl bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 text-sm dark:text-white dark:placeholder-white/30 outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500 transition-all"
                  />
                  <button onClick={sendInternal} disabled={!internalMsg.trim()}
                    className="w-10 h-10 rounded-xl flex items-center justify-center text-white transition-all hover:scale-105 disabled:opacity-40"
                    style={{ background: 'linear-gradient(135deg,#7c3aed,#9333ea)' }}>
                    <Send size={16} />
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
