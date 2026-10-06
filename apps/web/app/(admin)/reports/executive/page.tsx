'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Mail, RefreshCw, CalendarDays, Users, MessageSquare, TrendingUp, Wallet, AlertTriangle, Star, Zap, Target } from 'lucide-react'
type Period = 'weekly' | 'monthly'
const fmt = (n:number) => new Intl.NumberFormat('en-US').format(n || 0)
const money = (n:number) => 'UGX ' + fmt(n)
const trend = (n:number|null|undefined) => n == null ? 'No prior baseline' : `${n >= 0 ? '+' : ''}${n}% vs prior`
function Card({label,value,sub}:{label:string,value:string|number,sub?:string}) { return <div className="rounded-2xl border border-gray-100 dark:border-white/10 bg-white dark:bg-white/5 p-5 shadow-sm"><p className="text-[11px] font-bold uppercase tracking-wide text-gray-400">{label}</p><p className="mt-2 text-2xl font-black text-clinic-navy dark:text-white">{value}</p>{sub && <p className="mt-1 text-xs text-gray-400">{sub}</p>}</div> }
function Section({title,icon:Icon,children}:{title:string,icon:any,children:any}) { return <section className="rounded-2xl border border-gray-100 dark:border-white/10 bg-white dark:bg-white/5 overflow-hidden"><div className="flex items-center gap-2 border-b border-gray-100 dark:border-white/10 px-5 py-4"><Icon size={17} className="text-cyan-500"/><h2 className="font-black text-gray-800 dark:text-white">{title}</h2></div><div className="p-5">{children}</div></section> }
function Rows({rows}:{rows:[string,any][]}) { return <div className="grid sm:grid-cols-2 gap-x-8">{rows.map(([k,v]) => <div key={k} className="flex justify-between gap-4 py-2.5 border-b border-gray-50 dark:border-white/5 text-sm"><span className="text-gray-500 dark:text-white/50">{k}</span><strong className="text-gray-800 dark:text-white text-right">{v}</strong></div>)}</div> }
function Callout({title,items,tone}:{title:string,items:string[],tone:'win'|'opportunity'|'attention'}) {
 const cls=tone==='win'?'border-emerald-200 bg-emerald-50 text-emerald-800 dark:bg-emerald-900/10 dark:border-emerald-800/40 dark:text-emerald-300':tone==='opportunity'?'border-blue-200 bg-blue-50 text-blue-800 dark:bg-blue-900/10 dark:border-blue-800/40 dark:text-blue-300':'border-amber-200 bg-amber-50 text-amber-800 dark:bg-amber-900/10 dark:border-amber-800/40 dark:text-amber-300'
 return <div className={`rounded-2xl border p-5 ${cls}`}><h3 className="font-black">{title}</h3>{items.length?<ul className="mt-3 space-y-2 text-sm list-disc pl-5">{items.map(x=><li key={x}>{x}</li>)}</ul>:<p className="mt-2 text-sm opacity-70">No items recorded for this period.</p>}</div>
}
export default function ExecutiveReportPage() {
 const [period,setPeriod]=useState<Period>('weekly'),[data,setData]=useState<any>(null),[loading,setLoading]=useState(true),[email,setEmail]=useState(''),[sending,setSending]=useState(false),[msg,setMsg]=useState('')
 const token=typeof window!=='undefined'?localStorage.getItem('cc_token'):null
 async function load(p=period){setLoading(true);setMsg('');try{const r=await fetch(`/api-proxy/reports/executive?period=${p}`,{headers:{Authorization:`Bearer ${token}`}});if(!r.ok)throw new Error('Could not generate report');setData(await r.json())}catch(e:any){setMsg(e.message)}finally{setLoading(false)}}
 useEffect(()=>{load(period)},[period])
 async function sendTest(){if(!email)return;setSending(true);setMsg('');try{const r=await fetch('/api-proxy/reports/executive/test-email',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify({period,to:email})});const b=await r.json();if(!r.ok)throw new Error(b.error||'Test email failed');setMsg(`Test report sent to ${b.to}`)}catch(e:any){setMsg(e.message)}finally{setSending(false)}}
 const c=data?.current,cmp=data?.comparisons
 return <div className="p-6 space-y-6 max-w-7xl">
  <div className="flex flex-wrap items-center justify-between gap-4"><div className="flex items-center gap-3"><Link href="/reports" className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-white/10 text-gray-400"><ArrowLeft size={17}/></Link><div><h1 className="text-xl font-black text-clinic-navy dark:text-white">Business Impact & ROI Report</h1><p className="text-sm text-gray-400">Admin-only evidence of acquisition, engagement, clinic performance, treatment opportunity, automation and revenue</p></div></div>
  <div className="flex gap-2">{(['weekly','monthly'] as Period[]).map(p=><button key={p} onClick={()=>setPeriod(p)} className={`px-4 py-2 rounded-xl text-sm font-bold capitalize border ${period===p?'bg-clinic-navy text-white border-clinic-navy':'bg-white dark:bg-white/5 border-gray-200 dark:border-white/10 text-gray-500'}`}>{p}</button>)}<button onClick={()=>load()} className="p-2.5 rounded-xl border border-gray-200 dark:border-white/10 text-gray-500"><RefreshCw size={16} className={loading?'animate-spin':''}/></button></div></div>
  {msg&&<div className="rounded-xl bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 px-4 py-3 text-sm">{msg}</div>}
  {loading?<div className="py-24 text-center text-gray-400">Building business impact report from live clinic records…</div>:data&&<>
   <div className="rounded-3xl p-7 !text-white" style={{background:'linear-gradient(135deg,#0c1e50,#1A237E 55%,#29ABE2)'}}><p className="text-xs uppercase tracking-[.2em] !text-cyan-100 font-bold">Code Clinic · {data.period.kind} business impact brief</p><h2 className="text-3xl font-black mt-2 !text-white">{data.period.label}</h2><p className="mt-2 text-sm !text-blue-50">Compared with {data.period.previousLabel} · Generated {new Date(data.generatedAt).toLocaleString()}</p></div>

   <div><h2 className="text-sm font-black uppercase tracking-wider text-gray-500 mb-3">Business impact at a glance</h2><div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
    <Card label="Leads captured" value={c.crm.funnel.leadCount} sub={trend(cmp.leadsPct)}/>
    <Card label="Paying clients attributed" value={c.crm.funnel.payingClientCount} sub={trend(cmp.payingClientsPct)}/>
    <Card label="Attributed collected revenue" value={money(c.crm.attributedRevenue.collectedUGX)} sub="Cleanly linked to leads acquired in this period"/>
    <Card label="Clinic collections recorded" value={money(c.finance.collectedUGX)} sub={c.finance.collectedUGX===0?'No Payment records in this period — not an estimate':trend(cmp.collectedRevenuePct)}/>
    <Card label="Patients seen" value={c.patients.patientsSeen} sub={trend(cmp.patientsSeenPct)}/>
    <Card label="Digital conversations" value={c.communications.conversations} sub={trend(cmp.conversationsPct)}/>
    <Card label="Treatment presented" value={money(c.treatment.presentedValueUGX)} sub={`${c.treatment.plansPresented} plans`}/>
    <Card label="Treatment accepted" value={money(c.treatment.acceptedValueUGX)} sub={`${c.treatment.acceptanceRate}% case acceptance`}/>
   </div></div>

   <Section title="Acquisition → Paying Client Funnel" icon={Target}>
    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
     {[['Leads',c.crm.funnel.leadCount],['Contacted',c.crm.funnel.contactedCount],['Qualified',c.crm.funnel.qualifiedCount],['Converted',c.crm.funnel.convertedCount],['Booked',c.crm.funnel.bookedCount],['Attended',c.crm.funnel.attendedCount],['Treatment accepted',c.crm.funnel.treatmentAcceptedCount],['Paying clients',c.crm.funnel.payingClientCount]].map(([k,v],i)=><div key={String(k)} className="relative rounded-xl bg-slate-50 dark:bg-white/5 p-3 text-center"><p className="text-[10px] uppercase font-bold text-gray-400 min-h-7">{k}</p><p className="text-2xl font-black text-clinic-navy dark:text-white">{v}</p>{i<7&&<span className="hidden lg:block absolute -right-3 top-1/2 text-cyan-400">→</span>}</div>)}
    </div>
    <div className="grid sm:grid-cols-3 gap-3 mt-4"><Card label="Attributed treatment value" value={money(c.crm.attributedRevenue.treatmentValueUGX)}/><Card label="Attributed invoiced" value={money(c.crm.attributedRevenue.invoicedUGX)}/><Card label="Attributed collected" value={money(c.crm.attributedRevenue.collectedUGX)} sub={c.crm.ambiguousPatientCount? `${c.crm.ambiguousPatientCount} ambiguous multi-lead patient(s) excluded`:'Only clean one-lead attribution counted'}/></div>
   </Section>

   <Section title="Business Sources — Which Channels Produce Outcomes?" icon={TrendingUp}>
    {c.crm.sourceAttribution.length?<div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left text-xs uppercase text-gray-400 border-b"><th className="py-3">Source</th><th>Leads</th><th>Booked</th><th>Attended</th><th>Accepted</th><th>Treatment value</th><th>Collected</th></tr></thead><tbody>{c.crm.sourceAttribution.map((s:any)=><tr key={s.source} className="border-b border-gray-50 dark:border-white/5"><td className="py-3 font-bold">{s.source}</td><td>{s.leadCount}</td><td>{s.bookedCount}</td><td>{s.attendedCount}</td><td>{s.treatmentAcceptedCount}</td><td>{money(s.treatmentValueUGX)}</td><td className="font-bold">{money(s.collectedUGX)}</td></tr>)}</tbody></table></div>:<p className="text-sm text-gray-400">No lead-source activity recorded for this period.</p>}
   </Section>

   <div className="grid lg:grid-cols-2 gap-5">
    <Section title="Appointments" icon={CalendarDays}><Rows rows={[['Scheduled appointments',c.appointments.scheduled],['Attended appointments',c.appointments.attended],['Distinct patients seen',c.appointments.patientsSeen],['Show-up rate',c.appointments.showRate+'%'],['Confirmed',c.appointments.confirmed],['Pending',c.appointments.pending],['No-shows',c.appointments.noShows],['Cancelled',c.appointments.cancelled],['Rescheduled / superseded',c.appointments.rescheduled]]}/><p className="mt-3 text-xs text-gray-400">Appointment performance is based on the selected period's booking records and canonical attendance statuses. Clinical movement times are shown separately below.</p></Section>
    <Section title="Live Patient Flow" icon={Users}>
     <div className="mb-4 flex flex-wrap items-center gap-2 text-[10px] font-bold uppercase tracking-wide text-gray-400">
      {['Arrived','Waiting','In Operatory','With Provider','Session Complete','Checkout','Departed'].map((stage,i,arr)=><div key={stage} className="flex items-center gap-2"><span className="rounded-full bg-slate-100 dark:bg-white/10 px-2.5 py-1 text-gray-600 dark:text-gray-300">{stage}</span>{i<arr.length-1&&<span className="text-cyan-400">→</span>}</div>)}
     </div>
     <Rows rows={[['Visits with arrival captured',c.liveFlow.visitsWithArrival],['Reached provider',c.liveFlow.visitsWithProviderStart],['Completed arrival → departure journeys',c.liveFlow.completedJourneys],['Avg. arrival → provider',c.liveFlow.avgArrivalToProviderMinutes==null?'No measured data':c.liveFlow.avgArrivalToProviderMinutes+' min'],['Wait-time sample size',c.liveFlow.waitSamples+' visit(s)'],['Avg. provider → departure',c.liveFlow.avgProviderToDepartureMinutes==null?'No measured data':c.liveFlow.avgProviderToDepartureMinutes+' min'],['Provider-time sample size',c.liveFlow.providerSamples+' visit(s)'],['Avg. total visit',c.liveFlow.avgTotalVisitMinutes==null?'No measured data':c.liveFlow.avgTotalVisitMinutes+' min'],['Total-visit sample size',c.liveFlow.visitSamples+' visit(s)']]}/>
     <p className="mt-3 text-xs text-gray-400">Live Flow uses recorded clinical timestamps only. Averages exclude visits missing the required timestamps rather than estimating them.</p>
    </Section>
    <Section title="Digital Patient Engagement" icon={MessageSquare}><Rows rows={[['Conversations',c.communications.conversations],['Inbound patient messages',c.communications.inboundMessages],['Sarah/agent replies',c.communications.agentMessages],['Human takeovers',c.communications.humanTakeovers],['After-hours inbound',c.communications.afterHoursInbound],['After-hours share',c.communications.afterHoursShare+'%'],['Busiest engagement hour',c.communications.busiestHour||'No measured data'],['Messages in busiest hour',c.communications.busiestHourMessages],['Failed deliveries',c.communications.failedAgentMessages],...Object.entries(c.communications.byChannel).flatMap(([k,v]:any)=>[[`${k} · conversations`,v.conversations],[`${k} · inbound`,v.inbound]] as [string,any][]) ]}/></Section>
    <Section title="Patients Overview" icon={Users}><Rows rows={[['Total patient base',fmt(c.patients.totalPatients)],['Patients seen this period',c.patients.patientsSeen],['New patients',c.patients.newPatients],['Returning patients',c.patients.returningPatients]]}/><p className="mt-3 text-xs text-gray-400">Patient Overview is intentionally limited to patient-base and visit activity. Lead acquisition and CRM operations are reported separately.</p></Section>
    <Section title="CRM Operations" icon={Target}>
     <Rows rows={[['Leads captured this period',c.crm.newLeads],['Avg. first human lead reply',c.crm.avgFirstHumanReplyMinutes==null?'No measured data':c.crm.avgFirstHumanReplyMinutes+' min'],...Object.entries(c.crm.bySource).map(([k,v])=>[`Lead source · ${k}`,v] as [string,any]),['Structured referrals added',c.crmOperations.referralsAdded],['Referral patients accepting treatment',c.crmOperations.referralsAcceptedTreatment],['Active waitlist',c.crmOperations.waitlistActive],['Added to waitlist this period',c.crmOperations.waitlistAdded],['Waitlist fulfilled this period',c.crmOperations.waitlistFulfilled]]}/>
     <p className="mt-3 text-xs text-gray-400">Lead sources come from CRM lead records for the selected period. Referral and waitlist figures come from their recorded CRM operations; they are not inferred from appointment or conversation counts.</p>
    </Section>
    <Section title="Treatment Pipeline & Opportunity" icon={TrendingUp}><Rows rows={[['Plans presented',c.treatment.plansPresented],['Presented value',money(c.treatment.presentedValueUGX)],['Planned',c.treatment.planned],['In progress',c.treatment.inProgress],['Completed',c.treatment.completed],['On hold',c.treatment.onHold],['Follow-up requested',c.treatment.followUpRequested],['Accepted',c.treatment.accepted],['Accepted value',money(c.treatment.acceptedValueUGX)],['Declined',c.treatment.declined],['Acceptance rate',c.treatment.acceptanceRate+'%'],['Period-cohort money at risk',money(c.treatment.moneyAtRiskUGX)]]}/></Section>
    <Section title="Automation Impact" icon={Zap}><Rows rows={[['Automation events created',c.automation.eventsCreated],['Events processed',c.automation.eventsProcessed],['Active sequence enrollments',c.automation.activeEnrollments],['Touches created',c.automation.touchesCreated],['Live automated touches sent',c.automation.touchesSent],['Dry-run touches',c.automation.touchesDryRun],['Pending touches',c.automation.touchesPending],['Failed touches',c.automation.touchesFailed]]}/><p className="mt-3 text-xs text-gray-400">Only recorded automation activity is shown. The report does not invent a staff-hours-saved figure.</p></Section>
    <Section title="Patient Reviews & Satisfaction" icon={Star}>
     <div className="grid sm:grid-cols-2 gap-4">
      <div className="rounded-xl bg-slate-50 dark:bg-white/5 p-4">
       <p className="text-[10px] font-black uppercase tracking-wide text-gray-400 mb-2">Internal patient feedback</p>
       <Rows rows={[['Feedback received this period',c.crmOperations.feedbackReceived],['Average internal rating',c.crmOperations.averageRating==null?'No measured feedback':c.crmOperations.averageRating+'/5']]}/>
       <p className="mt-3 text-xs text-gray-400">These are ratings patients submitted through Code Clinic's own feedback flow. They are not Google reviews.</p>
      </div>
      <div className="rounded-xl bg-slate-50 dark:bg-white/5 p-4">
       <p className="text-[10px] font-black uppercase tracking-wide text-gray-400 mb-2">Google review requests</p>
       <Rows rows={[['Requests created this period',c.crmOperations.reviewRequests],...Object.entries(c.crmOperations.reviewRequestByStatus).map(([k,v])=>[`Request · ${String(k).replace(/_/g,' ').toLowerCase()}`,v] as [string,any])]}/>
       <p className="mt-3 text-xs text-gray-400">This is outbound request activity, not the number of public Google reviews received.</p>
      </div>
     </div>
     <div className="mt-4 rounded-xl border border-dashed border-amber-200 dark:border-amber-400/20 bg-amber-50/60 dark:bg-amber-400/5 p-4">
      <p className="text-sm font-bold text-amber-800 dark:text-amber-300">Google public review performance</p>
      <p className="mt-1 text-xs text-amber-700/80 dark:text-amber-200/60">Live Google rating, public review count and recent-review performance are intentionally not shown in this management report until Google Business Profile review access is available. A missing Google API result must never be presented as “0 reviews”.</p>
     </div>
    </Section>
   </div>

   <Section title="Revenue & Financial Evidence" icon={Wallet}>
    <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
     <Card label="Collections recorded" value={money(c.finance.collectedUGX)} sub="Payment records paid in this period"/>
     <Card label="Paying patients" value={c.finance.payingPatients} sub="Distinct patients with positive recorded payments"/>
     <Card label="Invoices raised" value={money(c.finance.invoicedUGX)} sub="Non-cancelled invoices created this period"/>
     <Card label="Outstanding" value={money(c.finance.outstandingUGX)} sub="Balance on those period invoices"/>
    </div>
    <div className="rounded-xl bg-slate-50 dark:bg-white/5 p-4">
     <p className="text-[10px] font-black uppercase tracking-wide text-gray-400 mb-2">Acquisition-attributed financial evidence</p>
     <Rows rows={[['Attributed treatment value',money(c.crm.attributedRevenue.treatmentValueUGX)],['Attributed invoiced value',money(c.crm.attributedRevenue.invoicedUGX)],['Attributed collected revenue',money(c.crm.attributedRevenue.collectedUGX)],['Paying clients attributed',c.crm.funnel.payingClientCount]]}/>
     <p className="mt-3 text-xs text-gray-400">Attribution is deliberately stricter than clinic-wide finance: only defensible lead → patient relationships are included, with ambiguous multi-lead patients excluded.</p>
    </div>
    <div className="mt-4 rounded-xl border border-dashed border-sky-200 dark:border-sky-400/20 bg-sky-50/60 dark:bg-sky-400/5 p-4">
     <p className="text-sm font-bold text-clinic-navy dark:text-sky-200">Financial coverage</p>
     <p className="mt-1 text-xs text-gray-600 dark:text-sky-100/60">These figures come from Code Clinic's recorded Payment and Invoice tables only. They do not use the dashboard's demo Financial Snapshot and must not be treated as the clinic's complete accounting revenue while QuickBooks payment data is not being synced back into this report.</p>
    </div>
   </Section>

   <div className="grid lg:grid-cols-3 gap-4"><Callout title="Business wins" items={data.wins} tone="win"/><Callout title="Revenue opportunities" items={data.opportunities} tone="opportunity"/><Callout title="Management attention" items={data.attention} tone="attention"/></div>

   <div className="rounded-2xl bg-slate-50 dark:bg-white/5 p-5"><h3 className="font-black text-gray-700 dark:text-white">How to read this report</h3><ul className="mt-3 space-y-1 text-xs text-gray-500 dark:text-white/50 list-disc pl-5">{data.notes.map((n:string)=><li key={n}>{n}</li>)}</ul></div>

   <Section title="Test Email Delivery" icon={Mail}><p className="text-sm text-gray-500 dark:text-white/50 mb-4">Nothing is scheduled yet. Send this exact business-impact report to a test recipient before automatic delivery is enabled.</p><div className="flex flex-col sm:flex-row gap-3"><input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="admin@example.com" className="flex-1 rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-gray-900 px-4 py-2.5 text-sm"/><button disabled={!email||sending} onClick={sendTest} className="rounded-xl bg-cyan-500 disabled:opacity-50 text-white font-bold px-5 py-2.5">{sending?'Sending…':'Send Test Email'}</button></div></Section>
  </>}
 </div>
}
