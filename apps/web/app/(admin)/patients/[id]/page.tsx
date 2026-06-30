'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import {
  ArrowLeft, User, Calendar, FileText, Activity, DollarSign, Folder,
  Phone, Mail, MapPin, Edit, AlertTriangle, Clock, Plus, Trash2, Pencil, Mic,
  MicOff, Save, ChevronRight, X, Brain, Sparkles, Loader2, Upload,
  Eye, Download, CheckCircle, XCircle, Star, Receipt, Camera, Printer, Share2
} from 'lucide-react'
import { cn, formatUGX, formatPhone, getInitials } from '@/lib/utils'
import AvatarUpload from '@/components/ui/AvatarUpload'
import TimelineTab from '@/components/patients/TimelineTab'

// ─── Types ────────────────────────────────────────────────────────────────

type Surface = 'buccal' | 'lingual' | 'occlusal' | 'mesial' | 'distal'
type SurfaceStatus = 'Healthy' | 'Caries' | 'Planned Treatment' | 'Amalgam' | 'Composite' | 'Gold' | 'Sealant'
type ToothCondition = 'Missing' | 'Implant' | 'Root Canal' | 'Crown' | 'Fracture' | 'To be Extracted' | 'Impacted' | 'Mobile' | 'Supraerupted' | 'Bridge Abutment' | 'Pontic' | 'Denture' | 'Caries' | 'Retained Roots' | 'Erosion' | 'Abrasions' | 'Abfractions'
type PerioSite = 'db' | 'b' | 'mb' | 'dl' | 'l' | 'ml'

interface TrackedCondition { id: string; condition: ToothCondition }
interface ToothState {
  conditions: TrackedCondition[]
  surfaces: Partial<Record<Surface, SurfaceStatus>>
  notes?: string
  mobility?: number
  periodontal?: Partial<Record<PerioSite, { pocketDepth?: number; gingivalMargin?: number; bleeding?: boolean; suppuration?: boolean; plaque?: boolean }>>
  history?: { date: string; changeType: string; item: string; oldStatus?: string; newStatus: string }[]
}

type ActiveTab = 'overview' | 'appointments' | 'dental' | 'perio' | 'treatment' | 'notes' | 'billing' | 'documents' | 'activity' | 'timeline'

// ─── Constants ────────────────────────────────────────────────────────────

const statusColorMap: Record<SurfaceStatus, string> = {
  Healthy: 'fill-white', Caries: 'fill-red-400', 'Planned Treatment': 'fill-amber-400',
  Amalgam: 'fill-slate-500', Composite: 'fill-sky-300', Gold: 'fill-yellow-400', Sealant: 'fill-pink-300',
}

const quadrant1 = ['18','17','16','15','14','13','12','11']
const quadrant2 = ['21','22','23','24','25','26','27','28']
const quadrant3 = ['31','32','33','34','35','36','37','38']
const quadrant4 = ['48','47','46','45','44','43','42','41']

// Pediatric (primary) teeth — ISO 5-digit notation, 20 teeth total
const childQ1 = ['55','54','53','52','51']
const childQ2 = ['61','62','63','64','65']
const childQ3 = ['71','72','73','74','75']
const childQ4 = ['85','84','83','82','81']

const conditionTools: ToothCondition[] = [
  'Missing','Implant','Root Canal','Crown','Fracture','To be Extracted',
  'Impacted','Mobile','Supraerupted','Bridge Abutment','Pontic','Denture',
  'Retained Roots','Erosion','Abrasions','Abfractions',
]
const surfaceTools: SurfaceStatus[] = ['Healthy','Caries','Planned Treatment','Amalgam','Composite','Gold','Sealant']

const upperTeeth = ['18','17','16','15','14','13','12','11','21','22','23','24','25','26','27','28']
const lowerTeeth = ['48','47','46','45','44','43','42','41','31','32','33','34','35','36','37','38']
const buccalSites: PerioSite[] = ['db','b','mb']
const lingualSites: PerioSite[] = ['dl','l','ml']

const STATUS_FLOW: Record<string, string> = {
  'PENDING': 'Confirm',
  'CONFIRMED': 'Check In',
  'CHECKED_IN': 'In Chair',
  'IN_CHAIR': 'With Provider',
  'WITH_PROVIDER': 'Ready for Checkout',
  'READY_CHECKOUT': 'Complete',
}
const STATUS_NEXT: Record<string, string> = {
  'PENDING': 'CONFIRMED',
  'CONFIRMED': 'CHECKED_IN',
  'CHECKED_IN': 'IN_CHAIR',
  'IN_CHAIR': 'WITH_PROVIDER',
  'WITH_PROVIDER': 'READY_CHECKOUT',
  'READY_CHECKOUT': 'COMPLETED',
}
const STATUS_COLOURS: Record<string, string> = {
  PENDING: 'bg-slate-100 text-slate-700', CONFIRMED: 'bg-blue-100 text-blue-800',
  CHECKED_IN: 'bg-yellow-100 text-yellow-800', IN_CHAIR: 'bg-orange-100 text-orange-800',
  WITH_PROVIDER: 'bg-teal-100 text-teal-800', READY_CHECKOUT: 'bg-purple-100 text-purple-800',
  COMPLETED: 'bg-green-100 text-green-800', NO_SHOW: 'bg-red-100 text-red-800', CANCELLED: 'bg-slate-100 text-slate-400',
}

// ─── Tooth SVG Component ─────────────────────────────────────────────────

function ToothSVG({ toothNumber, state, isSelected, onSelect, isPatientLeft, isUpperQuadrant }: {
  toothNumber: string; state: ToothState; isSelected: boolean;
  onSelect: (n: string | null) => void; isPatientLeft: boolean; isUpperQuadrant: boolean
}) {
  const { conditions = [], surfaces = {} } = state
  const hasCondition = (c: string) => conditions.some(tc => tc.condition === c)
  const isMissing = hasCondition('Missing')
  const hasImplant = hasCondition('Implant')
  const hasRootCanal = hasCondition('Root Canal')
  const hasCrown = hasCondition('Crown')
  const hasFracture = hasCondition('Fracture')
  const toBeExtracted = hasCondition('To be Extracted')

  const getSurfaceColor = (surfaceName: 'top' | 'bottom' | 'occlusal' | 'left' | 'right') => {
    let s: Surface
    if (surfaceName === 'top') s = isUpperQuadrant ? 'buccal' : 'lingual'
    else if (surfaceName === 'bottom') s = isUpperQuadrant ? 'lingual' : 'buccal'
    else if (surfaceName === 'left') s = isPatientLeft ? 'mesial' : 'distal'
    else if (surfaceName === 'right') s = isPatientLeft ? 'distal' : 'mesial'
    else s = 'occlusal'
    return statusColorMap[surfaces[s] || 'Healthy']
  }

  return (
    <div
      className={cn(
        'w-14 h-14 flex flex-col items-center justify-center relative cursor-pointer p-0.5 rounded-lg transition-colors',
        isSelected ? 'bg-blue-200' : 'hover:bg-slate-100 dark:hover:bg-white/10'
      )}
      onClick={() => onSelect(isSelected ? null : toothNumber)}
      title={`Tooth ${toothNumber}`}
    >
      <span className="text-[10px] font-semibold text-slate-600 dark:text-slate-300">{toothNumber}</span>
      <div className="w-10 h-10 relative">
        {isMissing ? (
          <div className="w-full h-full flex items-center justify-center">
            <X size={20} className="text-slate-400" />
          </div>
        ) : (
          <svg viewBox="0 0 20 20" className="w-full h-full">
            <path d="M7,6 L13,6 L14,2 L6,2 Z" className={`transition-colors stroke-slate-400 stroke-[0.5] ${getSurfaceColor('top')}`} />
            <path d="M7,14 L13,14 L14,18 L6,18 Z" className={`transition-colors stroke-slate-400 stroke-[0.5] ${getSurfaceColor('bottom')}`} />
            <path d="M6,7 L6,13 L2,14 L2,6 Z" className={`transition-colors stroke-slate-400 stroke-[0.5] ${getSurfaceColor('left')}`} />
            <path d="M14,7 L14,13 L18,14 L18,6 Z" className={`transition-colors stroke-slate-400 stroke-[0.5] ${getSurfaceColor('right')}`} />
            <path d="M6,6 H14 V14 H6 Z" className={`transition-colors stroke-slate-400 stroke-[0.5] ${getSurfaceColor('occlusal')}`} />
          </svg>
        )}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          {hasImplant && <CheckCircle size={14} className="text-cyan-600 opacity-80" />}
          {hasRootCanal && <span className="text-xs font-bold text-blue-500 opacity-80">R</span>}
          {hasCrown && <div className="w-8 h-8 border-2 border-yellow-400 rounded opacity-80" />}
          {hasFracture && <XCircle size={12} className="text-red-600 opacity-80" />}
          {toBeExtracted && <X size={16} className="text-red-600 opacity-80 stroke-2" />}
        </div>
      </div>
    </div>
  )
}

// ─── Markdown renderer ────────────────────────────────────────────────────

function renderMarkdown(text: string) {
  return text.split('\n').map((line, i) => {
    if (line.startsWith('### ')) return <h4 key={i} className="font-bold text-slate-800 dark:text-white mt-2 mb-0.5 text-sm">{line.slice(4)}</h4>
    if (line.startsWith('## '))  return <h3 key={i} className="font-bold text-slate-800 dark:text-white mt-3 mb-1">{line.slice(3)}</h3>
    if (line.startsWith('# '))   return <h2 key={i} className="font-semibold text-slate-900 dark:text-white mt-3 mb-1 text-base">{line.slice(2)}</h2>
    if (line === '---')           return <hr key={i} className="border-slate-200 dark:border-white/10 my-2" />
    const html = line
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g,     '<em>$1</em>')
    return <p key={i} className="text-sm text-slate-700 dark:text-slate-300" dangerouslySetInnerHTML={{ __html: html || '&nbsp;' }} />
  })
}

// ─── Dental Chart Tab ─────────────────────────────────────────────────────

