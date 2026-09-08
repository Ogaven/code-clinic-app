'use client'

import { useEffect, useRef, useState } from 'react'
import {
  FileText, Upload, Link2, Search, Trash2, Loader2, Globe, GraduationCap, ExternalLink,
  PenLine, AlertTriangle, Image as ImageIcon, Music, Video, Check, RotateCcw, Pencil,
} from 'lucide-react'
import { cn } from '@/lib/utils'

// Matches the real GET /ai-suite/knowledge response shape exactly
// ({ documents, total }) — the previous version of this page read a
// non-existent `d.items` field and silently always showed an empty list.
// Fixed here rather than left in place, since this panel is being rebuilt
// anyway and "no fake functionality" cuts both ways — a broken list is as
// dishonest as a fabricated one.
interface KBDocument {
  id: string
  title: string
  type: string
  sourceUrl: string | null
  chunkCount: number
  tokenCount: number
  createdAt: string
}

// Real ingestion for every one of these now exists (see
// apps/api/src/ai-suite/knowledge/media-extract.service.ts): PDF/TXT/MD/DOCX
// text extraction, OCR-style vision extraction for images, Whisper
// transcription for audio, and audio-track extraction + transcription for
// video. Nothing here is a placeholder — a file that can't genuinely be
// turned into text fails with a clear reason instead of silently becoming a
// useless "Video: clip.mp4" row (see the FAILED state below).
const FORMAT_GROUPS: { label: string; icon: React.ComponentType<any>; extensions: string[] }[] = [
  { label: 'Documents', icon: FileText,  extensions: ['pdf', 'txt', 'md', 'docx'] },
  { label: 'Images',    icon: ImageIcon, extensions: ['png', 'jpg', 'jpeg', 'webp'] },
  { label: 'Audio',     icon: Music,     extensions: ['mp3', 'm4a', 'wav', 'aac'] },
  { label: 'Video',     icon: Video,     extensions: ['mp4', 'mov', 'webm'] },
]
const ACCEPTED_EXTENSIONS = FORMAT_GROUPS.flatMap(g => g.extensions)
const ACCEPTED_MIME = ACCEPTED_EXTENSIONS.map(e => `.${e}`).join(',')

const TYPE_ICON: Record<string, React.ComponentType<any>> = {
  PDF: FileText, DOCX: FileText, TEXT: FileText, URL: Globe, STAFF_TRAINING: GraduationCap,
  IMAGE: ImageIcon, AUDIO: Music, VIDEO: Video,
}
const TYPE_LABEL: Record<string, string> = {
  PDF: 'PDF', DOCX: 'Word doc', TEXT: 'Text', URL: 'Web page', STAFF_TRAINING: 'Staff-taught',
  IMAGE: 'Image', AUDIO: 'Audio', VIDEO: 'Video',
}
const CATEGORY_ICON: Record<string, React.ComponentType<any>> = { DOCUMENT: FileText, IMAGE: ImageIcon, AUDIO: Music, VIDEO: Video }

function isRealLink(url: string | null): url is string {
  return !!url && /^https?:\/\//i.test(url)
}

interface IngestionRow {
  id: string
  originalFilename: string
  category: 'DOCUMENT' | 'IMAGE' | 'AUDIO' | 'VIDEO'
  sizeBytes: number
  status: 'PROCESSING' | 'EXTRACTED' | 'FAILED' | 'CONFIRMED'
  extractedTitle: string | null
  extractedText: string | null
  errorMessage: string | null
  createdAt: string
}

