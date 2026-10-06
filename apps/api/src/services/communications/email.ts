import nodemailer from 'nodemailer'

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT) || 587,
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
})

interface CredentialsEmailPayload {
  email: string
  firstName: string
  lastName: string
  role: string
  password: string
}

export async function sendCredentialsEmail(payload: CredentialsEmailPayload) {
  const { email, firstName, lastName, role, password } = payload
  const appUrl = process.env.APP_URL || 'http://localhost:3000'
  const roleName = role.charAt(0) + role.slice(1).toLowerCase()

  await transporter.sendMail({
    from: process.env.SMTP_FROM || '"Code Clinic" <noreply@codeclinic.ug>',
    to: email,
    subject: `Welcome to Code Clinic — Your Login Credentials`,
    html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #F8FAFF; margin: 0; padding: 20px; }
    .card { max-width: 520px; margin: 0 auto; background: white; border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.08); overflow: hidden; }
    .header { background: #1A237E; padding: 32px; text-align: center; }
    .header h1 { color: white; margin: 0; font-size: 22px; }
    .header p { color: #29ABE2; margin: 6px 0 0; font-size: 14px; }
    .body { padding: 32px; }
    .body h2 { color: #1A237E; margin-top: 0; }
    .cred-box { background: #F0F7FF; border: 1px solid #DBEAFE; border-radius: 8px; padding: 16px; margin: 20px 0; }
    .cred-row { display: flex; justify-content: space-between; margin: 6px 0; }
    .cred-label { color: #6B7280; font-size: 13px; }
    .cred-value { color: #1A237E; font-weight: 600; font-size: 13px; font-family: monospace; }
    .btn { display: block; background: #29ABE2; color: white; text-decoration: none; text-align: center; padding: 14px 24px; border-radius: 8px; font-weight: 600; margin: 24px 0; }
    .footer { background: #F9FAFB; padding: 20px 32px; text-align: center; color: #9CA3AF; font-size: 12px; border-top: 1px solid #E5E7EB; }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <h1>🦷 Code Clinic</h1>
      <p>codeclinic.ug · Kiira Road, Kamwokya, Kampala</p>
    </div>
    <div class="body">
      <h2>Welcome, ${firstName}!</h2>
      <p>Your staff account has been created. You have been added as <strong>${roleName}</strong>.</p>
      <p>Here are your login credentials:</p>
      <div class="cred-box">
        <div class="cred-row">
          <span class="cred-label">Email</span>
          <span class="cred-value">${email}</span>
        </div>
        <div class="cred-row">
          <span class="cred-label">Password</span>
          <span class="cred-value">${password}</span>
        </div>
        <div class="cred-row">
          <span class="cred-label">Role</span>
          <span class="cred-value">${roleName}</span>
        </div>
      </div>
      <a href="${appUrl}/login" class="btn">Log in to Code Clinic Dashboard</a>
      <p style="color: #EF4444; font-size: 13px;">
        ⚠️ Please change your password after your first login.
        Keep these credentials private.
      </p>
    </div>
    <div class="footer">
      Code Clinic · Kiira Road, Kamwokya, Kampala, Uganda<br>
      © ${new Date().getFullYear()} Code Clinic. All rights reserved.
    </div>
  </div>
</body>
</html>`,
  })
}

function esc(v: unknown) { return String(v ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]!)) }
export async function sendExecutiveReportEmail(to: string, report: any) {
  const c = report.current
  const ugx = (n:number) => 'UGX ' + Number(n || 0).toLocaleString('en-US')
  const section = (title:string, rows:Array<[string,unknown]>) => `<div style="margin:18px 0;padding:18px;border:1px solid #e5e7eb;border-radius:12px"><h3 style="margin:0 0 12px;color:#1A237E">${esc(title)}</h3>${rows.map(([k,v])=>`<div style="display:flex;justify-content:space-between;gap:20px;padding:6px 0;border-bottom:1px solid #f3f4f6"><span style="color:#64748b">${esc(k)}</span><strong style="color:#0f172a;text-align:right">${esc(v)}</strong></div>`).join('')}</div>`
  const callout = (title:string, items:string[], bg:string, border:string, color:string) => `<div style="margin:14px 0;background:${bg};border:1px solid ${border};border-radius:12px;padding:16px;color:${color}"><strong>${esc(title)}</strong>${items.length?`<ul>${items.map(x=>`<li>${esc(x)}</li>`).join('')}</ul>`:'<p>No items recorded for this period.</p>'}</div>`
  const funnel = c.crm.funnel
  const html=`<!doctype html><html><body style="margin:0;background:#f8fafc;font-family:Arial,sans-serif;color:#0f172a"><div style="max-width:820px;margin:auto;padding:24px">
  <div style="background:linear-gradient(135deg,#0c1e50,#1A237E,#29ABE2);color:white;border-radius:16px;padding:26px"><div style="color:#9ee8ff;font-weight:700;letter-spacing:2px">CODE CLINIC · BUSINESS IMPACT</div><h1 style="margin:8px 0">Business Impact & ROI Report</h1><div>${esc(report.period.label)} · ${esc(report.period.kind.toUpperCase())}</div></div>
  <p style="color:#64748b">Evidence-based management brief generated from Code Clinic operational records. Compared with ${esc(report.period.previousLabel)}.</p>
  ${section('Business impact at a glance',[
    ['Leads captured',funnel.leadCount],['Paying clients attributed',funnel.payingClientCount],
    ['Attributed collected revenue',ugx(c.crm.attributedRevenue.collectedUGX)],['Clinic collections recorded',ugx(c.finance.collectedUGX)],
    ['Patients seen',c.patients.patientsSeen],['Digital conversations',c.communications.conversations],
    ['Treatment presented',ugx(c.treatment.presentedValueUGX)],['Treatment accepted',ugx(c.treatment.acceptedValueUGX)]
  ])}
  ${section('Acquisition → Paying Client Funnel',[
    ['Leads',funnel.leadCount],['Contacted',funnel.contactedCount],['Qualified',funnel.qualifiedCount],['Converted',funnel.convertedCount],
    ['Booked',funnel.bookedCount],['Attended',funnel.attendedCount],['Treatment accepted',funnel.treatmentAcceptedCount],['Paying clients',funnel.payingClientCount],
    ['Attributed treatment value',ugx(c.crm.attributedRevenue.treatmentValueUGX)],['Attributed invoiced',ugx(c.crm.attributedRevenue.invoicedUGX)],['Attributed collected',ugx(c.crm.attributedRevenue.collectedUGX)]
  ])}
  ${section('Appointments & Live Patient Flow',[
    ['Scheduled',c.appointments.scheduled],['Attended appointments',c.appointments.attended],['Distinct patients seen',c.appointments.patientsSeen],['Show-up rate',c.appointments.showRate+'%'],
    ['No-shows',c.appointments.noShows],['Average arrival → provider',c.appointments.avgWaitMinutes==null?'No measured data':c.appointments.avgWaitMinutes+' min'],
    ['Average provider → departure',c.appointments.avgProviderMinutes==null?'No measured data':c.appointments.avgProviderMinutes+' min'],['Average total visit',c.appointments.avgVisitMinutes==null?'No measured data':c.appointments.avgVisitMinutes+' min']
  ])}
  ${section('Digital Patient Engagement',[
    ['Conversations',c.communications.conversations],['Inbound patient messages',c.communications.inboundMessages],['Sarah/agent replies',c.communications.agentMessages],
    ['Human takeovers',c.communications.humanTakeovers],['After-hours inbound',c.communications.afterHoursInbound],['After-hours share',c.communications.afterHoursShare+'%'],
    ['Busiest engagement hour',c.communications.busiestHour||'No measured data'],['Failed deliveries',c.communications.failedAgentMessages]
  ])}
  ${section('Patient Growth & CRM',[
    ['Total patient base',c.patients.totalPatients],['Patients seen',c.patients.patientsSeen],['New patients',c.patients.newPatients],['Returning patients',c.patients.returningPatients],
    ['Structured referrals added',c.crmOperations.referralsAdded],['Referral patients accepting treatment',c.crmOperations.referralsAcceptedTreatment],
    ['Active waitlist',c.crmOperations.waitlistActive],['Waitlist fulfilled',c.crmOperations.waitlistFulfilled]
  ])}
  ${section('Treatment Pipeline & Opportunity',[
    ['Plans presented',c.treatment.plansPresented],['Presented value',ugx(c.treatment.presentedValueUGX)],['Planned',c.treatment.planned],['In progress',c.treatment.inProgress],
    ['Completed',c.treatment.completed],['On hold',c.treatment.onHold],['Follow-up requested',c.treatment.followUpRequested],['Accepted',c.treatment.accepted],
    ['Accepted value',ugx(c.treatment.acceptedValueUGX)],['Acceptance rate',c.treatment.acceptanceRate+'%'],['Period-cohort money at risk',ugx(c.treatment.moneyAtRiskUGX)]
  ])}
  ${section('Automation & Patient Reviews',[
    ['Automation events processed',c.automation.eventsProcessed],['Live automated touches sent',c.automation.touchesSent],['Pending touches',c.automation.touchesPending],['Failed touches',c.automation.touchesFailed],
    ['Patient feedback received',c.crmOperations.feedbackReceived],['Average patient rating',c.crmOperations.averageRating==null?'No measured feedback':c.crmOperations.averageRating+'/5'],['Review requests created',c.crmOperations.reviewRequests]
  ])}
  ${section('Revenue Evidence',[
    ['Clinic collections recorded this period',ugx(c.finance.collectedUGX)],['Paying patients recorded this period',c.finance.payingPatients],
    ['Invoices created this period',ugx(c.finance.invoicedUGX)],['Outstanding on those invoices',ugx(c.finance.outstandingUGX)],
    ['Revenue attributed to acquired-lead cohort',ugx(c.crm.attributedRevenue.collectedUGX)]
  ])}
  ${callout('Business wins',report.wins,'#ecfdf5','#a7f3d0','#166534')}
  ${callout('Revenue opportunities',report.opportunities,'#eff6ff','#bfdbfe','#1e40af')}
  ${callout('Management attention',report.attention,'#fff7ed','#fed7aa','#9a3412')}
  <div style="margin-top:20px;padding:16px;background:#f1f5f9;border-radius:12px"><strong>Evidence notes</strong><ul style="color:#64748b;font-size:12px">${report.notes.map((x:string)=>`<li>${esc(x)}</li>`).join('')}</ul></div>
  <p style="font-size:12px;color:#94a3b8;margin-top:24px">Generated by Code Clinic EMR. Demo financial dashboard values are excluded from this report.</p></div></body></html>`
  await transporter.sendMail({ from: process.env.SMTP_FROM || '"Code Clinic" <noreply@codeclinic.ug>', to, subject: `Code Clinic ${report.period.kind === 'weekly' ? 'Weekly' : 'Monthly'} Business Impact Report — ${report.period.label}`, html })
}

