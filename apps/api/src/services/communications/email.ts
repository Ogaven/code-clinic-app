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
