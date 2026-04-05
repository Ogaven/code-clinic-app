'use client'

import { useEffect, useState } from 'react'
import {
  Bot, Play, Pause, Mic, Upload, FileText, Image as ImgIcon,
  Film, Link, Search, Trash2, Eye, Star, ChevronRight,
  AlertTriangle, CheckCircle2, Clock, Loader2, Save, History,
} from 'lucide-react'
import { cn } from '@/lib/utils'

type SubPage = 'agents' | 'voice-studio' | 'knowledge' | 'recordings'

const agentCards = [
  { type: 'BOOKING', name: 'Booking Agent', desc: 'Handles new appointment bookings via WhatsApp & phone', icon: '📅', color: '#0891b2' },
  { type: 'REMINDER', name: 'Reminder Agent', desc: 'Sends appointment reminders 24h and 1h before', icon: '🔔', color: '#7c3aed' },
  { type: 'FOLLOWUP', name: 'Follow-up Agent', desc: 'Checks in with patients post-appointment', icon: '💬', color: '#059669' },
  { type: 'DEBT', name: 'Debt Recovery Agent', desc: 'Sends payment reminders for outstanding balances', icon: '💰', color: '#d97706' },
  { type: 'VISITOR', name: 'Website Visitor Agent', desc: 'Engages website visitors and captures leads', icon: '🌐', color: '#e11d48' },
]

