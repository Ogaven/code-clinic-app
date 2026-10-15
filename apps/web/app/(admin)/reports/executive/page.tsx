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
function GoogleReviewSummary() {
 const [state,setState]=useState<{rating:number|null;count:number|null;error:string;loading:boolean}>({rating:null,count:null,error:'',loading:true})
 useEffect(()=>{
  let active=true
  const headers={Authorization:`Bearer ${localStorage.getItem('cc_token') || ''}`}
  const get=async (path:string)=>{const response=await fetch(`/api-proxy/business-profile/${path}`,{headers});const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(data.message||data.error||'Google Business Profile unavailable');return data}
  ;(async()=>{try{
   const status=await get('status')
   if(!status.connected)throw new Error('Google Business Profile is not connected')
   const locations=await get('locations')
   const available=(locations.results||[]).flatMap((item:{account:string;locations?:{name:string;title?:string}[]})=>(item.locations||[]).map(location=>({account:item.account,...location})))
   const chosen=available.find((location:{title?:string})=>/code clinic/i.test(location.title||''))
   if(!chosen)throw new Error('Code Clinic Google location is not available')
   const params=new URLSearchParams({accountId:chosen.account,locationId:chosen.name})
   const summary=await get(`reviews/summary?${params.toString()}`)
   if(summary.averageRating==null||summary.reason)throw new Error('Google review metrics are currently unavailable')
   if(active)setState({rating:Number(summary.averageRating),count:Number(summary.totalReviewCount),error:'',loading:false})
  }catch(error){if(active)setState({rating:null,count:null,error:error instanceof Error?error.message:'Google reviews unavailable',loading:false})}})()
  return()=>{active=false}
 },[])
 return <div className="mt-4 rounded-xl border border-blue-100 dark:border-white/10 bg-blue-50/40 dark:bg-white/5 p-4">
  <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-bold text-clinic-navy dark:text-white">Google public reviews</h3><Link href="/crm/reviews" className="text-sm font-semibold text-blue-700 dark:text-blue-300 underline">Open Google reviews</Link></div>
  {state.loading?<p className="mt-2 text-sm text-gray-500">Loading Google review summary…</p>:state.error?<p className="mt-2 text-sm text-amber-700 dark:text-amber-300">Unavailable: {state.error}. No zero values have been assumed.</p>:<div className="mt-3 grid grid-cols-2 gap-3"><Card label="Google rating" value={state.rating!.toFixed(1)+' / 5'}/><Card label="Public Google reviews" value={state.count!}/></div>}
  <p className="mt-3 text-xs text-gray-500">Google public reviews are distinct from internal patient feedback. Google Search and Maps performance metrics will appear separately when their API access is verified.</p>
 </div>
}
type GoogleMetricSeries = {dailyMetric?:string;timeSeries?:{datedValues?:{date?:{year?:number;month?:number;day?:number};value?:string}[]}}
function GooglePerformance({period}:{period:Period}) {
 const [state,setState]=useState<{loading:boolean;error:string;series:GoogleMetricSeries[];previous:GoogleMetricSeries[];dates:string;previousDates:string}>({loading:true,error:'',series:[],previous:[],dates:'',previousDates:''})
 useEffect(()=>{
  let active=true
  setState({loading:true,error:'',series:[],previous:[],dates:'',previousDates:''})
  const run=async()=>{
   try{
    const headers={Authorization:`Bearer ${localStorage.getItem('cc_token')||''}`}
    const get=async(path:string)=>{const response=await fetch(`/api-proxy/business-profile/${path}`,{headers});const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(data.message||data.error||'Google metrics unavailable');return data}
    const status=await get('status')
    if(!status.connected)throw new Error('Connect Google Business Profile in Review Settings')
    const locations=await get('locations')
    const all=(locations.results||[]).flatMap((group:{locations?:{name:string;title?:string}[]})=>group.locations||[])
    const location=all.find((item:{title?:string})=>/code clinic/i.test(item.title||''))
    if(!location?.name)throw new Error('Code Clinic location not found in Google Business Profile')
    const today=new Date()
    const end=new Date(Date.UTC(today.getUTCFullYear(),today.getUTCMonth(),today.getUTCDate()-1))
    const start=period==='monthly'?new Date(Date.UTC(end.getUTCFullYear(),end.getUTCMonth(),1)):new Date(end.getTime()-6*86400000)
    const iso=(date:Date)=>date.toISOString().slice(0,10)
    const params=new URLSearchParams({locationId:location.name,startDate:iso(start),endDate:iso(end)})
    const data=await get(`performance?${params.toString()}`)
    const duration=end.getTime()-start.getTime()+86400000
    const previousEnd=new Date(start.getTime()-86400000)
    const previousStart=new Date(previousEnd.getTime()-duration+86400000)
    let previous:GoogleMetricSeries[]=[]
    let previousDates='Previous period unavailable'
    try{
     const previousParams=new URLSearchParams({locationId:location.name,startDate:iso(previousStart),endDate:iso(previousEnd)})
     const prior=await get(`performance?${previousParams.toString()}`)
     previous=Array.isArray(prior.metrics)?prior.metrics:[]
     previousDates=`${iso(previousStart)} to ${iso(previousEnd)}`
    }catch{/* The current period remains available if comparison fails. */}
    if(active)setState({loading:false,error:'',series:Array.isArray(data.metrics)?data.metrics:[],previous,dates:`${iso(start)} to ${iso(end)}`,previousDates})
   }catch(error){if(active)setState({loading:false,error:error instanceof Error?error.message:'Google performance unavailable',series:[],previous:[],dates:'',previousDates:''})}
  }
  void run()
  return()=>{active=false}
 },[period])
 const metric=(name:string,source:GoogleMetricSeries[]=state.series):number|null=>{
  const series=source.find(item=>item.dailyMetric===name)
  if(!series?.timeSeries?.datedValues)return null
  return series.timeSeries.datedValues.reduce((sum,item)=>sum+(Number(item.value)||0),0)
 }
 const impressionKeys=['BUSINESS_IMPRESSIONS_DESKTOP_MAPS','BUSINESS_IMPRESSIONS_DESKTOP_SEARCH','BUSINESS_IMPRESSIONS_MOBILE_MAPS','BUSINESS_IMPRESSIONS_MOBILE_SEARCH']
 const impressions=impressionKeys.map(key=>metric(key))
 const totalImpressions=impressions.every(v=>v!==null)?impressions.reduce<number>((sum,v)=>sum+(v||0),0):null
 const impressionSeries=state.series.filter(item=>impressionKeys.includes(item.dailyMetric||''))
 const days=new Map<string,number>()
 impressionSeries.forEach(series=>(series.timeSeries?.datedValues||[]).forEach(point=>{
  const date=point.date
  if(!date?.year||!date.month||!date.day)return
  const key=`${date.year}-${String(date.month).padStart(2,'0')}-${String(date.day).padStart(2,'0')}`
  days.set(key,(days.get(key)||0)+(Number(point.value)||0))
 }))
 const chartDays=[...days.entries()].sort(([a],[b])=>a.localeCompare(b))
 const chartMax=Math.max(1,...chartDays.map(([,value])=>value))
 const priorImpressions=impressionKeys.map(key=>metric(key,state.previous))
 const priorTotal=priorImpressions.every(value=>value!==null)?priorImpressions.reduce<number>((sum,value)=>sum+(value||0),0):null
 const priorMetric=(name:string)=>name==='IMPRESSIONS_TOTAL'?priorTotal:metric(name,state.previous)
 const comparison=(current:number|null,prior:number|null)=>current===null||prior===null?'No comparison':prior===0?(current===0?'No change':'No prior baseline'):`${current>=prior?'+':''}${(((current-prior)/prior)*100).toFixed(1)}% vs previous`
 const items:[string,number|null,string][]=[
  ['Google Search & Maps impressions',totalImpressions, 'IMPRESSIONS_TOTAL'],
  ['Phone call clicks',metric('CALL_CLICKS'), 'CALL_CLICKS'],
  ['Direction requests',metric('BUSINESS_DIRECTION_REQUESTS'), 'BUSINESS_DIRECTION_REQUESTS'],
  ['Website clicks',metric('WEBSITE_CLICKS'), 'WEBSITE_CLICKS'],
  ['Business Profile bookings',metric('BUSINESS_BOOKINGS'), 'BUSINESS_BOOKINGS'],
  ['Business Profile conversations',metric('BUSINESS_CONVERSATIONS'), 'BUSINESS_CONVERSATIONS'],
  ['Search · mobile',impressions[3], 'BUSINESS_IMPRESSIONS_MOBILE_SEARCH'],
  ['Maps · mobile',impressions[2], 'BUSINESS_IMPRESSIONS_MOBILE_MAPS'],
  ['Search · desktop',impressions[1], 'BUSINESS_IMPRESSIONS_DESKTOP_SEARCH'],
  ['Maps · desktop',impressions[0], 'BUSINESS_IMPRESSIONS_DESKTOP_MAPS'],
 ]
 return <div className="mt-4 rounded-xl border border-slate-200 dark:border-white/10 p-4">
  <h3 className="text-sm font-bold text-clinic-navy dark:text-white">Google Search & Maps performance</h3>
  <p className="mt-1 text-xs text-gray-500">Read-only Google Business Profile metrics · {period==='monthly'?'month to yesterday':'last seven completed days'}</p>
  {state.loading?<p className="mt-3 text-sm text-gray-500">Loading Google performance…</p>:state.error?<p className="mt-3 text-sm text-amber-700 dark:text-amber-300">Unavailable: {state.error}. No zero values are assumed.</p>:<>
   <p className="mt-2 text-xs text-gray-500">Current: {state.dates} · Comparison: {state.previousDates}</p>
   <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-3">{items.map(([label,value,key])=><Card key={label} label={label} value={value===null?'Unavailable':fmt(value)} sub={comparison(value,priorMetric(key))}/>)}</div>
   {chartDays.length>0&&<div className="mt-5"><h4 className="mb-2 text-xs font-bold uppercase text-gray-500">Daily Search & Maps impressions</h4><div className="flex h-36 items-end gap-1 overflow-x-auto border-b border-slate-200 pb-1" role="img" aria-label="Daily Google Search and Maps impressions bar chart">{chartDays.map(([day,value])=><div key={day} title={`${day}: ${fmt(value)} impressions`} className="min-w-2 flex-1 rounded-t bg-cyan-500" style={{height:`${Math.max(3,100*value/chartMax)}%`}} />)}</div><div className="mt-1 flex justify-between text-[10px] text-gray-500"><span>{chartDays[0][0]}</span><span>{chartDays[chartDays.length-1][0]}</span></div></div>}
   <p className="mt-3 text-xs text-gray-500">These are Google profile actions and impressions, not clinic appointment bookings or Sarah AI conversations. Missing Google metrics are shown as unavailable.</p>
  </>}
 </div>
}
function GoogleSearchKeywords() {
 const [state,setState]=useState<{loading:boolean;error:string;keywords:{searchKeyword?:string;insightsValue?:{value?:string;threshold?:string}}[];month:string}>({loading:true,error:'',keywords:[],month:''})
 useEffect(()=>{
  let active=true
  const run=async()=>{
   try{
    const headers={Authorization:`Bearer ${localStorage.getItem('cc_token')||''}`}
    const get=async(path:string)=>{const response=await fetch(`/api-proxy/business-profile/${path}`,{headers});const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(data.message||data.error||'Google keywords unavailable');return data}
    const status=await get('status')
    if(!status.connected)throw new Error('Google Business Profile not connected')
    const locations=await get('locations')
    const all=(locations.results||[]).flatMap((group:{locations?:{name:string;title?:string}[]})=>group.locations||[])
    const location=all.find((item:{title?:string})=>/code clinic/i.test(item.title||''))
    if(!location?.name)throw new Error('Code Clinic location not found')
    const now=new Date()
    const previousMonth=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()-1,1))
    const month=previousMonth.toISOString().slice(0,7)
    const params=new URLSearchParams({locationId:location.name,month})
    const data=await get(`search-keywords?${params.toString()}`)
    if(active)setState({loading:false,error:'',keywords:Array.isArray(data.keywords)?data.keywords:[],month})
   }catch(error){if(active)setState({loading:false,error:error instanceof Error?error.message:'Google search keywords unavailable',keywords:[],month:''})}
  }
  void run()
  return()=>{active=false}
 },[])
 return <div className="mt-4 rounded-xl border border-slate-200 dark:border-white/10 p-4">
  <h3 className="text-sm font-bold text-clinic-navy dark:text-white">Google discovery search terms</h3>
  <p className="mt-1 text-xs text-gray-500">Previous completed calendar month · {state.month||'Loading'}</p>
  {state.loading?<p className="mt-3 text-sm text-gray-500">Loading Google search terms…</p>:state.error?<p className="mt-3 text-sm text-amber-700 dark:text-amber-300">Unavailable: {state.error}</p>:state.keywords.length===0?<p className="mt-3 text-sm text-gray-500">Google did not provide search keyword data for this month.</p>:<div className="mt-3 space-y-2">{state.keywords.slice(0,20).map((item,index)=><div key={index} className="flex items-center justify-between gap-4 border-b border-slate-100 py-2 text-sm dark:border-white/10"><span className="text-gray-700 dark:text-white">{item.searchKeyword||'Unspecified term'}</span><strong className="text-clinic-navy dark:text-white">{item.insightsValue?.value!=null?fmt(Number(item.insightsValue.value)):item.insightsValue?.threshold?`Under ${item.insightsValue.threshold}`:'Unavailable'}</strong></div>)}</div>}
  <p className="mt-2 text-xs text-gray-500">Search impressions may be withheld or thresholded by Google. These are not patient enquiries or booked appointments.</p>
 </div>
}
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

   <section aria-label="Executive decision summary" className="rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 p-5">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-black text-clinic-navy dark:text-white">Executive decision summary</h2><p className="mt-1 text-xs text-gray-500">Recorded outcomes for this reporting period — no demo financial figures or estimated savings</p></div><span className="rounded-full bg-sky-50 dark:bg-sky-900/20 px-3 py-1 text-xs font-semibold text-sky-700 dark:text-sky-200">Live clinic records</span></div>
    <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
     <Card label="Appointment show-up" value={c.appointments.showRate+'%'} sub={fmt(c.appointments.attended)+' attended / '+fmt(c.appointments.scheduled)+' scheduled'}/>
     <Card label="Treatment acceptance" value={c.treatment.acceptanceRate+'%'} sub={fmt(c.treatment.accepted)+' accepted treatment plans'}/>
     <Card label="Recorded collections" value={money(c.finance.collectedUGX)} sub="Clinic payment records only; QuickBooks not reconciled"/>
     <Card label="Unresolved treatment opportunity" value={money(c.treatment.moneyAtRiskUGX)} sub="Period-cohort money at risk; not guaranteed revenue"/>
    </div>
    <div className="mt-4 grid gap-3 lg:grid-cols-3">
     <div className="rounded-xl bg-emerald-50 dark:bg-emerald-900/10 p-4"><h3 className="text-sm font-bold text-emerald-800 dark:text-emerald-300">What is working</h3><p className="mt-2 text-sm text-gray-700 dark:text-gray-200">{data.wins?.[0] || 'No verified business win identified for this period.'}</p></div>
     <div className="rounded-xl bg-blue-50 dark:bg-blue-900/10 p-4"><h3 className="text-sm font-bold text-blue-800 dark:text-blue-300">Where to grow</h3><p className="mt-2 text-sm text-gray-700 dark:text-gray-200">{data.opportunities?.[0] || 'No specific revenue opportunity identified for this period.'}</p></div>
     <div className="rounded-xl bg-amber-50 dark:bg-amber-900/10 p-4"><h3 className="text-sm font-bold text-amber-800 dark:text-amber-300">Needs management attention</h3><p className="mt-2 text-sm text-gray-700 dark:text-gray-200">{data.attention?.[0] || 'No specific management alert identified for this period.'}</p></div>
    </div>
   </section>

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
    <Section title="Automation & System Contribution" icon={Zap}>
     <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
      <Card label="Events processed" value={c.automation.eventsProcessed} sub={`${c.automation.eventsCreated} automation event(s) recorded`}/>
      <Card label="Live automated touches" value={c.automation.touchesSent} sub="Recorded sends only — dry runs excluded"/>
      <Card label="Active follow-up journeys" value={c.automation.activeEnrollments} sub="Currently active sequence enrollments"/>
      <Card label="After-hours inbound" value={c.communications.afterHoursInbound} sub="Patient messages received outside clinic opening hours"/>
     </div>
     <div className="grid sm:grid-cols-2 gap-4">
      <div className="rounded-xl bg-slate-50 dark:bg-white/5 p-4">
       <p className="text-[10px] font-black uppercase tracking-wide text-gray-400 mb-2">Follow-up execution</p>
       <Rows rows={[['Touches created this period',c.automation.touchesCreated],['Live touches sent',c.automation.touchesSent],['Pending touches',c.automation.touchesPending],['Failed touches',c.automation.touchesFailed]]}/>
      </div>
      <div className="rounded-xl bg-slate-50 dark:bg-white/5 p-4">
       <p className="text-[10px] font-black uppercase tracking-wide text-gray-400 mb-2">Safety & evidence</p>
       <Rows rows={[['Dry-run touches',c.automation.touchesDryRun],['Automation events created',c.automation.eventsCreated],['Events processed',c.automation.eventsProcessed],['After-hours inbound messages',c.communications.afterHoursInbound]]}/>
      </div>
     </div>
     <p className="mt-3 text-xs text-gray-400">System contribution is based only on persisted automation, scheduled-touch and message records. Dry runs are kept separate from live sends, failures remain visible, and no speculative staff-hours-saved or labour-cost estimate is used.</p>
    </Section>
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
     <GoogleReviewSummary />
     <GooglePerformance period={period} />
     <GoogleSearchKeywords />
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