function DentalChartTab({ patientId, token }: { patientId: string; token: string | null }) {
  const [chart, setChart] = useState<Record<string, ToothState>>({})
  const [selectedTooth, setSelectedTooth] = useState<string | null>(null)
  const [aiSummary, setAiSummary] = useState('')
  const [isSummarizing, setIsSummarizing] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [smartEntry, setSmartEntry] = useState('')
  const [isProcessing, setIsProcessing] = useState(false)
  const [savedAiSummary, setSavedAiSummary] = useState('')
  const [services, setServices] = useState<any[]>([])
  const [chartMode, setChartMode] = useState<'adult' | 'child'>('adult')

  useEffect(() => {
    fetch(`/api-proxy/clinical/patients/${patientId}/dental-chart`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json()).then(d => {
        setChart(d.teeth || {})
        if (d.aiSummary) setSavedAiSummary(d.aiSummary)
      }).catch(() => {})
    fetch('/api-proxy/services', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json()).then(d => setServices(Array.isArray(d) ? d : [])).catch(() => {})
  }, [patientId, token])

  const getToothState = (n: string): ToothState => chart[n] || { conditions: [], surfaces: {}, history: [] }

  const updateTooth = (n: string, updates: Partial<ToothState>) => {
    setChart(prev => {
      const current = prev[n] || { conditions: [], surfaces: {}, history: [] }
      const newHistory = [...(current.history || [])]
      if (updates.conditions) {
        const oldSet = new Set(current.conditions.map(c => c.condition))
        updates.conditions.forEach(c => { if (!oldSet.has(c.condition)) newHistory.push({ date: new Date().toISOString(), changeType: 'condition', item: c.condition, newStatus: 'added' }) })
      }
      if (updates.surfaces) {
        Object.entries(updates.surfaces).forEach(([s, v]) => {
          const old = current.surfaces[s as Surface] || 'Healthy'
          if (old !== v) newHistory.push({ date: new Date().toISOString(), changeType: 'surface', item: s, oldStatus: old, newStatus: v as string })
        })
      }
      return { ...prev, [n]: { ...current, ...updates, surfaces: updates.surfaces ? { ...current.surfaces, ...updates.surfaces } : current.surfaces, conditions: updates.conditions ?? current.conditions, history: newHistory } }
    })
  }

  const handleConditionToggle = (condition: ToothCondition) => {
    if (!selectedTooth) return
    const state = getToothState(selectedTooth)
    const exists = state.conditions.some(c => c.condition === condition)
    const newConditions = exists
      ? state.conditions.filter(c => c.condition !== condition)
      : [...state.conditions, { id: `${condition}-${Date.now()}`, condition }]
    updateTooth(selectedTooth, { conditions: newConditions })
  }

  const handleSurfaceChange = (surface: Surface, status: SurfaceStatus) => {
    if (!selectedTooth) return
    const state = getToothState(selectedTooth)
    const newSurfaces = { ...state.surfaces, [surface]: status }
    const updates: Partial<ToothState> = { surfaces: newSurfaces }
    if (status === 'Caries' && !state.conditions.some(c => c.condition === 'Caries')) {
      updates.conditions = [...state.conditions, { id: `Caries-${surface}-${Date.now()}`, condition: 'Caries' }]
    }
    updateTooth(selectedTooth, updates)
  }

  const handleSave = async () => {
    setIsSaving(true)
    try {
      await fetch(`/api-proxy/clinical/patients/${patientId}/dental-chart`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ teeth: chart }),
      })
    } catch (e) { console.error(e) } finally { setIsSaving(false) }
  }

  const handleGenerateSummary = async () => {
    setIsSummarizing(true)
    try {
      const res = await fetch(`/api-proxy/clinical/patients/${patientId}/dental-chart/ai-summary`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ chartData: chart, type: 'dental' }),
      })
      const data = await res.json()
      setSavedAiSummary(data.summary || '')
      setAiSummary(data.summary || '')
    } catch (e) { console.error(e) } finally { setIsSummarizing(false) }
  }

  const handleSmartEntry = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!smartEntry.trim()) return
    setIsProcessing(true)
    try {
      const res = await fetch('/api-proxy/clinical/dental-chart/smart-entry', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ command: smartEntry, patientId }),
      })
      const data = await res.json()
      if (data.commands) {
        data.commands.forEach((cmd: any) => {
          if (cmd.type === 'surface') handleUpdateFromCommand(cmd.toothNumber, 'surface', cmd)
          else if (cmd.type === 'condition') handleUpdateFromCommand(cmd.toothNumber, 'condition', cmd)
        })
        setSmartEntry('')
      }
    } catch (e) { console.error(e) } finally { setIsProcessing(false) }
  }

  const handleUpdateFromCommand = (toothNumber: string, type: string, cmd: any) => {
    const state = chart[toothNumber] || { conditions: [], surfaces: {}, history: [] }
    if (type === 'surface') {
      updateTooth(toothNumber, { surfaces: { ...state.surfaces, [cmd.surface]: cmd.status } })
    } else if (type === 'condition') {
      const exists = state.conditions.some(c => c.condition === cmd.condition)
      if (!exists) updateTooth(toothNumber, { conditions: [...state.conditions, { id: `${cmd.condition}-${Date.now()}`, condition: cmd.condition }] })
    }
  }

  const selectedState = selectedTooth ? getToothState(selectedTooth) : null
  const activeTreatable = selectedState?.conditions.filter(c => ['Caries','Fracture','To be Extracted'].includes(c.condition)) || []

  const renderQuadrant = (teeth: string[], isPatientLeft: boolean, isUpper: boolean) => (
    <div className="flex">
      {teeth.map(n => (
        <ToothSVG key={n} toothNumber={n} state={getToothState(n)} isSelected={selectedTooth === n}
          onSelect={setSelectedTooth} isPatientLeft={isPatientLeft} isUpperQuadrant={isUpper} />
      ))}
    </div>
  )

  const q1 = chartMode === 'adult' ? quadrant1 : childQ1
  const q2 = chartMode === 'adult' ? quadrant2 : childQ2
  const q3 = chartMode === 'adult' ? quadrant3 : childQ3
  const q4 = chartMode === 'adult' ? quadrant4 : childQ4

  return (
    <div className="flex flex-col h-full">
      {/* Chart + Inspector */}
      <div className="flex flex-1 overflow-hidden">
        {/* Chart */}
        <div className="flex-1 flex flex-col items-center justify-center p-4 bg-slate-50 dark:bg-white/3 overflow-auto">
          {/* Adult / Child toggle */}
          <div className="flex items-center gap-1 mb-3 self-start bg-slate-200 dark:bg-white/10 rounded-lg p-0.5">
            {(['adult','child'] as const).map(mode => (
              <button key={mode} onClick={() => { setChartMode(mode); setSelectedTooth(null) }}
                className={cn('px-3 py-1 text-xs font-semibold rounded-md transition-colors',
                  chartMode === mode ? 'bg-white dark:bg-gray-700 text-slate-800 dark:text-white shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700')}>
                {mode === 'adult' ? 'Adult (32)' : 'Child — Primary (20)'}
              </button>
            ))}
          </div>
          <div className="flex items-center justify-center w-full">
            {renderQuadrant(q1, false, true)}
            <div className="w-px h-14 bg-slate-300 mx-1" />
            {renderQuadrant(q2, true, true)}
          </div>
          <div className="w-full border-t my-2 border-slate-300" />
          <div className="flex items-center justify-center w-full">
            {renderQuadrant(q4, false, false)}
            <div className="w-px h-14 bg-slate-300 mx-1" />
            {renderQuadrant(q3, true, false)}
          </div>
        </div>

        {/* Inspector */}
        <div className="w-72 border-l border-slate-200 dark:border-white/10 flex flex-col overflow-y-auto bg-white dark:bg-gray-900">
          {!selectedTooth ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-4 text-slate-400">
              <Eye size={40} className="mb-2 opacity-30" />
              <p className="font-medium">Select a tooth</p>
              <p className="text-sm">Click any tooth on the chart to view and edit</p>
            </div>
          ) : (
            <>
              <div className="p-4 border-b dark:border-white/10">
                <h3 className="font-bold text-slate-800 dark:text-white">Tooth #{selectedTooth}</h3>
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {/* Recommended actions */}
                {activeTreatable.length > 0 && (
                  <div>
                    <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2 flex items-center gap-1">
                      <Sparkles size={12} className="text-indigo-500" /> Recommended Actions
                    </h4>
                    {activeTreatable.map(tc => {
                      const recs = services.filter(s =>
                        tc.condition === 'Caries' ? s.name.toLowerCase().includes('fill') :
                        tc.condition === 'Fracture' ? s.name.toLowerCase().includes('crown') :
                        tc.condition === 'To be Extracted' ? s.name.toLowerCase().includes('extract') : false
                      ).slice(0, 2)
                      return (
                        <div key={tc.id} className="p-2 bg-amber-50 dark:bg-amber-900/20 rounded-md mb-2">
                          <p className="text-xs font-medium text-amber-800 dark:text-amber-300 mb-1">For: <strong>{tc.condition}</strong></p>
                          {recs.length > 0 ? recs.map(r => (
                            <div key={r.id} className="text-xs text-slate-700 dark:text-slate-300 flex items-center gap-1 py-0.5">
                              <Plus size={10} /> {r.name} — {formatUGX(r.priceUGX)}
                            </div>
                          )) : <p className="text-xs text-slate-500">No services matched</p>}
                        </div>
                      )
                    })}
                  </div>
                )}
                {/* Conditions */}
                <div>
                  <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Conditions</h4>
                  <div className="grid grid-cols-2 gap-1.5">
                    {conditionTools.map(c => (
                      <button key={c} onClick={() => handleConditionToggle(c)}
                        className={cn('px-2 py-1.5 text-xs rounded text-left transition-colors', selectedState?.conditions.some(tc => tc.condition === c) ? 'bg-blue-600 text-white' : 'bg-slate-100 dark:bg-white/10 hover:bg-slate-200 text-slate-700 dark:text-slate-300')}>
                        {c}
                      </button>
                    ))}
                  </div>
                </div>
                {/* Surfaces */}
                <div>
                  <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Surfaces</h4>
                  <div className="space-y-1.5">
                    {(['occlusal','buccal','lingual','mesial','distal'] as Surface[]).map(s => (
                      <div key={s} className="flex items-center justify-between">
                        <span className="capitalize text-xs text-slate-700 dark:text-slate-300">{s}</span>
                        <select value={selectedState?.surfaces[s] || 'Healthy'} onChange={e => handleSurfaceChange(s, e.target.value as SurfaceStatus)}
                          className="text-xs border border-slate-200 dark:border-white/10 dark:bg-gray-800 dark:text-white rounded px-1 py-0.5">
                          {surfaceTools.map(st => <option key={st} value={st}>{st}</option>)}
                        </select>
                      </div>
                    ))}
                  </div>
                </div>
                {/* Notes */}
                <div>
                  <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Notes</h4>
                  <textarea value={selectedState?.notes || ''} onChange={e => updateTooth(selectedTooth, { notes: e.target.value })}
                    placeholder="Tooth-specific notes..."
                    className="w-full text-xs border border-slate-200 dark:border-white/10 dark:bg-gray-800 dark:text-white rounded p-2 min-h-[60px] resize-none" />
                </div>
                {/* History */}
                {selectedState?.history && selectedState.history.length > 0 && (
                  <div>
                    <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">History</h4>
                    <div className="space-y-1.5 max-h-28 overflow-y-auto">
                      {[...selectedState.history].reverse().slice(0, 5).map((h, i) => (
                        <div key={i} className="border-l-2 border-slate-300 pl-2 text-xs">
                          <p className="text-slate-700 dark:text-slate-300">
                            {h.changeType === 'condition' ? `${h.item} ${h.newStatus}` : `${h.item}: ${h.oldStatus || 'Healthy'} → ${h.newStatus}`}
                          </p>
                          <p className="text-slate-400">{new Date(h.date).toLocaleDateString('en-UG')}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Bottom bar */}
      <div className="p-4 border-t dark:border-white/10 bg-white dark:bg-gray-900 space-y-3">
        {/* AI Summary */}
        <div className="bg-slate-50 dark:bg-white/5 p-3 rounded-lg">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-semibold text-slate-800 dark:text-white flex items-center gap-2">
              <Brain size={16} className="text-indigo-600" /> AI Chart Summary
            </h4>
            <button onClick={handleGenerateSummary} disabled={isSummarizing}
              className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-white bg-indigo-600 rounded hover:bg-indigo-700 disabled:bg-slate-400">
              <Sparkles size={12} /> {isSummarizing ? 'Generating...' : 'Generate'}
            </button>
          </div>
          {isSummarizing && <p className="text-sm text-slate-500 animate-pulse">Analyzing chart...</p>}
          {!isSummarizing && savedAiSummary && <div>{renderMarkdown(savedAiSummary)}</div>}
          {!isSummarizing && !savedAiSummary && <p className="text-sm text-slate-500">Click Generate for an AI summary of this chart.</p>}
        </div>
        {/* Smart Entry */}
        <form onSubmit={handleSmartEntry} className="relative">
          <input value={smartEntry} onChange={e => setSmartEntry(e.target.value)} disabled={isProcessing}
            placeholder="e.g. 'Caries on 16 occlusal', 'Missing 38 and 48', 'Crown on 25'"
            className="w-full pl-9 pr-14 py-2.5 text-sm border border-slate-200 dark:border-white/10 dark:bg-gray-800 dark:text-white rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none" />
          <Mic size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <button type="submit" disabled={isProcessing || !smartEntry.trim()}
            className="absolute right-2 top-1/2 -translate-y-1/2 px-2 py-1 text-xs bg-blue-600 text-white rounded disabled:bg-slate-300">
            {isProcessing ? '...' : 'Apply'}
          </button>
        </form>
        {/* Save */}
        <button onClick={handleSave} disabled={isSaving}
          className="w-full flex items-center justify-center gap-2 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-slate-400">
          <Save size={14} /> {isSaving ? 'Saving...' : 'Save Chart'}
        </button>
      </div>
    </div>
  )
}

// ─── Perio Chart Tab ──────────────────────────────────────────────────────

function PerioChartTab({ patientId, token }: { patientId: string; token: string | null }) {
  const [teeth, setTeeth] = useState<Record<string, ToothState>>({})
  const [aiSummary, setAiSummary] = useState('')
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isRecording, setIsRecording] = useState(false)
  const [transcript, setTranscript] = useState('')
  const recognitionRef = useRef<any>(null)

  useEffect(() => {
    fetch(`/api-proxy/clinical/patients/${patientId}/dental-chart`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json()).then(d => {
        setTeeth(d.teeth || {})
        if (d.aiPerioSummary) setAiSummary(d.aiPerioSummary)
      }).catch(() => {})
  }, [patientId, token])

  const updateMeasurement = (tooth: string, site: PerioSite, field: string, value: number | boolean) => {
    setTeeth(prev => {
      const t = prev[tooth] || { conditions: [], surfaces: {}, periodontal: {} }
      return { ...prev, [tooth]: { ...t, periodontal: { ...t.periodontal, [site]: { ...(t.periodontal?.[site] || {}), [field]: value } } } }
    })
  }

  const handleSave = async () => {
    setIsSaving(true)
    try {
      await fetch(`/api-proxy/clinical/patients/${patientId}/dental-chart`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ periodontal: teeth }),
      })
    } catch (e) { console.error(e) } finally { setIsSaving(false) }
  }

  const handleAISummary = async () => {
    setIsAnalyzing(true)
    try {
      const res = await fetch(`/api-proxy/clinical/patients/${patientId}/dental-chart/ai-summary`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ chartData: teeth, type: 'perio' }),
      })
      const data = await res.json()
      setAiSummary(data.summary || '')
    } catch (e) { console.error(e) } finally { setIsAnalyzing(false) }
  }

  const startVoiceScribe = () => {
    if (!('SpeechRecognition' in window || 'webkitSpeechRecognition' in window)) {
      alert('Voice recognition not supported on this browser'); return
    }
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    const recognition = new SR()
    recognition.continuous = false
    recognition.interimResults = false
    recognition.maxAlternatives = 1
    recognition.lang = 'en-US'
    let resultReceived = false
    recognition.onresult = (event: any) => {
      if (resultReceived) return
      resultReceived = true
      const t = event.results[0][0].transcript
      setTranscript((prev: string) => {
        const sep = prev && !prev.endsWith(' ') ? ' ' : ''
        return prev + sep + t
      })
    }
    recognition.onerror = () => setIsRecording(false)
    recognition.onend = () => setIsRecording(false)
    recognitionRef.current = recognition
    setIsRecording(true)
    recognition.start()
    setTimeout(() => { try { recognition.stop() } catch {} }, 10000)
  }

  const stopVoiceScribe = () => {
    try { recognitionRef.current?.stop() } catch {}
    setIsRecording(false)
  }

  const ppd = (tooth: string, site: PerioSite) => teeth[tooth]?.periodontal?.[site]?.pocketDepth
  const pdColor = (v?: number) => !v ? '' : v >= 6 ? 'text-red-600 font-bold' : v >= 4 ? 'text-yellow-600 font-bold' : 'text-slate-700'

  const renderToothCol = (tooth: string, isUpper: boolean) => {
    const t = teeth[tooth]
    const isMissing = t?.conditions?.some(c => ['Missing','Implant'].includes(c.condition))
    return (
      <div key={tooth} className="w-16 text-center flex-shrink-0 border-r border-slate-200 dark:border-white/10 last:border-r-0">
        {isUpper && <div className="h-5 text-[10px] font-semibold text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-white/10 flex items-center justify-center border-b border-slate-200">{tooth}</div>}
        {(['db','b','mb'] as PerioSite[]).map(site => (
          <div key={site} className="h-5 border-b border-slate-200 dark:border-white/10 flex items-center justify-center">
            {!isMissing && (
              <input type="text" value={t?.periodontal?.[site]?.pocketDepth ?? ''} readOnly={false}
                onChange={e => { const v = parseInt(e.target.value); if (!isNaN(v)) updateMeasurement(tooth, site, 'pocketDepth', v) }}
                className={cn('w-full h-full text-center bg-transparent border-none text-xs p-0 focus:ring-1 focus:ring-blue-500', pdColor(t?.periodontal?.[site]?.pocketDepth))} />
            )}
          </div>
        ))}
        <div className="h-4 flex items-center justify-center gap-0.5">
          {(['db','b','mb'] as PerioSite[]).map(site => (
            <button key={site} onClick={() => updateMeasurement(tooth, site, 'bleeding', !t?.periodontal?.[site]?.bleeding)}
              className={cn('w-2 h-2 rounded-full', t?.periodontal?.[site]?.bleeding ? 'bg-red-500' : 'bg-slate-200')} />
          ))}
        </div>
        {(['dl','l','ml'] as PerioSite[]).map(site => (
          <div key={site} className="h-5 border-b border-slate-200 dark:border-white/10 flex items-center justify-center">
            {!isMissing && (
              <input type="text" value={t?.periodontal?.[site]?.pocketDepth ?? ''}
                onChange={e => { const v = parseInt(e.target.value); if (!isNaN(v)) updateMeasurement(tooth, site, 'pocketDepth', v) }}
                className={cn('w-full h-full text-center bg-transparent border-none text-xs p-0 focus:ring-1 focus:ring-blue-500', pdColor(t?.periodontal?.[site]?.pocketDepth))} />
            )}
          </div>
        ))}
        {!isUpper && <div className="h-5 text-[10px] font-semibold text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-white/10 flex items-center justify-center border-t border-slate-200">{tooth}</div>}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex flex-wrap gap-2 items-center">
        <button onClick={isRecording ? stopVoiceScribe : startVoiceScribe}
          className={cn('flex items-center gap-2 px-3 py-2 text-sm font-medium text-white rounded-lg', isRecording ? 'bg-red-500 animate-pulse' : 'bg-blue-600')}>
          {isRecording ? '🔴 Recording... tap to stop' : '🎤 Dictate Note'}
        </button>
        {transcript && <span className="text-sm text-slate-600 dark:text-slate-300 flex-1 truncate">{transcript}</span>}
        <button onClick={handleAISummary} disabled={isAnalyzing}
          className="flex items-center gap-1 px-3 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:bg-slate-400">
          <Brain size={14} /> {isAnalyzing ? 'Analyzing...' : 'AI Analysis'}
        </button>
        <button onClick={handleSave} disabled={isSaving}
          className="flex items-center gap-1 px-3 py-2 text-sm font-medium bg-green-600 text-white rounded-lg disabled:bg-slate-400">
          <Save size={14} /> {isSaving ? 'Saving...' : 'Save'}
        </button>
      </div>
      {aiSummary && (
        <div className="bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-700 p-3 rounded-lg">{renderMarkdown(aiSummary)}</div>
      )}

      {/* Legend */}
      <div className="flex gap-4 text-xs text-slate-500">
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500 inline-block" /> Bleeding</span>
        <span className="text-red-600 font-bold">Red = PPD ≥ 6</span>
        <span className="text-yellow-600 font-bold">Yellow = PPD ≥ 4</span>
      </div>

      {/* Upper arch */}
      <div className="overflow-x-auto">
        <p className="text-center text-sm font-semibold text-slate-600 dark:text-slate-300 mb-1">Maxillary Arch (Upper)</p>
        <div className="flex border border-slate-200 dark:border-white/10 rounded-lg overflow-hidden w-fit mx-auto">
          <div className="w-14 text-[10px] text-slate-400 text-right pr-1 flex flex-col">
            <div className="h-5 flex items-center justify-end">Tooth</div>
            <div className="h-5 flex items-center justify-end">DB</div>
            <div className="h-5 flex items-center justify-end">B</div>
            <div className="h-5 flex items-center justify-end">MB</div>
            <div className="h-4 flex items-center justify-end">BOP</div>
            <div className="h-5 flex items-center justify-end">DL</div>
            <div className="h-5 flex items-center justify-end">L</div>
            <div className="h-5 flex items-center justify-end">ML</div>
          </div>
          {[...quadrant1, ...quadrant2].map(t => renderToothCol(t, true))}
        </div>
      </div>

      {/* Lower arch */}
      <div className="overflow-x-auto">
        <p className="text-center text-sm font-semibold text-slate-600 dark:text-slate-300 mb-1">Mandibular Arch (Lower)</p>
        <div className="flex border border-slate-200 dark:border-white/10 rounded-lg overflow-hidden w-fit mx-auto">
          <div className="w-14 text-[10px] text-slate-400 text-right pr-1 flex flex-col">
            <div className="h-5 flex items-center justify-end">DL</div>
            <div className="h-5 flex items-center justify-end">L</div>
            <div className="h-5 flex items-center justify-end">ML</div>
            <div className="h-4 flex items-center justify-end">BOP</div>
            <div className="h-5 flex items-center justify-end">DB</div>
            <div className="h-5 flex items-center justify-end">B</div>
            <div className="h-5 flex items-center justify-end">MB</div>
            <div className="h-5 flex items-center justify-end">Tooth</div>
          </div>
          {[...quadrant4.slice().reverse(), ...quadrant3.slice().reverse()].map(t => renderToothCol(t, false))}
        </div>
      </div>
    </div>
  )
}

