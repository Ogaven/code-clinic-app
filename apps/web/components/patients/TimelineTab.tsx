'use client'

import { useEffect, useState, useRef } from 'react'
import {
  Calendar, MessageSquare, FileText, Loader2,
  ChevronDown, ChevronUp, Plus, Mic, MicOff,
} from 'lucide-react'
import { cn } from '@/lib/utils'

const PATIENT_STATUS: Record<string, { label: string; cls: string }> = {
  ACTIVE:   { label: 'Active',    cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' },
  LAPSED:   { label: 'Lapsed',    cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' },
  DORMANT:  { label: 'Dormant',   cls: 'bg-slate-100 text-slate-600 dark:bg-slate-900/30 dark:text-slate-400' },
  NEW_LEAD: { label: 'New Patient',  cls: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' },
  UPCOMING: { label: 'Upcoming',  cls: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400' },
}

const APPT_STATUS: Record<string, string> = {
  PENDING:        'bg-slate-100 text-slate-600',
  CONFIRMED:      'bg-blue-100 text-blue-700',
  CHECKED_IN:     'bg-yellow-100 text-yellow-800',
  IN_CHAIR:       'bg-orange-100 text-orange-800',
  WITH_PROVIDER:  'bg-teal-100 text-teal-800',
  READY_CHECKOUT: 'bg-purple-100 text-purple-800',
  COMPLETED:      'bg-emerald-100 text-emerald-700',
  NO_SHOW:        'bg-red-100 text-red-700',
  CANCELLED:      'bg-slate-100 text-slate-400',
}

const CHANNEL_CLS: Record<string, string> = {
  WHATSAPP:  'bg-green-100 text-green-700',
  SMS:       'bg-blue-100 text-blue-700',
  VOICE:     'bg-orange-100 text-orange-700',
  WEBSITE:   'bg-violet-100 text-violet-700',
  FACEBOOK:  'bg-indigo-100 text-indigo-700',
  INSTAGRAM: 'bg-pink-100 text-pink-700',
}

function fmtUGX(n: number) {
  return 'UGX ' + Math.round(n).toLocaleString()
}

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString('en-UG', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
  })
}
function fmtTime(d: string) {
  return new Date(d).toLocaleTimeString('en-UG', { hour: '2-digit', minute: '2-digit' })
}

// ── Appointment row ───────────────────────────────────────────────────────────

function ApptRow({ a }: { a: any }) {
  const cls = APPT_STATUS[a.status] || 'bg-slate-100 text-slate-600'
  return (
    <div className="flex items-center justify-between px-4 py-3 border border-slate-100 dark:border-white/10 rounded-xl">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{ backgroundColor: (a.service?.colour || '#1976D2') + '25' }}>
          <Calendar size={14} style={{ color: a.service?.colour || '#1976D2' }} />
        </div>
        <div>
          <p className="text-sm font-medium text-slate-800 dark:text-white leading-snug">
            {a.service?.name || 'Appointment'}
          </p>
          <p className="text-xs text-slate-400 mt-0.5">
            {a.doctor?.user ? `Dr. ${a.doctor.user.firstName} ${a.doctor.user.lastName} · ` : ''}
            {fmtDate(a.startAt)} {fmtTime(a.startAt)}
          </p>
        </div>
      </div>
      <span className={cn('text-xs font-semibold px-2 py-0.5 rounded-full flex-shrink-0', cls)}>
        {a.status.replace(/_/g, ' ')}
      </span>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function TimelineTab({ patientId }: { patientId: string }) {
  const [data,         setData]        = useState<any>(null)
  const [notes,        setNotes]       = useState<any[]>([])
  const [loading,      setLoading]     = useState(true)
  const [noteText,     setNoteText]    = useState('')
  const [interimText,  setInterimText] = useState('')       // ghost text shown below textarea
  const [savingNote,   setSavingNote]  = useState(false)
  const [isRecording,  setIsRecording] = useState(false)
  const [expanded,     setExpanded]    = useState<Set<string>>(new Set())
  const [showAllPast,  setShowAllPast] = useState(false)
  const [overrideStatus,  setOverrideStatus]  = useState('')
  const [savingStatus,    setSavingStatus]    = useState(false)
  const recognitionRef  = useRef<any>(null)
  const isRecordingRef  = useRef(false)
  const finalTextRef    = useRef('')         // committed (final-only) text
  const pendingFinalRef = useRef('')         // finals buffered for 300ms debounce
  const lastFinalIdxRef = useRef(-1)         // last result index we've finalized
  const debounceRef     = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const token = localStorage.getItem('cc_token')
    const h = { Authorization: `Bearer ${token}` }
    Promise.all([
      fetch(`/api-proxy/patients/${patientId}/timeline`, { headers: h }).then(r => r.json()),
      fetch(`/api-proxy/clinical/patients/${patientId}/treatment-notes`, { headers: h }).then(r => r.json()),
    ])
      .then(([tl, ns]) => {
        setData(tl)
        setOverrideStatus(tl.savedStatus || tl.patientStatus || '')
        setNotes(Array.isArray(ns) ? ns : [])
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [patientId])

  const saveNote = async () => {
    if (!noteText.trim()) return
    setSavingNote(true)
    const token = localStorage.getItem('cc_token')
    try {
      const res = await fetch(`/api-proxy/clinical/patients/${patientId}/treatment-notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ content: noteText }),
      })
      const note = await res.json()
      setNotes(prev => [note, ...prev])
      setNoteText('')
    } catch {/* ignore */} finally { setSavingNote(false) }
  }

  const startRecording = () => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SR) { alert('Voice recording requires Chrome or Edge'); return }

    // Snapshot current note text as the committed baseline
    finalTextRef.current    = noteText
    pendingFinalRef.current = ''
    lastFinalIdxRef.current = -1
    isRecordingRef.current  = true
    setIsRecording(true)
    setInterimText('')

    // Flush pending finals buffer → committed text, then clear
    const flushPending = () => {
      if (debounceRef.current) { clearTimeout(debounceRef.current); debounceRef.current = null }
      if (pendingFinalRef.current) {
        finalTextRef.current   += pendingFinalRef.current
        pendingFinalRef.current = ''
        setNoteText(finalTextRef.current)
      }
    }

    function createAndStart() {
      if (!isRecordingRef.current) return
      const rec = new SR()
      rec.continuous    = true
      rec.interimResults = true
      rec.lang          = 'en-US'

      rec.onresult = (e: any) => {
        let interimTranscript = ''

        for (let i = e.resultIndex; i < e.results.length; i++) {
          const result = e.results[i]

          if (result.isFinal) {
            // Guard: skip if this result index was already processed
            if (i > lastFinalIdxRef.current) {
              lastFinalIdxRef.current  = i
              pendingFinalRef.current += result[0].transcript + ' '
            }
          } else {
            interimTranscript += result[0].transcript
          }
        }

        // Show interim ghost text immediately (not committed)
        setInterimText(interimTranscript)

        // Debounce the actual commit of finals — 300ms after the last final arrives
        if (pendingFinalRef.current) {
          if (debounceRef.current) clearTimeout(debounceRef.current)
          debounceRef.current = setTimeout(() => {
            finalTextRef.current   += pendingFinalRef.current
            pendingFinalRef.current = ''
            setNoteText(finalTextRef.current)
            setInterimText('')
          }, 300)
        }
      }

      rec.onerror = (e: any) => {
        if (e.error === 'no-speech' || e.error === 'aborted') return
        isRecordingRef.current = false
        setIsRecording(false)
        setInterimText('')
      }

      rec.onend = () => {
        // Flush any buffered finals before the session restarts
        flushPending()
        // Reset per-session index — new session starts at resultIndex 0
        lastFinalIdxRef.current = -1

        if (isRecordingRef.current) { setTimeout(createAndStart, 150) }
        else { setIsRecording(false); setInterimText('') }
      }

      recognitionRef.current = rec
      try { rec.start() } catch {/* ignore */}
    }

    createAndStart()
  }

  const stopRecording = () => {
    isRecordingRef.current = false
    // Flush any debounced finals before stopping so no words are lost
    if (debounceRef.current) { clearTimeout(debounceRef.current); debounceRef.current = null }
    if (pendingFinalRef.current) {
      finalTextRef.current   += pendingFinalRef.current
      pendingFinalRef.current = ''
      setNoteText(finalTextRef.current)
    }
    recognitionRef.current?.stop()
    setIsRecording(false)
    setInterimText('')
  }

  const saveStatusOverride = async (newStatus: string) => {
    setSavingStatus(true)
    const token = localStorage.getItem('cc_token')
    try {
      await fetch(`/api-proxy/patients/${patientId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ status: newStatus }),
      })
      setOverrideStatus(newStatus)
      setData((d: any) => d ? { ...d, savedStatus: newStatus, patientStatus: newStatus } : d)
    } catch {/* ignore */} finally { setSavingStatus(false) }
  }

  const toggleConv = (id: string) =>
    setExpanded(prev => {
      const s = new Set(prev)
      s.has(id) ? s.delete(id) : s.add(id)
      return s
    })

  if (loading) return (
    <div className="flex items-center justify-center py-16">
      <Loader2 size={24} className="animate-spin text-slate-400" />
    </div>
  )

  if (!data) return (
    <div className="text-center py-12 text-sm text-slate-400">Could not load timeline.</div>
  )

  const { appointments = [], financial, conversations = [] } = data
  const displayStatus = overrideStatus || data.patientStatus || 'NEW_LEAD'
  const statusCfg = PATIENT_STATUS[displayStatus] || PATIENT_STATUS.NEW_LEAD

  const now      = new Date()
  const upcoming = (appointments as any[]).filter(
    a => new Date(a.startAt) >= now && !['CANCELLED', 'COMPLETED', 'NO_SHOW'].includes(a.status),
  )
  const past = (appointments as any[]).filter(
    a => new Date(a.startAt) < now || ['COMPLETED', 'NO_SHOW', 'CANCELLED'].includes(a.status),
  )
  const visiblePast = showAllPast ? past : past.slice(0, 5)

  return (
    <div className="space-y-7">

      {/* ── Status badge + override ── */}
      <div className="flex items-center flex-wrap gap-3">
        <span className={cn('text-xs font-bold px-3 py-1.5 rounded-full', statusCfg.cls)}>
          {statusCfg.label}
        </span>
        <span className="text-xs text-slate-400">
          {appointments.length} appointment{appointments.length !== 1 ? 's' : ''} total
        </span>
        <div className="flex items-center gap-1.5 ml-auto">
          <label className="text-xs text-slate-400">Override:</label>
          <select
            value={overrideStatus}
            onChange={e => saveStatusOverride(e.target.value)}
            disabled={savingStatus}
            className="text-xs py-1 px-2 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
          >
            {Object.entries(PATIENT_STATUS).map(([key, cfg]) => (
              <option key={key} value={key}>{cfg.label}</option>
            ))}
          </select>
          {savingStatus && <span className="text-xs text-slate-400">Saving…</span>}
        </div>
      </div>

      {/* ── Financial summary ── */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-slate-50 dark:bg-white/5 border border-slate-100 dark:border-white/10 rounded-xl p-4">
          <p className="text-xs text-slate-500 mb-1">Total Billed</p>
          <p className="text-sm font-bold text-slate-800 dark:text-white">{fmtUGX(financial.totalBilled)}</p>
          <p className="text-xs text-slate-400 mt-0.5">
            {financial.invoiceCount} invoice{financial.invoiceCount !== 1 ? 's' : ''}
          </p>
        </div>
        <div className="bg-slate-50 dark:bg-white/5 border border-slate-100 dark:border-white/10 rounded-xl p-4">
          <p className="text-xs text-slate-500 mb-1">Total Paid</p>
          <p className="text-sm font-bold text-emerald-600">{fmtUGX(financial.totalPaid)}</p>
        </div>
        <div className={cn('rounded-xl p-4 border', financial.outstanding > 0
          ? 'bg-red-50 dark:bg-red-900/10 border-red-100 dark:border-red-900/20'
          : 'bg-slate-50 dark:bg-white/5 border-slate-100 dark:border-white/10')}>
          <p className="text-xs text-slate-500 mb-1">Outstanding</p>
          <p className={cn('text-sm font-bold', financial.outstanding > 0 ? 'text-red-600' : 'text-slate-400')}>
            {financial.outstanding > 0 ? fmtUGX(financial.outstanding) : 'Nil'}
          </p>
        </div>
      </div>

      {/* ── Appointments ── */}
      <section>
        <h3 className="text-sm font-bold text-slate-700 dark:text-slate-300 mb-3 flex items-center gap-2">
          <Calendar size={14} /> Appointments
        </h3>

        {upcoming.length > 0 && (
          <div className="mb-4">
            <p className="text-xs text-slate-500 uppercase tracking-wide font-semibold mb-2">Upcoming</p>
            <div className="space-y-2">
              {upcoming.map((a: any) => <ApptRow key={a.id} a={a} />)}
            </div>
          </div>
        )}

        {past.length > 0 && (
          <div>
            {upcoming.length > 0 && (
              <p className="text-xs text-slate-500 uppercase tracking-wide font-semibold mb-2">Past</p>
            )}
            <div className="space-y-2">
              {visiblePast.map((a: any) => <ApptRow key={a.id} a={a} />)}
            </div>
            {past.length > 5 && (
              <button onClick={() => setShowAllPast(v => !v)}
                className="mt-2 text-xs text-blue-600 hover:underline flex items-center gap-1">
                {showAllPast
                  ? <><ChevronUp size={12} /> Show less</>
                  : <><ChevronDown size={12} /> Show all {past.length} past appointments</>}
              </button>
            )}
          </div>
        )}

        {appointments.length === 0 && (
          <p className="text-sm text-slate-400 py-3">No appointments yet.</p>
        )}
      </section>

      {/* ── AI Conversations ── */}
      <section>
        <h3 className="text-sm font-bold text-slate-700 dark:text-slate-300 mb-3 flex items-center gap-2">
          <MessageSquare size={14} /> AI Conversations
          <span className="text-xs font-normal text-slate-400">({conversations.length} threads)</span>
        </h3>

        {conversations.length === 0 && (
          <p className="text-sm text-slate-400">No AI conversations found.</p>
        )}

        <div className="space-y-2">
          {(conversations as any[]).map((conv: any) => {
            const isOpen  = expanded.has(conv.id)
            const msgs    = (conv.messages || []) as any[]
            const lastMsg = msgs[msgs.length - 1]

            return (
              <div key={conv.id}
                className="border border-slate-100 dark:border-white/10 rounded-xl overflow-hidden">

                {/* Header row */}
                <button onClick={() => toggleConv(conv.id)}
                  className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-slate-50 dark:hover:bg-white/5 transition-colors">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={cn('text-xs font-semibold px-2 py-0.5 rounded-full',
                      CHANNEL_CLS[conv.channel] || 'bg-slate-100 text-slate-600')}>
                      {conv.channel}
                    </span>
                    <span className="text-xs text-slate-500">{conv.messageCount} msgs</span>
                    <span className={cn('text-xs',
                      conv.status === 'ACTIVE'         ? 'text-emerald-600' :
                      conv.status === 'HUMAN_TAKEOVER' ? 'text-orange-500' : 'text-slate-400')}>
                      {conv.status.replace(/_/g, ' ')}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className="text-xs text-slate-400 hidden sm:inline">
                      {new Date(conv.updatedAt).toLocaleDateString('en-UG', { day: 'numeric', month: 'short' })}
                    </span>
                    {isOpen
                      ? <ChevronUp size={14} className="text-slate-400" />
                      : <ChevronDown size={14} className="text-slate-400" />}
                  </div>
                </button>

                {/* Last message preview when collapsed */}
                {!isOpen && lastMsg && (
                  <p className="px-4 pb-3 text-xs text-slate-400 truncate">
                    {lastMsg.role === 'USER' ? 'Patient: ' : 'Agent: '}{lastMsg.content}
                  </p>
                )}

                {/* Message thread when expanded */}
                {isOpen && (
                  <div className="border-t border-slate-100 dark:border-white/10 p-3 space-y-2 max-h-72 overflow-y-auto">
                    {msgs.length === 0 && (
                      <p className="text-xs text-center text-slate-400 py-2">No messages.</p>
                    )}
                    {msgs.map((msg: any) => (
                      <div key={msg.id}
                        className={cn('flex', msg.role === 'USER' ? 'justify-end' : 'justify-start')}>
                        <div className={cn('max-w-[80%] text-xs px-3 py-2 rounded-xl',
                          msg.role === 'USER'
                            ? 'bg-blue-600 text-white rounded-br-sm'
                            : msg.role === 'AGENT'
                              ? 'bg-slate-100 dark:bg-white/10 text-slate-700 dark:text-slate-300 rounded-bl-sm'
                              : 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 text-center w-full rounded')}>
                          {msg.content}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </section>

      {/* ── Staff Notes ── */}
      <section>
        <h3 className="text-sm font-bold text-slate-700 dark:text-slate-300 mb-3 flex items-center gap-2">
          <FileText size={14} /> Staff Notes
          <span className="text-xs font-normal text-slate-400">({notes.length})</span>
        </h3>

        {/* Add note form */}
        <div className="mb-4 bg-slate-50 dark:bg-white/5 border border-slate-100 dark:border-white/10 rounded-xl p-3">
          <div className="mb-2">
            {isRecording ? (
              <button onClick={stopRecording}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-red-500 rounded-lg animate-pulse">
                <MicOff size={12} /> Stop Recording
              </button>
            ) : (
              <button onClick={startRecording}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700">
                <Mic size={12} /> Dictate Note
              </button>
            )}
          </div>
          <textarea
            value={noteText}
            onChange={e => setNoteText(e.target.value)}
            placeholder={isRecording ? 'Transcribing… Speak now.' : 'Add a staff note…'}
            rows={3}
            className="w-full text-sm bg-transparent dark:text-white resize-none outline-none placeholder:text-slate-400"
          />
          {/* Interim ghost text — shown while speaking, not yet committed */}
          {isRecording && interimText && (
            <p className="text-sm text-slate-400 dark:text-slate-500 italic mt-1 leading-snug select-none">
              {interimText}
            </p>
          )}
          <div className="flex justify-end mt-2 border-t border-slate-100 dark:border-white/10 pt-2">
            <button
              onClick={saveNote}
              disabled={!noteText.trim() || savingNote || isRecording}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed">
              {savingNote
                ? <Loader2 size={12} className="animate-spin" />
                : <Plus size={12} />}
              Save Note
            </button>
          </div>
        </div>

        {/* Notes list */}
        <div className="space-y-2">
          {notes.length === 0 && (
            <p className="text-sm text-slate-400">No notes yet.</p>
          )}
          {notes.map((note: any) => (
            <div key={note.id}
              className="border border-slate-100 dark:border-white/10 rounded-xl px-4 py-3">
              <p className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap leading-relaxed">
                {note.content}
              </p>
              <p className="text-xs text-slate-400 mt-2">
                {note.author
                  ? `${note.author.firstName} ${note.author.lastName}`
                  : 'Staff'} ·{' '}
                {new Date(note.createdAt).toLocaleDateString('en-UG', {
                  day: 'numeric', month: 'short', year: 'numeric',
                })}{' '}
                {new Date(note.createdAt).toLocaleTimeString('en-UG', {
                  hour: '2-digit', minute: '2-digit',
                })}
              </p>
            </div>
          ))}
        </div>
      </section>

    </div>
  )
}
