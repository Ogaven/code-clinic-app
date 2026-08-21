'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, HelpCircle, Eye, EyeOff, Trash2, QrCode, Loader2, X, Download, Edit3 } from 'lucide-react'
import { cn } from '@/lib/utils'

interface QuizSummary {
  id: string
  title: string
  description: string | null
  isActive: boolean
  questionCount: number
  createdAt: string
  updatedAt: string
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

export default function QuizFunnelsPage() {
  const API   = '/api-proxy'
  const router = useRouter()
  const token = typeof window !== 'undefined' ? localStorage.getItem('cc_token') : null
  const authH = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }

  const [quizzes, setQuizzes] = useState<QuizSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [qrFor, setQrFor] = useState<{ id: string; title: string; url: string; qrDataUrl: string } | null>(null)
  const [qrLoading, setQrLoading] = useState(false)
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null)

  function showToast(msg: string, ok = true) {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), 3000)
  }

  async function load() {
    setLoading(true)
    try {
      const res = await fetch(`${API}/quiz-funnels`, { headers: authH })
      if (res.ok) setQuizzes(await res.json())
    } catch {}
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  async function createQuiz(e: React.FormEvent) {
    e.preventDefault()
    if (!newTitle.trim()) return
    setCreating(true)
    try {
      const res = await fetch(`${API}/quiz-funnels`, {
        method: 'POST', headers: authH, body: JSON.stringify({ title: newTitle.trim() }),
      })
      if (res.ok) {
        const quiz = await res.json()
        router.push(`/quiz-funnels/${quiz.id}`)
      } else {
        showToast('Failed to create quiz', false)
      }
    } catch { showToast('Network error', false) }
    finally { setCreating(false) }
  }

  async function togglePublish(quiz: QuizSummary) {
    try {
      const res = await fetch(`${API}/quiz-funnels/${quiz.id}/publish`, {
        method: 'PATCH', headers: authH, body: JSON.stringify({ isActive: !quiz.isActive }),
      })
      if (res.ok) {
        setQuizzes(prev => prev.map(q => q.id === quiz.id ? { ...q, isActive: !q.isActive } : q))
        showToast(!quiz.isActive ? 'Quiz published' : 'Quiz unpublished')
      } else {
        showToast('Failed to update', false)
      }
    } catch { showToast('Network error', false) }
  }

  async function deleteQuiz(id: string) {
    if (!confirm('Delete this quiz? This cannot be undone.')) return
    try {
      const res = await fetch(`${API}/quiz-funnels/${id}`, { method: 'DELETE', headers: authH })
      if (res.ok) { setQuizzes(prev => prev.filter(q => q.id !== id)); showToast('Quiz deleted') }
      else showToast('Failed to delete', false)
    } catch { showToast('Network error', false) }
  }

  async function showQr(quiz: QuizSummary) {
    setQrLoading(true)
    setQrFor({ id: quiz.id, title: quiz.title, url: '', qrDataUrl: '' })
    try {
      const res = await fetch(`${API}/quiz-funnels/${quiz.id}/qr`, { headers: authH })
      if (res.ok) {
        const d = await res.json()
        setQrFor({ id: quiz.id, title: quiz.title, url: d.url, qrDataUrl: d.qrDataUrl })
      } else {
        showToast('Failed to generate QR code', false)
        setQrFor(null)
      }
    } catch { showToast('Network error', false); setQrFor(null) }
    finally { setQrLoading(false) }
  }

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-black text-gray-800 dark:text-white">Quiz Funnels</h1>
          <p className="text-sm text-gray-400 dark:text-white/40 mt-0.5">Lead-generation quizzes — scan, answer, get a personalized result, become a lead.</p>
        </div>
        <button onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-black text-white transition-all hover:-translate-y-0.5"
          style={{ background: 'linear-gradient(135deg,#1A237E,#29ABE2)' }}>
          <Plus size={16} /> New Quiz
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-24">
          <Loader2 size={24} className="animate-spin text-cyan-500" />
        </div>
      ) : quizzes.length === 0 ? (
        <div className="text-center py-24 text-gray-400 dark:text-white/30">
          <HelpCircle size={40} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm font-medium">No quizzes yet — create your first one to start generating leads.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {quizzes.map(quiz => (
            <div key={quiz.id} className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/8 shadow-sm overflow-hidden flex flex-col">
              <div className="p-5 flex-1">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <h3 className="font-black text-gray-800 dark:text-white text-sm leading-snug">{quiz.title}</h3>
                  <span className={cn('flex-shrink-0 text-[10px] font-black px-2 py-1 rounded-full uppercase tracking-wide',
                    quiz.isActive ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500')}>
                    {quiz.isActive ? 'Published' : 'Draft'}
                  </span>
                </div>
                {quiz.description && <p className="text-xs text-gray-400 dark:text-white/40 mb-3 line-clamp-2">{quiz.description}</p>}
                <p className="text-xs text-gray-400 dark:text-white/40">{quiz.questionCount} question{quiz.questionCount === 1 ? '' : 's'} · Updated {fmtDate(quiz.updatedAt)}</p>
              </div>
              <div className="border-t border-gray-100 dark:border-white/8 px-3 py-2.5 flex items-center gap-1">
                <button onClick={() => router.push(`/quiz-funnels/${quiz.id}`)} title="Edit"
                  className="flex-1 flex items-center justify-center gap-1.5 px-2 py-2 rounded-xl text-xs font-bold text-gray-600 dark:text-white/60 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors">
                  <Edit3 size={13} /> Edit
                </button>
                <button onClick={() => togglePublish(quiz)} title={quiz.isActive ? 'Unpublish' : 'Publish'}
                  className="flex-1 flex items-center justify-center gap-1.5 px-2 py-2 rounded-xl text-xs font-bold text-gray-600 dark:text-white/60 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors">
                  {quiz.isActive ? <><EyeOff size={13} /> Unpublish</> : <><Eye size={13} /> Publish</>}
                </button>
                <button onClick={() => showQr(quiz)} disabled={!quiz.isActive} title={quiz.isActive ? 'QR code' : 'Publish first to get a QR code'}
                  className="flex items-center justify-center px-2.5 py-2 rounded-xl text-gray-600 dark:text-white/60 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors disabled:opacity-30">
                  <QrCode size={14} />
                </button>
                <button onClick={() => deleteQuiz(quiz.id)} title="Delete"
                  className="flex items-center justify-center px-2.5 py-2 rounded-xl text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={() => setShowCreate(false)}>
          <div className="bg-white dark:bg-[#0e2045] rounded-3xl shadow-2xl border border-gray-100 dark:border-white/10 w-full max-w-sm p-6" onClick={e => e.stopPropagation()}>
            <h2 className="text-base font-black text-gray-800 dark:text-white mb-1">New Quiz</h2>
            <p className="text-xs text-gray-400 dark:text-white/40 mb-4">Give it a name — you'll add questions and results next.</p>
            <form onSubmit={createQuiz} className="space-y-4">
              <input autoFocus value={newTitle} onChange={e => setNewTitle(e.target.value)} placeholder="e.g. Smile Health Score"
                className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-white/10 rounded-xl bg-gray-50 dark:bg-white/5 dark:text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/20" />
              <div className="flex items-center gap-3">
                <button type="button" onClick={() => setShowCreate(false)}
                  className="flex-1 px-4 py-2.5 rounded-xl border border-gray-200 dark:border-white/10 text-sm font-semibold text-gray-600 dark:text-white/70">
                  Cancel
                </button>
                <button type="submit" disabled={creating || !newTitle.trim()}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-black text-white disabled:opacity-50"
                  style={{ background: 'linear-gradient(135deg,#1A237E,#29ABE2)' }}>
                  {creating ? <Loader2 size={14} className="animate-spin" /> : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* QR modal */}
      {qrFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={() => setQrFor(null)}>
          <div className="bg-white dark:bg-[#0e2045] rounded-3xl shadow-2xl border border-gray-100 dark:border-white/10 w-full max-w-sm p-6 text-center" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-black text-gray-800 dark:text-white text-left">{qrFor.title}</h2>
              <button onClick={() => setQrFor(null)} className="w-8 h-8 rounded-xl flex items-center justify-center hover:bg-gray-100 dark:hover:bg-white/8 text-gray-400"><X size={16} /></button>
            </div>
            {qrLoading || !qrFor.qrDataUrl ? (
              <div className="w-56 h-56 mx-auto flex items-center justify-center">
                <Loader2 size={24} className="animate-spin text-cyan-500" />
              </div>
            ) : (
              <>
                <img src={qrFor.qrDataUrl} alt="Quiz QR code" className="w-56 h-56 mx-auto rounded-xl border border-gray-100 dark:border-white/10" />
                <p className="text-xs text-gray-400 dark:text-white/40 break-all mt-3">{qrFor.url}</p>
                <a href={qrFor.qrDataUrl} download={`quiz-${qrFor.id}.png`}
                  className="mt-4 inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-black text-white transition-all hover:-translate-y-0.5"
                  style={{ background: 'linear-gradient(135deg,#1A237E,#29ABE2)' }}>
                  <Download size={14} /> Download PNG
                </a>
              </>
            )}
          </div>
        </div>
      )}

      {toast && (
        <div className={cn('fixed bottom-6 right-6 px-5 py-3 rounded-2xl shadow-2xl text-sm font-semibold text-white z-[100]',
          toast.ok ? 'bg-emerald-600' : 'bg-red-600')}>
          {toast.msg}
        </div>
      )}
    </div>
  )
}
