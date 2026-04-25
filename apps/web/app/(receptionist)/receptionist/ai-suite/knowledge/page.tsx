'use client'

import { useEffect, useRef, useState } from 'react'
import { FileText, Upload, Link, Search, Trash2, Eye, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

type KBItem = { id: string; title: string; type: string; isActive: boolean; createdAt: string }

export default function KnowledgeBasePage() {
  const API   = '/api-proxy'
  const token = typeof window !== 'undefined' ? localStorage.getItem('cc_token') : null
  const authH = { Authorization: `Bearer ${token}` }

  const [items, setItems]           = useState<KBItem[]>([])
  const [loading, setLoading]       = useState(true)
  const [uploading, setUploading]   = useState(false)
  const [urlInput, setUrlInput]     = useState('')
  const [urlLoading, setUrlLoading] = useState(false)
  const [search, setSearch]         = useState('')
  const [toast, setToast]           = useState<string | null>(null)
  const fileRef                     = useRef<HTMLInputElement>(null)

  useEffect(() => { fetchItems() }, [])

  async function fetchItems() {
    setLoading(true)
    try {
      const res = await fetch(`${API}/ai-suite/knowledge`, { headers: authH })
      if (res.ok) {
        const d = await res.json()
        setItems(Array.isArray(d) ? d : d?.items ?? [])
      }
    } catch {} finally { setLoading(false) }
  }

  async function uploadFile(file: File) {
    setUploading(true)
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch(`${API}/ai-suite/knowledge/upload`, { method: 'POST', headers: authH, body: form })
      if (res.ok) { showToast('Document ingested!'); fetchItems() }
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
      if (res.ok) { showToast('URL ingested!'); setUrlInput(''); fetchItems() }
      else { const e = await res.json().catch(() => ({})); showToast(e.error || 'Failed to ingest URL') }
    } catch { showToast('Failed') } finally { setUrlLoading(false) }
  }

  async function deleteItem(id: string) {
    await fetch(`${API}/ai-suite/knowledge/${id}`, { method: 'DELETE', headers: authH })
    setItems(prev => prev.filter(i => i.id !== id))
    showToast('Deleted')
  }

  function showToast(msg: string) { setToast(msg); setTimeout(() => setToast(null), 3000) }

  const filtered = items.filter(i => !search || i.title.toLowerCase().includes(search.toLowerCase()))

  return (
    <div className="p-6 space-y-5 max-w-3xl">
      {toast && (
        <div className="fixed top-5 right-5 z-50 bg-gray-900 text-white text-sm font-semibold px-4 py-3 rounded-2xl shadow-xl animate-fade-in">
          {toast}
        </div>
      )}

      <div>
        <h1 className="text-xl font-black text-gray-800 dark:text-white">Knowledge Base</h1>
        <p className="text-sm text-gray-400 mt-0.5">Train Sarah with clinic documents, FAQs, and web pages</p>
      </div>

      {/* Upload zone */}
      <div
        className="bg-white dark:bg-white/5 rounded-2xl border-2 border-dashed border-gray-200 dark:border-white/10 p-10 text-center hover:border-cyan-400 hover:bg-cyan-50/30 dark:hover:bg-cyan-900/10 transition-all cursor-pointer"
        onClick={() => fileRef.current?.click()}
        onDragOver={e => e.preventDefault()}
        onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) uploadFile(f) }}>
        <input ref={fileRef} type="file" accept=".pdf,.png,.jpg,.jpeg,.mp3,.mp4,.wav" className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) uploadFile(f); e.target.value = '' }} />
        {uploading
          ? <Loader2 size={32} className="mx-auto mb-3 animate-spin text-cyan-500" />
          : <Upload size={32} className="mx-auto mb-3 text-gray-300 dark:text-white/20" />
        }
        <p className="font-bold text-gray-700 dark:text-white mb-1">
          {uploading ? 'Uploading & ingesting...' : 'Drop a file here or click to browse'}
        </p>
        <p className="text-sm text-gray-400 mb-4">PDF, Image, Audio, Video — all ingested into the AI knowledge base</p>
        <div className="flex items-center justify-center gap-2 mb-4">
          {['PDF', 'PNG', 'JPG', 'MP3', 'MP4'].map(t => (
            <span key={t} className="text-[10px] font-bold bg-gray-100 dark:bg-white/10 text-gray-500 dark:text-white/50 px-2 py-1 rounded-lg">{t}</span>
          ))}
        </div>
        <button disabled={uploading}
          className="px-5 py-2.5 rounded-xl text-sm font-bold text-white transition-all hover:-translate-y-0.5 hover:shadow-lg disabled:opacity-60"
          style={{ background: 'linear-gradient(135deg,#0c1e50,#29ABE2)' }}>
          Browse Files
        </button>
      </div>

      {/* Add URL */}
      <div className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/10 shadow-sm p-4">
        <div className="flex items-center gap-2 mb-3">
          <Link size={15} className="text-cyan-500" />
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

      {/* Items list */}
      <div className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/10 shadow-sm overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-50 dark:border-white/5">
          <Search size={14} className="text-gray-400" />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search knowledge base..."
            className="flex-1 text-sm outline-none bg-transparent placeholder-gray-400 dark:placeholder-white/30 dark:text-white" />
        </div>
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 size={20} className="animate-spin text-cyan-500" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="px-4 py-10 text-center">
            <FileText size={28} className="mx-auto mb-2 text-gray-200 dark:text-white/10" />
            <p className="text-sm text-gray-400">{items.length === 0 ? 'No items yet — upload a document to get started' : 'No results'}</p>
          </div>
        ) : filtered.map(item => (
          <div key={item.id} className="flex items-center gap-3 px-4 py-3 border-b border-gray-50 dark:border-white/5 last:border-0">
            <div className="w-9 h-9 rounded-xl bg-gray-100 dark:bg-white/8 flex items-center justify-center flex-shrink-0">
              <FileText size={16} className="text-gray-400 dark:text-white/40" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-gray-800 dark:text-white truncate">{item.title}</p>
              <p className="text-xs text-gray-400">{item.type} · {new Date(item.createdAt).toLocaleDateString()}</p>
            </div>
            <span className={cn(
              'text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0',
              item.isActive ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400' : 'bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400',
            )}>
              {item.isActive ? 'Active' : 'Processing'}
            </span>
            <div className="flex items-center gap-1 flex-shrink-0">
              <button className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-white/8 transition-colors">
                <Eye size={13} className="text-gray-400" />
              </button>
              <button onClick={() => deleteItem(item.id)}
                className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">
                <Trash2 size={13} className="text-red-400" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