export default function AISuitePage() {
  const API   = process.env.NEXT_PUBLIC_API_URL || '/api-proxy'
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

  useEffect(() => {
    if (sub === 'agents' || sub === 'voice-studio') fetchPrompts()
    if (sub === 'recordings') fetchRecordings()
    if (sub === 'knowledge') fetchKB()
  }, [sub])

  async function fetchPrompts() {
    const res = await fetch(`${API}/receptionist/agent-prompts`, { headers: authH })
    if (res.ok) setPrompts(await res.json())
  }
  async function fetchRecordings() {
    setLoading(true)
    const res = await fetch(`${API}/receptionist/call-recordings`, { headers: authH })
    if (res.ok) setRec(await res.json())
    setLoading(false)
  }
  async function fetchKB() {
    setLoading(true)
    const res = await fetch(`${API}/receptionist/knowledge-base`, { headers: authH })
    if (res.ok) setKBItems(await res.json())
    setLoading(false)
  }

  async function toggleAgent(type: string) {
    const prompt = prompts.find(p => p.type === type)
    if (!prompt) {
      showToast(`${type} agent not yet configured in the system`)
      return
    }
    await fetch(`${API}/receptionist/agent-prompts/${prompt.id}`, {
      method: 'PATCH', headers: { ...authH, 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: !prompt.isActive }),
    })
    fetchPrompts()
  }

  async function savePrompt() {
    if (!editPrompt) return
    setSaving(true)
    await fetch(`${API}/receptionist/agent-prompts/${editPrompt.id}`, {
      method: 'PATCH', headers: { ...authH, 'Content-Type': 'application/json' },
      body: JSON.stringify({ systemPrompt: editText }),
    })
    setSaving(false)
    fetchPrompts()
    showToast('Prompt saved and activated!')
  }

  function showToast(msg: string) { setToast(msg); setTimeout(() => setToast(null), 3000) }

  const promptForType = (type: string) => prompts.find(p => p.type === type)

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
          { key: 'agents',       label: 'Agent Control',       icon: Bot },
          { key: 'voice-studio', label: 'Voice Studio',        icon: Mic },
          { key: 'knowledge',    label: 'Knowledge Base',      icon: FileText },
          { key: 'recordings',   label: 'Call Recordings',     icon: Film },
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
              await Promise.all(prompts.filter(p => p.isActive).map(p =>
                fetch(`${API}/receptionist/agent-prompts/${p.id}`, {
                  method: 'PATCH', headers: { ...authH, 'Content-Type': 'application/json' },
                  body: JSON.stringify({ isActive: false }),
                })
              ))
              fetchPrompts()
              showToast('All agents paused')
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
              <h2 className="text-xl font-black text-gray-800">Agent Control</h2>
              <p className="text-sm text-gray-400 mt-0.5">Manage your AI agents and their activity</p>
            </div>
            <div className="grid grid-cols-2 gap-4 xl:grid-cols-3">
              {agentCards.map(agent => {
                const prompt = promptForType(agent.type)
                const isActive = prompt?.isActive ?? false
                return (
                  <div key={agent.type} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 hover:shadow-md transition-all">
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
                    <h3 className="font-bold text-gray-800 mb-1">{agent.name}</h3>
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
              <h2 className="text-xl font-black text-gray-800">Voice Studio</h2>
              <p className="text-sm text-gray-400 mt-0.5">Edit and manage agent prompts</p>
            </div>
            <div className="grid grid-cols-[240px_1fr] gap-5">
              {/* Prompt list */}
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-50">
                  <p className="text-xs font-bold text-gray-500 uppercase tracking-wide">Agents</p>
                </div>
                {prompts.length === 0 ? (
                  <div className="px-4 py-8 text-center">
                    <Bot size={24} className="mx-auto mb-2 text-gray-200" />
                    <p className="text-xs text-gray-400">No agents configured yet</p>
                  </div>
                ) : prompts.map(p => (
                  <button key={p.id} onClick={() => { setEdit(p); setEditText(p.systemPrompt) }}
                    className={cn('w-full flex items-center gap-3 px-4 py-3 text-left border-b border-gray-50 last:border-0 hover:bg-gray-50 transition-colors',
                      editPrompt?.id === p.id && 'bg-cyan-50 border-l-4 border-l-cyan-500')}>
                    <div className={cn('w-2 h-2 rounded-full flex-shrink-0', p.isActive ? 'bg-emerald-500' : 'bg-gray-300')} />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-gray-800 truncate">{p.name}</p>
                      <p className="text-xs text-gray-400">v{p.version}</p>
                    </div>
                  </button>
                ))}
              </div>

              {/* Prompt editor */}
              <div className="space-y-4">
                {editPrompt ? (
                  <>
                    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                      <div className="flex items-center justify-between mb-4">
                        <div>
                          <h3 className="font-bold text-gray-800">{editPrompt.name}</h3>
                          <p className="text-xs text-gray-400">Version {editPrompt.version}</p>
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
                        className="w-full px-4 py-3 text-sm border border-gray-200 rounded-xl bg-gray-50 focus:outline-none focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-500 transition-all font-mono resize-none"
                        placeholder="Write the system prompt for this agent..."
                      />
                    </div>
                  </>
                ) : (
                  <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-12 text-center">
                    <Mic size={32} className="mx-auto mb-3 text-gray-200" />
                    <p className="text-gray-400 font-medium">Select an agent to edit its prompt</p>
                  </div>
                )}
              </div>
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
            <div className="bg-white rounded-2xl border-2 border-dashed border-gray-200 p-10 text-center hover:border-cyan-400 hover:bg-cyan-50/30 transition-all cursor-pointer">
              <Upload size={32} className="mx-auto mb-3 text-gray-300" />
              <p className="font-bold text-gray-700 mb-1">Drop any file here</p>
              <p className="text-sm text-gray-400 mb-4">PDF, Image, Audio, Video, Link, Screenshot</p>
              <div className="flex items-center justify-center gap-3 mb-4">
                {['PDF', 'PNG', 'JPG', 'MP3', 'MP4', 'URL'].map(t => (
                  <span key={t} className="text-[10px] font-bold bg-gray-100 text-gray-500 px-2 py-1 rounded-lg">{t}</span>
                ))}
              </div>
              <button className="px-5 py-2.5 rounded-xl text-sm font-bold text-white transition-all hover:-translate-y-0.5 hover:shadow-lg"
                style={{ background: 'linear-gradient(135deg,#0c1e50,#29ABE2)' }}>
                Browse Files
              </button>
            </div>

            {/* Add URL */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
              <div className="flex items-center gap-2 mb-3">
                <Link size={15} className="text-cyan-500" />
                <h3 className="text-sm font-bold text-gray-800">Add URL</h3>
              </div>
              <div className="flex gap-2">
                <input placeholder="https://example.com/page-to-ingest..." className={cn(inputCls, 'flex-1')} />
                <button className="px-4 py-2.5 rounded-xl text-sm font-bold text-white whitespace-nowrap"
                  style={{ background: 'linear-gradient(135deg,#0c1e50,#29ABE2)' }}>
                  Crawl & Ingest
                </button>
              </div>
            </div>

            {/* Search + list */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
              <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-50">
                <Search size={14} className="text-gray-400" />
                <input value={kbSearch} onChange={e => setKbSearch(e.target.value)}
                  placeholder="Search knowledge base..." className="flex-1 text-sm outline-none bg-transparent placeholder-gray-400" />
              </div>
              {loading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 size={20} className="animate-spin text-cyan-500" />
                </div>
              ) : kbItems.length === 0 ? (
                <div className="px-4 py-10 text-center">
                  <FileText size={28} className="mx-auto mb-2 text-gray-200" />
                  <p className="text-sm text-gray-400">No knowledge base items yet</p>
                  <p className="text-xs text-gray-300 mt-1">Upload documents to get started</p>
                </div>
              ) : kbItems.filter(k => !kbSearch || k.title.toLowerCase().includes(kbSearch.toLowerCase())).map(item => (
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
            ) : recordings.length === 0 ? (
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-12 text-center">
                <Film size={32} className="mx-auto mb-3 text-gray-200" />
                <p className="font-medium text-gray-400">No call recordings yet</p>
                <p className="text-sm text-gray-300 mt-1">Recordings will appear here once the AI agents are active</p>
              </div>
            ) : recordings.map((r: any) => (
              <div key={r.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
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
