// One-shot test: send WhatsApp to clinic front desk via Africa's Talking
// Run: node test-wa-alert.js from /var/www/codeclinic
// Delete after use.

const fs   = require('fs')
const path = require('path')

// Parse .env manually
const envPath = path.join(__dirname, '.env')
const lines   = fs.readFileSync(envPath, 'utf8').split('\n')
for (const line of lines) {
  const m = line.match(/^([^#=\s]+)\s*=\s*(.*)$/)
  if (m) process.env[m[1]] = m[2].trim()
}

const apiKey   = process.env.AT_API_KEY
const username = process.env.AT_USERNAME
const waNumber = process.env.AT_WHATSAPP_NUMBER || process.env.WHATSAPP_PHONE_NUMBER

if (!apiKey || !username || !waNumber) {
  console.error('Missing env vars:', { apiKey: !!apiKey, username: !!username, waNumber })
  process.exit(1)
}

// Resolve africastalking from pnpm store
const atPkg = require.resolve('africastalking', {
  paths: [
    path.join(__dirname, 'node_modules/.pnpm/africastalking@0.7.1/node_modules'),
    path.join(__dirname, 'node_modules'),
    path.join(__dirname, 'apps/api/node_modules'),
  ],
})
const AfricasTalking = require(atPkg)
const at = AfricasTalking({ apiKey, username })

const to   = '+256394836298'
const body = 'Test message from Code Clinic system — please ignore. If you received this, staff alerts are working correctly. ✅'

console.log(`Sending WhatsApp to ${to} via waNumber=${waNumber}...`)

at.WHATSAPP.sendMessage({ waNumber, phoneNumber: to, body: { message: body } })
  .then(res => {
    console.log('SUCCESS:', JSON.stringify(res, null, 2))
  })
  .catch(err => {
    console.error('ERROR:', err?.message || JSON.stringify(err))
    process.exit(1)
  })
