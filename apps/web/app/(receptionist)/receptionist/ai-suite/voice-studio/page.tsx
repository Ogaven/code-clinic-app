'use client'

import { useEffect, useRef, useState } from 'react'
import {
  Mic, MicOff, Play, Trash2, Upload, CheckCircle2, Loader2, Star, Volume2,
} from 'lucide-react'
import { cn } from '@/lib/utils'

type VoiceProfile = { id: string; name: string; elevenLabsVoiceId: string; isCloned: boolean; isDefault: boolean }
type Settings = { personaName: string; elevenLabsVoiceId: string; stability: number; similarityBoost: number; elevenLabsKeySet: boolean }

export default function VoiceStudioPage() {
  const API   = '/api-proxy'
  const token = typeof window !== 'undefined' ? localStorage.getItem('cc_token') : null
  const authH = { Authorization: `Bearer ${token}` }

  const [settings, setSettings]     = useState<Settings | null>(null)
  const [voices, setVoices]         = useState<VoiceProfile[]>([])
  const [loading, setLoading]       = useState(true)
  const [savingSettings, setSaving] = useState(false)
  const [training, setTraining]     = useState(false)
  const [previewing, setPreviewing] = useState(false)
  const [previewAudio, setPreviewAudio] = useState<string | null>(null)
  const [toast, setToast]           = useState<string | null>(null)

  // Form fields
  const [personaName, setPersonaName]   = useState('')
  const [stability, setStability]       = useState(0.5)
  const [similarity, setSimilarity]     = useState(0.75)
  const [previewText, setPreviewText]   = useState('Hi! I\'m Sarah from Code Clinic. How can I help you today?')

  // Voice training
  const [trainName, setTrainName]   = useState('')
  const [recording, setRecording]   = useState(false)
  const [samples, setSamples]       = useState<{ id: string; name: string; blob: Blob }[]>([])
  const mediaRef                    = useRef<MediaRecorder | null>(null)
  const chunksRef                   = useRef<Blob[]>([])
  const fileRef                     = useRef<HTMLInputElement>(null)

  useEffect(() => { fetchAll() }, [])

  async function fetchAll() {
    setLoading(true)
    try {
      const [sr, vr] = await Promise.all([
        fetch(`${API}/ai-suite/voice/settings`, { headers: authH }),
        fetch(`${API}/ai-suite/voice/voices`, { headers: authH }),
      ])
      if (sr.ok) {
        const s: Settings = await sr.json()
        setSettings(s)
        setPersonaName(s.personaName)
        setStability(s.stability)
        setSimilarity(s.similarityBoost)
      }
      if (vr.ok) setVoices(await vr.json())
    } catch {} finally { setLoading(false) }
  }

  async function saveSettings() {
    setSaving(true)
    try {
      await fetch(`${API}/ai-suite/voice/settings`, {
        method: 'POST', headers: { ...authH, 'Content-Type': 'application/json' },
        body: JSON.stringify({ personaName, stability, similarityBoost: similarity }),
      })
      showToast('Settings saved')
    } catch {} finally { setSaving(false) }
  }

  async function previewVoice() {
    if (!previewText.trim()) return
    setPreviewing(true)
    setPreviewAudio(null)
    try {
      const res = await fetch(`${API}/ai-suite/voice/preview`, {
        method: 'POST', headers: { ...authH, 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: previewText }),
      })
      if (!res.ok) { showToast('Preview failed — check ElevenLabs API key'); return }
      const blob = await res.blob()
      const url  = URL.createObjectURL(blob)
      setPreviewAudio(url)
      new Audio(url).play()
    } catch { showToast('Preview failed') } finally { setPreviewing(false) }
  }

  async function assignVoice(id: string) {
    await fetch(`${API}/ai-suite/voice/voices/${id}/assign`, { method: 'PUT', headers: authH })
    fetchAll()
    showToast('Voice set as default')
  }

  async function deleteVoice(id: string) {
    if (!confirm('Delete this voice? This cannot be undone.')) return
    await fetch(`${API}/ai-suite/voice/voices/${id}`, { method: 'DELETE', headers: authH })
    fetchAll()
    showToast('Voice deleted')
  }

  async function toggleRecording() {
    if (recording) { mediaRef.current?.stop(); setRecording(false); return }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mr = new MediaRecorder(stream); chunksRef.current = []
      mr.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data) }
      mr.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
        setSamples(s => [...s, { id: Date.now().toString(), name: `Sample ${s.length + 1}`, blob }])
        stream.getTracks().forEach(t => t.stop())
      }
      mediaRef.current = mr; mr.start(); setRecording(true)
    } catch { showToast('Microphone access required') }
  }

  async function trainVoice() {
    if (!trainName.trim() || samples.length === 0) return
    setTraining(true)
    try {
      const form = new FormData()
      form.append('name', trainName)
      form.append('file', samples[0].blob, 'voice-sample.webm')
      const res = await fetch(`${API}/ai-suite/voice/train`, { method: 'POST', headers: authH, body: form })
      if (res.ok) {
        showToast('Voice cloned and saved!')
        setTrainName(''); setSamples([])
        fetchAll()
      } else {
        const e = await res.json().catch(() => ({}))
        showToast(e.error || 'Training failed — check ElevenLabs API key')
      }
    } catch { showToast('Training failed') } finally { setTraining(false) }
  }

  function showToast(msg: string) { setToast(msg); setTimeout(() => setToast(null), 3500) }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 size={24} className="animate-spin text-cyan-500" />
      </div>
    )
  }

  return (
    <div className="p-6 space-y-6 max-w-3xl">
      {toast && (
        <div className="fixed top-5 right-5 z-50 bg-gray-900 text-white text-sm font-semibold px-4 py-3 rounded-2xl shadow-xl animate-fade-in">
          {toast}
        </div>
      )}

      <div>
        <h1 className="text-xl font-black text-gray-800 dark:text-white">Voice Studio</h1>
        <p className="text-sm text-gray-400 mt-0.5">Configure the AI voice and clone custom voices</p>
      </div>

      {/* ── Settings ──────────────────────────────────── */}
      <div className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/10 shadow-sm p-5 space-y-4">
        <h2 className="text-sm font-bold text-gray-800 dark:text-white flex items-center gap-2">
          <Mic size={15} className="text-cyan-500" /> Voice Settings
          {settings?.elevenLabsKeySet
            ? <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400 ml-auto">ElevenLabs Connected</span>
            : <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-50 dark:bg-red-900/20 text-red-500 ml-auto">ELEVENLABS_API_KEY not set</span>
          }
        </h2>
        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="text-xs font-bold text-gray-500 dark:text-white/50 uppercase tracking-wide mb-1.5 block">Persona Name</label>
            <input value={personaName} onChange={e => setPersonaName(e.target.value)}
              className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-white/10 rounded-xl bg-gray-50 dark:bg-white/5 dark:text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-500" />
          </div>
          <div>
            <label className="text-xs font-bold text-gray-500 dark:text-white/50 uppercase tracking-wide mb-1.5 block">Stability ({stability.toFixed(2)})</label>
            <input type="range" min={0} max={1} step={0.05} value={stability} onChange={e => setStability(parseFloat(e.target.value))}
              className="w-full h-2 accent-cyan-500 mt-3" />
          </div>
          <div>
            <label className="text-xs font-bold text-gray-500 dark:text-white/50 uppercase tracking-wide mb-1.5 block">Similarity ({similarity.toFixed(2)})</label>
            <input type="range" min={0} max={1} step={0.05} value={similarity} onChange={e => setSimilarity(parseFloat(e.target.value))}
              className="w-full h-2 accent-cyan-500 mt-3" />
          </div>
        </div>
        <button onClick={saveSettings} disabled={savingSettings}
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold text-white transition-all hover:-translate-y-0.5 disabled:opacity-60"
          style={{ background: 'linear-gradient(135deg,#0c1e50,#29ABE2)' }}>
          {savingSettings && <Loader2 size={13} className="animate-spin" />}
          Save Settings
        </button>
      </div>

      {/* ── Preview ───────────────────────────────────── */}
      <div className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/10 shadow-sm p-5 space-y-3">
        <h2 className="text-sm font-bold text-gray-800 dark:text-white flex items-center gap-2">
          <Volume2 size={15} className="text-purple-500" /> Preview Voice
        </h2>
        <textarea value={previewText} onChange={e => setPreviewText(e.target.value)} rows={2}
          className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-white/10 rounded-xl bg-gray-50 dark:bg-white/5 dark:text-white resize-none focus:outline-none focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-500" />
        <button onClick={previewVoice} disabled={previewing || !settings?.elevenLabsKeySet}
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold text-white transition-all hover:-translate-y-0.5 disabled:opacity-60"
          style={{ background: 'linear-gradient(135deg,#7c3aed,#9333ea)' }}>
          {previewing ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
          {previewing ? 'Generating...' : 'Play Preview'}
        </button>
      </div>

      {/* ── Voice profiles ────────────────────────────── */}
      {voices.length > 0 && (
        <div className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/10 shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-50 dark:border-white/5">
            <h2 className="text-sm font-bold text-gray-800 dark:text-white">Saved Voices</h2>
          </div>
          {voices.map(v => (
            <div key={v.id} className="flex items-center gap-4 px-5 py-3.5 border-b border-gray-50 dark:border-white/5 last:border-0">
              <div className="w-9 h-9 rounded-xl bg-purple-50 dark:bg-purple-900/20 flex items-center justify-center flex-shrink-0">
                <Mic size={16} className="text-purple-500" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-gray-800 dark:text-white">{v.name}</p>
                <p className="text-xs text-gray-400 dark:text-white/40">{v.isCloned ? 'Custom clone' : 'ElevenLabs preset'}</p>
              </div>
              {v.isDefault && (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-cyan-50 dark:bg-cyan-900/20 text-cyan-600 dark:text-cyan-400">
                  Default
                </span>
              )}
              <div className="flex items-center gap-2 flex-shrink-0">
                {!v.isDefault && (
                  <button onClick={() => assignVoice(v.id)}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-bold bg-cyan-50 dark:bg-cyan-900/20 text-cyan-600 dark:text-cyan-400 hover:bg-cyan-100 transition-colors">
                    <Star size={11} /> Use
                  </button>
                )}
                <button onClick={() => deleteVoice(v.id)}
                  className="w-8 h-8 rounded-xl flex items-center justify-center hover:bg-red-50 dark:hover:bg-red-900/20 text-red-400 transition-colors">
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Clone new voice ───────────────────────────── */}
      <div className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/10 shadow-sm p-5 space-y-4">
        <h2 className="text-sm font-bold text-gray-800 dark:text-white flex items-center gap-2">
          <Star size={15} className="text-amber-500" /> Clone a Custom Voice
        </h2>
        <p className="text-xs text-gray-400 dark:text-white/40">
          Record or upload a voice sample to clone it with ElevenLabs AI.
        </p>
        <div>
          <label className="text-xs font-bold text-gray-500 dark:text-white/50 uppercase tracking-wide mb-1.5 block">Voice Name</label>
          <input value={trainName} onChange={e => setTrainName(e.target.value)} placeholder="e.g. Sarah UG"
            className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-white/10 rounded-xl bg-gray-50 dark:bg-white/5 dark:text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-500" />
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <button onClick={toggleRecording}
            className={cn(
              'flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-sm text-white transition-all',
              recording && 'animate-pulse',
            )}
            style={{ background: recording ? '#ef4444' : 'linear-gradient(135deg,#1A237E,#29ABE2)' }}>
            {recording ? <><MicOff size={15} /> Stop</> : <><Mic size={15} /> Record Sample</>}
          </button>
          <label className="flex items-center gap-2 px-4 py-2.5 rounded-xl border-2 border-dashed border-gray-200 dark:border-white/10 text-gray-500 dark:text-white/50 hover:border-cyan-400 hover:text-cyan-500 cursor-pointer transition-all text-sm font-medium">
            <Upload size={14} /> Upload Audio
            <input ref={fileRef} type="file" accept="audio/*" className="hidden"
              onChange={e => {
                const f = e.target.files?.[0]
                if (!f) return
                setSamples(s => [...s, { id: Date.now().toString(), name: f.name, blob: f }])
                e.target.value = ''
              }} />
          </label>
        </div>

        {samples.length > 0 && (
          <div className="space-y-2">
            {samples.map((s, i) => (
              <div key={s.id} className="flex items-center gap-3 p-3 bg-emerald-50 dark:bg-emerald-900/10 rounded-xl border border-emerald-100 dark:border-emerald-700/20">
                <div className="w-7 h-7 rounded-full bg-emerald-500 flex items-center justify-center text-white text-xs font-bold">{i + 1}</div>
                <p className="flex-1 text-sm font-medium text-gray-800 dark:text-white truncate">{s.name}</p>
                <button onClick={() => setSamples(ss => ss.filter(x => x.id !== s.id))}
                  className="w-7 h-7 rounded-full hover:bg-red-100 dark:hover:bg-red-900/20 flex items-center justify-center text-red-400">
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>
        )}

        <button onClick={trainVoice} disabled={training || !trainName.trim() || samples.length === 0 || !settings?.elevenLabsKeySet}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-white text-sm transition-all hover:-translate-y-0.5 hover:shadow-lg disabled:opacity-40 disabled:cursor-not-allowed"
          style={{ background: 'linear-gradient(135deg,#7c3aed,#9333ea)' }}>
          {training ? <><Loader2 size={15} className="animate-spin" /> Cloning...</> : <><CheckCircle2 size={15} /> Clone &amp; Save Voice</>}
        </button>
      </div>
    </div>
  )
}
