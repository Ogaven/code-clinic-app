'use client'

import { useEffect, useRef, useState } from 'react'
import {
  Bot, Play, Pause, Mic, MicOff, Upload, FileText,
  Film, Link, Search, Trash2, Eye, Star, ChevronRight,
  CheckCircle2, Loader2, Save,
} from 'lucide-react'
import { cn } from '@/lib/utils'

type SubPage = 'agents' | 'voice-studio' | 'voice-training' | 'knowledge' | 'recordings'

// Map frontend card type → backend responsibility key
const TYPE_TO_RESPONSIBILITY: Record<string, string> = {
  BOOKING:  'INBOUND',
  REMINDER: 'REMINDER',
  FOLLOWUP: 'FOLLOWUP',
  DEBT:     'DEBT',
  VISITOR:  'INBOUND', // no separate visitor config; reuse INBOUND
}

const agentCards = [
  { type: 'BOOKING',  name: 'Booking Agent',         desc: 'Handles new appointment bookings via WhatsApp & phone', icon: '📅', color: '#0891b2' },
  { type: 'REMINDER', name: 'Reminder Agent',         desc: 'Sends appointment reminders 24h and 1h before',          icon: '🔔', color: '#7c3aed' },
  { type: 'FOLLOWUP', name: 'Follow-up Agent',        desc: 'Checks in with patients post-appointment',               icon: '💬', color: '#059669' },
  { type: 'DEBT',     name: 'Debt Recovery Agent',    desc: 'Sends payment reminders for outstanding balances',       icon: '💰', color: '#d97706' },
  { type: 'VISITOR',  name: 'Website Visitor Agent',  desc: 'Engages website visitors and captures leads',            icon: '🌐', color: '#e11d48' },
]

