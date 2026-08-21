'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter, useParams } from 'next/navigation'
import {
  ArrowLeft, Plus, Trash2, GripVertical, Save, Eye, EyeOff,
  Loader2, ChevronDown, ChevronUp, Award,
} from 'lucide-react'
import { cn } from '@/lib/utils'

interface QuizOption { id: string; text: string; score: number }
interface QuizQuestion { id: string; text: string; options: QuizOption[] }
interface QuizResultTier { id: string; minScore: number; maxScore: number; title: string; message: string; cta: string; ctaLink: string }

interface Quiz {
  id: string
  title: string
  description: string | null
  isActive: boolean
  questions: QuizQuestion[]
  resultTiers: QuizResultTier[]
}

function newId() {
  return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `id-${Date.now()}-${Math.random().toString(36).slice(2)}`
}
function newOption(): QuizOption { return { id: newId(), text: '', score: 0 } }
function newQuestion(): QuizQuestion { return { id: newId(), text: '', options: [newOption(), newOption()] } }
function newTier(): QuizResultTier { return { id: newId(), minScore: 0, maxScore: 100, title: '', message: '', cta: '', ctaLink: '' } }

export default function QuizBuilderPage() {
  const API    = '/api-proxy'
  const router = useRouter()
  const params = useParams()
  const quizId = params.id as string
  const token  = typeof window !== 'undefined' ? localStorage.getItem('cc_token') : null
  const authH  = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }

  const [quiz, setQuiz]       = useState<Quiz | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving]   = useState(false)
  const [toast, setToast]     = useState<{ msg: string; ok: boolean } | null>(null)
  const [dragQ, setDragQ]     = useState<string | null>(null)
  const [dragOpt, setDragOpt] = useState<{ qId: string; oId: string } | null>(null)

  function showToast(msg: string, ok = true) {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), 3000)
  }

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`${API}/quiz-funnels/${quizId}`, { headers: authH })
      if (res.ok) {
        const d = await res.json()
        setQuiz({
          id: d.id, title: d.title, description: d.description, isActive: d.isActive,
          questions: (d.questions || []).length ? d.questions : [newQuestion()],
          resultTiers: (d.resultTiers || []).length ? d.resultTiers : [newTier()],
        })
      } else {
        showToast('Quiz not found', false)
      }
    } catch { showToast('Network error', false) }
    finally { setLoading(false) }
  }, [quizId])

  useEffect(() => { load() }, [load])

  function updateQuiz(patch: Partial<Quiz>) {
    setQuiz(q => q ? { ...q, ...patch } : q)
  }

  // ── Questions ──────────────────────────────────────────────────
  function addQuestion() {
    updateQuiz({ questions: [...(quiz?.questions || []), newQuestion()] })
  }
  function removeQuestion(qId: string) {
    if (!quiz || quiz.questions.length <= 1) { showToast('A quiz needs at least one question', false); return }
    updateQuiz({ questions: quiz.questions.filter(q => q.id !== qId) })
  }
  function updateQuestion(qId: string, text: string) {
    updateQuiz({ questions: quiz!.questions.map(q => q.id === qId ? { ...q, text } : q) })
  }
  function addOption(qId: string) {
    updateQuiz({ questions: quiz!.questions.map(q => q.id === qId ? { ...q, options: [...q.options, newOption()] } : q) })
  }
  function removeOption(qId: string, oId: string) {
    const q = quiz!.questions.find(x => x.id === qId)!
    if (q.options.length <= 2) { showToast('A question needs at least two options', false); return }
    updateQuiz({ questions: quiz!.questions.map(x => x.id === qId ? { ...x, options: x.options.filter(o => o.id !== oId) } : x) })
  }
  function updateOption(qId: string, oId: string, patch: Partial<QuizOption>) {
    updateQuiz({
      questions: quiz!.questions.map(q => q.id === qId
        ? { ...q, options: q.options.map(o => o.id === oId ? { ...o, ...patch } : o) }
        : q),
    })
  }

  // Native HTML5 drag-and-drop for reordering questions (same pattern as Treatment Pipeline)
  function onQDragStart(e: React.DragEvent, qId: string) { setDragQ(qId); e.dataTransfer.effectAllowed = 'move' }
  function onQDragOver(e: React.DragEvent) { e.preventDefault(); e.dataTransfer.dropEffect = 'move' }
  function onQDrop(e: React.DragEvent, targetId: string) {
    e.preventDefault()
    if (!dragQ || dragQ === targetId || !quiz) { setDragQ(null); return }
    const list = [...quiz.questions]
    const fromIdx = list.findIndex(q => q.id === dragQ)
    const toIdx   = list.findIndex(q => q.id === targetId)
    const [moved] = list.splice(fromIdx, 1)
    list.splice(toIdx, 0, moved)
    updateQuiz({ questions: list })
    setDragQ(null)
  }

  function onOptDragStart(e: React.DragEvent, qId: string, oId: string) { setDragOpt({ qId, oId }); e.dataTransfer.effectAllowed = 'move' }
  function onOptDrop(e: React.DragEvent, qId: string, targetOId: string) {
    e.preventDefault()
    if (!dragOpt || dragOpt.qId !== qId || dragOpt.oId === targetOId || !quiz) { setDragOpt(null); return }
    const q = quiz.questions.find(x => x.id === qId)!
    const list = [...q.options]
    const fromIdx = list.findIndex(o => o.id === dragOpt.oId)
    const toIdx   = list.findIndex(o => o.id === targetOId)
    const [moved] = list.splice(fromIdx, 1)
    list.splice(toIdx, 0, moved)
    updateQuiz({ questions: quiz.questions.map(x => x.id === qId ? { ...x, options: list } : x) })
    setDragOpt(null)
  }

  // ── Result tiers ───────────────────────────────────────────────
  function addTier() { updateQuiz({ resultTiers: [...(quiz?.resultTiers || []), newTier()] }) }
  function removeTier(tId: string) {
    if (!quiz || quiz.resultTiers.length <= 1) { showToast('A quiz needs at least one result tier', false); return }
    updateQuiz({ resultTiers: quiz.resultTiers.filter(t => t.id !== tId) })
  }
  function updateTier(tId: string, patch: Partial<QuizResultTier>) {
    updateQuiz({ resultTiers: quiz!.resultTiers.map(t => t.id === tId ? { ...t, ...patch } : t) })
  }

  // ── Save / Publish ─────────────────────────────────────────────
  async function save(publishOverride?: boolean) {
    if (!quiz) return
    if (!quiz.title.trim()) { showToast('Title is required', false); return }
    for (const q of quiz.questions) {
      if (!q.text.trim()) { showToast('Every question needs text', false); return }
      if (q.options.some(o => !o.text.trim())) { showToast('Every answer option needs text', false); return }
    }
    for (const t of quiz.resultTiers) {
      if (!t.title.trim() || !t.message.trim()) { showToast('Every result tier needs a title and message', false); return }
    }
    setSaving(true)
    try {
      const res = await fetch(`${API}/quiz-funnels/${quizId}`, {
        method: 'PUT', headers: authH,
        body: JSON.stringify({
          title: quiz.title, description: quiz.description,
          questions: quiz.questions, resultTiers: quiz.resultTiers,
          isActive: publishOverride !== undefined ? publishOverride : quiz.isActive,
        }),
      })
      if (res.ok) {
        const d = await res.json()
        updateQuiz({ isActive: d.isActive })
        showToast(publishOverride !== undefined ? (publishOverride ? 'Saved and published' : 'Saved and unpublished') : 'Saved')
      } else {
        const d = await res.json().catch(() => ({}))
        showToast(d.error || 'Failed to save', false)
      }
    } catch { showToast('Network error', false) }
    finally { setSaving(false) }
  }

  if (loading) return (
    <div className="flex items-center justify-center py-24"><Loader2 size={24} className="animate-spin text-cyan-500" /></div>
  )
  if (!quiz) return (
    <div className="text-center py-24 text-gray-400">Quiz not found.</div>
  )

  const inputCls = 'w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-white/10 rounded-xl bg-gray-50 dark:bg-white/5 dark:text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/20'

  return (
    <div className="max-w-3xl mx-auto pb-24">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => router.push('/quiz-funnels')} className="w-9 h-9 rounded-xl flex items-center justify-center hover:bg-gray-100 dark:hover:bg-white/8 text-gray-500">
          <ArrowLeft size={16} />
        </button>
        <div className="flex-1">
          <h1 className="text-xl font-black text-gray-800 dark:text-white">Edit Quiz</h1>
        </div>
        <span className={cn('text-[10px] font-black px-2.5 py-1 rounded-full uppercase tracking-wide',
          quiz.isActive ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500')}>
          {quiz.isActive ? 'Published' : 'Draft'}
        </span>
      </div>

      {/* Title / description */}
      <div className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/8 shadow-sm p-5 space-y-3 mb-5">
        <div>
          <label className="text-xs font-bold text-gray-500 dark:text-white/50 mb-1 block">Quiz Title</label>
          <input value={quiz.title} onChange={e => updateQuiz({ title: e.target.value })} className={inputCls} placeholder="e.g. Smile Health Score" />
        </div>
        <div>
          <label className="text-xs font-bold text-gray-500 dark:text-white/50 mb-1 block">Description (optional, shown to takers)</label>
          <textarea rows={2} value={quiz.description || ''} onChange={e => updateQuiz({ description: e.target.value })} className={cn(inputCls, 'resize-none')} placeholder="Answer 5 quick questions to see how healthy your smile really is." />
        </div>
      </div>

      {/* Questions */}
      <div className="mb-5">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-black text-gray-700 dark:text-white/70 uppercase tracking-wide">Questions</h2>
          <button onClick={addQuestion} className="flex items-center gap-1.5 text-xs font-bold text-cyan-600 hover:text-cyan-700"><Plus size={13} /> Add Question</button>
        </div>
        <div className="space-y-3">
          {quiz.questions.map((q, qi) => (
            <div key={q.id}
              draggable
              onDragStart={e => onQDragStart(e, q.id)}
              onDragOver={onQDragOver}
              onDrop={e => onQDrop(e, q.id)}
              className={cn('bg-white dark:bg-white/5 rounded-2xl border shadow-sm p-4',
                dragQ === q.id ? 'border-cyan-300 opacity-50' : 'border-gray-100 dark:border-white/8')}>
              <div className="flex items-start gap-2 mb-3">
                <div className="cursor-grab active:cursor-grabbing pt-2.5 text-gray-300"><GripVertical size={16} /></div>
                <span className="text-xs font-black text-gray-400 pt-2.5 flex-shrink-0">Q{qi + 1}</span>
                <input value={q.text} onChange={e => updateQuestion(q.id, e.target.value)} className={inputCls} placeholder="Question text" />
                <button onClick={() => removeQuestion(q.id)} className="p-2 text-gray-300 hover:text-red-500 flex-shrink-0"><Trash2 size={15} /></button>
              </div>
              <div className="pl-8 space-y-2">
                {q.options.map(o => (
                  <div key={o.id}
                    draggable
                    onDragStart={e => onOptDragStart(e, q.id, o.id)}
                    onDragOver={e => e.preventDefault()}
                    onDrop={e => onOptDrop(e, q.id, o.id)}
                    className={cn('flex items-center gap-2', dragOpt?.oId === o.id && 'opacity-50')}>
                    <GripVertical size={13} className="text-gray-300 cursor-grab flex-shrink-0" />
                    <input value={o.text} onChange={e => updateOption(q.id, o.id, { text: e.target.value })}
                      className={cn(inputCls, 'flex-1')} placeholder="Answer option" />
                    <input type="number" value={o.score} onChange={e => updateOption(q.id, o.id, { score: Number(e.target.value) })}
                      className="w-20 px-2 py-2.5 text-sm border border-gray-200 dark:border-white/10 rounded-xl bg-gray-50 dark:bg-white/5 dark:text-white text-center flex-shrink-0" placeholder="Score" title="Points for this answer" />
                    <button onClick={() => removeOption(q.id, o.id)} className="p-1.5 text-gray-300 hover:text-red-500 flex-shrink-0"><Trash2 size={13} /></button>
                  </div>
                ))}
                <button onClick={() => addOption(q.id)} className="flex items-center gap-1.5 text-xs font-bold text-gray-400 hover:text-cyan-600 pl-5">
                  <Plus size={12} /> Add option
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Result tiers */}
      <div className="mb-5">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-black text-gray-700 dark:text-white/70 uppercase tracking-wide">Result Tiers</h2>
          <button onClick={addTier} className="flex items-center gap-1.5 text-xs font-bold text-cyan-600 hover:text-cyan-700"><Plus size={13} /> Add Tier</button>
        </div>
        <div className="space-y-3">
          {quiz.resultTiers.map(t => (
            <div key={t.id} className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/8 shadow-sm p-4 space-y-3">
              <div className="flex items-center gap-2">
                <Award size={15} className="text-amber-500 flex-shrink-0" />
                <input value={t.title} onChange={e => updateTier(t.id, { title: e.target.value })} className={cn(inputCls, 'flex-1')} placeholder="Tier title, e.g. Needs Attention" />
                <button onClick={() => removeTier(t.id)} className="p-2 text-gray-300 hover:text-red-500 flex-shrink-0"><Trash2 size={15} /></button>
              </div>
              <div className="grid grid-cols-2 gap-3 pl-6">
                <div>
                  <label className="text-[10px] font-bold text-gray-400 mb-1 block">Min Score</label>
                  <input type="number" value={t.minScore} onChange={e => updateTier(t.id, { minScore: Number(e.target.value) })} className={inputCls} />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-gray-400 mb-1 block">Max Score</label>
                  <input type="number" value={t.maxScore} onChange={e => updateTier(t.id, { maxScore: Number(e.target.value) })} className={inputCls} />
                </div>
              </div>
              <div className="pl-6">
                <label className="text-[10px] font-bold text-gray-400 mb-1 block">Personalized Message</label>
                <textarea rows={2} value={t.message} onChange={e => updateTier(t.id, { message: e.target.value })} className={cn(inputCls, 'resize-none')} placeholder="What this result means for them..." />
              </div>
              <div className="grid grid-cols-2 gap-3 pl-6">
                <div>
                  <label className="text-[10px] font-bold text-gray-400 mb-1 block">Call to Action</label>
                  <input value={t.cta} onChange={e => updateTier(t.id, { cta: e.target.value })} className={inputCls} placeholder="Book a free consultation" />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-gray-400 mb-1 block">CTA Link (optional)</label>
                  <input value={t.ctaLink} onChange={e => updateTier(t.id, { ctaLink: e.target.value })} className={inputCls} placeholder="https://..." />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Sticky save bar */}
      <div className="fixed bottom-0 left-0 right-0 lg:left-[220px] bg-white/90 dark:bg-[#0a1f4a]/90 backdrop-blur-md border-t border-gray-100 dark:border-white/10 px-6 py-4 flex items-center justify-end gap-3 z-40">
        <button onClick={() => save()} disabled={saving}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold text-gray-600 dark:text-white/70 border border-gray-200 dark:border-white/10 disabled:opacity-50">
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save Draft
        </button>
        <button onClick={() => save(!quiz.isActive)} disabled={saving}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-black text-white transition-all hover:-translate-y-0.5 disabled:opacity-50"
          style={{ background: 'linear-gradient(135deg,#1A237E,#29ABE2)' }}>
          {quiz.isActive ? <><EyeOff size={14} /> Save &amp; Unpublish</> : <><Eye size={14} /> Save &amp; Publish</>}
        </button>
      </div>

      {toast && (
        <div className={cn('fixed bottom-24 right-6 px-5 py-3 rounded-2xl shadow-2xl text-sm font-semibold text-white z-[100]',
          toast.ok ? 'bg-emerald-600' : 'bg-red-600')}>
          {toast.msg}
        </div>
      )}
    </div>
  )
}
