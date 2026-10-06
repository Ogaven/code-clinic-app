import { prisma } from '../lib/prisma'
import { isAccepted, isDeclined, computeMoneyAtRisk } from './treatment-classification.service'
export type ExecutivePeriod = 'weekly' | 'monthly'
function startOfPeriod(kind: ExecutivePeriod, anchor = new Date()) { const local=new Date(anchor.toLocaleString('en-US',{timeZone:'Africa/Kampala'})); local.setHours(0,0,0,0); if(kind==='weekly'){const day=local.getDay();local.setDate(local.getDate()-((day+6)%7))}else local.setDate(1); return new Date(local.getTime()-10800000) }
function nextPeriod(kind: ExecutivePeriod,start:Date){const d=new Date(start.getTime()+10800000);kind==='weekly'?d.setDate(d.getDate()+7):d.setMonth(d.getMonth()+1);return new Date(d.getTime()-10800000)}
function previousPeriod(kind: ExecutivePeriod,start:Date){const d=new Date(start.getTime()+10800000);kind==='weekly'?d.setDate(d.getDate()-7):d.setMonth(d.getMonth()-1);return new Date(d.getTime()-10800000)}
function pct(c:number,p:number){return p===0?(c===0?0:null):Math.round(((c-p)/p)*1000)/10}
function label(kind:ExecutivePeriod,start:Date,end:Date){const fmt=(d:Date)=>d.toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric',timeZone:'Africa/Kampala'});return kind==='weekly'?`${fmt(start)} – ${fmt(new Date(end.getTime()-1))}`:start.toLocaleDateString('en-GB',{month:'long',year:'numeric',timeZone:'Africa/Kampala'})}
async function snapshot(start:Date,end:Date){
 const range={gte:start,lt:end}
 const [appointments,leads,conversations,messages,plans,payments]=await Promise.all([
  prisma.appointment.findMany({where:{startAt:range},select:{status:true,patientId:true,arrivedAt:true,withProviderAt:true}}),
  prisma.lead.findMany({where:{createdAt:range},select:{status:true,source:true,firstHumanReplyAt:true,createdAt:true}}),
  prisma.aiConversation.findMany({where:{createdAt:range},select:{channel:true,agentEnabled:true}}),
  prisma.aiMessage.findMany({where:{createdAt:range},select:{role:true,status:true}}),
  prisma.treatmentPlan.findMany({where:{createdAt:range},select:{status:true,costPerUnit:true,quantity:true,discount:true,appointments:{select:{status:true,createdAt:true}}}}),
  prisma.payment.findMany({where:{paidAt:range},select:{amountUGX:true}})
 ])
 const seen=new Set(['COMPLETED','CHECKED_OUT','IMPORTED']), cancelled=new Set(['CANCELLED','CANCELLED_RESCHEDULED'])
 const waits=appointments.filter(a=>a.arrivedAt&&a.withProviderAt).map(a=>(a.withProviderAt!.getTime()-a.arrivedAt!.getTime())/60000).filter(n=>n>=0)
 const bySource:Record<string,number>={};for(const l of leads)bySource[l.source]=(bySource[l.source]||0)+1
 const converted=leads.filter(l=>l.status==='CONVERTED').length
 const reply=leads.filter(l=>l.firstHumanReplyAt).map(l=>(l.firstHumanReplyAt!.getTime()-l.createdAt.getTime())/60000).filter(n=>n>=0)
 const byChannel:Record<string,number>={};for(const c of conversations)byChannel[c.channel]=(byChannel[c.channel]||0)+1
 const accepted=plans.filter(p=>isAccepted(p)).length,declined=plans.filter(p=>isDeclined(p)).length,pending=plans.filter(p=>p.status==='Planned'||p.status==='On Hold').length
 return {
  appointments:{scheduled:appointments.length,patientsSeen:new Set(appointments.filter(a=>seen.has(a.status)).map(a=>a.patientId)).size,attended:appointments.filter(a=>seen.has(a.status)).length,confirmed:appointments.filter(a=>a.status==='CONFIRMED').length,pending:appointments.filter(a=>a.status==='PENDING').length,cancelled:appointments.filter(a=>cancelled.has(a.status)).length,noShows:appointments.filter(a=>a.status==='NO_SHOW').length,rescheduled:appointments.filter(a=>a.status==='RESCHEDULED').length,avgWaitMinutes:waits.length?Math.round(waits.reduce((a,b)=>a+b,0)/waits.length):null},
  crm:{newLeads:leads.length,converted,conversionRate:leads.length?Math.round(converted/leads.length*1000)/10:0,avgFirstHumanReplyMinutes:reply.length?Math.round(reply.reduce((a,b)=>a+b,0)/reply.length):null,bySource},
  communications:{conversations:conversations.length,inboundMessages:messages.filter(m=>m.role==='USER').length,agentMessages:messages.filter(m=>m.role==='AGENT').length,humanTakeovers:conversations.filter(c=>!c.agentEnabled).length,failedAgentMessages:messages.filter(m=>m.role==='AGENT'&&m.status==='failed').length,byChannel},
  treatment:{plansPresented:plans.length,accepted,declined,pending,acceptanceRate:plans.length?Math.round(accepted/plans.length*1000)/10:0,moneyAtRiskUGX:computeMoneyAtRisk(plans.map(p=>({status:p.status,appointments:p.appointments,value:Math.round(p.costPerUnit*p.quantity-p.discount)})))},
  finance:{collectedUGX:payments.reduce((s,p)=>s+p.amountUGX,0)}
 }
}
export async function buildExecutiveReport(kind:ExecutivePeriod){
 const start=startOfPeriod(kind),end=nextPeriod(kind,start),prevStart=previousPeriod(kind,start)
 const [current,previous]=await Promise.all([snapshot(start,end),snapshot(prevStart,start)])
 const attention:string[]=[]
 if(current.appointments.noShows)attention.push(`${current.appointments.noShows} no-show appointment(s) recorded in this period.`)
 if(current.appointments.pending)attention.push(`${current.appointments.pending} appointment(s) remain pending.`)
 if(current.communications.failedAgentMessages)attention.push(`${current.communications.failedAgentMessages} agent message(s) recorded as failed delivery.`)
 if(current.treatment.pending)attention.push(`${current.treatment.pending} treatment plan(s) are still planned/on hold.`)
 if(current.treatment.moneyAtRiskUGX)attention.push(`UGX ${current.treatment.moneyAtRiskUGX.toLocaleString('en-US')} is classified as treatment money at risk for plans created in this period.`)
 return {period:{kind,start:start.toISOString(),end:end.toISOString(),label:label(kind,start,end),previousLabel:label(kind,prevStart,start)},generatedAt:new Date().toISOString(),current,previous,comparisons:{scheduledAppointmentsPct:pct(current.appointments.scheduled,previous.appointments.scheduled),patientsSeenPct:pct(current.appointments.patientsSeen,previous.appointments.patientsSeen),leadsPct:pct(current.crm.newLeads,previous.crm.newLeads),conversionsPct:pct(current.crm.converted,previous.crm.converted),conversationsPct:pct(current.communications.conversations,previous.communications.conversations),treatmentAcceptancePointChange:Math.round((current.treatment.acceptanceRate-previous.treatment.acceptanceRate)*10)/10,collectedRevenuePct:pct(current.finance.collectedUGX,previous.finance.collectedUGX)},attention,notes:['Revenue is actual collected payments in the selected period, not CRM-attributed revenue.','Treatment acceptance uses the shared Case Acceptance classification rules.']}
}