// ─── Treatment Plan Tab ───────────────────────────────────────────────────

function TreatmentPlanTab({ patientId, token }: { patientId: string; token: string | null }) {
  const [plans, setPlans] = useState<any[]>([])
  const [services, setServices] = useState<any[]>([])
  const [showAdd, setShowAdd] = useState(false)
  const [appointments, setAppointments] = useState<any[]>([])
  const [form, setForm] = useState({ serviceId: '', toothNumber: '', quantity: 1, costPerUnit: 0, discount: 0, notes: '', status: 'Planned' })
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState({ serviceId: '', toothNumber: '', quantity: 1, costPerUnit: 0, discount: 0, notes: '', status: 'Planned' })

  useEffect(() => {
    fetch(`/api-proxy/clinical/patients/${patientId}/treatment-plans`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json()).then(d => setPlans(Array.isArray(d) ? d : [])).catch(() => {})
    fetch('/api-proxy/services', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json()).then(d => setServices(Array.isArray(d) ? d : [])).catch(() => {})
    fetch(`/api-proxy/patients/${patientId}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json()).then(d => setAppointments(d.appointments || [])).catch(() => {})
  }, [patientId, token])

  const handleAdd = async () => {
    const res = await fetch(`/api-proxy/clinical/patients/${patientId}/treatment-plans`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(form),
    })
    if (!res.ok) return
    const plan = await res.json()
    setPlans(p => [plan, ...p])
    setShowAdd(false)
    setForm({ serviceId: '', toothNumber: '', quantity: 1, costPerUnit: 0, discount: 0, notes: '', status: 'Planned' })
  }

  const handleStatusChange = async (planId: string, status: string) => {
    const plan = plans.find(p => p.id === planId)
    if (!plan) return
    await fetch(`/api-proxy/clinical/patients/${patientId}/treatment-plans/${planId}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ ...plan, status }),
    })
    setPlans(prev => prev.map(p => p.id === planId ? { ...p, status } : p))
  }

  const handleDelete = async (planId: string) => {
    if (!confirm('Remove this treatment?')) return
    await fetch(`/api-proxy/clinical/patients/${patientId}/treatment-plans/${planId}`, {
      method: 'DELETE', headers: { Authorization: `Bearer ${token}` },
    })
    setPlans(prev => prev.filter(p => p.id !== planId))
  }

  function handleStartEdit(p: any) {
    setEditingId(p.id)
    setEditForm({ serviceId: p.serviceId || '', toothNumber: p.toothNumber || '', quantity: p.quantity || 1, costPerUnit: p.costPerUnit || 0, discount: p.discount || 0, notes: p.notes || '', status: p.status || 'Planned' })
  }

  async function handleSaveEdit() {
    if (!editingId) return
    const res = await fetch(`/api-proxy/clinical/patients/${patientId}/treatment-plans/${editingId}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(editForm),
    })
    if (res.ok) {
      const updated = await res.json()
      setPlans(prev => prev.map(p => p.id === editingId ? updated : p))
    }
    setEditingId(null)
  }

  const statusStyles: Record<string, string> = {
    Planned: 'bg-blue-100 text-blue-800', 'In Progress': 'bg-amber-100 text-amber-800',
    Completed: 'bg-green-100 text-green-800', 'On Hold': 'bg-yellow-100 text-yellow-800', Cancelled: 'bg-red-100 text-red-800',
  }

  const totalCost = plans.filter(p => ['Planned','In Progress'].includes(p.status)).reduce((s, p) => s + (p.costPerUnit * p.quantity - p.discount), 0)

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button onClick={() => setShowAdd(true)} className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700">
          <Plus size={14} /> Add Treatment
        </button>
      </div>

      {showAdd && (
        <div className="bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-slate-600 dark:text-slate-300">Service</label>
              <select value={form.serviceId} onChange={e => {
                const svc = services.find(s => s.id === e.target.value)
                setForm(f => ({ ...f, serviceId: e.target.value, costPerUnit: svc?.priceUGX || 0 }))
              }} className="w-full mt-1 text-sm border border-slate-200 dark:border-white/10 dark:bg-gray-800 dark:text-white rounded px-2 py-1.5">
                <option value="">Select service</option>
                {services.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600 dark:text-slate-300">Tooth #</label>
              <input value={form.toothNumber} onChange={e => setForm(f => ({ ...f, toothNumber: e.target.value }))} placeholder="e.g. 16" className="w-full mt-1 text-sm border border-slate-200 dark:border-white/10 dark:bg-gray-800 dark:text-white rounded px-2 py-1.5" />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600 dark:text-slate-300">Status</label>
              <select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))} className="w-full mt-1 text-sm border border-slate-200 dark:border-white/10 dark:bg-gray-800 dark:text-white rounded px-2 py-1.5">
                {['Planned','In Progress','Completed','On Hold','Cancelled'].map(s => <option key={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600 dark:text-slate-300">Qty</label>
              <input type="number" min={1} value={form.quantity} onChange={e => setForm(f => ({ ...f, quantity: Number(e.target.value) }))} className="w-full mt-1 text-sm border border-slate-200 dark:border-white/10 dark:bg-gray-800 dark:text-white rounded px-2 py-1.5" />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600 dark:text-slate-300">Cost per unit (UGX) <span className="text-slate-400 font-normal">— optional</span></label>
              <input
                type="text" inputMode="numeric"
                value={form.costPerUnit > 0 ? form.costPerUnit.toLocaleString('en-US') : ''}
                onChange={e => {
                  const raw = e.target.value.replace(/[^0-9]/g, '')
                  setForm(f => ({ ...f, costPerUnit: raw ? parseInt(raw, 10) : 0 }))
                }}
                placeholder="0 (free / no charge)"
                className="w-full mt-1 text-sm border border-slate-200 dark:border-white/10 dark:bg-gray-800 dark:text-white rounded px-2 py-1.5" />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600 dark:text-slate-300">Discount (UGX)</label>
              <input type="number" min={0} value={form.discount} onChange={e => setForm(f => ({ ...f, discount: Number(e.target.value) }))} className="w-full mt-1 text-sm border border-slate-200 dark:border-white/10 dark:bg-gray-800 dark:text-white rounded px-2 py-1.5" />
            </div>
          </div>
          <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Notes..." className="w-full text-sm border border-slate-200 dark:border-white/10 dark:bg-gray-800 dark:text-white rounded px-2 py-1.5 min-h-[60px] resize-none" />
          <div className="flex gap-2">
            <button onClick={handleAdd} className="px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700">Save</button>
            <button onClick={() => setShowAdd(false)} className="px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-white/10 rounded-lg">Cancel</button>
          </div>
        </div>
      )}

      <div className="bg-white dark:bg-white/5 rounded-xl border border-slate-200 dark:border-white/10 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-slate-50 dark:bg-white/5 border-b border-slate-200 dark:border-white/10">
              <tr>
                {['Tooth','Treatment','Status','Qty','Unit Cost','Disc (UGX)','Total','Date',''].map(h => (
                  <th key={h} className="px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {plans.map(p => {
                const svc = services.find(s => s.id === p.serviceId)
                const total = p.costPerUnit * p.quantity - p.discount
                const isEditing = editingId === p.id
                const editTotal = editForm.costPerUnit * editForm.quantity - editForm.discount
                if (isEditing) {
                  return (
                    <tr key={p.id} className="border-b border-slate-100 dark:border-white/5 bg-blue-50/30 dark:bg-blue-900/10">
                      <td className="px-3 py-2">
                        <input value={editForm.toothNumber} onChange={e => setEditForm(f => ({ ...f, toothNumber: e.target.value }))}
                          className="w-16 text-sm border border-slate-200 dark:border-white/10 dark:bg-gray-800 dark:text-white rounded px-2 py-1" placeholder="—" />
                      </td>
                      <td className="px-3 py-2">
                        <select value={editForm.serviceId} onChange={e => {
                          const sv = services.find(s => s.id === e.target.value)
                          setEditForm(f => ({ ...f, serviceId: e.target.value, costPerUnit: sv?.priceUGX || f.costPerUnit }))
                        }} className="w-full text-sm border border-slate-200 dark:border-white/10 dark:bg-gray-800 dark:text-white rounded px-2 py-1">
                          {services.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                        </select>
                      </td>
                      <td className="px-3 py-2">
                        <select value={editForm.status} onChange={e => setEditForm(f => ({ ...f, status: e.target.value }))}
                          className={cn('text-xs px-2 py-0.5 rounded-full font-semibold border-0 cursor-pointer', statusStyles[editForm.status] || 'bg-slate-100 text-slate-700')}>
                          {['Planned','In Progress','Completed','On Hold','Cancelled'].map(s => <option key={s}>{s}</option>)}
                        </select>
                      </td>
                      <td className="px-3 py-2">
                        <input type="number" min={1} value={editForm.quantity} onChange={e => setEditForm(f => ({ ...f, quantity: Number(e.target.value) }))}
                          className="w-14 text-sm border border-slate-200 dark:border-white/10 dark:bg-gray-800 dark:text-white rounded px-2 py-1 text-center" />
                      </td>
                      <td className="px-3 py-2">
                        <input type="text" inputMode="numeric" placeholder="0"
                          value={editForm.costPerUnit > 0 ? editForm.costPerUnit.toLocaleString('en-US') : ''}
                          onChange={e => { const raw = e.target.value.replace(/[^0-9]/g, ''); setEditForm(f => ({ ...f, costPerUnit: raw ? parseInt(raw, 10) : 0 })) }}
                          className="w-24 text-sm border border-slate-200 dark:border-white/10 dark:bg-gray-800 dark:text-white rounded px-2 py-1 text-right" />
                      </td>
                      <td className="px-3 py-2">
                        <input type="number" min={0} value={editForm.discount} onChange={e => setEditForm(f => ({ ...f, discount: Number(e.target.value) }))}
                          className="w-14 text-sm border border-slate-200 dark:border-white/10 dark:bg-gray-800 dark:text-white rounded px-2 py-1 text-center" />
                      </td>
                      <td className="px-3 py-2 text-sm font-semibold text-slate-800 dark:text-white text-right">{formatUGX(editTotal)}</td>
                      <td className="px-3 py-2 text-xs text-slate-400">{new Date(p.dateAdded || p.createdAt).toLocaleDateString('en-UG')}</td>
                      <td className="px-3 py-2">
                        <div className="flex gap-1">
                          <button onClick={handleSaveEdit} className="p-1 text-emerald-500 hover:text-emerald-700"><Save size={14} /></button>
                          <button onClick={() => setEditingId(null)} className="p-1 text-slate-400 hover:text-slate-600"><X size={14} /></button>
                        </div>
                      </td>
                    </tr>
                  )
                }
                return (
                  <tr key={p.id} className="border-b border-slate-100 dark:border-white/5 hover:bg-slate-50 dark:hover:bg-white/5">
                    <td className="px-4 py-3 text-sm text-slate-600 dark:text-slate-300">{p.toothNumber || '—'}</td>
                    <td className="px-4 py-3 text-sm font-medium text-slate-800 dark:text-white">{svc?.name || 'Treatment'}</td>
                    <td className="px-4 py-3">
                      <select value={p.status} onChange={e => handleStatusChange(p.id, e.target.value)}
                        className={cn('text-xs px-2 py-0.5 rounded-full font-semibold border-0 cursor-pointer', statusStyles[p.status] || 'bg-slate-100 text-slate-700')}>
                        {['Planned','In Progress','Completed','On Hold','Cancelled'].map(s => <option key={s}>{s}</option>)}
                      </select>
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-600 dark:text-slate-300 text-center">{p.quantity}</td>
                    <td className="px-4 py-3 text-sm text-slate-600 dark:text-slate-300 text-right">{formatUGX(p.costPerUnit)}</td>
                    <td className="px-4 py-3 text-sm text-slate-600 dark:text-slate-300 text-center">{p.discount > 0 ? `UGX ${p.discount.toLocaleString()}` : '—'}</td>
                    <td className="px-4 py-3 text-sm font-semibold text-slate-800 dark:text-white text-right">{formatUGX(total)}</td>
                    <td className="px-4 py-3 text-xs text-slate-400">{new Date(p.dateAdded || p.createdAt).toLocaleDateString('en-UG')}</td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1">
                        <button onClick={() => handleStartEdit(p)} className="p-1 text-slate-400 hover:text-slate-600"><Pencil size={14} /></button>
                        <button onClick={() => handleDelete(p.id)} className="p-1 text-red-400 hover:text-red-600"><Trash2 size={14} /></button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
            {plans.length > 0 && (
              <tfoot className="bg-slate-50 dark:bg-white/5 border-t-2 border-slate-300 dark:border-white/20">
                <tr>
                  <td colSpan={6} className="px-4 py-3 text-sm font-semibold text-slate-800 dark:text-white text-right">Outstanding Cost:</td>
                  <td className="px-4 py-3 text-sm font-bold text-clinic-navy dark:text-white text-right">{formatUGX(totalCost)}</td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            )}
          </table>
          {plans.length === 0 && <p className="text-center p-8 text-sm text-slate-400">No treatment plan items yet.</p>}
        </div>
      </div>
    </div>
  )
}

// ─── Notes Tab ────────────────────────────────────────────────────────────

function NotesTab({ patientId, token }: { patientId: string; token: string | null }) {
  const [notes, setNotes] = useState<any[]>([])
  const [content, setContent] = useState('')
  const [isRecording, setIsRecording] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editContent, setEditContent] = useState('')
  const recognitionRef  = useRef<any>(null)
  const isRecordingRef  = useRef(false)
  const accumulatedRef  = useRef('')
  const user = typeof window !== 'undefined' ? JSON.parse(localStorage.getItem('cc_user') || '{}') : {}

  useEffect(() => {
    fetch(`/api-proxy/clinical/patients/${patientId}/treatment-notes`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json()).then(d => setNotes(Array.isArray(d) ? d : [])).catch(() => {})
  }, [patientId, token])

  const startRecording = () => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SR) { alert('Voice recording requires Chrome or Edge'); return }
    accumulatedRef.current = content
    isRecordingRef.current = true
    setIsRecording(true)

    function createAndStart() {
      if (!isRecordingRef.current) return
      const rec = new SR()
      rec.continuous = true; rec.interimResults = true; rec.lang = 'en-US'
      rec.onresult = (e: any) => {
        let interim = ''
        for (let i = e.resultIndex; i < e.results.length; i++) {
          if (e.results[i].isFinal) {
            accumulatedRef.current += e.results[i][0].transcript + ' '
          } else {
            interim += e.results[i][0].transcript
          }
        }
        setContent(accumulatedRef.current + interim)
      }
      rec.onerror = (e: any) => {
        if (e.error === 'no-speech' || e.error === 'aborted') return
        isRecordingRef.current = false
        setIsRecording(false)
      }
      rec.onend = () => {
        if (isRecordingRef.current) {
          setTimeout(createAndStart, 150) // fresh instance — avoids Chrome restart errors
        } else {
          setIsRecording(false)
        }
      }
      recognitionRef.current = rec
      try { rec.start() } catch {}
    }

    createAndStart()
  }

  const stopRecording = () => {
    isRecordingRef.current = false
    recognitionRef.current?.stop()
    setIsRecording(false)
  }

  const handleSave = async () => {
    if (!content.trim()) return
    setIsSaving(true)
    try {
      const res = await fetch(`/api-proxy/clinical/patients/${patientId}/treatment-notes`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ content }),
      })
      const note = await res.json()
      setNotes(prev => [{ ...note, authorId: user.id }, ...prev])
      setContent('')
    } catch (e) { console.error(e) } finally { setIsSaving(false) }
  }

  const handleDelete = async (noteId: string) => {
    if (!confirm('Delete this note?')) return
    await fetch(`/api-proxy/clinical/patients/${patientId}/treatment-notes/${noteId}`, {
      method: 'DELETE', headers: { Authorization: `Bearer ${token}` },
    })
    setNotes(prev => prev.filter(n => n.id !== noteId))
  }

  const handleEdit = async (noteId: string) => {
    await fetch(`/api-proxy/clinical/patients/${patientId}/treatment-notes/${noteId}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ content: editContent }),
    })
    setNotes(prev => prev.map(n => n.id === noteId ? { ...n, content: editContent } : n))
    setEditingId(null)
  }

  return (
    <div className="space-y-4">
      {/* Add note */}
      <div className="bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 p-4 rounded-xl">
        <h4 className="font-semibold text-slate-800 dark:text-white text-sm mb-3">New Treatment Note</h4>
        <div className="flex gap-2 mb-3">
          {isRecording ? (
            <button onClick={stopRecording} className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-white bg-red-600 rounded-lg animate-pulse">
              <MicOff size={14} /> Stop Recording
            </button>
          ) : (
            <button onClick={startRecording} className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg">
              <Mic size={14} /> Dictate Note
            </button>
          )}
        </div>
        <textarea value={content} onChange={e => setContent(e.target.value)}
          placeholder={isRecording ? 'Transcribing... Speak now.' : 'Type or dictate a clinical note...'}
          className="w-full text-sm border border-slate-200 dark:border-white/10 dark:bg-gray-800 dark:text-white rounded-lg p-3 min-h-[120px] resize-none" />
        <div className="text-right mt-2">
          <button onClick={handleSave} disabled={!content.trim() || isSaving || isRecording}
            className="px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 disabled:bg-slate-400">
            {isSaving ? 'Saving...' : 'Save Note'}
          </button>
        </div>
      </div>

      {/* Notes list */}
      <div className="space-y-3">
        {notes.length === 0 && <p className="text-center py-8 text-sm text-slate-400">No notes recorded for this patient.</p>}
        {notes.map(note => (
          <div key={note.id} className="bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl p-4 group relative">
            <div className="flex items-start justify-between mb-2">
              <div>
                <p className="text-xs font-semibold text-slate-500">{new Date(note.createdAt).toLocaleString('en-UG')}</p>
              </div>
              <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                {note.authorId === user.id && (
                  <button onClick={() => { setEditingId(note.id); setEditContent(note.content) }}
                    className="p-1 text-slate-400 hover:text-blue-600"><Edit size={13} /></button>
                )}
                <button onClick={() => handleDelete(note.id)} className="p-1 text-slate-400 hover:text-red-600"><Trash2 size={13} /></button>
              </div>
            </div>
            {editingId === note.id ? (
              <div>
                <textarea value={editContent} onChange={e => setEditContent(e.target.value)}
                  className="w-full text-sm border border-blue-300 rounded p-2 min-h-[80px] resize-none dark:bg-gray-800 dark:text-white" />
                <div className="flex gap-2 mt-2">
                  <button onClick={() => handleEdit(note.id)} className="px-3 py-1 text-xs text-white bg-blue-600 rounded">Save</button>
                  <button onClick={() => setEditingId(null)} className="px-3 py-1 text-xs text-slate-600 bg-slate-100 rounded">Cancel</button>
                </div>
              </div>
            ) : (
              <p className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap">{note.content}</p>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Appointments Tab ─────────────────────────────────────────────────────

function AppointmentsTab({ patient, token }: { patient: any; token: string | null }) {
  const [appointments, setAppointments] = useState<any[]>(patient.appointments || [])
  const [advancing, setAdvancing] = useState<string | null>(null)

  const handleAdvanceStatus = async (apptId: string, currentStatus: string) => {
    const nextStatus = STATUS_NEXT[currentStatus]
    if (!nextStatus) return
    setAdvancing(apptId)
    try {
      const res = await fetch(`/api-proxy/scheduling/appointments/${apptId}/status`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ status: nextStatus }),
      })
      if (res.ok) {
        setAppointments(prev => prev.map(a => a.id === apptId ? { ...a, status: nextStatus } : a))
      }
    } catch (e) { console.error(e) } finally { setAdvancing(null) }
  }

  const upcoming = appointments.filter(a => new Date(a.startAt) >= new Date() && a.status !== 'CANCELLED')
  const past = appointments.filter(a => new Date(a.startAt) < new Date() || a.status === 'COMPLETED')

  const AppointmentCard = ({ a }: { a: any }) => {
    const isUpcoming = new Date(a.startAt) >= new Date() && a.status !== 'CANCELLED' && a.status !== 'COMPLETED'
    const nextAction = STATUS_FLOW[a.status]
    return (
      <div className="flex items-center justify-between p-4 border border-slate-100 dark:border-white/10 rounded-xl hover:bg-slate-50 dark:hover:bg-white/5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: a.service?.colour + '20' || '#E3F2FD' }}>
            <Calendar size={16} style={{ color: a.service?.colour || '#1976D2' }} />
          </div>
          <div>
            <p className="font-medium text-sm text-slate-800 dark:text-white">{a.service?.name}</p>
            <p className="text-xs text-slate-500">Dr. {a.doctor?.user?.firstName} {a.doctor?.user?.lastName} · {new Date(a.startAt).toLocaleDateString('en-UG', { weekday: 'short', month: 'short', day: 'numeric' })} {new Date(a.startAt).toLocaleTimeString('en-UG', { hour: '2-digit', minute: '2-digit' })}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={cn('text-xs font-semibold px-2 py-0.5 rounded-full', STATUS_COLOURS[a.status] || 'bg-slate-100 text-slate-600')}>
            {a.status.replace(/_/g, ' ')}
          </span>
          {isUpcoming && nextAction && (
            <button onClick={() => handleAdvanceStatus(a.id, a.status)} disabled={advancing === a.id}
              className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:bg-slate-400">
              {advancing === a.id ? <Loader2 size={12} className="animate-spin" /> : <ChevronRight size={12} />} {nextAction}
            </button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {upcoming.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">Upcoming</h4>
          <div className="space-y-2">{upcoming.map(a => <AppointmentCard key={a.id} a={a} />)}</div>
        </div>
      )}
      {past.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">Past</h4>
          <div className="space-y-2">{past.slice(0, 10).map(a => <AppointmentCard key={a.id} a={a} />)}</div>
        </div>
      )}
      {appointments.length === 0 && <p className="text-center py-8 text-sm text-slate-400">No appointments yet.</p>}
    </div>
  )
}

// ─── Billing Tab ──────────────────────────────────────────────────────────

function BillingTab({ patient, token }: { patient: any; token: string | null }) {
  const invoices: any[] = patient.invoices || []
  const totalOwed = invoices.reduce((s: number, inv: any) => s + (inv.totalUGX - inv.paidUGX), 0)

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div className={cn('px-4 py-2 rounded-xl text-sm font-semibold', totalOwed > 0 ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700')}>
          {totalOwed > 0 ? `Outstanding: ${formatUGX(totalOwed)}` : 'No outstanding balance'}
        </div>
      </div>
      <div className="bg-white dark:bg-white/5 rounded-xl border border-slate-200 dark:border-white/10 overflow-hidden">
        <table className="w-full text-left">
          <thead className="bg-slate-50 dark:bg-white/5 border-b border-slate-200 dark:border-white/10">
            <tr>
              {['Invoice','Date','Total','Paid','Balance','Status'].map(h => (
                <th key={h} className="px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wider">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {invoices.map((inv: any) => {
              const balance = inv.totalUGX - inv.paidUGX
              return (
                <tr key={inv.id} className="border-b border-slate-100 dark:border-white/5">
                  <td className="px-4 py-3 text-sm font-medium text-blue-600">{inv.invoiceNumber}</td>
                  <td className="px-4 py-3 text-sm text-slate-600 dark:text-slate-300">{new Date(inv.createdAt).toLocaleDateString('en-UG')}</td>
                  <td className="px-4 py-3 text-sm text-slate-800 dark:text-white">{formatUGX(inv.totalUGX)}</td>
                  <td className="px-4 py-3 text-sm text-green-600">{formatUGX(inv.paidUGX)}</td>
                  <td className={cn('px-4 py-3 text-sm font-semibold', balance > 0 ? 'text-red-600' : 'text-green-600')}>{formatUGX(balance)}</td>
                  <td className="px-4 py-3">
                    <span className={cn('text-xs font-semibold px-2 py-0.5 rounded-full',
                      inv.status === 'PAID' ? 'bg-green-100 text-green-700' :
                      inv.status === 'OVERDUE' ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700')}>
                      {inv.status}
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {invoices.length === 0 && <p className="text-center p-8 text-sm text-slate-400">No billing history found.</p>}
      </div>
    </div>
  )
}

// ─── Documents Tab ────────────────────────────────────────────────────────

function DocumentsTab({ patientId, token }: { patientId: string; token: string | null }) {
  const [docs, setDocs] = useState<any[]>([])
  const [isUploading, setIsUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch(`/api-proxy/clinical/patients/${patientId}/documents`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json()).then(d => setDocs(Array.isArray(d) ? d : [])).catch(() => {})
  }, [patientId, token])

  const handleFile = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    const file = files[0]
    if (file.size > 10 * 1024 * 1024) { setError('File must be under 10MB'); return }
    setError('')
    setIsUploading(true)

    // Try R2 upload via multipart
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch(`/api-proxy/clinical/patients/${patientId}/documents`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form,
      })
      if (res.ok) {
        const doc = await res.json()
        setDocs(prev => [doc, ...prev])
        setIsUploading(false)
        return
      }
    } catch (e) {}

    // Fallback: base64
    const reader = new FileReader()
    reader.onload = async (e) => {
      try {
        const res = await fetch(`/api-proxy/clinical/patients/${patientId}/documents`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ fileUrl: e.target?.result, fileName: file.name, fileType: file.type }),
        })
        const doc = await res.json()
        setDocs(prev => [doc, ...prev])
      } catch (e) { setError('Upload failed') }
      setIsUploading(false)
    }
    reader.readAsDataURL(file)
  }

  const handleDelete = async (docId: string) => {
    if (!confirm('Delete this document?')) return
    await fetch(`/api-proxy/clinical/patients/${patientId}/documents/${docId}`, {
      method: 'DELETE', headers: { Authorization: `Bearer ${token}` },
    })
    setDocs(prev => prev.filter(d => d.id !== docId))
  }

  return (
    <div className="space-y-4">
      <label
        onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFile(e.dataTransfer.files) }}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        htmlFor="doc-upload"
        className={cn('block p-8 border-2 border-dashed rounded-xl text-center cursor-pointer transition-colors',
          dragOver ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/10' : 'border-slate-200 dark:border-white/20 hover:border-slate-300')}>
        <Upload size={32} className="mx-auto text-slate-400 mb-2" />
        <p className="text-sm text-slate-600 dark:text-slate-300">{isUploading ? 'Uploading...' : 'Drop files here or click to browse'}</p>
        <p className="text-xs text-slate-400 mt-1">JPG, PNG, BMP, GIF, WebP, PDF — max 10MB</p>
      </label>
      <input id="doc-upload" type="file" accept="image/jpeg,image/png,image/bmp,image/gif,image/webp,application/pdf" className="hidden" onChange={e => handleFile(e.target.files)} />
      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="space-y-2">
        {docs.length === 0 && <p className="text-center py-8 text-sm text-slate-400">No documents uploaded yet.</p>}
        {docs.map(doc => (
          <div key={doc.id} className="flex items-center bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl p-3 hover:shadow-sm">
            {doc.fileType.startsWith('image/') ? (
              <img src={doc.fileUrl} alt={doc.fileName} loading="lazy" width={48} height={48} className="w-12 h-12 object-cover rounded-lg flex-shrink-0" />
            ) : (
              <div className="w-12 h-12 bg-red-50 dark:bg-red-900/20 rounded-lg flex items-center justify-center flex-shrink-0">
                <FileText size={20} className="text-red-500" />
              </div>
            )}
            <div className="flex-1 ml-3 overflow-hidden">
              <a href={doc.fileUrl} target="_blank" rel="noopener noreferrer"
                className="text-sm font-medium text-blue-600 truncate block hover:underline">{doc.fileName}</a>
              <p className="text-xs text-slate-400">Uploaded by {doc.uploadedBy} · {new Date(doc.createdAt).toLocaleDateString('en-UG')}</p>
            </div>
            <button onClick={() => handleDelete(doc.id)} className="p-2 text-slate-400 hover:text-red-500 ml-2">
              <Trash2 size={15} />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Activity Tab ─────────────────────────────────────────────────────────

function ActivityTab({ patientId, token }: { patientId: string; token: string | null }) {
  const [activities, setActivities] = useState<any[]>([])

  useEffect(() => {
    fetch(`/api-proxy/clinical/patients/${patientId}/activity`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json()).then(d => setActivities(Array.isArray(d) ? d : [])).catch(() => {})
  }, [patientId, token])

  const timeAgo = (date: string) => {
    const diff = Date.now() - new Date(date).getTime()
    const mins = Math.floor(diff / 60000)
    if (mins < 60) return `${mins}m ago`
    const hrs = Math.floor(mins / 60)
    if (hrs < 24) return `${hrs}h ago`
    return `${Math.floor(hrs / 24)}d ago`
  }

  return (
    <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
      {activities.length === 0 && <p className="text-center py-8 text-sm text-slate-400">No activity recorded yet.</p>}
      {activities.map(a => (
        <div key={a.id} className="flex items-start gap-3">
          <div className="w-8 h-8 bg-slate-100 dark:bg-white/10 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
            <Clock size={14} className="text-slate-500" />
          </div>
          <div>
            <p className="text-sm text-slate-700 dark:text-slate-300">{a.action}</p>
            <p className="text-xs text-slate-400">By {a.userName} · <span title={new Date(a.createdAt).toLocaleString('en-UG')}>{timeAgo(a.createdAt)}</span></p>
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── Overview Tab ─────────────────────────────────────────────────────────

function formatDobAge(dob: string) {
  const birth = new Date(dob)
  const now   = new Date()
  const totalMonths = (now.getFullYear() - birth.getFullYear()) * 12 + (now.getMonth() - birth.getMonth()) - (now.getDate() < birth.getDate() ? 1 : 0)
  const years  = Math.floor(totalMonths / 12)
  const months = totalMonths % 12
  const agePart = totalMonths < 12 ? `${totalMonths} mo` : (years < 3 && months > 0 ? `${years} yr ${months} mo` : `${years} yrs`)
  return `${birth.toLocaleDateString('en-UG')} (${agePart})`
}

function OverviewTab({ patient, onSwitchTab }: { patient: any; onSwitchTab: (tab: ActiveTab) => void }) {
  const totalSpent = (patient.invoices || []).reduce((s: number, inv: any) => s + inv.paidUGX, 0)
  const outstanding = (patient.invoices || []).reduce((s: number, inv: any) => s + (inv.totalUGX - inv.paidUGX), 0)
  const lastVisit = patient.appointments?.slice().sort((a: any, b: any) => new Date(b.startAt).getTime() - new Date(a.startAt).getTime())[0]
  const activePlans = (patient.treatmentPlans || []).filter((p: any) => p.status === 'Planned')
  const planTotal = activePlans.reduce((s: number, p: any) => s + (p.costPerUnit * p.quantity - p.discount), 0)

  return (
    <div className="space-y-5">

      {/* Quick actions */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {[
          { label: '🦷 Dental Chart', tab: 'dental' as ActiveTab, color: 'bg-blue-50 text-blue-700 hover:bg-blue-100 border-blue-200' },
          { label: '📋 Treatment Plan', tab: 'treatment' as ActiveTab, color: 'bg-amber-50 text-amber-700 hover:bg-amber-100 border-amber-200' },
          { label: '📝 Notes', tab: 'notes' as ActiveTab, color: 'bg-slate-50 text-slate-700 hover:bg-slate-100 border-slate-200' },
          { label: '🦪 Perio Chart', tab: 'perio' as ActiveTab, color: 'bg-teal-50 text-teal-700 hover:bg-teal-100 border-teal-200' },
        ].map(({ label, tab, color }) => (
          <button key={tab} onClick={() => onSwitchTab(tab)}
            className={cn('text-xs font-semibold px-3 py-2 rounded-xl border transition-colors text-left', color)}>
            {label}
          </button>
        ))}
      </div>

      {/* Treatment plan banner */}
      {activePlans.length > 0 && (
        <div className="flex items-center justify-between p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-xl">
          <div>
            <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">
              Active Treatment Plan: {activePlans.length} item{activePlans.length !== 1 ? 's' : ''}
            </p>
            <p className="text-xs text-amber-600 dark:text-amber-400">Total: {formatUGX(planTotal)}</p>
          </div>
          <button onClick={() => onSwitchTab('treatment')}
            className="text-xs font-bold text-amber-700 hover:text-amber-900 flex items-center gap-1">
            View Plan <ChevronRight size={12} />
          </button>
        </div>
      )}
      {/* Medical alerts */}
      {patient.medicalNotesEncrypted && (
        <div className="bg-red-50 dark:bg-red-900/20 border-l-4 border-red-500 p-4 rounded-r-xl">
          <p className="flex items-center gap-2 text-sm font-semibold text-red-800 dark:text-red-300 mb-1">
            <AlertTriangle size={16} /> Medical Alerts
          </p>
          <p className="text-sm text-red-700 dark:text-red-400">{patient.medicalNotesEncrypted}</p>
        </div>
      )}
      {patient.allergies && (
        <div className="bg-red-50 dark:bg-red-900/10 border border-red-100 dark:border-red-700/20 rounded-xl px-3 py-2.5">
          <p className="text-[10px] font-black text-red-500 uppercase tracking-wider mb-0.5">Allergies</p>
          <p className="text-sm text-red-700 dark:text-red-300">{patient.allergies}</p>
        </div>
      )}
      {patient.medicalHistory && (
        <div className="bg-blue-50 dark:bg-blue-900/10 border border-blue-100 dark:border-blue-700/20 rounded-xl px-3 py-2.5">
          <p className="text-[10px] font-black text-blue-500 uppercase tracking-wider mb-1.5">Medical History</p>
          <div className="flex flex-wrap gap-1.5">
            {patient.medicalHistory.split(',').map((c: string) => c.trim()).filter(Boolean).map((cond: string) => (
              <span key={cond} className="px-2.5 py-1 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded-lg text-xs font-bold">{cond}</span>
            ))}
          </div>
        </div>
      )}

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Total Visits', value: patient.appointments?.length || 0 },
          { label: 'Last Visit', value: lastVisit ? new Date(lastVisit.startAt).toLocaleDateString('en-UG', { month: 'short', day: 'numeric' }) : '—' },
          { label: 'Total Spent', value: formatUGX(totalSpent) },
          { label: 'Balance', value: formatUGX(outstanding), red: outstanding > 0 },
        ].map(({ label, value, red }) => (
          <div key={label} className="bg-slate-50 dark:bg-white/5 border border-slate-100 dark:border-white/10 rounded-xl p-3">
            <p className="text-xs text-slate-400 mb-1">{label}</p>
            <p className={cn('text-sm font-bold', red ? 'text-red-600' : 'text-slate-800 dark:text-white')}>{value}</p>
          </div>
        ))}
      </div>

      {/* Patient details */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {[
          { label: 'Date of Birth', value: patient.dob ? formatDobAge(patient.dob) : '—' },
          { label: 'Phone', value: formatPhone(patient.phone) },
          { label: 'Email', value: patient.email || '—' },
          { label: 'Gender', value: patient.gender || '—' },
          { label: 'Residence', value: patient.address || '—' },
          { label: 'How They Found Us', value: patient.referralSource || '—' },
          { label: 'Patient Since', value: new Date(patient.createdAt).toLocaleDateString('en-UG', { year: 'numeric', month: 'long' }) },
        ].map(({ label, value }) => (
          <div key={label}>
            <p className="text-xs text-slate-400 mb-0.5">{label}</p>
            <p className="text-sm font-medium text-slate-800 dark:text-white">{value}</p>
          </div>
        ))}
      </div>

      {/* Next of Kin */}
      {(patient.nextOfKinName || patient.nextOfKinPhone) && (
        <div className="bg-blue-50 dark:bg-blue-900/10 border border-blue-100 dark:border-blue-700/30 rounded-xl p-4">
          <p className="text-xs font-bold uppercase tracking-wide text-blue-500 mb-2">Next of Kin</p>
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: 'Name',         value: patient.nextOfKinName || '—' },
              { label: 'Phone',        value: patient.nextOfKinPhone || '—' },
              { label: 'Relationship', value: patient.nextOfKinRelation || '—' },
            ].map(({ label, value }) => (
              <div key={label}>
                <p className="text-[10px] text-blue-400 mb-0.5">{label}</p>
                <p className="text-sm font-semibold text-blue-800 dark:text-blue-200">{value}</p>
              </div>
            ))}
          </div>
        </div>
      )}
      {!patient.nextOfKinName && (
        <p className="text-xs text-slate-400 italic">No next of kin recorded. Edit patient to add.</p>
      )}

      {/* Recent appointments */}
      {patient.appointments?.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">Recent Appointments</h4>
          <div className="space-y-2">
            {patient.appointments.slice(0, 3).map((a: any) => (
              <div key={a.id} className="flex items-center justify-between p-3 bg-slate-50 dark:bg-white/5 rounded-xl border border-slate-100 dark:border-white/10">
                <div>
                  <p className="text-sm font-medium text-slate-800 dark:text-white">{a.service?.name}</p>
                  <p className="text-xs text-slate-400">Dr. {a.doctor?.user?.firstName} {a.doctor?.user?.lastName} · {new Date(a.startAt).toLocaleDateString('en-UG')}</p>
                </div>
                <span className={cn('text-xs font-semibold px-2 py-0.5 rounded-full', STATUS_COLOURS[a.status] || 'bg-slate-100 text-slate-600')}>
                  {a.status.replace(/_/g, ' ')}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────

export default function PatientProfilePage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const searchParams = useSearchParams()
  const [patient, setPatient] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<ActiveTab>(() => {
    const tp = searchParams.get('tab') as ActiveTab | null
    const valid: ActiveTab[] = ['timeline','overview','appointments','dental','perio','treatment','notes','billing','documents','activity']
    return tp && valid.includes(tp) ? tp : 'timeline'
  })
  const token = typeof window !== 'undefined' ? localStorage.getItem('cc_token') : null
  const user = typeof window !== 'undefined' ? JSON.parse(localStorage.getItem('cc_user') || '{}') : {}

  const [editOpen, setEditOpen] = useState(false)
  const [editForm, setEditForm] = useState<any>({})
  const [isSavingEdit, setIsSavingEdit] = useState(false)
  const [toggling, setToggling] = useState(false)
  const [deletePatientOpen, setDeletePatientOpen] = useState(false)
  const [deletingPatient,   setDeletingPatient]   = useState(false)
  const [deletePatientError, setDeletePatientError] = useState('')
  const [mergeOpen, setMergeOpen] = useState(false)
  const [mergeSearch, setMergeSearch] = useState('')
  const [mergeResults, setMergeResults] = useState<any[]>([])
  const [mergeSource, setMergeSource] = useState<any>(null)
  const [mergingPatient, setMergingPatient] = useState(false)
  const [mergeError, setMergeError] = useState('')

  const handlePrint = async (mode: 'print' | 'download' | 'share' = 'print') => {
    if (!patient) return
    const name   = `${patient.firstName || ''} ${patient.lastName || ''}`.trim() || 'Patient'
    const origin = window.location.origin
    const hdrs   = { Authorization: `Bearer ${token}` }
    const [notesRes, plansRes, svcsRes] = await Promise.all([
      fetch(`/api-proxy/clinical/patients/${id}/treatment-notes`, { headers: hdrs }),
      fetch(`/api-proxy/clinical/patients/${id}/treatment-plans`,  { headers: hdrs }),
      fetch('/api-proxy/services',                                  { headers: hdrs }),
    ])
    const notes: any[]   = notesRes.ok ? await notesRes.json() : []
    const plansAll: any[]= plansRes.ok ? await plansRes.json() : []
    const svcsAll: any[] = svcsRes.ok  ? await svcsRes.json()  : []
    const svcMap: Record<string,string> = Object.fromEntries(svcsAll.map((s: any) => [s.id, s.name]))
    const plans = plansAll

    const notesHtml = notes.map((note: any) => {
      const date   = new Date(note.createdAt).toLocaleString('en-UG')
      const author = note.author ? `Dr ${note.author.firstName} ${note.author.lastName}` : ''
      const body   = (note.content || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      return `<div class="note"><div class="note-date">${date}${author ? ` &bull; <span class="note-author">${author}</span>` : ''}</div><div class="note-content">${body}</div></div>`
    }).join('')

    const planRows = plans.map((p: any) => {
      const total = (p.costPerUnit * p.quantity) - (p.discount || 0)
      const badgeCls = p.status === 'In Progress' ? 'badge-ip' : p.status === 'Completed' ? 'badge-done' : p.status === 'On Hold' ? 'badge-hold' : p.status === 'Cancelled' ? 'badge-cancel' : 'badge-pl'
      return `<tr>
        <td>${p.toothNumber || '—'}</td>
        <td>${svcMap[p.serviceId] || '—'}</td>
        <td><span class="badge ${badgeCls}">${p.status}</span></td>
        <td class="num">${p.quantity}</td>
        <td class="num">${p.costPerUnit > 0 ? 'UGX ' + p.costPerUnit.toLocaleString() : '—'}</td>
        <td class="num">${p.discount > 0 ? 'UGX ' + (p.discount).toLocaleString() : '—'}</td>
        <td class="num bold">${total > 0 ? 'UGX ' + total.toLocaleString() : '—'}</td>
      </tr>`
    }).join('')
    const remainingTotal = plans.filter((p: any) => ['Planned','In Progress'].includes(p.status)).reduce((sum: number, p: any) => sum + ((p.costPerUnit * p.quantity) - (p.discount || 0)), 0)
    const completedTotal = plans.filter((p: any) => p.status === 'Completed').reduce((sum: number, p: any) => sum + ((p.costPerUnit * p.quantity) - (p.discount || 0)), 0)
    const planHtml = plans.length > 0
      ? `<table class="plan-table"><thead><tr><th>Tooth</th><th>Procedure</th><th>Status</th><th>Qty</th><th>Unit Cost</th><th>Discount</th><th>Total</th></tr></thead><tbody>${planRows}</tbody><tfoot><tr><td colspan="6" class="bold" style="text-align:right;background:#f0fff4;color:#166534">Completed Total</td><td class="num bold" style="background:#f0fff4;color:#166534">${completedTotal > 0 ? 'UGX ' + completedTotal.toLocaleString() : '—'}</td></tr><tr><td colspan="6" class="bold" style="text-align:right;background:#f0f4ff;color:#1A237E">Remaining / Outstanding</td><td class="num bold" style="background:#f0f4ff;color:#1A237E">UGX ${remainingTotal.toLocaleString()}</td></tr></tfoot></table>`
      : '<p class="empty">No treatment plan items.</p>'

    const dobDisplay = patient.dob ? formatDobAge(patient.dob) : null
    const genderDisplay = patient.gender ? patient.gender.charAt(0) + patient.gender.slice(1).toLowerCase() : null
    const addressDisplay = [patient.address, patient.district].filter(Boolean).join(', ') || null
    const generatedAt = new Date().toLocaleString('en-UG', { timeZone: 'Africa/Nairobi', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    const infoItems = [
      patient.patientId ? `<div class="info-item"><span class="info-label">Patient ID</span><span class="info-value mono">${patient.patientId}</span></div>` : '',
      dobDisplay        ? `<div class="info-item"><span class="info-label">Date of Birth</span><span class="info-value">${dobDisplay}</span></div>` : '',
      `<div class="info-item"><span class="info-label">Phone</span><span class="info-value">${patient.phone || 'N/A'}</span></div>`,
      genderDisplay     ? `<div class="info-item"><span class="info-label">Gender</span><span class="info-value">${genderDisplay}</span></div>` : '',
      addressDisplay    ? `<div class="info-item"><span class="info-label">Residence</span><span class="info-value">${addressDisplay}</span></div>` : '',
      `<div class="info-item"><span class="info-label">Generated</span><span class="info-value">${generatedAt}</span></div>`,
    ].filter(Boolean).join('')

    const tipBanner = mode === 'print'
      ? `<div class="pdf-tip"><strong>To save as PDF:</strong> Press <strong>Ctrl+P</strong> (Cmd+P on Mac) &rarr; change the printer/destination to <strong>"Save as PDF"</strong> &rarr; click Save.</div>`
      : ''

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Patient Record — ${name}</title>
<style>
body{font-family:Arial,sans-serif;color:#000;background:#fff;margin:0;padding:24px}
.pdf-tip{background:#fff8e1;border:1px solid #f59e0b;border-radius:6px;padding:10px 14px;margin-bottom:16px;font-size:12px;color:#78350f}
@media print{.pdf-tip{display:none}@page{size:A4;margin:1.5cm}}
.header{text-align:center;border-bottom:2px solid #1A237E;padding-bottom:16px;margin-bottom:24px}
.patient-info{margin-bottom:24px;background:#f0f4ff;padding:14px 16px;border-radius:8px;border-left:4px solid #1A237E}
.patient-info h2{font-size:18px;font-weight:700;margin:0 0 10px;color:#1A237E}
.info-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px 24px}
.info-item{display:flex;flex-direction:column;gap:1px}
.info-label{font-size:10px;font-weight:700;color:#555;text-transform:uppercase;letter-spacing:.5px}
.info-value{font-size:12px;color:#222;font-weight:500}
.mono{font-family:monospace;font-size:11px;letter-spacing:.3px;color:#1A237E}
.section-title{font-size:12px;font-weight:700;color:#1A237E;text-transform:uppercase;letter-spacing:.5px;margin:20px 0 10px;border-bottom:1px solid #e0e0e0;padding-bottom:4px}
.plan-table{width:100%;border-collapse:collapse;font-size:12px;margin-bottom:8px}
.plan-table th{background:#f0f4ff;color:#1A237E;font-weight:700;padding:6px 8px;text-align:left;border:1px solid #d0d8f0}
.plan-table td{padding:5px 8px;border:1px solid #e0e0e0;vertical-align:middle}
.plan-table tr:nth-child(even) td{background:#fafafa}
.num{text-align:right}.bold{font-weight:700}
.badge{font-size:10px;font-weight:700;padding:2px 6px;border-radius:10px;white-space:nowrap}
.badge-pl{background:#dbeafe;color:#1d4ed8}.badge-ip{background:#fef3c7;color:#92400e}.badge-done{background:#dcfce7;color:#166534}.badge-hold{background:#f3f4f6;color:#6b7280}.badge-cancel{background:#fee2e2;color:#dc2626}
.note{border:1px solid #e0e0e0;border-radius:8px;padding:12px 16px;margin-bottom:12px;page-break-inside:avoid}
.note-date{font-size:11px;color:#888;margin-bottom:6px}.note-author{color:#1A237E;font-weight:600}
.note-content{font-size:13px;line-height:1.6;white-space:pre-wrap}
.empty{color:#aaa;font-size:13px;font-style:italic}
.footer{text-align:center;font-size:10px;color:#555;margin-top:32px;border-top:1px solid #e0e0e0;padding-top:12px}
</style></head><body>
${tipBanner}
<div class="header"><img src="${origin}/logo.png" alt="Code Clinic" style="height:44px;width:auto;display:block;margin:0 auto 10px"><div style="font-size:12px;color:#555">Patient Record</div></div>
<div class="patient-info"><h2>${name}</h2><div class="info-grid">${infoItems}</div></div>
<div class="section-title">Treatment Plan — All Items (${plans.length})</div>
${planHtml}
<div class="section-title">Treatment Notes (${notes.length})</div>
${notesHtml || '<p class="empty">No notes recorded for this patient.</p>'}
<div class="footer">Code Clinic, Kiira Road, Kamwokya &bull; +256 394 836 298</div>
<script>window.onload=function(){window.print();window.onafterprint=function(){window.close();}}</script>
</body></html>`

    const cleanHtml = html.replace('<script>window.onload=function(){window.print();window.onafterprint=function(){window.close();}}</script>', '')
    if (mode === 'share') {
      const file = new File([new Blob([cleanHtml], { type: 'text/html' })], `treatment-plan-${name.replace(/[^a-zA-Z0-9]/g, '-')}.html`, { type: 'text/html' })
      if ((navigator as any).canShare?.({ files: [file] })) {
        try { await (navigator as any).share({ files: [file], title: `Treatment Plan — ${name}`, text: 'Treatment plan from Code Clinic' }) } catch {}
      } else {
        const url = URL.createObjectURL(file)
        const a = document.createElement('a')
        a.href = url; a.download = file.name; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url)
      }
    } else if (mode === 'download') {
      const blob = new Blob([cleanHtml], { type: 'text/html' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = `treatment-plan-${name.replace(/[^a-zA-Z0-9]/g, '-')}.html`
      document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url)
    } else {
      const w = window.open('', '_blank', 'width=800,height=900')
      if (w) { w.document.write(html); w.document.close() }
    }
  }

  async function toggleActive() {
    setToggling(true)
    try {
      const res = await fetch(`/api-proxy/patients/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ isActive: !patient.isActive }),
      })
      if (res.ok) setPatient((p: any) => ({ ...p, isActive: !p.isActive }))
    } finally { setToggling(false) }
  }

  async function handleDeletePatient() {
    setDeletingPatient(true)
    setDeletePatientError('')
    try {
      const res = await fetch(`/api-proxy/patients/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await res.json()
      if (res.ok) {
        router.push('/patients')
      } else {
        setDeletePatientError(data.error || 'Failed to delete patient')
      }
    } catch {
      setDeletePatientError('Network error')
    } finally { setDeletingPatient(false) }
  }

  async function searchMergePatients(q: string) {
    if (q.length < 2) { setMergeResults([]); return }
    const res = await fetch(`/api-proxy/patients?q=${encodeURIComponent(q)}&limit=8`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (res.ok) {
      const data = await res.json()
      setMergeResults((data.data || []).filter((p: any) => p.id !== id))
    }
  }

  async function handleMergePatient() {
    if (!mergeSource) return
    setMergingPatient(true)
    setMergeError('')
    try {
      const res = await fetch(`/api-proxy/patients/${id}/merge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ sourceId: mergeSource.id }),
      })
      const data = await res.json()
      if (res.ok) {
        setMergeOpen(false)
        router.push('/patients')
      } else {
        setMergeError(data.error || 'Failed to merge patients')
      }
    } catch {
      setMergeError('Network error')
    } finally { setMergingPatient(false) }
  }

  function openEdit() {
    setEditForm({
      firstName: patient.firstName || '',
      lastName: patient.lastName || '',
      phone: patient.phone || '',
      email: patient.email || '',
      gender: patient.gender || '',
      dob: patient.dob ? patient.dob.slice(0, 10) : '',
      address: patient.address || '',
      district: patient.district || '',
      nextOfKinName: patient.nextOfKinName || '',
      nextOfKinPhone: patient.nextOfKinPhone || '',
      nextOfKinRelation: patient.nextOfKinRelation || '',
      referralSource: patient.referralSource || '',
    })
    setEditOpen(true)
  }

  async function saveEdit() {
    if (!editForm.firstName || !editForm.lastName || !editForm.phone) return
    setIsSavingEdit(true)
    try {
      const res = await fetch(`/api-proxy/patients/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(editForm),
      })
      if (res.ok) {
        const updated = await res.json()
        setPatient((p: any) => ({ ...p, ...updated }))
        setEditOpen(false)
      }
    } finally {
      setIsSavingEdit(false)
    }
  }

  // Keep URL in sync with active tab (shallow)
  function switchTab(tab: ActiveTab) {
    setActiveTab(tab)
    router.replace(`/patients/${id}?tab=${tab}`, { scroll: false })
  }

  useEffect(() => {
    fetch(`/api-proxy/patients/${id}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json()).then(setPatient).catch(console.error).finally(() => setLoading(false))
  }, [id])

  if (loading) return (
    <div className="space-y-4 animate-pulse max-w-7xl">
      <div className="h-8 w-40 bg-gray-200 dark:bg-white/10 rounded" />
      <div className="h-32 bg-gray-100 dark:bg-white/5 rounded-2xl" />
    </div>
  )

  if (!patient) return (
    <div className="text-center py-20 text-gray-400">
      <User size={40} className="mx-auto mb-3 opacity-30" />
      <p>Patient not found</p>
    </div>
  )

  const tabs: { key: ActiveTab; label: string; icon: React.ElementType }[] = [
    { key: 'timeline',     label: 'Timeline',       icon: Activity   },
    { key: 'overview',     label: 'Overview',        icon: User       },
    { key: 'appointments', label: 'Appointments',    icon: Calendar   },
    { key: 'dental',       label: 'Dental Chart',    icon: Activity   },
    { key: 'perio',        label: 'Perio Chart',     icon: FileText   },
    { key: 'treatment',    label: 'Treatment Plan',  icon: CheckCircle },
    { key: 'notes',        label: 'Notes',           icon: FileText   },
    { key: 'billing',      label: 'Billing',         icon: DollarSign },
    { key: 'documents',    label: 'Documents',       icon: Folder     },
  ]

  const renderTab = () => {
    switch (activeTab) {
      case 'overview': return <OverviewTab patient={patient} onSwitchTab={switchTab} />
      case 'appointments': return <AppointmentsTab patient={patient} token={token} />
      case 'dental': return <DentalChartTab patientId={id!} token={token} />
      case 'perio': return <PerioChartTab patientId={id!} token={token} />
      case 'treatment': return <TreatmentPlanTab patientId={id!} token={token} />
      case 'notes': return <NotesTab patientId={id!} token={token} />
      case 'billing': return <BillingTab patient={patient} token={token} />
      case 'documents': return <DocumentsTab patientId={id!} token={token} />
      case 'activity': return <ActivityTab patientId={id!} token={token} />
      case 'timeline': return <TimelineTab patientId={id!} />
    }
  }

  const outstanding = (patient.invoices || []).reduce((s: number, inv: any) => s + (inv.totalUGX - inv.paidUGX), 0)

  return (
    <div className="space-y-4 animate-fade-in max-w-7xl">
      {/* Back */}
      <button onClick={() => router.push('/patients')} className="flex items-center gap-2 text-sm text-gray-500 hover:text-clinic-navy dark:hover:text-white transition-colors">
        <ArrowLeft size={16} /> Back to Patients
      </button>

      {/* Hero */}
      <div className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/10 shadow-sm overflow-hidden">
        <div className="h-20 bg-gradient-to-r from-clinic-navy to-clinic-blue" />
        <div className="px-6 pb-5 -mt-10">
          <div className="flex items-end justify-between flex-wrap gap-4">
            <div className="flex items-end gap-4">
              <AvatarUpload userId={patient.id} firstName={patient.firstName} lastName={patient.lastName}
                currentAvatarUrl={patient.avatarUrl} size="xl" token={token || undefined}
                onUploaded={(url) => setPatient((p: any) => ({ ...p, avatarUrl: url }))} />
              <div className="mb-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="text-2xl font-bold text-clinic-navy dark:text-white">{patient.firstName} {patient.lastName}</h1>
                  {patient.patientId && (
                    <span className="text-xs font-mono text-cyan-600 dark:text-cyan-400 bg-cyan-50 dark:bg-cyan-900/20 px-2 py-0.5 rounded-lg">{patient.patientId}</span>
                  )}
                  {!patient.isActive && (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 uppercase">Inactive</span>
                  )}
                  <button onClick={openEdit} className="p-1.5 rounded-lg text-slate-400 hover:text-clinic-blue hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors" title="Edit patient">
                    <Edit size={15} />
                  </button>
                  <button
                    onClick={toggleActive}
                    disabled={toggling}
                    className={cn('text-xs font-bold px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50',
                      patient.isActive
                        ? 'text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20'
                        : 'text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20')}>
                    {toggling ? '...' : patient.isActive ? 'Deactivate' : 'Reactivate'}
                  </button>
                  {user.role === 'ADMIN' && (
                    <button
                      onClick={() => { setMergeOpen(true); setMergeSearch(''); setMergeResults([]); setMergeSource(null); setMergeError('') }}
                      className="text-xs font-bold px-3 py-1.5 rounded-lg transition-colors text-amber-700 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/20 border border-amber-200 dark:border-amber-800/40">
                      Merge Patient…
                    </button>
                  )}
                  {user.role === 'ADMIN' && (
                    <button
                      onClick={() => { setDeletePatientOpen(true); setDeletePatientError('') }}
                      className="text-xs font-bold px-3 py-1.5 rounded-lg transition-colors text-red-700 hover:bg-red-100 dark:hover:bg-red-900/30 border border-red-200 dark:border-red-800/40">
                      Delete Patient
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  {patient.dob && <span className="text-sm text-slate-500">{formatDobAge(patient.dob)}</span>}
                  <span className="text-slate-300">·</span>
                  <a href={`tel:${patient.phone}`} className="text-sm text-blue-600 hover:underline flex items-center gap-1">
                    <Phone size={12} /> {formatPhone(patient.phone)}
                  </a>
                  {outstanding > 0 && (
                    <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-red-100 text-red-700">
                      Owes {formatUGX(outstanding)}
                    </span>
                  )}
                  {patient.medicalNotesEncrypted && (
                    <span className="flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full bg-red-100 text-red-700">
                      <AlertTriangle size={10} /> Medical Alert
                    </span>
                  )}
                </div>
              </div>
            </div>
            {/* Print + Download + Share buttons */}
            <div className="flex gap-2 self-end mb-2 flex-wrap">
              <button onClick={() => handlePrint('print')}
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-slate-600 dark:text-white/70 border border-slate-200 dark:border-white/10 hover:bg-slate-50 dark:hover:bg-white/5 transition-all">
                <Printer size={14} /> Print
              </button>
              <button onClick={() => handlePrint('download')}
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 transition-all">
                <Download size={14} /> Download
              </button>
              <button onClick={() => handlePrint('share')}
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 transition-all">
                <Share2 size={14} /> Share
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Body: sidebar + content */}
      <div className="flex gap-4 min-h-[70vh]">
        {/* Sidebar */}
        <div className="w-48 flex-shrink-0">
          <nav className="bg-white dark:bg-white/5 rounded-xl border border-gray-100 dark:border-white/10 p-2 space-y-0.5 sticky top-4">
            {tabs.map(({ key, label, icon: Icon }) => (
              <button key={key} onClick={() => switchTab(key)}
                className={cn(
                  'w-full flex items-center gap-2.5 px-3 py-2.5 text-sm font-medium rounded-lg text-left transition-colors',
                  activeTab === key
                    ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/10'
                )}>
                <Icon size={15} /> {label}
              </button>
            ))}
          </nav>
        </div>

        {/* Content */}
        <div className="flex-1 bg-white dark:bg-white/5 rounded-xl border border-gray-100 dark:border-white/10 overflow-hidden">
          <div className={cn('p-6 h-full', activeTab === 'dental' || activeTab === 'perio' ? 'p-0' : '')}>
            {renderTab()}
          </div>
        </div>
      </div>

      {/* Edit Patient Modal */}
      {editOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b dark:border-white/10">
              <h2 className="text-lg font-bold text-slate-800 dark:text-white">Edit Patient</h2>
              <button onClick={() => setEditOpen(false)} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-white/10 text-slate-400">
                <X size={16} />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1">First Name *</label>
                  <input value={editForm.firstName} onChange={e => setEditForm((f: any) => ({ ...f, firstName: e.target.value }))}
                    className="w-full px-3 py-2 text-sm border border-slate-200 dark:border-white/10 dark:bg-gray-800 dark:text-white rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1">Last Name *</label>
                  <input value={editForm.lastName} onChange={e => setEditForm((f: any) => ({ ...f, lastName: e.target.value }))}
                    className="w-full px-3 py-2 text-sm border border-slate-200 dark:border-white/10 dark:bg-gray-800 dark:text-white rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1">Phone *</label>
                  <input value={editForm.phone} onChange={e => setEditForm((f: any) => ({ ...f, phone: e.target.value }))}
                    className="w-full px-3 py-2 text-sm border border-slate-200 dark:border-white/10 dark:bg-gray-800 dark:text-white rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1">Email</label>
                  <input type="email" value={editForm.email} onChange={e => setEditForm((f: any) => ({ ...f, email: e.target.value }))}
                    className="w-full px-3 py-2 text-sm border border-slate-200 dark:border-white/10 dark:bg-gray-800 dark:text-white rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1">Gender</label>
                  <select value={editForm.gender} onChange={e => setEditForm((f: any) => ({ ...f, gender: e.target.value }))}
                    className="w-full px-3 py-2 text-sm border border-slate-200 dark:border-white/10 dark:bg-gray-800 dark:text-white rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none">
                    <option value="">Not specified</option>
                    <option value="MALE">Male</option>
                    <option value="FEMALE">Female</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1">Date of Birth</label>
                  <input type="date" value={editForm.dob} onChange={e => setEditForm((f: any) => ({ ...f, dob: e.target.value }))}
                    className="w-full px-3 py-2 text-sm border border-slate-200 dark:border-white/10 dark:bg-gray-800 dark:text-white rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">Residence</label>
                <input value={editForm.address} onChange={e => setEditForm((f: any) => ({ ...f, address: e.target.value }))}
                  className="w-full px-3 py-2 text-sm border border-slate-200 dark:border-white/10 dark:bg-gray-800 dark:text-white rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">How did they find us?</label>
                <select value={editForm.referralSource} onChange={e => setEditForm((f: any) => ({ ...f, referralSource: e.target.value }))}
                  className="w-full px-3 py-2 text-sm border border-slate-200 dark:border-white/10 dark:bg-gray-800 dark:text-white rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none">
                  <option value="">Not specified</option>
                  {['Walk-in','Google Search','Google Ad','Facebook','Instagram','Friends and Family','Doctor referral','NWSC','ERA','City Medicals','GA','BNI','YouTube','Worship Harvest','Other'].map((o: string) => (
                    <option key={o} value={o}>{o}</option>
                  ))}
                </select>
              </div>
              <div className="border-t dark:border-white/10 pt-4">
                <p className="text-xs font-bold uppercase tracking-wide text-blue-500 mb-3">Next of Kin</p>
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 mb-1">Name</label>
                    <input value={editForm.nextOfKinName} onChange={e => setEditForm((f: any) => ({ ...f, nextOfKinName: e.target.value }))}
                      placeholder="e.g. John Doe"
                      className="w-full px-3 py-2 text-sm border border-slate-200 dark:border-white/10 dark:bg-gray-800 dark:text-white rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 mb-1">Phone</label>
                      <input value={editForm.nextOfKinPhone} onChange={e => setEditForm((f: any) => ({ ...f, nextOfKinPhone: e.target.value }))}
                        placeholder="+256..."
                        className="w-full px-3 py-2 text-sm border border-slate-200 dark:border-white/10 dark:bg-gray-800 dark:text-white rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none" />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 mb-1">Relationship</label>
                      <input value={editForm.nextOfKinRelation} onChange={e => setEditForm((f: any) => ({ ...f, nextOfKinRelation: e.target.value }))}
                        placeholder="e.g. Spouse, Parent"
                        className="w-full px-3 py-2 text-sm border border-slate-200 dark:border-white/10 dark:bg-gray-800 dark:text-white rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none" />
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-3 px-6 py-4 border-t dark:border-white/10 bg-slate-50 dark:bg-white/5 rounded-b-2xl">
              <button onClick={() => setEditOpen(false)} className="px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 hover:text-slate-800 transition-colors">
                Cancel
              </button>
              <button onClick={saveEdit} disabled={isSavingEdit || !editForm.firstName || !editForm.lastName || !editForm.phone}
                className="px-5 py-2 text-sm font-bold text-white bg-blue-600 rounded-xl hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed transition-colors flex items-center gap-2">
                {isSavingEdit ? <><Loader2 size={14} className="animate-spin" /> Saving...</> : <><Save size={14} /> Save Changes</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Patient Confirmation Dialog */}
      {deletePatientOpen && (
        <>
          <div className="fixed inset-0 bg-black/50 z-50" onClick={() => !deletingPatient && setDeletePatientOpen(false)} />
          <div className="fixed inset-0 flex items-center justify-center z-50 p-4 pointer-events-none">
            <div className="pointer-events-auto w-full max-w-sm bg-white dark:bg-[#0f1729] rounded-2xl shadow-2xl border border-gray-100 dark:border-white/10 p-6 space-y-4">
              <h3 className="text-base font-black text-red-700 dark:text-red-400">Permanently Delete Patient?</h3>
              <p className="text-sm text-gray-500 dark:text-white/60">
                This will permanently delete{' '}
                <span className="font-semibold text-gray-700 dark:text-white/80">
                  {patient?.firstName} {patient?.lastName}
                </span>{' '}
                and all their records. This cannot be undone.
              </p>
              <p className="text-xs text-amber-600 dark:text-amber-400 font-medium">
                Only patients with no appointments and no treatment records can be deleted. Use Deactivate for all others.
              </p>
              {deletePatientError && (
                <p className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/30 rounded-xl px-3 py-2">
                  {deletePatientError}
                </p>
              )}
              <div className="flex gap-3 pt-1">
                <button
                  onClick={handleDeletePatient}
                  disabled={deletingPatient}
                  className="flex-1 py-2.5 text-sm font-bold text-white bg-red-600 hover:bg-red-700 rounded-xl transition-colors disabled:opacity-60 flex items-center justify-center gap-2">
                  {deletingPatient ? <Loader2 size={14} className="animate-spin" /> : null}
                  {deletingPatient ? 'Deleting…' : 'Yes, Delete Permanently'}
                </button>
                <button
                  onClick={() => setDeletePatientOpen(false)}
                  disabled={deletingPatient}
                  className="px-4 py-2.5 text-sm font-semibold text-gray-600 dark:text-white/60 hover:bg-gray-100 dark:hover:bg-white/8 rounded-xl transition-colors disabled:opacity-60">
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Merge Patient Dialog */}
      {mergeOpen && (
        <>
          <div className="fixed inset-0 bg-black/50 z-50" onClick={() => !mergingPatient && setMergeOpen(false)} />
          <div className="fixed inset-0 flex items-center justify-center z-50 p-4 pointer-events-none">
            <div className="pointer-events-auto w-full max-w-md bg-white dark:bg-[#0f1729] rounded-2xl shadow-2xl border border-gray-100 dark:border-white/10 p-6 space-y-4">
              <h3 className="text-base font-black text-amber-700 dark:text-amber-400">Merge Duplicate Patient</h3>
              <p className="text-sm text-gray-500 dark:text-white/60">
                Search for the <span className="font-semibold">duplicate</span> patient to merge into{' '}
                <span className="font-semibold text-gray-700 dark:text-white/80">{patient?.firstName} {patient?.lastName}</span>.
                The duplicate will be deleted and all their records moved here.
              </p>

              {!mergeSource ? (
                <div className="space-y-2">
                  <input
                    type="text"
                    value={mergeSearch}
                    onChange={e => { setMergeSearch(e.target.value); searchMergePatients(e.target.value) }}
                    placeholder="Search by name or phone…"
                    className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-white/10 rounded-xl bg-white dark:bg-white/5 text-gray-700 dark:text-white placeholder-gray-400 dark:placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-amber-400/50"
                  />
                  {mergeResults.length > 0 && (
                    <div className="border border-gray-100 dark:border-white/10 rounded-xl overflow-hidden">
                      {mergeResults.map((p: any) => (
                        <button
                          key={p.id}
                          onClick={() => setMergeSource(p)}
                          className="w-full text-left px-4 py-2.5 text-sm hover:bg-amber-50 dark:hover:bg-amber-900/20 transition-colors border-b border-gray-50 dark:border-white/5 last:border-0">
                          <span className="font-semibold text-gray-700 dark:text-white/80">{p.firstName} {p.lastName}</span>
                          <span className="ml-2 text-xs text-gray-400 dark:text-white/30">{p.phone}</span>
                          {p.patientId && <span className="ml-2 text-xs font-mono text-cyan-600 dark:text-cyan-400">{p.patientId}</span>}
                        </button>
                      ))}
                    </div>
                  )}
                  {mergeSearch.length >= 2 && mergeResults.length === 0 && (
                    <p className="text-xs text-gray-400 dark:text-white/30 text-center py-2">No patients found</p>
                  )}
                </div>
              ) : (
                <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/40 rounded-xl px-4 py-3 space-y-1">
                  <p className="text-xs font-semibold text-amber-700 dark:text-amber-400 uppercase tracking-wide">Will be deleted:</p>
                  <p className="text-sm font-bold text-gray-800 dark:text-white">{mergeSource.firstName} {mergeSource.lastName}</p>
                  <p className="text-xs text-gray-500 dark:text-white/50">{mergeSource.phone}{mergeSource.patientId ? ` · ${mergeSource.patientId}` : ''}</p>
                  <button onClick={() => setMergeSource(null)} className="text-xs text-amber-600 dark:text-amber-400 underline mt-1">Change</button>
                </div>
              )}

              {mergeError && (
                <p className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/30 rounded-xl px-3 py-2">
                  {mergeError}
                </p>
              )}

              <div className="flex gap-3 pt-1">
                <button
                  onClick={handleMergePatient}
                  disabled={!mergeSource || mergingPatient}
                  className="flex-1 py-2.5 text-sm font-bold text-white bg-amber-600 hover:bg-amber-700 rounded-xl transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2">
                  {mergingPatient ? <Loader2 size={14} className="animate-spin" /> : null}
                  {mergingPatient ? 'Merging…' : 'Merge & Delete Duplicate'}
                </button>
                <button
                  onClick={() => setMergeOpen(false)}
                  disabled={mergingPatient}
                  className="px-4 py-2.5 text-sm font-semibold text-gray-600 dark:text-white/60 hover:bg-gray-100 dark:hover:bg-white/8 rounded-xl transition-colors disabled:opacity-60">
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
