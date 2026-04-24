'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AlignLeft, ChevronDown, Database, Eye, FileText,
  Globe, Loader2, Plus, Search, Trash2, Upload, X, CheckCircle, XCircle,
} from 'lucide-react'

// ── Types ────────────────────────────────────────────────────────────────────

interface KBDocument {
  id:          string
  title:       string
  type:        string
  r2Key:       string | null
  sourceUrl:   string | null
  chunkCount:  number
  tokenCount:  number
  hasEmbedding:boolean
  createdAt:   string
}

interface PreviewChunk {
  id:         string
  title:      string
  rawText:    string
  chunkIndex: number
  tokenCount: number
}

interface SearchResult {
  id:         string
  title:      string
  rawText:    string
  score:      number
  similarity: number
}

type AddTab = 'file' | 'url' | 'text'

// ── Helpers ──────────────────────────────────────────────────────────────────

function getHeaders(extra?: Record<string, string>) {
  const token = typeof window !== 'undefined' ? localStorage.getItem('cc_token') : null
  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...extra,
  }
}

function typeBadge(type: string) {
  const cfg: Record<string, { label: string; cls: string }> = {
    PDF:      { label: 'PDF',      cls: 'bg-red-100    text-red-600    dark:bg-red-900/30    dark:text-red-400'    },
    IMAGE:    { label: 'Image',    cls: 'bg-pink-100   text-pink-600   dark:bg-pink-900/30   dark:text-pink-400'   },
    AUDIO:    { label: 'Audio',    cls: 'bg-purple-100 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400' },
    VIDEO:    { label: 'Video',    cls: 'bg-orange-100 text-orange-600 dark:bg-orange-900/30 dark:text-orange-400' },
    TEXT:     { label: 'Text',     cls: 'bg-blue-100   text-blue-600   dark:bg-blue-900/30   dark:text-blue-400'   },
    DOCUMENT: { label: 'Doc',      cls: 'bg-gray-100   text-gray-600   dark:bg-gray-700      dark:text-gray-300'   },
    URL:      { label: 'URL',      cls: 'bg-teal-100   text-teal-600   dark:bg-teal-900/30   dark:text-teal-400'   },
    WEB:      { label: 'Web',      cls: 'bg-teal-100   text-teal-600   dark:bg-teal-900/30   dark:text-teal-400'   },
  }
  const { label, cls } = cfg[type.toUpperCase()] ?? { label: type, cls: 'bg-gray-100 text-gray-600' }
  return <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${cls}`}>{label}</span>
}

function fmt(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}

function timeStr(iso: string): string {
  return new Date(iso).toLocaleDateString('en-UG', { day: 'numeric', month: 'short', year: 'numeric' })
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function KnowledgeBasePage() {
  const [documents,  setDocuments]  = useState<KBDocument[]>([])
  const [loading,    setLoading]    = useState(true)
  const [search,     setSearch]     = useState('')
  const [showAdd,    setShowAdd]    = useState(false)
  const [addTab,     setAddTab]     = useState<AddTab>('file')

  // Upload state
  const [dragOver,    setDragOver]    = useState(false)
  const [uploadFile,  setUploadFile]  = useState<File | null>(null)
  const [uploadTitle, setUploadTitle] = useState('')
  const [uploading,   setUploading]   = useState(false)
  const [uploadMsg,   setUploadMsg]   = useState<{ ok: boolean; text: string } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // URL state
  const [urlInput,   setUrlInput]   = useState('')
  const [urlLoading, setUrlLoading] = useState(false)
  const [urlMsg,     setUrlMsg]     = useState<{ ok: boolean; text: string } | null>(null)

  // Text state
  const [textTitle,   setTextTitle]   = useState('')
  const [textContent, setTextContent] = useState('')
  const [textLoading, setTextLoading] = useState(false)
  const [textMsg,     setTextMsg]     = useState<{ ok: boolean; text: string } | null>(null)

  // Preview
  const [previewDoc,    setPreviewDoc]    = useState<KBDocument | null>(null)
  const [previewChunks, setPreviewChunks] = useState<PreviewChunk[]>([])
  const [previewLoading,setPreviewLoading]= useState(false)

  // Search test
  const [searchQuery,   setSearchQuery]   = useState('')
  const [searchResults, setSearchResults] = useState<SearchResult[] | null>(null)
  const [searchLoading, setSearchLoading] = useState(false)
  const [noResults,     setNoResults]     = useState(false)

  // ── Data ────────────────────────────────────────────────────────────────────

  const loadDocuments = useCallback(async () => {
    try {
      const res = await fetch('/api-proxy/knowledge', { headers: getHeaders() })
      if (res.ok) {
        const data = await res.json()
        setDocuments(data.documents ?? [])
      }
    } catch {}
  }, [])

  useEffect(() => {
    loadDocuments().finally(() => setLoading(false))
  }, [loadDocuments])

  // ── Upload ──────────────────────────────────────────────────────────────────

  function onDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files?.[0]
    if (file) { setUploadFile(file); setUploadTitle(file.name.replace(/\.[^.]+$/, '')) }
  }

  async function handleUpload() {
    if (!uploadFile || uploading) return
    setUploading(true)
    setUploadMsg(null)
    try {
      const form = new FormData()
      form.append('file', uploadFile)
      form.append('title', uploadTitle || uploadFile.name)

      const res = await fetch('/api-proxy/knowledge/upload', {
        method:  'POST',
        headers: getHeaders(),
        body:    form,
      })
      const data = await res.json()
      if (res.ok) {
        setUploadMsg({ ok: true,  text: data.message ?? `Ingested into ${data.chunks} chunk(s)` })
        setUploadFile(null)
        setUploadTitle('')
        await loadDocuments()
      } else {
        setUploadMsg({ ok: false, text: data.error ?? 'Upload failed' })
      }
    } catch (err: any) {
      setUploadMsg({ ok: false, text: err.message ?? 'Upload failed' })
    } finally {
      setUploading(false)
    }
  }

  // ── URL ingest ──────────────────────────────────────────────────────────────

  async function handleUrlIngest() {
    if (!urlInput.trim() || urlLoading) return
    setUrlLoading(true)
    setUrlMsg(null)
    try {
      const res = await fetch('/api-proxy/knowledge/url', {
        method:  'POST',
        headers: getHeaders({ 'Content-Type': 'application/json' }),
        body:    JSON.stringify({ url: urlInput.trim() }),
      })
      const data = await res.json()
      if (res.ok) {
        setUrlMsg({ ok: true,  text: data.message ?? `Ingested into ${data.chunks} chunk(s)` })
        setUrlInput('')
        await loadDocuments()
      } else {
        setUrlMsg({ ok: false, text: data.error ?? 'URL ingest failed' })
      }
    } catch (err: any) {
      setUrlMsg({ ok: false, text: err.message ?? 'URL ingest failed' })
    } finally {
      setUrlLoading(false)
    }
  }

  // ── Text ingest ─────────────────────────────────────────────────────────────

  async function handleTextIngest() {
    if (!textTitle.trim() || !textContent.trim() || textLoading) return
    setTextLoading(true)
    setTextMsg(null)
    try {
      const res = await fetch('/api-proxy/knowledge/text', {
        method:  'POST',
        headers: getHeaders({ 'Content-Type': 'application/json' }),
        body:    JSON.stringify({ title: textTitle.trim(), content: textContent.trim() }),
      })
      const data = await res.json()
      if (res.ok) {
        setTextMsg({ ok: true,  text: `Ingested into ${data.chunks} chunk(s)` })
        setTextTitle('')
        setTextContent('')
        await loadDocuments()
      } else {
        setTextMsg({ ok: false, text: data.error ?? 'Failed to add text' })
      }
    } catch (err: any) {
      setTextMsg({ ok: false, text: err.message ?? 'Failed to add text' })
    } finally {
      setTextLoading(false)
    }
  }

  // ── Delete ──────────────────────────────────────────────────────────────────

  async function handleDelete(id: string, title: string) {
    if (!confirm(`Delete "${title}" and all its chunks?`)) return
    await fetch(`/api-proxy/knowledge/${id}`, { method: 'DELETE', headers: getHeaders() })
    await loadDocuments()
  }

  // ── Preview ─────────────────────────────────────────────────────────────────

  async function handlePreview(doc: KBDocument) {
    setPreviewDoc(doc)
    setPreviewChunks([])
    setPreviewLoading(true)
    try {
      const res = await fetch(`/api-proxy/knowledge/${doc.id}/preview`, { headers: getHeaders() })
      if (res.ok) {
        const data = await res.json()
        setPreviewChunks(data.chunks ?? [])
      }
    } finally {
      setPreviewLoading(false)
    }
  }

  // ── Search test ─────────────────────────────────────────────────────────────

  async function handleSearch() {
    if (!searchQuery.trim() || searchLoading) return
    setSearchLoading(true)
    setSearchResults(null)
    setNoResults(false)
    try {
      const res = await fetch('/api-proxy/knowledge/search', {
        method:  'POST',
        headers: getHeaders({ 'Content-Type': 'application/json' }),
        body:    JSON.stringify({ query: searchQuery.trim(), top_k: 5 }),
      })
      if (res.ok) {
        const data = await res.json()
        setSearchResults(data.results ?? [])
        setNoResults(!data.found)
      }
    } finally {
      setSearchLoading(false)
    }
  }

  // ── Derived ─────────────────────────────────────────────────────────────────

  const filtered = documents.filter(d =>
    !search || d.title.toLowerCase().includes(search.toLowerCase()) || d.type.toLowerCase().includes(search.toLowerCase())
  )

  const totalTokens = documents.reduce((s, d) => s + d.tokenCount, 0)
  const totalChunks = documents.reduce((s, d) => s + d.chunkCount, 0)

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">

      {/* ── Stats + Header ───────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-wrap gap-3">
          {[
            { label: 'Documents', value: documents.length, icon: FileText,  color: 'blue'   },
            { label: 'Chunks',    value: totalChunks,      icon: Database,  color: 'purple' },
            { label: 'Tokens',    value: fmt(totalTokens), icon: AlignLeft, color: 'teal'   },
          ].map(s => (
            <div key={s.label} className="flex items-center gap-2.5 px-4 py-2.5 rounded-xl bg-white dark:bg-white/5 border border-gray-100 dark:border-white/10 shadow-sm">
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center bg-${s.color}-50 dark:bg-${s.color}-500/10`}>
                <s.icon size={15} className={`text-${s.color}-500`} />
              </div>
              <div>
                <p className="text-xs font-bold text-gray-900 dark:text-white">{s.value}</p>
                <p className="text-[10px] text-gray-400">{s.label}</p>
              </div>
            </div>
          ))}
        </div>

        <button
          onClick={() => { setShowAdd(true); setAddTab('file') }}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold transition-colors shadow-sm"
        >
          <Plus size={14} /> Add Content
        </button>
      </div>

      {/* ── Document list ─────────────────────────────────────────────────────── */}
      <div className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/10 shadow-sm overflow-hidden">

        {/* Table header / search */}
        <div className="px-5 py-3.5 border-b border-gray-100 dark:border-white/10 flex items-center gap-3">
          <div className="relative flex-1 max-w-xs">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Filter documents…"
              className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 text-gray-900 dark:text-white placeholder:text-gray-400 outline-none focus:ring-2 focus:ring-blue-500/30 transition-shadow"
            />
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 size={20} className="animate-spin text-gray-300 dark:text-gray-600" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
            <Database size={32} className="text-gray-200 dark:text-gray-700 mb-3" />
            <p className="text-sm font-medium text-gray-400 dark:text-gray-500">
              {search ? 'No documents match your filter' : 'Knowledge base is empty'}
            </p>
            {!search && (
              <p className="text-xs text-gray-300 dark:text-gray-600 mt-1">
                Upload files, paste URLs, or add text to train Sarah
              </p>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-gray-50 dark:border-white/5 text-left">
                  {['Title', 'Type', 'Chunks', 'Tokens', 'Embedding', 'Added', ''].map(h => (
                    <th key={h} className="px-5 py-2.5 text-[10px] font-semibold text-gray-400 uppercase tracking-wide whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((doc, i) => (
                  <tr
                    key={doc.id}
                    className={`border-b border-gray-50 dark:border-white/5 last:border-0 hover:bg-gray-50 dark:hover:bg-white/3 transition-colors ${
                      i % 2 === 0 ? '' : 'bg-gray-50/30 dark:bg-white/2'
                    }`}
                  >
                    <td className="px-5 py-3 max-w-[200px]">
                      <p className="font-medium text-gray-900 dark:text-white truncate" title={doc.title}>
                        {doc.title}
                      </p>
                      {doc.sourceUrl && (
                        <p className="text-[10px] text-gray-400 truncate mt-0.5" title={doc.sourceUrl}>
                          {doc.sourceUrl}
                        </p>
                      )}
                    </td>
                    <td className="px-5 py-3">{typeBadge(doc.type)}</td>
                    <td className="px-5 py-3 text-gray-500 dark:text-gray-400">{doc.chunkCount}</td>
                    <td className="px-5 py-3 text-gray-500 dark:text-gray-400">{fmt(doc.tokenCount)}</td>
                    <td className="px-5 py-3">
                      {doc.hasEmbedding
                        ? <span className="flex items-center gap-1 text-green-600 dark:text-green-400"><CheckCircle size={12} /> Ready</span>
                        : <span className="flex items-center gap-1 text-gray-400"><XCircle size={12} /> Pending</span>
                      }
                    </td>
                    <td className="px-5 py-3 text-gray-400 whitespace-nowrap">{timeStr(doc.createdAt)}</td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => handlePreview(doc)}
                          className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-500/10 transition-colors"
                          title="Preview chunks"
                        >
                          <Eye size={13} />
                        </button>
                        <button
                          onClick={() => handleDelete(doc.id, doc.title)}
                          className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors"
                          title="Delete document"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Search test ──────────────────────────────────────────────────────── */}
      <div className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/10 shadow-sm p-5">
        <h3 className="text-sm font-bold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
          <Search size={15} className="text-blue-500" /> Test Knowledge Search
        </h3>
        <p className="text-xs text-gray-400 mb-3">
          Simulate what Sarah retrieves when a patient asks a question.
        </p>
        <div className="flex gap-2">
          <input
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSearch()}
            placeholder="e.g. How much does a root canal cost?"
            className="flex-1 text-xs px-3 py-2 rounded-xl bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 text-gray-900 dark:text-white placeholder:text-gray-400 outline-none focus:ring-2 focus:ring-blue-500/30 transition-shadow"
          />
          <button
            onClick={handleSearch}
            disabled={!searchQuery.trim() || searchLoading}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white text-xs font-semibold transition-colors"
          >
            {searchLoading ? <Loader2 size={13} className="animate-spin" /> : <Search size={13} />}
            Search
          </button>
        </div>

        {noResults && (
          <p className="text-xs text-amber-600 dark:text-amber-400 mt-3 flex items-center gap-1.5">
            <XCircle size={13} /> No results above confidence threshold — Sarah would escalate this question.
          </p>
        )}

        {searchResults && searchResults.length > 0 && (
          <div className="mt-4 space-y-2.5">
            {searchResults.map((r, i) => (
              <div key={r.id} className="rounded-xl border border-gray-100 dark:border-white/10 bg-gray-50 dark:bg-white/3 p-3">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[10px] font-semibold text-blue-600 dark:text-blue-400">#{i + 1} — {r.title}</span>
                  <span className="text-[10px] text-gray-400">{Math.round((r.similarity ?? r.score ?? 0) * 100)}% match</span>
                </div>
                <p className="text-[11px] text-gray-600 dark:text-gray-300 leading-relaxed line-clamp-4">
                  {r.rawText}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Add Content modal ────────────────────────────────────────────────── */}
      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowAdd(false)} />
          <div className="relative w-full max-w-lg bg-white dark:bg-[#0a1240] rounded-2xl shadow-2xl border border-gray-100 dark:border-white/10 overflow-hidden">

            {/* Modal header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-white/10">
              <h3 className="text-sm font-bold text-gray-900 dark:text-white">Add to Knowledge Base</h3>
              <button
                onClick={() => setShowAdd(false)}
                className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-white/10 transition-colors"
              >
                <X size={15} className="text-gray-500" />
              </button>
            </div>

            {/* Tabs */}
            <div className="flex border-b border-gray-100 dark:border-white/10 px-5">
              {([
                { key: 'file', label: 'Upload File', icon: Upload    },
                { key: 'url',  label: 'Add URL',     icon: Globe     },
                { key: 'text', label: 'Add Text',    icon: AlignLeft },
              ] as const).map(tab => (
                <button
                  key={tab.key}
                  onClick={() => setAddTab(tab.key)}
                  className={`flex items-center gap-1.5 px-4 py-3 text-xs font-semibold border-b-2 transition-colors ${
                    addTab === tab.key
                      ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                      : 'border-transparent text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'
                  }`}
                >
                  <tab.icon size={13} /> {tab.label}
                </button>
              ))}
            </div>

            <div className="p-5">

              {/* ── File Upload tab ────────────────────────────────────────── */}
              {addTab === 'file' && (
                <div className="space-y-3">
                  <div
                    onDragOver={e => { e.preventDefault(); setDragOver(true) }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={onDrop}
                    onClick={() => fileInputRef.current?.click()}
                    className={`relative border-2 border-dashed rounded-xl p-8 flex flex-col items-center justify-center cursor-pointer transition-colors ${
                      dragOver
                        ? 'border-blue-400 bg-blue-50 dark:bg-blue-500/10'
                        : 'border-gray-200 dark:border-white/10 hover:border-gray-300 dark:hover:border-white/20'
                    }`}
                  >
                    <Upload size={24} className={`mb-2 ${dragOver ? 'text-blue-500' : 'text-gray-300 dark:text-gray-600'}`} />
                    {uploadFile ? (
                      <p className="text-xs font-semibold text-gray-700 dark:text-gray-200">{uploadFile.name}</p>
                    ) : (
                      <>
                        <p className="text-xs font-semibold text-gray-500 dark:text-gray-400">Drop a file or click to browse</p>
                        <p className="text-[10px] text-gray-400 mt-0.5">PDF, images, audio, video, TXT — up to 50 MB</p>
                      </>
                    )}
                    <input
                      ref={fileInputRef}
                      type="file"
                      className="hidden"
                      accept=".pdf,.png,.jpg,.jpeg,.webp,.mp3,.wav,.m4a,.ogg,.mp4,.txt,.md"
                      onChange={e => {
                        const f = e.target.files?.[0]
                        if (f) { setUploadFile(f); setUploadTitle(f.name.replace(/\.[^.]+$/, '')) }
                      }}
                    />
                  </div>

                  {uploadFile && (
                    <input
                      value={uploadTitle}
                      onChange={e => setUploadTitle(e.target.value)}
                      placeholder="Document title…"
                      className="w-full text-xs px-3 py-2 rounded-xl bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 text-gray-900 dark:text-white placeholder:text-gray-400 outline-none focus:ring-2 focus:ring-blue-500/30"
                    />
                  )}

                  {uploadMsg && (
                    <Feedback ok={uploadMsg.ok} text={uploadMsg.text} />
                  )}

                  <button
                    onClick={handleUpload}
                    disabled={!uploadFile || uploading}
                    className="w-full py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white text-xs font-semibold transition-colors flex items-center justify-center gap-2"
                  >
                    {uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                    {uploading ? 'Uploading…' : 'Upload & Ingest'}
                  </button>
                </div>
              )}

              {/* ── URL tab ────────────────────────────────────────────────── */}
              {addTab === 'url' && (
                <div className="space-y-3">
                  <p className="text-xs text-gray-400">
                    Sarah will crawl the page, extract all text, and add it to the knowledge base.
                  </p>
                  <input
                    value={urlInput}
                    onChange={e => setUrlInput(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleUrlIngest()}
                    placeholder="https://codeclinic.ug/services"
                    className="w-full text-xs px-3 py-2.5 rounded-xl bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 text-gray-900 dark:text-white placeholder:text-gray-400 outline-none focus:ring-2 focus:ring-blue-500/30"
                  />

                  {urlMsg && <Feedback ok={urlMsg.ok} text={urlMsg.text} />}

                  <button
                    onClick={handleUrlIngest}
                    disabled={!urlInput.trim() || urlLoading}
                    className="w-full py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white text-xs font-semibold transition-colors flex items-center justify-center gap-2"
                  >
                    {urlLoading ? <Loader2 size={14} className="animate-spin" /> : <Globe size={14} />}
                    {urlLoading ? 'Crawling…' : 'Crawl & Ingest'}
                  </button>
                </div>
              )}

              {/* ── Text tab ───────────────────────────────────────────────── */}
              {addTab === 'text' && (
                <div className="space-y-3">
                  <input
                    value={textTitle}
                    onChange={e => setTextTitle(e.target.value)}
                    placeholder="Title (e.g. Price List, Opening Hours)"
                    className="w-full text-xs px-3 py-2.5 rounded-xl bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 text-gray-900 dark:text-white placeholder:text-gray-400 outline-none focus:ring-2 focus:ring-blue-500/30"
                  />
                  <textarea
                    value={textContent}
                    onChange={e => setTextContent(e.target.value)}
                    placeholder="Paste your content here — service descriptions, FAQs, clinic policies, pricing…"
                    rows={6}
                    className="w-full text-xs px-3 py-2.5 rounded-xl bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 text-gray-900 dark:text-white placeholder:text-gray-400 outline-none focus:ring-2 focus:ring-blue-500/30 resize-none"
                  />

                  {textMsg && <Feedback ok={textMsg.ok} text={textMsg.text} />}

                  <button
                    onClick={handleTextIngest}
                    disabled={!textTitle.trim() || !textContent.trim() || textLoading}
                    className="w-full py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white text-xs font-semibold transition-colors flex items-center justify-center gap-2"
                  >
                    {textLoading ? <Loader2 size={14} className="animate-spin" /> : <AlignLeft size={14} />}
                    {textLoading ? 'Adding…' : 'Add to Knowledge Base'}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Preview modal ────────────────────────────────────────────────────── */}
      {previewDoc && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setPreviewDoc(null)} />
          <div className="relative w-full max-w-2xl max-h-[80vh] flex flex-col bg-white dark:bg-[#0a1240] rounded-2xl shadow-2xl border border-gray-100 dark:border-white/10 overflow-hidden">

            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-white/10 flex-shrink-0">
              <div>
                <h3 className="text-sm font-bold text-gray-900 dark:text-white">{previewDoc.title}</h3>
                <p className="text-[10px] text-gray-400 mt-0.5">{previewDoc.chunkCount} chunk(s) · {fmt(previewDoc.tokenCount)} tokens</p>
              </div>
              <button
                onClick={() => setPreviewDoc(null)}
                className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-white/10 transition-colors"
              >
                <X size={15} className="text-gray-500" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-3">
              {previewLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 size={20} className="animate-spin text-gray-300 dark:text-gray-600" />
                </div>
              ) : previewChunks.length === 0 ? (
                <p className="text-xs text-gray-400 text-center py-8">No chunks found</p>
              ) : (
                previewChunks.map((chunk, i) => (
                  <div key={chunk.id} className="rounded-xl bg-gray-50 dark:bg-white/5 border border-gray-100 dark:border-white/10 p-3.5">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[10px] font-semibold text-blue-600 dark:text-blue-400">
                        Chunk {i + 1}{chunk.chunkIndex !== undefined ? ` (index ${chunk.chunkIndex})` : ''}
                      </span>
                      <span className="text-[10px] text-gray-400">{chunk.tokenCount} tokens</span>
                    </div>
                    <p className="text-[11px] text-gray-700 dark:text-gray-300 leading-relaxed whitespace-pre-wrap">
                      {chunk.rawText}
                    </p>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Feedback component ────────────────────────────────────────────────────────

function Feedback({ ok, text }: { ok: boolean; text: string }) {
  return (
    <div className={`flex items-start gap-2 rounded-xl px-3 py-2.5 text-xs ${
      ok
        ? 'bg-green-50 dark:bg-green-500/10 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-500/20'
        : 'bg-red-50   dark:bg-red-500/10   text-red-700   dark:text-red-400   border border-red-200   dark:border-red-500/20'
    }`}>
      {ok ? <CheckCircle size={13} className="flex-shrink-0 mt-0.5" /> : <XCircle size={13} className="flex-shrink-0 mt-0.5" />}
      {text}
    </div>
  )
}
