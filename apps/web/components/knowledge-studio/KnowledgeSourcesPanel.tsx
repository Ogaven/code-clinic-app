'use client'

import { useEffect, useRef, useState } from 'react'
import { FileText, Upload, Link2, Search, Trash2, Loader2, Globe, GraduationCap, ExternalLink, PenLine, AlertTriangle } from 'lucide-react'
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

// Only PDF/TXT/MD/pasted-text and URL crawls produce real, meaningful
// content (apps/api/src/ai-suite/knowledge/knowledge-ingest.service.ts
// extracts actual text for these). Image/audio/video uploads are accepted by
// that same service but stored as a placeholder string like "Image:
// photo.jpg" with NO OCR/transcription/description — genuinely useless to
// retrieval and to the AI. This panel used to advertise those formats
// ("PDF, Image, Audio, Video — all ingested") which was not true of what
// staff would actually get. Restricted to what's real.
const ACCEPTED_EXTENSIONS = ['.pdf', '.txt', '.md']
const ACCEPTED_MIME = '.pdf,.txt,.md'
const FORMAT_BADGES = ['PDF', 'TXT', 'MD']

const TYPE_ICON: Record<string, React.ComponentType<any>> = {
  PDF: FileText, TEXT: FileText, URL: Globe, STAFF_TRAINING: GraduationCap,
}
const TYPE_LABEL: Record<string, string> = {
  PDF: 'PDF', TEXT: 'Text', URL: 'Web page', STAFF_TRAINING: 'Staff-taught',
}

function isRealLink(url: string | null): url is string {
  return !!url && /^https?:\/\//i.test(url)
}

export default function KnowledgeSourcesPanel() {
  const API = '/api-proxy'
  const token = typeof window !== 'undefined' ? localStorage.getItem('cc_token') : null
  const authH = { Authorization: `Bearer ${token}` }

  const [docs, setDocs] = useState<KBDocument[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [urlInput, setUrlInput] = useState('')
  const [urlLoading, setUrlLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [toast, setToast] = useState<string | null>(null)
  const [rejectedFile, setRejectedFile] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const [showTextForm, setShowTextForm] = useState(false)
  const [textTitle, setTextTitle] = useState('')
  const [textContent, setTextContent] = useState('')
  const [textLoading, setTextLoading] = useState(false)

  const [pendingDelete, setPendingDelete] = useState<KBDocument | null>(null)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => { fetchDocs() }, [])

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

  function showToast(msg: string) { setToast(msg); setTimeout(() => setToast(null), 3000) }

  function acceptFile(file: File): boolean {
    const ext = '.' + (file.name.split('.').pop() || '').toLowerCase()
    if (!ACCEPTED_EXTENSIONS.includes(ext)) {
      setRejectedFile(file.name)
      setTimeout(() => setRejectedFile(null), 4000)
      return false
    }
    return true
  }

  async function uploadFile(file: File) {
    if (!acceptFile(file)) return
    setUploading(true)
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch(`${API}/ai-suite/knowledge/upload`, { method: 'POST', headers: authH, body: form })
      if (res.ok) { showToast('Document ingested!'); fetchDocs() }
      else { const e = await res.json().catch(() => ({})); showToast(e.error || 'Upload failed') }
    } catch { showToast('Upload failed') } finally { setUploading(false) }
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

  return (
    <div className="space-y-5">
      {toast && (
        <div className="fixed top-5 right-5 z-50 bg-gray-900 text-white text-sm font-semibold px-4 py-3 rounded-2xl shadow-xl animate-fade-in">
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
        <p className="text-sm text-gray-400 mt-0.5">Documents, web pages and staff-taught facts Code Clinic AI draws answers from</p>
      </div>

      {/* Upload zone */}
      <div
        className="bg-white dark:bg-white/5 rounded-2xl border-2 border-dashed border-gray-200 dark:border-white/10 p-8 text-center hover:border-cyan-400 hover:bg-cyan-50/30 dark:hover:bg-cyan-900/10 transition-all cursor-pointer"
        onClick={() => fileRef.current?.click()}
        onDragOver={e => e.preventDefault()}
        onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) uploadFile(f) }}>
        <input ref={fileRef} type="file" accept={ACCEPTED_MIME} className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) uploadFile(f); e.target.value = '' }} />
        {uploading
          ? <Loader2 size={28} className="mx-auto mb-2.5 animate-spin text-cyan-500" />
          : <Upload size={28} className="mx-auto mb-2.5 text-gray-300 dark:text-white/20" />}
        <p className="font-bold text-gray-700 dark:text-white mb-1 text-sm">
          {uploading ? 'Uploading & ingesting...' : 'Drop a file here or click to browse'}
        </p>
        <p className="text-xs text-gray-400 mb-3">Text is extracted and added to the shared AI knowledge base</p>
        <div className="flex items-center justify-center gap-2 mb-3">
          {FORMAT_BADGES.map(t => (
            <span key={t} className="text-[10px] font-bold bg-gray-100 dark:bg-white/10 text-gray-500 dark:text-white/50 px-2 py-1 rounded-lg">{t}</span>
          ))}
        </div>
        <button disabled={uploading}
          className="px-4 py-2 rounded-xl text-xs font-bold text-white transition-all hover:-translate-y-0.5 hover:shadow-lg disabled:opacity-60">
          <span className="px-4 py-2 rounded-xl text-xs font-bold text-white" style={{ background: 'linear-gradient(135deg,#0c1e50,#29ABE2)' }}>Browse Files</span>
        </button>
        {rejectedFile && (
          <p className="text-xs font-semibold text-red-500 mt-3">
            "{rejectedFile}" isn't a supported format yet — only PDF, TXT and MD produce real text the AI can use.
          </p>
        )}
      </div>

      {/* Add URL */}
      <div className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/10 shadow-sm p-4">
        <div className="flex items-center gap-2 mb-3">
          <Link2 size={14} className="text-cyan-500" />
          <h3 className="text-sm font-bold text-gray-800 dark:text-white">Add URL</h3>
        </div>
        <div className="flex gap-2">
          <input value={urlInput} onChange={e => setUrlInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') ingestURL() }}
            placeholder="https://yourclinic.com/faq"
            className="flex-1 px-3 py-2.5 text-sm border border-gray-200 dark:border-white/10 rounded-xl bg-gray-50 dark:bg-white/5 dark:text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-500" />
          <button onClick={ingestURL} disabled={urlLoading || !urlInput.trim()}
            className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-bold text-white whitespace-nowrap disabled:opacity-60"
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
            <p className="text-sm text-gray-400">{docs.length === 0 ? 'No sources yet — upload a document, add a URL, or teach the AI in the chat panel' : 'No results'}</p>
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
