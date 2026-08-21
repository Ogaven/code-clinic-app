'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { CheckCircle2, AlertCircle, Loader2, Sparkles, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

interface QuizOption { id: string; text: string }
interface QuizQuestion { id: string; text: string; options: QuizOption[] }
interface PublicQuiz { id: string; title: string; description: string | null; questions: QuizQuestion[] }

type Step = 'loading' | 'notfound' | 'intro' | 'question' | 'contact' | 'submitting' | 'result' | 'error'

export default function PublicQuizPage() {
  const params = useParams()
  const quizId = params.id as string

  const [step, setStep]           = useState<Step>('loading')
  const [quiz, setQuiz]            = useState<PublicQuiz | null>(null)
  const [qIndex, setQIndex]        = useState(0)
  const [answers, setAnswers]      = useState<{ questionId: string; optionId: string }[]>([])
  const [name, setName]            = useState('')
  const [phone, setPhone]          = useState('')
  const [email, setEmail]          = useState('')
  const [result, setResult]        = useState<{ score: number; tier: { title: string; message: string; cta: string; ctaLink: string | null } | null } | null>(null)
  const [error, setError]          = useState('')

  useEffect(() => {
    fetch(`/api-proxy/quiz-funnels/${quizId}/public`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) { setQuiz(d); setStep('intro') } else setStep('notfound') })
      .catch(() => setStep('notfound'))
  }, [quizId])

  function selectAnswer(optionId: string) {
    if (!quiz) return
    const question = quiz.questions[qIndex]
    const next = [...answers.filter(a => a.questionId !== question.id), { questionId: question.id, optionId }]
    setAnswers(next)
    if (qIndex < quiz.questions.length - 1) {
      setTimeout(() => setQIndex(qIndex + 1), 200)
    } else {
      setTimeout(() => setStep('contact'), 200)
    }
  }

  function goBack() {
    if (qIndex > 0) setQIndex(qIndex - 1)
    else setStep('intro')
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim() || !phone.trim()) { setError('Name and phone are required.'); return }
    setError('')
    setStep('submitting')
    try {
      const res = await fetch(`/api-proxy/quiz-funnels/${quizId}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers, name: name.trim(), phone: phone.trim(), email: email.trim() || undefined }),
      })
      if (res.ok) {
        const d = await res.json()
        setResult({ score: d.score, tier: d.tier })
        setStep('result')
      } else {
        const d = await res.json().catch(() => ({}))
        setError(d.error || 'Something went wrong — please try again.')
        setStep('contact')
      }
    } catch {
      setError('Network error. Please check your connection and try again.')
      setStep('contact')
    }
  }

  const wrapCls = 'min-h-screen bg-gradient-to-br from-slate-50 to-cyan-50/30 flex flex-col'
  const inputCls = 'w-full px-4 py-3 text-sm border border-gray-200 rounded-xl bg-gray-50 focus:outline-none focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-500 transition-all'

  if (step === 'loading') return (
    <div className={cn(wrapCls, 'items-center justify-center')}><Loader2 size={28} className="animate-spin text-cyan-500" /></div>
  )

  if (step === 'notfound') return (
    <div className={cn(wrapCls, 'items-center justify-center p-6 text-center')}>
      <AlertCircle size={36} className="text-gray-300 mb-4" />
      <h1 className="text-lg font-black text-gray-700 mb-1">Quiz not available</h1>
      <p className="text-sm text-gray-400">This quiz may have been unpublished or doesn't exist.</p>
    </div>
  )

  const progress = quiz ? Math.round(((qIndex + (step === 'question' ? 0.5 : 1)) / quiz.questions.length) * 100) : 0

  return (
    <div className={wrapCls}>
      {/* Header */}
      <div className="sticky top-0 z-10 bg-white/80 backdrop-blur-md border-b border-gray-100 px-4 py-3 flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ background: 'linear-gradient(135deg,#1A237E,#29ABE2)' }}>
          <Sparkles size={16} className="text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-black text-gray-800 truncate">{quiz?.title || 'Code Clinic'}</p>
          <p className="text-[10px] text-gray-400">Code Clinic Quiz</p>
        </div>
      </div>

      {(step === 'question' || step === 'contact') && quiz && (
        <div className="h-1.5 bg-gray-100">
          <div className="h-full transition-all duration-300" style={{ width: `${progress}%`, background: 'linear-gradient(90deg,#1A237E,#29ABE2)' }} />
        </div>
      )}

      <div className="flex-1 max-w-lg w-full mx-auto px-4 py-8 flex flex-col">

        {step === 'intro' && quiz && (
          <div className="flex-1 flex flex-col items-center justify-center text-center space-y-5">
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center" style={{ background: 'linear-gradient(135deg,#1A237E,#29ABE2)' }}>
              <Sparkles size={28} className="text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-black text-gray-800 mb-2">{quiz.title}</h1>
              {quiz.description && <p className="text-gray-500 max-w-sm">{quiz.description}</p>}
            </div>
            <p className="text-xs text-gray-400">{quiz.questions.length} quick question{quiz.questions.length === 1 ? '' : 's'} · takes about a minute</p>
            <button onClick={() => setStep('question')}
              className="flex items-center gap-2 px-8 py-3.5 rounded-2xl text-sm font-black text-white transition-all hover:-translate-y-0.5 hover:shadow-lg"
              style={{ background: 'linear-gradient(135deg,#1A237E,#29ABE2)' }}>
              Start Quiz <ChevronRight size={16} />
            </button>
          </div>
        )}

        {step === 'question' && quiz && (
          <div className="flex-1 flex flex-col">
            <p className="text-[11px] font-black text-cyan-600 uppercase tracking-widest mb-2">Question {qIndex + 1} of {quiz.questions.length}</p>
            <h2 className="text-xl font-black text-gray-800 mb-6">{quiz.questions[qIndex].text}</h2>
            <div className="space-y-3">
              {quiz.questions[qIndex].options.map(o => {
                const selected = answers.find(a => a.questionId === quiz.questions[qIndex].id)?.optionId === o.id
                return (
                  <button key={o.id} onClick={() => selectAnswer(o.id)}
                    className={cn('w-full text-left px-5 py-4 rounded-2xl border-2 text-sm font-semibold transition-all',
                      selected ? 'border-cyan-500 bg-cyan-50 text-cyan-800' : 'border-gray-100 bg-white text-gray-700 hover:border-cyan-200')}>
                    {o.text}
                  </button>
                )
              })}
            </div>
            {qIndex > 0 && (
              <button onClick={goBack} className="mt-6 text-xs font-bold text-gray-400 self-start">← Back</button>
            )}
          </div>
        )}

        {(step === 'contact' || step === 'submitting') && (
          <div className="flex-1 flex flex-col">
            <h2 className="text-xl font-black text-gray-800 mb-1">Almost done!</h2>
            <p className="text-sm text-gray-500 mb-6">Enter your details to see your personalized result.</p>
            <form onSubmit={submit} className="space-y-4">
              <div>
                <label className="text-xs font-bold text-gray-500 mb-1 block">Full Name *</label>
                <input required value={name} onChange={e => setName(e.target.value)} className={inputCls} placeholder="Your name" />
              </div>
              <div>
                <label className="text-xs font-bold text-gray-500 mb-1 block">Phone Number *</label>
                <input required value={phone} onChange={e => setPhone(e.target.value)} className={inputCls} placeholder="e.g. 0700 000 000" />
              </div>
              <div>
                <label className="text-xs font-bold text-gray-500 mb-1 block">Email (optional)</label>
                <input type="email" value={email} onChange={e => setEmail(e.target.value)} className={inputCls} placeholder="you@example.com" />
              </div>
              {error && (
                <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">
                  <AlertCircle size={15} /> {error}
                </div>
              )}
              <button type="submit" disabled={step === 'submitting'}
                className="w-full py-3.5 rounded-2xl text-sm font-black text-white disabled:opacity-60 transition-all hover:-translate-y-0.5 hover:shadow-lg"
                style={{ background: 'linear-gradient(135deg,#1A237E,#29ABE2)' }}>
                {step === 'submitting' ? <><Loader2 size={14} className="inline animate-spin mr-2" />Getting your results...</> : 'See My Results'}
              </button>
            </form>
          </div>
        )}

        {step === 'result' && result && (
          <div className="flex-1 flex flex-col items-center justify-center text-center space-y-5">
            <div className="w-20 h-20 rounded-full bg-emerald-100 flex items-center justify-center">
              <CheckCircle2 size={40} className="text-emerald-500" />
            </div>
            {result.tier ? (
              <>
                <div>
                  <p className="text-[11px] font-black text-cyan-600 uppercase tracking-widest mb-1">Your Result</p>
                  <h1 className="text-2xl font-black text-gray-800 mb-3">{result.tier.title}</h1>
                  <p className="text-gray-600 max-w-sm">{result.tier.message}</p>
                </div>
                {result.tier.cta && (
                  <a href={result.tier.ctaLink || '#'}
                    className="inline-flex items-center gap-2 px-8 py-3.5 rounded-2xl text-sm font-black text-white transition-all hover:-translate-y-0.5 hover:shadow-lg"
                    style={{ background: 'linear-gradient(135deg,#1A237E,#29ABE2)' }}>
                    {result.tier.cta}
                  </a>
                )}
              </>
            ) : (
              <p className="text-gray-500">Thanks for taking the quiz! Our team will be in touch soon.</p>
            )}
            <p className="text-xs text-gray-400">We've sent your result to our team — expect a message from us shortly.</p>
          </div>
        )}
      </div>
    </div>
  )
}