interface UploadingItem {
  tempId: string
  filename: string
  progress: number // 0-100 while uploading; -1 once handed off to server-side processing
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

// ── One card in the upload/preview queue ───────────────────────────────────
function IngestionCard({ row, onConfirm, onRetry, onDiscard, busy }: {
  row: IngestionRow
  onConfirm: (id: string, title: string, text: string) => void
  onRetry: (id: string) => void
  onDiscard: (id: string) => void
  busy: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(row.extractedTitle || '')
  const [text, setText] = useState(row.extractedText || '')
  const Icon = CATEGORY_ICON[row.category] || FileText

  return (
    <div className="rounded-2xl border border-gray-100 dark:border-white/10 bg-white dark:bg-white/[0.03] p-3.5 space-y-2.5">
      <div className="flex items-center gap-2.5">
        <div className={cn('w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0',
          row.status === 'FAILED' ? 'bg-red-50 dark:bg-red-900/20' : 'bg-gray-100 dark:bg-white/8')}>
          <Icon size={15} className={row.status === 'FAILED' ? 'text-red-500' : 'text-gray-400 dark:text-white/40'} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-800 dark:text-white truncate">{row.originalFilename}</p>
          <p className="text-xs text-gray-400">{row.category} · {formatBytes(row.sizeBytes)}</p>
        </div>
        {row.status === 'PROCESSING' && (
          <span className="flex items-center gap-1.5 text-[11px] font-bold text-cyan-600 dark:text-cyan-400 flex-shrink-0">
            <Loader2 size={13} className="animate-spin" /> Extracting…
          </span>
        )}
      </div>

      {row.status === 'FAILED' && (
        <div className="flex items-start gap-2 rounded-xl bg-red-50 dark:bg-red-900/10 border border-red-100 dark:border-red-500/20 px-3 py-2.5">
          <AlertTriangle size={14} className="text-red-500 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-red-600 dark:text-red-400 flex-1">{row.errorMessage || 'Extraction failed.'}</p>
        </div>
      )}

      {row.status === 'EXTRACTED' && (
        <>
          {editing ? (
            <div className="space-y-2">
              <input value={title} onChange={e => setTitle(e.target.value)}
                className="w-full px-3 py-2 text-sm font-semibold rounded-xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/5 dark:text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/20" />
              <textarea value={text} onChange={e => setText(e.target.value)} rows={6}
                className="w-full px-3 py-2 text-sm rounded-xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/5 dark:text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/20 resize-none" />
            </div>
          ) : (
            <button onClick={() => setEditing(true)} className="w-full text-left group">
              <div className="rounded-xl bg-gray-50 dark:bg-white/5 border border-gray-100 dark:border-white/10 px-3 py-2.5 max-h-32 overflow-y-auto">
                <p className="text-xs font-bold text-gray-500 dark:text-white/40 mb-1 flex items-center gap-1">
                  {title} <Pencil size={10} className="opacity-0 group-hover:opacity-100 transition-opacity" />
                </p>
                <p className="text-xs text-gray-600 dark:text-white/60 whitespace-pre-wrap">{text}</p>
              </div>
            </button>
          )}
          <div className="flex gap-2">
            <button onClick={() => onDiscard(row.id)} disabled={busy}
              className="flex-1 py-2 rounded-xl text-xs font-bold text-gray-500 dark:text-white/50 border border-gray-200 dark:border-white/10 disabled:opacity-50">
              Discard
            </button>
            <button onClick={() => onConfirm(row.id, title.trim(), text.trim())} disabled={busy || !title.trim() || !text.trim()}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-bold text-white disabled:opacity-50"
              style={{ background: 'linear-gradient(135deg,#059669,#10b981)' }}>
              {busy ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Save to Knowledge Base
            </button>
          </div>
        </>
      )}

      {row.status === 'FAILED' && (
        <div className="flex gap-2">
          <button onClick={() => onDiscard(row.id)} disabled={busy}
            className="flex-1 py-2 rounded-xl text-xs font-bold text-gray-500 dark:text-white/50 border border-gray-200 dark:border-white/10 disabled:opacity-50">
            Discard
          </button>
          <button onClick={() => onRetry(row.id)} disabled={busy}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-bold text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 disabled:opacity-50">
            {busy ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />} Retry
          </button>
        </div>
      )}
    </div>
  )
}

export default function KnowledgeSourcesPanel() {
  const API = '/api-proxy'
  const token = typeof window !== 'undefined' ? localStorage.getItem('cc_token') : null
  const authH = { Authorization: `Bearer ${token}` }

  const [docs, setDocs] = useState<KBDocument[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [toast, setToast] = useState<string | null>(null)
  const [rejectedFile, setRejectedFile] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const [uploadingItems, setUploadingItems] = useState<UploadingItem[]>([])
  const [queue, setQueue] = useState<IngestionRow[]>([])
  const [queueLoading, setQueueLoading] = useState(true)
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set())

  const [urlInput, setUrlInput] = useState('')
  const [urlLoading, setUrlLoading] = useState(false)

  const [showTextForm, setShowTextForm] = useState(false)
  const [textTitle, setTextTitle] = useState('')
  const [textContent, setTextContent] = useState('')
  const [textLoading, setTextLoading] = useState(false)

  const [pendingDelete, setPendingDelete] = useState<KBDocument | null>(null)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => { fetchDocs(); fetchQueue() }, [])

  async function fetchDocs() {
    setLoading(true)
    try {
      const res = await fetch(`${API}/ai-suite/knowledge`, { headers: authH })
      if (res.ok) {
        const d = await res.json()
        setDocs(Array.isArray(d?.documents) ? d.documents : [])
      }
    } catch {} finally { setLoading(false) }
  }

  async function fetchQueue() {
    setQueueLoading(true)
    try {
      const res = await fetch(`${API}/ai-suite/knowledge/ingest`, { headers: authH })
      if (res.ok) { const d = await res.json(); setQueue(Array.isArray(d?.ingestions) ? d.ingestions : []) }
    } catch {} finally { setQueueLoading(false) }
  }

  function showToast(msg: string) { setToast(msg); setTimeout(() => setToast(null), 3500) }

  function acceptFile(file: File): boolean {
    const ext = (file.name.split('.').pop() || '').toLowerCase()
    if (!ACCEPTED_EXTENSIONS.includes(ext)) {
      setRejectedFile(file.name)
      setTimeout(() => setRejectedFile(null), 4500)
      return false
    }
    return true
  }

  // Plain fetch gives no upload progress events — XHR does. Used only for
  // this one request so the rest of the file can stay on fetch.
  function uploadWithProgress(file: File, onProgress: (pct: number) => void): Promise<{ status: number; body: any }> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      xhr.open('POST', `${API}/ai-suite/knowledge/ingest/upload`)
      xhr.setRequestHeader('Authorization', authH.Authorization)
      xhr.upload.onprogress = e => { if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100)) }
      xhr.onload = () => {
        let body: any = {}
        try { body = JSON.parse(xhr.responseText) } catch {}
        resolve({ status: xhr.status, body })
      }
      xhr.onerror = () => reject(new Error('Network error'))
      const form = new FormData()
      form.append('file', file)
      xhr.send(form)
    })
  }

  async function uploadFile(file: File) {
    if (!acceptFile(file)) return
    const tempId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    setUploadingItems(items => [...items, { tempId, filename: file.name, progress: 0 }])
    try {
      const { status, body } = await uploadWithProgress(file, pct => {
        setUploadingItems(items => items.map(i => i.tempId === tempId ? { ...i, progress: pct } : i))
      })
      setUploadingItems(items => items.map(i => i.tempId === tempId ? { ...i, progress: -1 } : i))
      if (status >= 200 && status < 300) {
        if (body.duplicateOf) showToast(`Note: a file was already saved as "${body.duplicateOf.title}" — review before saving again`)
        await fetchQueue()
      } else {
        showToast(body.error || 'Upload failed')
      }
    } catch {
      showToast('Upload failed — check your connection and try again')
    } finally {
      setUploadingItems(items => items.filter(i => i.tempId !== tempId))
    }
  }

  function withBusy(id: string, fn: () => Promise<void>) {
    setBusyIds(s => new Set(s).add(id))
    return fn().finally(() => setBusyIds(s => { const n = new Set(s); n.delete(id); return n }))
  }

  async function confirmIngestion(id: string, title: string, text: string) {
    await withBusy(id, async () => {
      try {
        if (title !== queue.find(q => q.id === id)?.extractedTitle || text !== queue.find(q => q.id === id)?.extractedText) {
          const patchRes = await fetch(`${API}/ai-suite/knowledge/ingest/${id}`, {
            method: 'PATCH', headers: { ...authH, 'Content-Type': 'application/json' },
            body: JSON.stringify({ extractedTitle: title, extractedText: text }),
          })
          if (!patchRes.ok) { const e = await patchRes.json().catch(() => ({})); showToast(e.error || 'Failed to save edits'); return }
        }
        const res = await fetch(`${API}/ai-suite/knowledge/ingest/${id}/confirm`, { method: 'POST', headers: authH })
        if (res.ok) {
          showToast('Saved to the knowledge base!')
          setQueue(q => q.filter(r => r.id !== id))
          fetchDocs()
        } else {
          const e = await res.json().catch(() => ({})); showToast(e.error || 'Failed to save')
        }
      } catch { showToast('Failed to save') }
    })
  }

  async function retryIngestion(id: string) {
    await withBusy(id, async () => {
      try {
        const res = await fetch(`${API}/ai-suite/knowledge/ingest/${id}/retry`, { method: 'POST', headers: authH })
        const d = await res.json().catch(() => ({}))
        if (res.ok && d.ingestion) setQueue(q => q.map(r => r.id === id ? d.ingestion : r))
        else showToast(d.error || 'Retry failed')
      } catch { showToast('Retry failed') }
    })
  }

  async function discardIngestion(id: string) {
    await withBusy(id, async () => {
      try {
        await fetch(`${API}/ai-suite/knowledge/ingest/${id}`, { method: 'DELETE', headers: authH })
        setQueue(q => q.filter(r => r.id !== id))
      } catch { showToast('Failed to discard') }
    })
  }

  async function ingestURL() {
    if (!urlInput.trim()) return
    setUrlLoading(true)
    try {
      const res = await fetch(`${API}/ai-suite/knowledge/url`, {
        method: 'POST', headers: { ...authH, 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: urlInput }),
      })
      if (res.ok) { showToast('URL ingested!'); setUrlInput(''); fetchDocs() }
      else { const e = await res.json().catch(() => ({})); showToast(e.error || 'Failed to ingest URL') }
    } catch { showToast('Failed') } finally { setUrlLoading(false) }
  }

  async function ingestText() {
    if (!textTitle.trim() || !textContent.trim()) return
    setTextLoading(true)
    try {
      const res = await fetch(`${API}/ai-suite/knowledge/text`, {
        method: 'POST', headers: { ...authH, 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: textTitle.trim(), content: textContent.trim() }),
      })
      if (res.ok) { showToast('Text saved to knowledge base!'); setTextTitle(''); setTextContent(''); setShowTextForm(false); fetchDocs() }
      else { const e = await res.json().catch(() => ({})); showToast(e.error || 'Failed to save text') }
    } catch { showToast('Failed') } finally { setTextLoading(false) }
  }

  async function confirmDelete() {
    if (!pendingDelete) return
    setDeleting(true)
    try {
      await fetch(`${API}/ai-suite/knowledge/${pendingDelete.id}`, { method: 'DELETE', headers: authH })
      setDocs(prev => prev.filter(d => d.id !== pendingDelete.id))
      showToast('Removed')
    } finally { setDeleting(false); setPendingDelete(null) }
  }

  const filtered = docs.filter(d => !search || d.title.toLowerCase().includes(search.toLowerCase()))
  const hasQueueActivity = uploadingItems.length > 0 || queue.length > 0

  return (
    <div className="space-y-5">
      {toast && (
        <div className="fixed top-5 right-5 z-50 bg-gray-900 text-white text-sm font-semibold px-4 py-3 rounded-2xl shadow-xl animate-fade-in max-w-sm">
          {toast}
        </div>
      )}

      {/* Delete confirmation */}
      {pendingDelete && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white dark:bg-[#0e2045] rounded-2xl shadow-2xl border border-gray-100 dark:border-white/10 w-full max-w-sm overflow-hidden">
            <div className="p-5 space-y-3">
              <div className="w-10 h-10 rounded-xl bg-red-50 dark:bg-red-900/20 flex items-center justify-center">
                <AlertTriangle size={18} className="text-red-500" />
              </div>
              <h3 className="text-sm font-bold text-gray-800 dark:text-white">Remove this source?</h3>
              <p className="text-sm text-gray-500 dark:text-white/50">
                <span className="font-semibold text-gray-700 dark:text-white/70">{pendingDelete.title}</span> will be permanently removed from the shared knowledge base. WhatsApp, Website, Facebook Messenger and Instagram DM will stop drawing on this information immediately. This can't be undone.
              </p>
              <div className="flex gap-2 pt-2">
                <button onClick={() => setPendingDelete(null)} disabled={deleting}
                  className="flex-1 py-2.5 rounded-xl text-sm font-semibold border border-gray-200 dark:border-white/10 text-gray-600 dark:text-white/60 disabled:opacity-50">
                  Cancel
                </button>
                <button onClick={confirmDelete} disabled={deleting}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm font-bold text-white bg-red-500 hover:bg-red-600 transition-colors disabled:opacity-60">
                  {deleting ? <span className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" /> : <Trash2 size={13} />}
                  Remove
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div>
        <h1 className="text-xl font-black text-gray-800 dark:text-white">Knowledge Base</h1>
        <p className="text-sm text-gray-400 mt-0.5">Documents, images, audio, video, web pages and staff-taught facts Code Clinic AI draws answers from</p>
      </div>

      {/* Upload zone */}
      <div
        className="bg-white dark:bg-white/5 rounded-2xl border-2 border-dashed border-gray-200 dark:border-white/10 p-6 sm:p-8 text-center hover:border-cyan-400 hover:bg-cyan-50/30 dark:hover:bg-cyan-900/10 transition-all cursor-pointer"
        onClick={() => fileRef.current?.click()}
        onDragOver={e => e.preventDefault()}
        onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) uploadFile(f) }}>
        <input ref={fileRef} type="file" accept={ACCEPTED_MIME} className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) uploadFile(f); e.target.value = '' }} />
        <Upload size={28} className="mx-auto mb-2.5 text-gray-300 dark:text-white/20" />
        <p className="font-bold text-gray-700 dark:text-white mb-1 text-sm">Drop a file here or click to browse</p>
        <p className="text-xs text-gray-400 mb-3">Real text is extracted, transcribed or described — then you review it before it's saved</p>
        <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 mb-3">
          {FORMAT_GROUPS.map(g => (
            <span key={g.label} className="flex items-center gap-1.5 text-[11px] font-bold text-gray-500 dark:text-white/50">
              <g.icon size={13} className="text-gray-400 dark:text-white/40" /> {g.label}
            </span>
          ))}
        </div>
        <button className="px-4 py-2 rounded-xl text-xs font-bold text-white transition-all hover:-translate-y-0.5 hover:shadow-lg"
          style={{ background: 'linear-gradient(135deg,#0c1e50,#29ABE2)' }}>
          Browse Files
        </button>
        {rejectedFile && (
          <p className="text-xs font-semibold text-red-500 mt-3">
            "{rejectedFile}" isn't a supported format. Supported: PDF, TXT, MD, DOCX · PNG, JPG, WEBP · MP3, M4A, WAV, AAC · MP4, MOV, WEBM.
          </p>
        )}
      </div>

      {/* Upload / extraction queue */}
      {hasQueueActivity && (
        <div className="space-y-2.5">
          {uploadingItems.map(item => (
            <div key={item.tempId} className="rounded-2xl border border-cyan-200 dark:border-cyan-500/30 bg-cyan-50/50 dark:bg-cyan-900/10 p-3.5">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-semibold text-gray-800 dark:text-white truncate">{item.filename}</p>
                <span className="text-[11px] font-bold text-cyan-600 dark:text-cyan-400 flex-shrink-0 ml-2">
                  {item.progress < 0 ? 'Processing…' : `${item.progress}%`}
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-white dark:bg-white/10 overflow-hidden">
                <div className="h-full rounded-full bg-cyan-500 transition-all" style={{ width: `${item.progress < 0 ? 100 : item.progress}%` }} />
              </div>
            </div>
          ))}
          {queue.map(row => (
            <IngestionCard key={row.id} row={row} onConfirm={confirmIngestion} onRetry={retryIngestion} onDiscard={discardIngestion} busy={busyIds.has(row.id)} />
          ))}
        </div>
      )}

      {/* Add URL */}
      <div className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/10 shadow-sm p-4">
        <div className="flex items-center gap-2 mb-3">
          <Link2 size={14} className="text-cyan-500" />
          <h3 className="text-sm font-bold text-gray-800 dark:text-white">Add URL</h3>
        </div>
        <div className="flex flex-col sm:flex-row gap-2">
          <input value={urlInput} onChange={e => setUrlInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') ingestURL() }}
            placeholder="https://yourclinic.com/faq"
            className="flex-1 px-3 py-2.5 text-sm border border-gray-200 dark:border-white/10 rounded-xl bg-gray-50 dark:bg-white/5 dark:text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-500" />
          <button onClick={ingestURL} disabled={urlLoading || !urlInput.trim()}
            className="flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-bold text-white whitespace-nowrap disabled:opacity-60"
            style={{ background: 'linear-gradient(135deg,#0c1e50,#29ABE2)' }}>
            {urlLoading && <Loader2 size={13} className="animate-spin" />}
            Crawl &amp; Ingest
          </button>
        </div>
      </div>

      {/* Paste text — real GET.../text endpoint, matches Admin's existing capability */}
      <div className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/10 shadow-sm p-4">
        <button onClick={() => setShowTextForm(s => !s)} className="flex items-center gap-2 w-full text-left">
          <PenLine size={14} className="text-cyan-500" />
          <h3 className="text-sm font-bold text-gray-800 dark:text-white flex-1">Paste Text</h3>
          <span className="text-xs text-gray-400">{showTextForm ? 'Hide' : 'Write a fact directly'}</span>
        </button>
        {showTextForm && (
          <div className="mt-3 space-y-2">
            <input value={textTitle} onChange={e => setTextTitle(e.target.value)} placeholder="Title, e.g. Cancellation policy"
              className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-white/10 rounded-xl bg-gray-50 dark:bg-white/5 dark:text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/20" />
            <textarea value={textContent} onChange={e => setTextContent(e.target.value)} rows={3} placeholder="The exact information the AI should know..."
              className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-white/10 rounded-xl bg-gray-50 dark:bg-white/5 dark:text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/20 resize-none" />
            <div className="flex justify-end">
              <button onClick={ingestText} disabled={textLoading || !textTitle.trim() || !textContent.trim()}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold text-white disabled:opacity-60"
                style={{ background: 'linear-gradient(135deg,#0c1e50,#29ABE2)' }}>
                {textLoading && <Loader2 size={12} className="animate-spin" />}
                Save to Knowledge Base
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Source list */}
      <div className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/10 shadow-sm overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-50 dark:border-white/5">
          <Search size={14} className="text-gray-400 flex-shrink-0" />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search knowledge base..."
            className="flex-1 text-sm outline-none bg-transparent placeholder-gray-400 dark:placeholder-white/30 dark:text-white" />
          <span className="text-[11px] font-semibold text-gray-400 dark:text-white/30 flex-shrink-0">{docs.length} source{docs.length === 1 ? '' : 's'}</span>
        </div>
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 size={20} className="animate-spin text-cyan-500" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="px-4 py-10 text-center">
            <FileText size={26} className="mx-auto mb-2 text-gray-200 dark:text-white/10" />
            <p className="text-sm text-gray-400">{docs.length === 0 ? 'No sources yet — upload a file, add a URL, or teach the AI in the chat panel' : 'No results'}</p>
          </div>
        ) : filtered.map(doc => {
          const Icon = TYPE_ICON[doc.type] || FileText
          const link = isRealLink(doc.sourceUrl) ? doc.sourceUrl : null
          return (
            <div key={doc.id} className="flex items-center gap-3 px-4 py-3 border-b border-gray-50 dark:border-white/5 last:border-0">
              <div className={cn('w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0',
                doc.type === 'STAFF_TRAINING' ? 'bg-purple-50 dark:bg-purple-900/20' : 'bg-gray-100 dark:bg-white/8')}>
                <Icon size={15} className={doc.type === 'STAFF_TRAINING' ? 'text-purple-500' : 'text-gray-400 dark:text-white/40'} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-gray-800 dark:text-white truncate">{doc.title}</p>
                <p className="text-xs text-gray-400 flex items-center gap-1 flex-wrap">
                  <span>{TYPE_LABEL[doc.type] || doc.type} · {doc.chunkCount} chunk{doc.chunkCount === 1 ? '' : 's'} · {new Date(doc.createdAt).toLocaleDateString()}</span>
                  {/* Only a genuine http(s) sourceUrl is ever a link — staff-training://<userId>
                      provenance tags and internal r2Key paths are never navigable. */}
                  {link && (
                    <a href={link} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}
                      className="inline-flex items-center gap-0.5 text-cyan-600 dark:text-cyan-400 hover:underline truncate max-w-[200px]">
                      <ExternalLink size={10} className="flex-shrink-0" /> {link}
                    </a>
                  )}
                </p>
              </div>
              <button onClick={() => setPendingDelete(doc)}
                className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors flex-shrink-0">
                <Trash2 size={13} className="text-red-400" />
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
