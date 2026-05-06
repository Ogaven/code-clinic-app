'use client'

import { useState, useRef, useCallback } from 'react'
import { Upload, Download, FileSpreadsheet, Loader2, Check, X, AlertCircle, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ParsedRow    { [key: string]: string }
interface ImportResult { imported: number; skipped: number; errors: string[] }

const API = '/api-proxy'
function authToken() {
  return typeof window !== 'undefined' ? localStorage.getItem('cc_token') ?? '' : ''
}

const CSV_HEADERS = ['patient_name', 'phone', 'email', 'service', 'doctor', 'date (YYYY-MM-DD)', 'time (HH:MM)', 'notes']
const TARGET_COLS = ['Patient Name', 'Phone', 'Email', 'Service', 'Doctor', 'Date', 'Time', 'Notes']
const COL_KEYS    = ['patient_name', 'phone', 'email', 'service', 'doctor', 'date', 'time', 'notes']

function downloadTemplate() {
  const rows = [
    CSV_HEADERS.join(','),
    'John Doe,+256700000001,john@example.com,General Checkup,Dr. Smith,2026-06-15,09:00,First visit',
    'Jane Doe,+256700000002,,Dental Cleaning,,2026-06-16,10:30,',
  ]
  const blob = new Blob([rows.join('\n')], { type: 'text/csv' })
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'appointments_template.csv'; a.click()
}

// Parse a CSV string into header array + row array (handles simple quoted fields)
function parseCSV(text: string): { headers: string[]; rows: ParsedRow[] } {
  const lines = text.split(/\r?\n/).filter(l => l.trim())
  if (lines.length === 0) return { headers: [], rows: [] }
  const splitLine = (line: string): string[] => {
    const result: string[] = []; let cur = ''; let inQ = false
    for (let i = 0; i < line.length; i++) {
      const c = line[i]
      if (c === '"') { inQ = !inQ }
      else if (c === ',' && !inQ) { result.push(cur.trim()); cur = '' }
      else cur += c
    }
    result.push(cur.trim())
    return result
  }
  const headers = splitLine(lines[0])
  const rows: ParsedRow[] = lines.slice(1).map(l => {
    const vals = splitLine(l)
    const obj: ParsedRow = {}
    headers.forEach((h, i) => { obj[h] = vals[i] ?? '' })
    return obj
  })
  return { headers, rows }
}

export default function ImportTab() {
  const fileRef = useRef<HTMLInputElement>(null)

  const [file,       setFile]       = useState<File | null>(null)
  const [headers,    setHeaders]    = useState<string[]>([])
  const [preview,    setPreview]    = useState<ParsedRow[]>([])
  const [mapping,    setMapping]    = useState<Record<string, string>>({})
  const [isXlsx,     setIsXlsx]    = useState(false)
  const [importing,  setImporting]  = useState(false)
  const [result,     setResult]     = useState<ImportResult | null>(null)
  const [error,      setError]      = useState<string | null>(null)
  const [dragOver,   setDragOver]   = useState(false)
  const [progress,   setProgress]   = useState(0)

  const parseFile = useCallback(async (f: File) => {
    setFile(f); setResult(null); setError(null); setProgress(0)
    const ext = f.name.split('.').pop()?.toLowerCase()

    if (ext === 'xlsx' || ext === 'xls') {
      // For Excel files: no client-side preview, API will parse
      setIsXlsx(true); setHeaders([]); setPreview([])
      // Build a default mapping assuming standard column names
      const autoMap: Record<string, string> = {}
      COL_KEYS.forEach((k, i) => { autoMap[k] = CSV_HEADERS[i] })
      setMapping(autoMap)
      return
    }

    // CSV: parse for preview + column detection
    setIsXlsx(false)
    try {
      const text = await f.text()
      const { headers: hdr, rows } = parseCSV(text)
      if (hdr.length === 0) { setError('CSV appears empty or unreadable'); return }
      setHeaders(hdr)
      setPreview(rows.slice(0, 5))

      // Auto-map
      const autoMap: Record<string, string> = {}
      COL_KEYS.forEach((key, i) => {
        const target = TARGET_COLS[i].toLowerCase()
        const match  = hdr.find(h => h.toLowerCase().includes(target) || target.includes(h.toLowerCase()))
        if (match) autoMap[key] = match
      })
      setMapping(autoMap)
    } catch (e: any) {
      setError(`Failed to parse CSV: ${e.message}`); setFile(null)
    }
  }, [])

  function handleDrop(e: React.DragEvent) {
    e.preventDefault(); setDragOver(false)
    const f = e.dataTransfer.files[0]; if (f) parseFile(f)
  }
  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; if (f) parseFile(f)
    if (fileRef.current) fileRef.current.value = ''
  }

  async function runImport() {
    if (!file) return
    setImporting(true); setProgress(20); setResult(null); setError(null)

    try {
      const form = new FormData()
      form.append('file', file)

      setProgress(60)
      const r = await fetch(`${API}/scheduling/import-appointments`, {
        method:  'POST',
        headers: { Authorization: `Bearer ${authToken()}` },
        body:    form,
      })
      setProgress(100)

      if (r.ok) {
        setResult(await r.json())
      } else {
        const d = await r.json().catch(() => ({}))
        setError(d.error || 'Import failed')
      }
    } catch (e: any) {
      setError(`Import failed: ${e.message}`)
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto overflow-y-auto h-full pb-10">
      <div className="mb-6">
        <h2 className="text-lg font-black text-gray-800 dark:text-white">Import Appointments</h2>
        <p className="text-sm text-gray-400 mt-0.5">Upload a CSV or Excel file exported from SimplyBook.me, Calendly, or any booking system</p>
      </div>

      {/* Template download */}
      <div className="flex items-center gap-3 mb-6 p-4 rounded-2xl bg-blue-50 dark:bg-blue-900/15 border border-blue-100 dark:border-blue-800/30">
        <FileSpreadsheet size={18} className="text-blue-500 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-blue-700 dark:text-blue-300">Need the right format?</p>
          <p className="text-xs text-blue-500 mt-0.5">Download our template, fill it in, then upload below.</p>
        </div>
        <button onClick={downloadTemplate}
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold text-white flex-shrink-0 transition-all hover:-translate-y-0.5"
          style={{ background: 'linear-gradient(135deg,#1A237E,#29ABE2)' }}>
          <Download size={12} /> Download CSV Template
        </button>
      </div>

      {/* Drop zone */}
      <div
        onDragOver={e => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => fileRef.current?.click()}
        className={cn(
          'relative border-2 border-dashed rounded-2xl p-10 text-center cursor-pointer transition-all',
          dragOver      ? 'border-cyan-400 bg-cyan-50 dark:bg-cyan-900/15'
          : file        ? 'border-emerald-300 dark:border-emerald-700 bg-emerald-50/50 dark:bg-emerald-900/10'
          :               'border-gray-200 dark:border-white/10 hover:border-cyan-300 dark:hover:border-cyan-700 hover:bg-gray-50/50 dark:hover:bg-white/3',
        )}>
        <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={handleFileInput} />
        {file ? (
          <div className="flex flex-col items-center gap-2">
            <FileSpreadsheet size={32} className="text-emerald-500" />
            <p className="font-bold text-emerald-600 dark:text-emerald-400">{file.name}</p>
            <p className="text-xs text-gray-400">{(file.size / 1024).toFixed(1)} KB — click to choose a different file</p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2">
            <Upload size={32} className="text-gray-300 dark:text-gray-600" />
            <p className="font-bold text-gray-500 dark:text-gray-400">Drag & drop your file here</p>
            <p className="text-xs text-gray-400">or click to browse — supports .csv, .xlsx, .xls</p>
          </div>
        )}
      </div>

      {error && (
        <div className="mt-4 flex items-start gap-2 p-4 rounded-xl bg-red-50 dark:bg-red-900/15 border border-red-100 dark:border-red-800/30 text-sm text-red-600 dark:text-red-400">
          <AlertCircle size={16} className="flex-shrink-0 mt-0.5" /> {error}
        </div>
      )}

      {/* Excel notice */}
      {file && isXlsx && (
        <div className="mt-4 p-4 rounded-xl bg-amber-50 dark:bg-amber-900/15 border border-amber-100 dark:border-amber-800/30 text-xs text-amber-700 dark:text-amber-400 font-medium">
          Excel file detected — column preview not available. Make sure the first sheet uses these headers: <span className="font-black">{CSV_HEADERS.join(', ')}</span>. The file will be processed on the server.
        </div>
      )}

      {/* Column mapping (CSV only) */}
      {file && !isXlsx && headers.length > 0 && (
        <div className="mt-6">
          <h3 className="text-sm font-black text-gray-700 dark:text-gray-200 mb-1">Map Columns</h3>
          <p className="text-xs text-gray-400 mb-4">Match each required field to a column from your file</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {COL_KEYS.map((key, i) => (
              <div key={key}>
                <p className="text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">{TARGET_COLS[i]}</p>
                <div className="relative">
                  <select
                    value={mapping[key] ?? ''}
                    onChange={e => setMapping(prev => ({ ...prev, [key]: e.target.value }))}
                    className="w-full appearance-none pl-3 pr-7 py-2 text-xs border border-gray-200 dark:border-white/10 rounded-lg bg-white dark:bg-white/5 text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-cyan-500/20 transition-all">
                    <option value="">— skip —</option>
                    {headers.map(h => <option key={h} value={h}>{h}</option>)}
                  </select>
                  <ChevronDown size={11} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Preview (CSV only) */}
      {preview.length > 0 && (
        <div className="mt-6">
          <h3 className="text-sm font-black text-gray-700 dark:text-gray-200 mb-3">Preview (first {preview.length} rows)</h3>
          <div className="overflow-x-auto rounded-xl border border-gray-100 dark:border-white/8">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 dark:bg-black/20">
                <tr>
                  {headers.map(h => <th key={h} className="text-left text-[10px] font-black uppercase tracking-wide text-gray-400 px-3 py-2 border-b border-gray-100 dark:border-white/8">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {preview.map((row, i) => (
                  <tr key={i} className={cn('border-b border-gray-50 dark:border-white/5', i % 2 === 1 && 'bg-gray-50/30 dark:bg-white/[0.01]')}>
                    {headers.map(h => <td key={h} className="px-3 py-2 text-gray-600 dark:text-gray-300 max-w-[140px] truncate">{row[h]}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Import button + progress */}
      {file && (
        <div className="mt-6 space-y-3">
          {importing && (
            <div className="w-full bg-gray-100 dark:bg-white/10 rounded-full h-2 overflow-hidden">
              <div className="h-full rounded-full bg-gradient-to-r from-[#1A237E] to-[#29ABE2] transition-all duration-500" style={{ width: `${progress}%` }} />
            </div>
          )}
          <button onClick={runImport} disabled={importing}
            className="flex items-center gap-2 px-6 py-3 rounded-xl font-bold text-white text-sm disabled:opacity-60 transition-all hover:-translate-y-0.5 hover:shadow-lg"
            style={{ background: 'linear-gradient(135deg,#1A237E,#29ABE2)', boxShadow: '0 4px 14px rgba(41,171,226,0.3)' }}>
            {importing ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
            {importing ? 'Importing…' : 'Import appointments'}
          </button>
        </div>
      )}

      {/* Result */}
      {result && (
        <div className="mt-5 p-5 rounded-2xl border border-gray-100 dark:border-white/8 bg-white dark:bg-white/5">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-8 h-8 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
              <Check size={16} className="text-emerald-500" />
            </div>
            <p className="font-black text-gray-800 dark:text-white">Import complete</p>
          </div>
          <div className="flex gap-6 mb-3">
            <div className="text-center">
              <p className="text-2xl font-black text-emerald-600 dark:text-emerald-400">{result.imported}</p>
              <p className="text-xs text-gray-400">Imported</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-black text-amber-500">{result.skipped}</p>
              <p className="text-xs text-gray-400">Skipped</p>
            </div>
          </div>
          {result.errors.length > 0 && (
            <div className="space-y-1 mt-3">
              <p className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">Warnings ({result.errors.length})</p>
              {result.errors.map((e, i) => (
                <p key={i} className="text-xs text-amber-600 dark:text-amber-400 flex items-start gap-1">
                  <AlertCircle size={11} className="flex-shrink-0 mt-0.5" /> {e}
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