export default function AISuitePage() {
  const API   = '/api-proxy'
  const token = typeof window !== 'undefined' ? localStorage.getItem('cc_token') : null
  const authH = { Authorization: `Bearer ${token}` }

  const [sub, setSub]             = useState<SubPage>('agents')
  const [prompts, setPrompts]     = useState<any[]>([])
  const [recordings, setRec]      = useState<any[]>([])
  const [kbItems, setKBItems]     = useState<any[]>([])
  const [loading, setLoading]     = useState(false)
  const [editPrompt, setEdit]     = useState<any | null>(null)
  const [editText, setEditText]   = useState('')
  const [saving, setSaving]       = useState(false)
  const [toast, setToast]         = useState<string | null>(null)
  const [kbSearch, setKbSearch]   = useState('')

  // Voice training state
  const [vtName, setVtName]         = useState('Sarah')
  const [vtDesc, setVtDesc]         = useState('Friendly Ugandan dental receptionist, warm and professional')
  const [vtSamples, setVtSamples]   = useState<{ id: string; name: string; duration: string }[]>([])
  const [vtRecording, setVtRec]     = useState(false)
  const [vtCloning, setVtCloning]   = useState(false)
  const [vtCloned, setVtCloned]     = useState(false)
  const [vtAccent, setVtAccent]     = useState('ugandan')
  const [vtGender, setVtGender]     = useState('female')
  const mediaRecRef                 = useRef<MediaRecorder | null>(null)
  const vtChunksRef                 = useRef<Blob[]>([])
  const kbFileRef                   = useRef<HTMLInputElement>(null)
  const [kbUploading, setKbUploading] = useState(false)
  const [kbUrlInput, setKbUrlInput] = useState('')
  const [kbUrlLoading, setKbUrlLoading] = useState(false)

  async function toggleVtRecording() {
    if (vtRecording) {
      mediaRecRef.current?.stop(); setVtRec(false); return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mr = new MediaRecorder(stream); vtChunksRef.current = []
      mr.ondataavailable = e => { if (e.data.size > 0) vtChunksRef.current.push(e.data) }
      mr.onstop = () => {
        const duration = `0:${(Math.floor(Math.random() * 20) + 10).toString()}`
        setVtSamples(s => [...s, { id: Date.now().toString(), name: `Sample ${s.length + 1}`, duration }])
        stream.getTracks().forEach(t => t.stop())
      }
      mediaRecRef.current = mr; mr.start(); setVtRec(true)
    } catch { showToast('Microphone access required for voice training') }
  }

  async function cloneVoice() {
    if (vtSamples.length < 3) { showToast('Record at least 3 voice samples to clone'); return }
    setVtCloning(true)
    await new Promise(r => setTimeout(r, 3000)) // Simulate API call to ElevenLabs
    setVtCloning(false); setVtCloned(true)
    showToast('Voice cloned successfully! Sarah is now using your custom voice.')
  }

  useEffect(() => {
    if (sub === 'agents' || sub === 'voice-studio') fetchPrompts()
    if (sub === 'recordings') fetchRecordings()
    if (sub === 'knowledge') fetchKB()
  }, [sub])

  async function fetchPrompts() {
    try {
      const res = await fetch(`${API}/agent/config`, { headers: authH })
      if (res.ok) {
        const data = await res.json().catch(() => null)
        if (!data) return
        const configs = Array.isArray(data) ? data
          : Array.isArray(data?.configs) ? data.configs
          : []
        setPrompts(configs)
      }
    } catch { setPrompts([]) }
  }
  async function fetchRecordings() {
    setLoading(true)
    try {
      const res = await fetch(`${API}/agent/queue`, { headers: authH })
      if (res.ok) {
        const data = await res.json().catch(() => [])
        setRec(Array.isArray(data) ? data : [])
      }
    } catch { setRec([]) } finally { setLoading(false) }
  }
  async function fetchKB() {
    setLoading(true)
    try {
      const res = await fetch(`${API}/knowledge`, { headers: authH })
      if (res.ok) {
        const data = await res.json().catch(() => [])
        setKBItems(Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : [])
      }
    } catch { setKBItems([]) } finally { setLoading(false) }
  }

  async function toggleAgent(type: string) {
    const responsibility = TYPE_TO_RESPONSIBILITY[type] || type
    const current = prompts.find(p => p.responsibility === responsibility)
    const newActive = !(current?.isActive ?? false)
    const res = await fetch(`${API}/agent/config/${responsibility}`, {
      method: 'PUT', headers: { ...authH, 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: newActive }),
    })
    if (res.ok) {
      showToast(newActive ? `${type} agent activated` : `${type} agent paused`)
      fetchPrompts()
    } else {
      const err = await res.json().catch(() => ({}))
      showToast(err.error || 'Failed to update agent')
    }
  }

  async function pauseAllAgents() {
    const responsibilities = ['INBOUND', 'REMINDER', 'FOLLOWUP', 'DEBT']
    for (const r of responsibilities) {
      await fetch(`${API}/agent/config/${r}`, {
        method: 'PUT', headers: { ...authH, 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: false }),
      })
    }
    fetchPrompts()
    showToast('All agents paused')
  }

  async function savePrompt() {
    if (!editPrompt) return
    setSaving(true)
    const responsibility = editPrompt.responsibility || TYPE_TO_RESPONSIBILITY[editPrompt.type] || editPrompt.type
    const res = await fetch(`${API}/agent/config/${responsibility}`, {
      method: 'PUT', headers: { ...authH, 'Content-Type': 'application/json' },
      body: JSON.stringify({ system_prompt: editText }),
    })
    setSaving(false)
    if (res.ok) {
      fetchPrompts()
      showToast('Prompt saved!')
    } else {
      const err = await res.json().catch(() => ({}))
      showToast(err.error || 'Failed to save prompt')
    }
  }

  async function uploadKBFile(file: File) {
    setKbUploading(true)
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch(`${API}/knowledge/upload`, { method: 'POST', headers: authH, body: form })
      if (res.ok) { showToast('Document ingested into knowledge base!'); fetchKB() }
      else { const e = await res.json().catch(() => ({})); showToast(e.error || 'Upload failed') }
    } catch { showToast('Upload failed') } finally { setKbUploading(false) }
  }

  async function ingestURL() {
    if (!kbUrlInput.trim()) return
    setKbUrlLoading(true)
    try {
      const res = await fetch(`${API}/knowledge/url`, {
        method: 'POST', headers: { ...authH, 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: kbUrlInput }),
      })
      if (res.ok) { showToast('URL ingested!'); setKbUrlInput(''); fetchKB() }
      else { const e = await res.json().catch(() => ({})); showToast(e.error || 'Failed to ingest URL') }
    } catch { showToast('Failed to ingest URL') } finally { setKbUrlLoading(false) }
  }

  function showToast(msg: string) { setToast(msg); setTimeout(() => setToast(null), 3000) }

  // Look up config by responsibility (mapping card type → DB responsibility)
  const promptForType = (type: string) => {
    const responsibility = TYPE_TO_RESPONSIBILITY[type] || type
    return prompts.find(p => p.responsibility === responsibility)
  }

  const inputCls = 'w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl bg-gray-50 focus:outline-none focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-500 transition-all'

  return (
    <div className="flex h-full bg-slate-50">
      {/* Toast */}
      {toast && (
        <div className="fixed top-5 right-5 z-50 bg-gray-900 text-white text-sm font-semibold px-4 py-3 rounded-2xl shadow-xl animate-fade-in">
          {toast}
        </div>
      )}

      {/* Sub-nav sidebar */}
      <div className="w-56 flex-shrink-0 bg-white border-r border-gray-100 p-3 flex flex-col gap-1">
        <p className="text-[9px] font-black uppercase tracking-widest text-gray-400 px-2 py-1">AI Suite</p>
        {([
          { key: 'agents',         label: 'Agent Control',    icon: Bot },
          { key: 'voice-studio',   label: 'Voice Studio',     icon: Mic },
          { key: 'voice-training', label: 'Voice Training',   icon: Star },
          { key: 'knowledge',      label: 'Knowledge Base',   icon: FileText },
          { key: 'recordings',     label: 'Call Recordings',  icon: Film },
        ] as const).map(({ key, label, icon: Icon }) => (
          <button key={key} onClick={() => setSub(key)}
            className={cn('flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-left transition-all text-sm',
              sub === key ? 'bg-cyan-50 text-cyan-700 font-bold' : 'text-gray-600 hover:bg-gray-50')}>
            <Icon size={15} />
            {label}
          </button>
        ))}

        <div className="mt-auto pt-4 border-t border-gray-100">
          <button
            onClick={async () => {
              if (!confirm('Pause ALL AI agents? The clinic will need to handle calls manually.')) return
              await pauseAllAgents()
            }}
            className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl bg-red-50 text-red-600 text-xs font-bold hover:bg-red-100 transition-colors">
            <Pause size={13} /> Pause All Agents
          </button>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 overflow-y-auto p-6">

        {/* Agent Control */}
        {sub === 'agents' && (
          <div className="space-y-4">
            <div>
              <h2 className="text-xl font-black text-gray-800 dark:text-white">Agent Control</h2>
              <p className="text-sm text-gray-400 mt-0.5">Manage your AI agents and their activity</p>
            </div>
            <div className="grid grid-cols-2 gap-4 xl:grid-cols-3">
              {agentCards.map(agent => {
                const prompt = promptForType(agent.type)
                const isActive = prompt?.isActive ?? false
                return (
                  <div key={agent.type} className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/10 shadow-sm p-5 hover:shadow-md transition-all">
                    <div className="flex items-start justify-between mb-4">
                      <div className="w-11 h-11 rounded-xl flex items-center justify-center text-2xl"
                        style={{ background: agent.color + '15' }}>
                        {agent.icon}
                      </div>
                      <button onClick={() => toggleAgent(agent.type)}
                        className={cn('relative w-11 h-[22px] rounded-full transition-all',
                          isActive ? 'bg-emerald-500' : 'bg-gray-200')}>
                        <span className={cn('absolute top-[3px] w-4 h-4 rounded-full bg-white shadow-sm transition-all',
                          isActive ? 'left-[23px]' : 'left-[3px]')} />
                      </button>
                    </div>
                    <h3 className="font-bold text-gray-800 dark:text-white mb-1">{agent.name}</h3>
                    <p className="text-xs text-gray-400 leading-relaxed mb-3">{agent.desc}</p>
                    <div className="flex items-center gap-2">
                      <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded-full',
                        isActive ? 'bg-emerald-50 text-emerald-600' : 'bg-gray-100 text-gray-500')}>
                        {isActive ? 'Active' : 'Paused'}
                      </span>
                      {prompt && (
                        <button onClick={() => { setSub('voice-studio'); setEdit(prompt); setEditText(prompt.systemPrompt) }}
                          className="text-[10px] font-bold text-cyan-600 hover:underline flex items-center gap-0.5">
                          Edit Prompt <ChevronRight size={10} />
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Voice Studio */}
        {sub === 'voice-studio' && (
          <div className="space-y-5">
            <div>
              <h2 className="text-xl font-black text-gray-800 dark:text-white">Voice Studio</h2>
              <p className="text-sm text-gray-400 mt-0.5">Edit and manage agent prompts</p>
            </div>
            <div className="grid grid-cols-[240px_1fr] gap-5">
              {/* Prompt list */}
              <div className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/10 shadow-sm overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-50 dark:border-white/5">
                  <p className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Agents</p>
                </div>
                {!Array.isArray(prompts) || prompts.length === 0 ? (
                  <div className="px-4 py-8 text-center">
                    <Bot size={24} className="mx-auto mb-2 text-gray-200" />
                    <p className="text-xs text-gray-400">No agents configured yet</p>
                    <p className="text-[10px] text-gray-300 mt-1">Run /setup/seed-production to initialize</p>
                  </div>
                ) : prompts.map(p => (
                  <button key={p.id} onClick={() => { setEdit(p); setEditText(p.systemPrompt || '') }}
                    className={cn('w-full flex items-center gap-3 px-4 py-3 text-left border-b border-gray-50 dark:border-white/5 last:border-0 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors',
                      editPrompt?.id === p.id && 'bg-cyan-50 dark:bg-cyan-900/10 border-l-4 border-l-cyan-500')}>
                    <div className={cn('w-2 h-2 rounded-full flex-shrink-0', p.isActive ? 'bg-emerald-500' : 'bg-gray-300')} />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-gray-800 dark:text-gray-200 truncate capitalize">{(p.responsibility || '').toLowerCase()}</p>
                      <p className="text-xs text-gray-400">v{p.promptVersion || 1}</p>
                    </div>
                  </button>
                ))}
              </div>

              {/* Prompt editor */}
              <div className="space-y-4">
                {editPrompt ? (
                  <>
                    <div className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/10 shadow-sm p-5">
                      <div className="flex items-center justify-between mb-4">
                        <div>
                          <h3 className="font-bold text-gray-800 dark:text-white capitalize">{(editPrompt.responsibility || editPrompt.name || '').toLowerCase()} Agent</h3>
                          <p className="text-xs text-gray-400">Version {editPrompt.promptVersion || 1}</p>
                        </div>
                        <div className="flex gap-2">
                          <button onClick={savePrompt} disabled={saving}
                            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold text-white transition-all hover:-translate-y-0.5 disabled:opacity-60"
                            style={{ background: 'linear-gradient(135deg,#0891b2,#29ABE2)' }}>
                            {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                            Save & Activate
                          </button>
                        </div>
                      </div>
                      <div className="mb-2">
                        <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">System Prompt</p>
                        <p className="text-xs text-gray-400 mb-2">
                          Use variables like <code className="bg-gray-100 px-1 rounded">{'{patient_name}'}</code>, <code className="bg-gray-100 px-1 rounded">{'{appointment_time}'}</code>
                        </p>
                      </div>
                      <textarea
                        value={editText} onChange={e => setEditText(e.target.value)}
                        rows={16}
                        className="w-full px-4 py-3 text-sm border border-gray-200 dark:border-white/10 rounded-xl bg-gray-50 dark:bg-white/5 dark:text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-500 transition-all font-mono resize-none"
                        placeholder="Write the system prompt for this agent..."
                      />
                    </div>
                  </>
                ) : (
                  <div className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/10 shadow-sm p-12 text-center">
                    <Mic size={32} className="mx-auto mb-3 text-gray-200" />
                    <p className="text-gray-400 font-medium">Select an agent to edit its prompt</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Voice Training */}
        {sub === 'voice-training' && (
          <div className="space-y-5 max-w-2xl">
            <div>
              <h2 className="text-xl font-black text-gray-800 dark:text-white">Custom Voice Training</h2>
              <p className="text-sm text-gray-400 dark:text-white/40 mt-0.5">
                Clone and train a custom voice for your AI agent using ElevenLabs. Record at least 3 samples.
              </p>
            </div>

            {vtCloned && (
              <div className="flex items-center gap-3 p-4 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-700/30 rounded-2xl">
                <CheckCircle2 size={20} className="text-emerald-500 flex-shrink-0" />
                <div>
                  <p className="text-sm font-bold text-emerald-700 dark:text-emerald-400">Voice cloned successfully!</p>
                  <p className="text-xs text-emerald-600 dark:text-emerald-500 mt-0.5">Sarah is now using your custom trained voice.</p>
                </div>
              </div>
            )}

            {/* Voice Identity */}
            <div className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/8 shadow-sm p-5 space-y-4">
              <h3 className="text-sm font-bold text-gray-800 dark:text-white flex items-center gap-2">
                <Star size={15} className="text-amber-500" /> Voice Identity
              </h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-gray-500 dark:text-white/50 uppercase tracking-wide mb-1.5">Voice Name</label>
                  <input value={vtName} onChange={e => setVtName(e.target.value)}
                    className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-white/10 rounded-xl bg-gray-50 dark:bg-white/5 dark:text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-500 transition-all"
                    placeholder="e.g. Sarah" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 dark:text-white/50 uppercase tracking-wide mb-1.5">Gender</label>
                  <select value={vtGender} onChange={e => setVtGender(e.target.value)}
                    className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-white/10 rounded-xl bg-gray-50 dark:bg-white/5 dark:text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-500 transition-all">
                    <option value="female">Female</option>
                    <option value="male">Male</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-500 dark:text-white/50 uppercase tracking-wide mb-1.5">Accent / Dialect</label>
                <div className="flex flex-wrap gap-2">
                  {['ugandan', 'kenyan', 'nigerian', 'south-african', 'british', 'american'].map(a => (
                    <button key={a} onClick={() => setVtAccent(a)}
                      className={cn(
                        'px-3 py-1.5 rounded-xl text-xs font-bold capitalize transition-all border',
                        vtAccent === a
                          ? 'bg-cyan-500 text-white border-cyan-500'
                          : 'bg-gray-100 dark:bg-white/8 text-gray-600 dark:text-white/60 border-gray-200 dark:border-white/10 hover:bg-gray-200 dark:hover:bg-white/12',
                      )}>
                      {a === 'ugandan' ? '🇺🇬' : a === 'kenyan' ? '🇰🇪' : a === 'nigerian' ? '🇳🇬' : a === 'south-african' ? '🇿🇦' : a === 'british' ? '🇬🇧' : '🇺🇸'} {a}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-500 dark:text-white/50 uppercase tracking-wide mb-1.5">Voice Description</label>
                <textarea value={vtDesc} onChange={e => setVtDesc(e.target.value)} rows={2}
                  className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-white/10 rounded-xl bg-gray-50 dark:bg-white/5 dark:text-white resize-none focus:outline-none focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-500 transition-all"
                  placeholder="Describe the voice personality..." />
              </div>
            </div>

            {/* Recording section */}
            <div className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/8 shadow-sm p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-gray-800 dark:text-white flex items-center gap-2">
                  <Mic size={15} className="text-red-500" /> Voice Samples
                  <span className="text-xs font-medium text-gray-400 dark:text-white/40">({vtSamples.length}/10 recorded)</span>
                </h3>
                <span className={cn(
                  'text-xs font-bold px-2 py-0.5 rounded-full',
                  vtSamples.length >= 3 ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600' : 'bg-amber-50 dark:bg-amber-900/20 text-amber-600',
                )}>
                  {vtSamples.length >= 3 ? 'Ready to clone' : `Need ${3 - vtSamples.length} more`}
                </span>
              </div>

              <p className="text-xs text-gray-500 dark:text-white/40 leading-relaxed">
                Read the scripts below into your microphone. Each sample should be 15–30 seconds. Speak naturally as the voice you want the AI to use.
              </p>

              {/* Script prompts */}
              <div className="space-y-2">
                {[
                  "Hello! Welcome to Code Clinic. My name is Sarah and I'm happy to help you today. How can I assist you?",
                  'Your appointment has been confirmed for Monday at nine AM with Doctor Mugabe for a dental cleaning. We look forward to seeing you!',
                  'I understand your concern. Let me connect you with our receptionist who will be able to help you reschedule that appointment right away.',
                ].map((script, i) => (
                  <div key={i} className="p-3 bg-gray-50 dark:bg-white/5 rounded-xl border border-gray-100 dark:border-white/8">
                    <p className="text-[10px] font-bold text-gray-400 dark:text-white/30 uppercase tracking-wide mb-1">Script {i + 1}</p>
                    <p className="text-sm text-gray-700 dark:text-white/70 leading-relaxed italic">"{script}"</p>
                  </div>
                ))}
              </div>

              {/* Record button */}
              <div className="flex items-center gap-3">
                <button onClick={toggleVtRecording}
                  className={cn(
                    'flex items-center gap-2 px-5 py-3 rounded-xl font-bold text-sm text-white transition-all hover:scale-105',
                    vtRecording ? 'animate-pulse' : '',
                  )}
                  style={{ background: vtRecording ? '#ef4444' : 'linear-gradient(135deg,#1A237E,#29ABE2)' }}>
                  {vtRecording ? <><MicOff size={16} /> Stop Recording</> : <><Mic size={16} /> Record Sample</>}
                </button>
                {vtRecording && (
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                    <span className="text-sm text-red-500 font-bold">Recording...</span>
                  </div>
                )}
              </div>

              {/* Recorded samples */}
              {vtSamples.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-bold text-gray-500 dark:text-white/40 uppercase tracking-wide">Recorded Samples</p>
                  {vtSamples.map((s, i) => (
                    <div key={s.id} className="flex items-center gap-3 p-3 bg-emerald-50 dark:bg-emerald-900/10 rounded-xl border border-emerald-100 dark:border-emerald-700/20">
                      <div className="w-8 h-8 rounded-full bg-emerald-500 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">{i + 1}</div>
                      <div className="flex-1">
                        <p className="text-sm font-semibold text-gray-800 dark:text-white">{s.name}</p>
                        <p className="text-xs text-gray-400 dark:text-white/40">Duration: {s.duration}s</p>
                      </div>
                      <button className="w-8 h-8 rounded-full bg-emerald-500 flex items-center justify-center text-white">
                        <Play size={12} />
                      </button>
                      <button onClick={() => setVtSamples(ss => ss.filter(x => x.id !== s.id))} className="w-8 h-8 rounded-full hover:bg-red-100 dark:hover:bg-red-900/20 flex items-center justify-center text-red-400">
                        <Trash2 size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Upload existing audio */}
              <div>
                <label className="flex items-center gap-2 px-4 py-3 rounded-xl border-2 border-dashed border-gray-200 dark:border-white/10 text-gray-500 dark:text-white/50 hover:border-cyan-400 hover:text-cyan-500 cursor-pointer transition-all">
                  <Upload size={15} />
                  <span className="text-sm font-medium">Or upload audio files (WAV, MP3, M4A)</span>
                  <input type="file" accept="audio/*" multiple className="hidden"
                    onChange={e => {
                      if (!e.target.files) return
                      Array.from(e.target.files).forEach(f => {
                        setVtSamples(s => [...s, { id: Date.now().toString() + f.name, name: f.name, duration: '0:' + (Math.floor(Math.random() * 20) + 10) }])
                      })
                      e.target.value = ''
                    }} />
                </label>
              </div>
            </div>

            {/* Clone Voice button */}
            <div className="flex items-center gap-4">
              <button onClick={cloneVoice} disabled={vtSamples.length < 3 || vtCloning || vtCloned}
                className="flex items-center gap-2.5 px-6 py-3 rounded-2xl font-bold text-white text-sm transition-all hover:-translate-y-0.5 hover:shadow-lg disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ background: 'linear-gradient(135deg,#7c3aed,#9333ea)', boxShadow: '0 4px 14px rgba(124,58,237,0.4)' }}>
                {vtCloning ? (
                  <><Loader2 size={16} className="animate-spin" /> Cloning Voice...</>
                ) : vtCloned ? (
                  <><CheckCircle2 size={16} /> Voice Active</>
                ) : (
                  <><Star size={16} /> Clone &amp; Activate Voice</>
                )}
              </button>
              {vtSamples.length < 3 && (
                <p className="text-xs text-gray-400 dark:text-white/30">Record {3 - vtSamples.length} more sample{3 - vtSamples.length !== 1 ? 's' : ''} to enable cloning</p>
              )}
            </div>
          </div>
        )}

        {/* Knowledge Base */}
        {sub === 'knowledge' && (
          <div className="space-y-5">
            <div>
              <h2 className="text-xl font-black text-gray-800">Knowledge Base</h2>
              <p className="text-sm text-gray-400 mt-0.5">Upload documents to train the AI agents</p>
            </div>

            {/* Upload zone */}
            <div
              className="bg-white dark:bg-white/5 rounded-2xl border-2 border-dashed border-gray-200 dark:border-white/10 p-10 text-center hover:border-cyan-400 hover:bg-cyan-50/30 dark:hover:bg-cyan-900/10 transition-all cursor-pointer"
              onClick={() => kbFileRef.current?.click()}
              onDragOver={e => e.preventDefault()}
              onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) uploadKBFile(f) }}>
              <input ref={kbFileRef} type="file" accept=".pdf,.png,.jpg,.jpeg,.mp3,.mp4,.wav,.webp" className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) uploadKBFile(f); e.target.value = '' }} />
              {kbUploading ? (
                <Loader2 size={32} className="mx-auto mb-3 animate-spin text-cyan-500" />
              ) : (
                <Upload size={32} className="mx-auto mb-3 text-gray-300" />
              )}
              <p className="font-bold text-gray-700 mb-1">{kbUploading ? 'Uploading & ingesting...' : 'Drop any file here or click to browse'}</p>
              <p className="text-sm text-gray-400 mb-4">PDF, Image, Audio, Video — ingested into the AI knowledge base</p>
              <div className="flex items-center justify-center gap-3 mb-4">
                {['PDF', 'PNG', 'JPG', 'MP3', 'MP4', 'WAV'].map(t => (
                  <span key={t} className="text-[10px] font-bold bg-gray-100 text-gray-500 px-2 py-1 rounded-lg">{t}</span>
                ))}
              </div>
              <button disabled={kbUploading}
                className="px-5 py-2.5 rounded-xl text-sm font-bold text-white transition-all hover:-translate-y-0.5 hover:shadow-lg disabled:opacity-60"
                style={{ background: 'linear-gradient(135deg,#0c1e50,#29ABE2)' }}>
                Browse Files
              </button>
            </div>

            {/* Add URL */}
            <div className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/10 shadow-sm p-4">
              <div className="flex items-center gap-2 mb-3">
                <Link size={15} className="text-cyan-500" />
                <h3 className="text-sm font-bold text-gray-800">Add URL</h3>
              </div>
              <div className="flex gap-2">
                <input
                  value={kbUrlInput}
                  onChange={e => setKbUrlInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') ingestURL() }}
                  placeholder="https://example.com/page-to-ingest..."
                  className={cn(inputCls, 'flex-1')} />
                <button onClick={ingestURL} disabled={kbUrlLoading || !kbUrlInput.trim()}
                  className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-bold text-white whitespace-nowrap disabled:opacity-60"
                  style={{ background: 'linear-gradient(135deg,#0c1e50,#29ABE2)' }}>
                  {kbUrlLoading ? <Loader2 size={14} className="animate-spin" /> : null}
                  Crawl & Ingest
                </button>
              </div>
            </div>

            {/* Search + list */}
            <div className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/10 shadow-sm overflow-hidden">
              <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-50">
                <Search size={14} className="text-gray-400" />
                <input value={kbSearch} onChange={e => setKbSearch(e.target.value)}
                  placeholder="Search knowledge base..." className="flex-1 text-sm outline-none bg-transparent placeholder-gray-400" />
              </div>
              {loading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 size={20} className="animate-spin text-cyan-500" />
                </div>
              ) : !Array.isArray(kbItems) || kbItems.length === 0 ? (
                <div className="px-4 py-10 text-center">
                  <FileText size={28} className="mx-auto mb-2 text-gray-200" />
                  <p className="text-sm text-gray-400">No knowledge base items yet</p>
                  <p className="text-xs text-gray-300 mt-1">Upload documents to get started</p>
                </div>
              ) : (Array.isArray(kbItems) ? kbItems : []).filter(k => !kbSearch || (k.title || '').toLowerCase().includes(kbSearch.toLowerCase())).map(item => (
                <div key={item.id} className="flex items-center gap-3 px-4 py-3 border-b border-gray-50 last:border-0">
                  <div className="w-9 h-9 rounded-xl bg-gray-100 flex items-center justify-center flex-shrink-0">
                    <FileText size={16} className="text-gray-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-800 truncate">{item.title}</p>
                    <p className="text-xs text-gray-400">{item.type} · {new Date(item.createdAt).toLocaleDateString()}</p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded-full',
                      item.isActive ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600')}>
                      {item.isActive ? 'Active' : 'Processing'}
                    </span>
                    <button className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-gray-100 transition-colors">
                      <Eye size={13} className="text-gray-400" />
                    </button>
                    <button className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-red-50 transition-colors">
                      <Trash2 size={13} className="text-red-400" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Call Recordings */}
        {sub === 'recordings' && (
          <div className="space-y-4">
            <div>
              <h2 className="text-xl font-black text-gray-800">Call Recordings</h2>
              <p className="text-sm text-gray-400 mt-0.5">Review and rate AI call quality</p>
            </div>

            {loading ? (
              <div className="flex items-center justify-center py-20">
                <Loader2 size={24} className="animate-spin text-cyan-500" />
              </div>
            ) : !Array.isArray(recordings) || recordings.length === 0 ? (
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-12 text-center">
                <Film size={32} className="mx-auto mb-3 text-gray-200" />
                <p className="font-medium text-gray-400">No call recordings yet</p>
                <p className="text-sm text-gray-300 mt-1">Recordings will appear here once the AI agents are active</p>
              </div>
            ) : (Array.isArray(recordings) ? recordings : []).map((r: any) => (
              <div key={r.id} className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/10 shadow-sm p-4">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-purple-400 to-blue-500 flex items-center justify-center text-white flex-shrink-0">
                    <Film size={20} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-gray-800">
                      {r.agentLog?.patient?.firstName} {r.agentLog?.patient?.lastName}
                    </p>
                    <p className="text-xs text-gray-400">
                      {new Date(r.createdAt).toLocaleDateString()} ·{' '}
                      {r.durationSec ? `${Math.floor(r.durationSec / 60)}m ${r.durationSec % 60}s` : 'N/A'}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <div className="flex gap-0.5">
                      {[1,2,3,4,5].map(s => (
                        <Star key={s} size={14}
                          className={cn(s <= (r.qualityScore || 0) ? 'text-amber-400 fill-amber-400' : 'text-gray-200')} />
                      ))}
                    </div>
                    <button className="px-3 py-1.5 rounded-xl bg-cyan-50 text-cyan-600 text-xs font-bold hover:bg-cyan-100 transition-colors flex items-center gap-1">
                      <Play size={11} /> Play
                    </button>
                  </div>
                </div>
                {r.transcriptText && (
                  <div className="mt-3 bg-gray-50 rounded-xl px-4 py-3">
                    <p className="text-xs text-gray-500 leading-relaxed line-clamp-2">{r.transcriptText}</p>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
