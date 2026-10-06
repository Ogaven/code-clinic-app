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
  const section = (title:string, rows:Array<[string,unknown]>) => `<div style="margin:18px 0;padding:18px;border:1px solid #e5e7eb;border-radius:12px"><h3 style="margin:0 0 12px;color:#1A237E">${esc(title)}</h3>${rows.map(([k,v])=>`<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f3f4f6"><span style="color:#64748b">${esc(k)}</span><strong style="color:#0f172a">${esc(v)}</strong></div>`).join('')}</div>`
  const attention = report.attention.length ? `<div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:12px;padding:16px"><strong style="color:#9a3412">Management attention</strong><ul>${report.attention.map((x:string)=>`<li>${esc(x)}</li>`).join('')}</ul></div>` : `<div style="background:#ecfdf5;border:1px solid #a7f3d0;border-radius:12px;padding:16px;color:#166534"><strong>No exception items were detected for this period.</strong></div>`
  const html=`<!doctype html><html><body style="margin:0;background:#f8fafc;font-family:Arial,sans-serif;color:#0f172a"><div style="max-width:760px;margin:auto;padding:24px"><div style="background:#1A237E;color:white;border-radius:16px;padding:26px"><div style="color:#29ABE2;font-weight:700">CODE CLINIC</div><h1 style="margin:8px 0">Admin Executive Report</h1><div>${esc(report.period.label)} · ${esc(report.period.kind.toUpperCase())}</div></div>
  <p style="color:#64748b">A management-level snapshot generated from Code Clinic's operational records. Comparisons are against ${esc(report.period.previousLabel)}.</p>
  ${section('Appointments & Patient Flow',[['Appointments scheduled',c.appointments.scheduled],['Patients seen',c.appointments.patientsSeen],['Attended appointments',c.appointments.attended],['Confirmed',c.appointments.confirmed],['Pending',c.appointments.pending],['Cancelled',c.appointments.cancelled],['No-shows',c.appointments.noShows],['Average arrival-to-provider wait',c.appointments.avgWaitMinutes==null?'No measured data':c.appointments.avgWaitMinutes+' min']])}
  ${section('CRM & Lead Conversion',[['New leads',c.crm.newLeads],['Converted',c.crm.converted],['Conversion rate',c.crm.conversionRate+'%'],['Average first human reply',c.crm.avgFirstHumanReplyMinutes==null?'No measured data':c.crm.avgFirstHumanReplyMinutes+' min']])}
  ${section('Communications',[['New conversations',c.communications.conversations],['Inbound messages',c.communications.inboundMessages],['Agent messages',c.communications.agentMessages],['Human takeovers',c.communications.humanTakeovers],['Failed agent deliveries',c.communications.failedAgentMessages]])}
  ${section('Treatment Pipeline',[['Plans presented',c.treatment.plansPresented],['Accepted',c.treatment.accepted],['Pending / on hold',c.treatment.pending],['Declined',c.treatment.declined],['Acceptance rate',c.treatment.acceptanceRate+'%'],['Money at risk',ugx(c.treatment.moneyAtRiskUGX)]])}
  ${section('Collections',[['Collected revenue',ugx(c.finance.collectedUGX)]])}${attention}
  <p style="font-size:12px;color:#94a3b8;margin-top:24px">Revenue shown is actual recorded collections for the period, not assumed CRM-attributed revenue. Generated by Code Clinic EMR.</p></div></body></html>`
  await transporter.sendMail({ from: process.env.SMTP_FROM || '"Code Clinic" <noreply@codeclinic.ug>', to, subject: `Code Clinic ${report.period.kind === 'weekly' ? 'Weekly' : 'Monthly'} Executive Report — ${report.period.label}`, html })
}
