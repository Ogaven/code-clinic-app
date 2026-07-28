'use client'

import { useEffect, useState } from 'react'
import { Plus, Pencil, Trash2, ChevronDown, ChevronRight, Building2, DollarSign } from 'lucide-react'
import { cn } from '@/lib/utils'

interface SponsorOrg {
  id: string
  name: string
  contactName: string | null
  contactPhone: string | null
  contactEmail: string | null
  address: string | null
  isActive: boolean
  _count: { patientSponsors: number; feeSchedules: number }
}

interface Service {
  id: string
  name: string
  category: string
  priceUGX: number | null
}

interface FeeSchedule {
  id: string
  organizationId: string
  serviceId: string | null
  negotiatedRate: number | null
  coveragePercent: number | null
  notes: string | null
  effectiveFrom: string
  effectiveTo: string | null
  service: { id: string; name: string; category: string; priceUGX: number | null } | null
}

const token = () => typeof window !== 'undefined' ? localStorage.getItem('cc_token') : ''
const authHeaders = () => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` })

export default function SponsorsPage() {
  const [orgs,     setOrgs]     = useState<SponsorOrg[]>([])
  const [services, setServices] = useState<Service[]>([])
  const [loading,  setLoading]  = useState(true)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [schedules, setSchedules] = useState<Record<string, FeeSchedule[]>>({})

  // Org form state
  const [orgModal,  setOrgModal]  = useState<'create' | SponsorOrg | null>(null)
  const [orgSaving, setOrgSaving] = useState(false)
  const [orgError,  setOrgError]  = useState<string | null>(null)
  const [orgForm,   setOrgForm]   = useState({ name: '', contactName: '', contactPhone: '', contactEmail: '', address: '', isActive: true })

  // Fee schedule form state
  const [fsModal,  setFsModal]  = useState<{ orgId: string; fs?: FeeSchedule } | null>(null)
  const [fsSaving, setFsSaving] = useState(false)
  const [fsError,  setFsError]  = useState<string | null>(null)
  const [fsForm,   setFsForm]   = useState({ serviceId: '', negotiatedRate: '', coveragePercent: '', notes: '', effectiveFrom: '', effectiveTo: '' })

  // Delete state
  const [deleteTarget, setDeleteTarget] = useState<{ type: 'org'; org: SponsorOrg } | { type: 'fs'; fs: FeeSchedule; orgId: string } | null>(null)
  const [deleting,     setDeleting]     = useState(false)
  const [deleteError,  setDeleteError]  = useState<string | null>(null)

  useEffect(() => {
    Promise.all([
      fetch('/api-proxy/sponsors',  { headers: authHeaders() }).then(r => r.json()),
      fetch('/api-proxy/services',  { headers: authHeaders() }).then(r => r.json()),
    ]).then(([orgsData, svcData]) => {
      setOrgs(Array.isArray(orgsData) ? orgsData : [])
      const svcs = Array.isArray(svcData) ? svcData : (svcData?.services ?? [])
      setServices(svcs)
    }).catch(console.error).finally(() => setLoading(false))
  }, [])

  async function loadSchedules(orgId: string) {
    const data = await fetch(`/api-proxy/sponsors/${orgId}/fee-schedules`, { headers: authHeaders() }).then(r => r.json())
    setSchedules(s => ({ ...s, [orgId]: Array.isArray(data) ? data : [] }))
  }

  function toggleExpand(orgId: string) {
    if (expanded === orgId) { setExpanded(null); return }
    setExpanded(orgId)
    if (!schedules[orgId]) loadSchedules(orgId)
  }

  // ── Org CRUD ──────────────────────────────────────────────────────────────

  function openOrgCreate() {
    setOrgForm({ name: '', contactName: '', contactPhone: '', contactEmail: '', address: '', isActive: true })
    setOrgError(null)
    setOrgModal('create')
  }

  function openOrgEdit(org: SponsorOrg) {
    setOrgForm({
      name: org.name, contactName: org.contactName ?? '', contactPhone: org.contactPhone ?? '',
      contactEmail: org.contactEmail ?? '', address: org.address ?? '', isActive: org.isActive,
    })
    setOrgError(null)
    setOrgModal(org)
  }

  async function saveOrg() {
    if (!orgForm.name.trim()) { setOrgError('Name is required'); return }
    setOrgSaving(true); setOrgError(null)
    try {
      const isEdit = orgModal !== 'create'
      const url    = isEdit ? `/api-proxy/sponsors/${(orgModal as SponsorOrg).id}` : '/api-proxy/sponsors'
      const method = isEdit ? 'PUT' : 'POST'
      const r = await fetch(url, { method, headers: authHeaders(), body: JSON.stringify(orgForm) })
      const data = await r.json()
      if (!r.ok) { setOrgError(data.error || 'Save failed'); return }
      if (isEdit) {
        setOrgs(list => list.map(o => o.id === data.id ? { ...o, ...data } : o))
      } else {
        setOrgs(list => [...list, { ...data, _count: { patientSponsors: 0, feeSchedules: 0 } }])
      }
      setOrgModal(null)
    } catch (e: any) { setOrgError(e.message) } finally { setOrgSaving(false) }
  }

  async function confirmDelete() {
    if (!deleteTarget) return
    setDeleting(true); setDeleteError(null)
    try {
      if (deleteTarget.type === 'org') {
        const r = await fetch(`/api-proxy/sponsors/${deleteTarget.org.id}`, { method: 'DELETE', headers: authHeaders() })
        const data = await r.json()
        if (!r.ok) { setDeleteError(data.error || 'Delete failed'); return }
        setOrgs(list => list.filter(o => o.id !== deleteTarget.org.id))
        if (expanded === deleteTarget.org.id) setExpanded(null)
      } else {
        const r = await fetch(`/api-proxy/sponsors/fee-schedules/${deleteTarget.fs.id}`, { method: 'DELETE', headers: authHeaders() })
        const data = await r.json()
        if (!r.ok) { setDeleteError(data.error || 'Delete failed'); return }
        setSchedules(s => ({ ...s, [deleteTarget.orgId]: (s[deleteTarget.orgId] || []).filter(f => f.id !== deleteTarget.fs.id) }))
        setOrgs(list => list.map(o => o.id === deleteTarget.orgId ? { ...o, _count: { ...o._count, feeSchedules: o._count.feeSchedules - 1 } } : o))
      }
      setDeleteTarget(null)
    } catch (e: any) { setDeleteError(e.message) } finally { setDeleting(false) }
  }

  // ── Fee Schedule CRUD ─────────────────────────────────────────────────────

  function openFsCreate(orgId: string) {
    setFsForm({ serviceId: '', negotiatedRate: '', coveragePercent: '', notes: '', effectiveFrom: new Date().toISOString().slice(0, 10), effectiveTo: '' })
    setFsError(null)
    setFsModal({ orgId })
  }

  function openFsEdit(orgId: string, fs: FeeSchedule) {
    setFsForm({
      serviceId:       fs.serviceId ?? '',
      negotiatedRate:  fs.negotiatedRate?.toString() ?? '',
      coveragePercent: fs.coveragePercent?.toString() ?? '',
      notes:           fs.notes ?? '',
      effectiveFrom:   fs.effectiveFrom.slice(0, 10),
      effectiveTo:     fs.effectiveTo ? fs.effectiveTo.slice(0, 10) : '',
    })
    setFsError(null)
    setFsModal({ orgId, fs })
  }

  async function saveFs() {
    if (!fsModal) return
    setFsSaving(true); setFsError(null)
    try {
      const body = {
        serviceId:       fsForm.serviceId || null,
        negotiatedRate:  fsForm.negotiatedRate ? Number(fsForm.negotiatedRate) : null,
        coveragePercent: fsForm.coveragePercent ? Number(fsForm.coveragePercent) : null,
        notes:           fsForm.notes || null,
        effectiveFrom:   fsForm.effectiveFrom || undefined,
        effectiveTo:     fsForm.effectiveTo || null,
      }
      const isEdit = !!fsModal.fs
      const url    = isEdit ? `/api-proxy/sponsors/fee-schedules/${fsModal.fs!.id}` : `/api-proxy/sponsors/${fsModal.orgId}/fee-schedules`
      const method = isEdit ? 'PUT' : 'POST'
      const r = await fetch(url, { method, headers: authHeaders(), body: JSON.stringify(body) })
      const data = await r.json()
      if (!r.ok) { setFsError(data.error || 'Save failed'); return }
      if (isEdit) {
        setSchedules(s => ({ ...s, [fsModal.orgId]: (s[fsModal.orgId] || []).map(f => f.id === data.id ? data : f) }))
      } else {
        setSchedules(s => ({ ...s, [fsModal.orgId]: [...(s[fsModal.orgId] || []), data] }))
        setOrgs(list => list.map(o => o.id === fsModal.orgId ? { ...o, _count: { ...o._count, feeSchedules: o._count.feeSchedules + 1 } } : o))
      }
      setFsModal(null)
    } catch (e: any) { setFsError(e.message) } finally { setFsSaving(false) }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) return <div className="p-8 text-center text-gray-400">Loading sponsors…</div>

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Sponsor / Billing</h1>
          <p className="text-sm text-gray-500 mt-1">Manage corporate sponsors and their negotiated service rates</p>
        </div>
        <button
          onClick={openOrgCreate}
          className="flex items-center gap-2 bg-[#1A237E] text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#151b6b] transition-colors"
        >
          <Plus className="w-4 h-4" /> New Sponsor
        </button>
      </div>

      {orgs.length === 0 && (
        <div className="text-center py-16 text-gray-400">
          <Building2 className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p>No sponsor organizations yet.</p>
        </div>
      )}

      <div className="space-y-3">
        {orgs.map(org => (
          <div key={org.id} className="border border-gray-200 rounded-xl overflow-hidden bg-white shadow-sm">
            {/* Org header row */}
            <div className="flex items-center gap-3 px-4 py-3">
              <button onClick={() => toggleExpand(org.id)} className="text-gray-400 hover:text-gray-600 shrink-0">
                {expanded === org.id ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
              </button>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-gray-900">{org.name}</span>
                  {!org.isActive && <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">Inactive</span>}
                </div>
                <div className="flex gap-4 text-xs text-gray-400 mt-0.5">
                  {org.contactName  && <span>{org.contactName}</span>}
                  {org.contactPhone && <span>{org.contactPhone}</span>}
                  {org.contactEmail && <span>{org.contactEmail}</span>}
                  <span>{org._count.patientSponsors} patient{org._count.patientSponsors !== 1 ? 's' : ''}</span>
                  <span>{org._count.feeSchedules} rate{org._count.feeSchedules !== 1 ? 's' : ''}</span>
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button onClick={() => openOrgEdit(org)} className="p-1.5 text-gray-400 hover:text-blue-600 rounded" title="Edit">
                  <Pencil className="w-4 h-4" />
                </button>
                <button onClick={() => { setDeleteTarget({ type: 'org', org }); setDeleteError(null) }} className="p-1.5 text-gray-400 hover:text-red-600 rounded" title="Delete">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Expanded: fee schedules */}
            {expanded === org.id && (
              <div className="border-t border-gray-100 bg-gray-50 px-4 py-3">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm font-medium text-gray-600">Negotiated Rates</span>
                  <button
                    onClick={() => openFsCreate(org.id)}
                    className="flex items-center gap-1 text-xs text-[#1A237E] hover:underline font-medium"
                  >
                    <Plus className="w-3 h-3" /> Add Rate
                  </button>
                </div>
                {!schedules[org.id] ? (
                  <p className="text-xs text-gray-400">Loading…</p>
                ) : schedules[org.id].length === 0 ? (
                  <p className="text-xs text-gray-400 italic">No rates configured — standard pricing applies to all services.</p>
                ) : (
                  <div className="space-y-2">
                    {schedules[org.id].map(fs => (
                      <div key={fs.id} className="flex items-center gap-3 bg-white rounded-lg border border-gray-100 px-3 py-2 text-sm">
                        <DollarSign className="w-4 h-4 text-green-500 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <span className="font-medium text-gray-800">
                            {fs.service ? fs.service.name : 'All Services'}
                          </span>
                          <span className="text-gray-400 mx-2">·</span>
                          {fs.negotiatedRate != null && (
                            <span className="text-green-700">UGX {fs.negotiatedRate.toLocaleString()}</span>
                          )}
                          {fs.coveragePercent != null && (
                            <span className="text-blue-600 ml-1">({fs.coveragePercent}% covered)</span>
                          )}
                          {fs.service?.priceUGX != null && fs.negotiatedRate != null && (
                            <span className="text-gray-400 text-xs ml-2">
                              standard: UGX {Number(fs.service.priceUGX).toLocaleString()}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button onClick={() => openFsEdit(org.id, fs)} className="p-1 text-gray-400 hover:text-blue-600 rounded" title="Edit">
                            <Pencil className="w-3 h-3" />
                          </button>
                          <button onClick={() => { setDeleteTarget({ type: 'fs', fs, orgId: org.id }); setDeleteError(null) }} className="p-1 text-gray-400 hover:text-red-600 rounded" title="Delete">
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* ── Org Create/Edit Modal ── */}
      {orgModal !== null && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
            <h2 className="text-lg font-bold text-gray-900 mb-4">
              {orgModal === 'create' ? 'New Sponsor Organization' : `Edit ${(orgModal as SponsorOrg).name}`}
            </h2>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-gray-600">Organization Name *</label>
                <input
                  className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#1A237E]"
                  value={orgForm.name} onChange={e => setOrgForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. NSSF Uganda"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-gray-600">Contact Name</label>
                  <input className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#1A237E]"
                    value={orgForm.contactName} onChange={e => setOrgForm(f => ({ ...f, contactName: e.target.value }))} />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600">Contact Phone</label>
                  <input className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#1A237E]"
                    value={orgForm.contactPhone} onChange={e => setOrgForm(f => ({ ...f, contactPhone: e.target.value }))} />
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600">Contact Email</label>
                <input className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#1A237E]"
                  type="email" value={orgForm.contactEmail} onChange={e => setOrgForm(f => ({ ...f, contactEmail: e.target.value }))} />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600">Address</label>
                <input className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#1A237E]"
                  value={orgForm.address} onChange={e => setOrgForm(f => ({ ...f, address: e.target.value }))} />
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={orgForm.isActive} onChange={e => setOrgForm(f => ({ ...f, isActive: e.target.checked }))} />
                <span className="text-sm text-gray-700">Active</span>
              </label>
            </div>
            {orgError && <p className="mt-3 text-sm text-red-600">{orgError}</p>}
            <div className="flex gap-3 mt-5">
              <button onClick={() => setOrgModal(null)} className="flex-1 border border-gray-200 rounded-lg px-4 py-2 text-sm text-gray-600 hover:bg-gray-50">Cancel</button>
              <button onClick={saveOrg} disabled={orgSaving} className="flex-1 bg-[#1A237E] text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-[#151b6b] disabled:opacity-50">
                {orgSaving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Fee Schedule Modal ── */}
      {fsModal !== null && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
            <h2 className="text-lg font-bold text-gray-900 mb-4">
              {fsModal.fs ? 'Edit Rate' : 'Add Negotiated Rate'}
            </h2>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-gray-600">Service</label>
                <select
                  className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#1A237E]"
                  value={fsForm.serviceId} onChange={e => setFsForm(f => ({ ...f, serviceId: e.target.value }))}
                >
                  <option value="">— All Services —</option>
                  {services.map(s => (
                    <option key={s.id} value={s.id}>{s.name} ({s.category}){s.priceUGX ? ` — UGX ${Number(s.priceUGX).toLocaleString()}` : ''}</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-gray-600">Negotiated Rate (UGX)</label>
                  <input
                    className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#1A237E]"
                    type="number" min="0"
                    value={fsForm.negotiatedRate} onChange={e => setFsForm(f => ({ ...f, negotiatedRate: e.target.value }))}
                    placeholder="Leave blank for standard"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600">Coverage %</label>
                  <input
                    className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#1A237E]"
                    type="number" min="0" max="100"
                    value={fsForm.coveragePercent} onChange={e => setFsForm(f => ({ ...f, coveragePercent: e.target.value }))}
                    placeholder="e.g. 80"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-gray-600">Effective From</label>
                  <input type="date" className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#1A237E]"
                    value={fsForm.effectiveFrom} onChange={e => setFsForm(f => ({ ...f, effectiveFrom: e.target.value }))} />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600">Effective To</label>
                  <input type="date" className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#1A237E]"
                    value={fsForm.effectiveTo} onChange={e => setFsForm(f => ({ ...f, effectiveTo: e.target.value }))} />
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600">Notes</label>
                <input className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#1A237E]"
                  value={fsForm.notes} onChange={e => setFsForm(f => ({ ...f, notes: e.target.value }))}
                  placeholder="Optional notes" />
              </div>
            </div>
            {fsError && <p className="mt-3 text-sm text-red-600">{fsError}</p>}
            <div className="flex gap-3 mt-5">
              <button onClick={() => setFsModal(null)} className="flex-1 border border-gray-200 rounded-lg px-4 py-2 text-sm text-gray-600 hover:bg-gray-50">Cancel</button>
              <button onClick={saveFs} disabled={fsSaving} className="flex-1 bg-[#1A237E] text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-[#151b6b] disabled:opacity-50">
                {fsSaving ? 'Saving…' : 'Save Rate'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete Confirm Modal ── */}
      {deleteTarget !== null && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6">
            <h2 className="text-lg font-bold text-gray-900 mb-2">Confirm Delete</h2>
            <p className="text-sm text-gray-600 mb-4">
              {deleteTarget.type === 'org'
                ? `Delete "${deleteTarget.org.name}"? This will also remove all associated fee schedules and terminated patient links.`
                : `Delete this rate entry for "${deleteTarget.fs.service?.name ?? 'All Services'}"?`}
            </p>
            {deleteError && <p className="mb-3 text-sm text-red-600">{deleteError}</p>}
            <div className="flex gap-3">
              <button onClick={() => { setDeleteTarget(null); setDeleteError(null) }} className="flex-1 border border-gray-200 rounded-lg px-4 py-2 text-sm text-gray-600 hover:bg-gray-50">Cancel</button>
              <button onClick={confirmDelete} disabled={deleting} className="flex-1 bg-red-600 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-red-700 disabled:opacity-50">
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
