import 'dotenv/config'
import './lib/env' // Validate env vars at startup — exits if required vars are missing
import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import cookieParser from 'cookie-parser'
import path from 'path'
import fs from 'fs'
import { generalLimiter } from './middleware/rateLimit'
import { runStartup } from './startup'
import { logger } from './lib/logger'
import { prisma } from './lib/prisma'

// Routes
import authRouter from './routes/auth'
import employeesRouter from './routes/employees'
import schedulingRouter from './routes/scheduling'
import patientsRouter from './routes/patients'
import doctorsRouter from './routes/doctors'
import servicesRouter from './routes/services'
import accountsRouter from './routes/accounts'
import aiRouter from './routes/ai'
import crmRouter from './routes/crm'
import campaignsRouter, { runScheduledCampaigns } from './routes/campaigns'
import pipelineRouter from './routes/pipeline'
import developerRouter from './routes/developer'
import integrationsRouter from './routes/integrations'
import receptionistRouter from './routes/receptionist'
import assistantRouter from './routes/assistant'
import agentRouter from './routes/agent'
import websiteLeadRouter from './routes/website-lead'
import websiteChatRouter from './routes/website-chat'
import knowledgeRouter from './routes/knowledge'
import setupRouter from './routes/setup'
import clinicalRouter from './routes/clinical'
import previsitRouter from './routes/previsit'
import quickbooksRouter from './routes/quickbooks'
import stocksRouter from './routes/stocks'
import webhooksRouter from './routes/webhooks'
import auditRouter from './routes/audit'
import aiReportsRouter from './routes/ai-reports'
import permissionsRouter from './routes/permissions'
import manychatRouter from './routes/manychat'

// AI Suite routers
import aiSuiteRouter     from './ai-suite/whatsapp/whatsapp.routes'
import smsRouter         from './ai-suite/sms/sms.routes'
import takeoverRouter    from './ai-suite/takeover/takeover.routes'
import aiKnowledgeRouter from './ai-suite/knowledge/knowledge.routes'
import leadNurtureRouter from './ai-suite/lead-nurture/lead-nurture.routes'
import debtRouter        from './ai-suite/debt/debt.routes'
import voiceRouter       from './ai-suite/voice/voice.routes'
import voiceLlmRouter   from './ai-suite/voice/voice-llm.routes'
import agentControlRouter from './ai-suite/agent-control/agent-control.routes'
import facebookRouter    from './ai-suite/facebook/facebook.routes'
import configRouter      from './ai-suite/config/config.routes'
import connectionsRouter from './ai-suite/connections/connections.routes'
import websiteRouter, { WIDGET_JS } from './ai-suite/website/website.routes'

// Schedulers
// import { startScheduler } from './services/agent/scheduler' // disabled - tables not in schema
import { checkAndSendReminders }           from './ai-suite/scheduler/reminder.service'
import { checkAndSendFollowups, processAfterHoursQueue, checkAndSendPostAppointmentFollowups, checkAndSendMissedCallFollowups, checkAndSendReactivationMessages, checkAndSendAppointmentConfirmations, checkAndSendWeekendReport } from './ai-suite/scheduler/followup.service'
import { checkAndSendLeadNurtureMessages } from './ai-suite/scheduler/lead-nurture-scheduler.service'
import { updatePatientStatuses }           from './ai-suite/scheduler/patient-status.service'
import { initializeSIP }                   from './ai-suite/voice/sip.service'

// Lock process timezone to EAT (UTC+3) — must be set before any Date operations.
process.env.TZ = 'Africa/Nairobi'

const app  = express()
const PORT = process.env.PORT || 4000

// Railway (and most PaaS) run behind a reverse proxy — trust it so that
// express-rate-limit can read the real client IP from X-Forwarded-For
app.set('trust proxy', 1)

// ─── Ensure uploads directory exists (persist on Railway Volume at /data) ──
const uploadsDir = fs.existsSync('/data')
  ? path.join('/data', 'uploads')
  : path.resolve(process.cwd(), 'uploads')
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true })

// ─── Security middleware ───────────────────────────────────────
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}))
const allowedOrigins = [
  'https://codeclinic.ug',
  'https://www.codeclinic.ug',
  ...(process.env.APP_URL || 'http://localhost:3000').split(',').map(o => o.trim()),
]

app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true) // allow non-browser requests (curl, Postman, server-to-server)
    if (allowedOrigins.includes(origin)) return cb(null, true)
    logger.warn({ origin }, 'CORS: rejected request from unlisted origin')
    cb(new Error(`CORS: ${origin} not allowed`))
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}))
app.use(cookieParser())
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true, limit: '10mb' }))
app.use(generalLimiter)

// ─── Static: local upload fallback ────────────────────────────
app.use('/uploads', express.static(uploadsDir))

// ─── Health check ─────────────────────────────────────────────
const startTime = Date.now()
app.get('/health', async (_req, res) => {
  let dbOk = true
  try { await prisma.$queryRaw`SELECT 1` } catch { dbOk = false }

  // Probe optional services
  const emailOk   = !!(process.env.SMTP_HOST || process.env.SENDGRID_API_KEY)
  const pushOk    = !!(process.env.FCM_SERVER_KEY || process.env.ONESIGNAL_APP_ID)
  const storageOk = !!(process.env.R2_BUCKET && process.env.R2_ACCOUNT_ID)
  const redisOk   = !!(process.env.REDIS_URL)

  const uptimeSeconds = Math.floor((Date.now() - startTime) / 1000)
  const status = dbOk ? 'ok' : 'degraded'

  res.status(dbOk ? 200 : 503).json({
    status,
    service: 'CodeClinic API',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    timezone: 'Africa/Nairobi',
    uptime: uptimeSeconds,
    db:     { status: dbOk   ? 'ok' : 'error' },
    redis:  { status: redisOk ? 'ok' : 'noop' },
    services: { email: emailOk, push: pushOk, storage: storageOk },
    checks: { database: dbOk ? 'ok' : 'error' },
  })
})

// ─── Routes ───────────────────────────────────────────────────
app.use('/auth',         authRouter)
app.use('/employees',    employeesRouter)
app.use('/staff',        permissionsRouter)

// Google Calendar OAuth callback alias — Google redirects to this URL
// (integrationsRouter handles /google-calendar/callback internally)
app.get('/scheduling/google/callback', (req, res, next) => {
  req.url = '/google-calendar/callback'
  integrationsRouter(req, res, next)
})

app.use('/scheduling',   schedulingRouter)
app.use('/patients',     patientsRouter)
app.use('/doctors',      doctorsRouter)
app.use('/services',     servicesRouter)
app.use('/stocks',       stocksRouter)
app.use('/accounts',            accountsRouter)
app.use('/accounts/quickbooks', quickbooksRouter)
app.use('/ai',           aiRouter)
app.use('/crm',          crmRouter)
app.use('/campaigns',    campaignsRouter)
app.use('/pipeline',     pipelineRouter)
app.use('/developer',    developerRouter)
app.use('/integrations', integrationsRouter)
app.use('/api/integrations', integrationsRouter)  // alias for OAuth callbacks configured with /api/ prefix
app.use('/receptionist', receptionistRouter)
app.use('/assistant',    assistantRouter)
app.use('/agent',        agentRouter)
app.use('/api/website-lead', websiteLeadRouter)
app.use('/website-chat',     websiteChatRouter)
app.use('/knowledge',    knowledgeRouter)
app.use('/setup',        setupRouter)
app.use('/clinical',     clinicalRouter)
app.use('/pre-visit',    previsitRouter)
app.use('/audit-logs',   auditRouter)
app.use('/ai-suite',     aiReportsRouter)
app.use('/manychat',     manychatRouter)

// ─── Webhooks (Meta, etc.) ────────────────────────────────────
// GET  /webhooks/facebook — Meta webhook verification
// POST /webhooks/facebook — Facebook Messenger events
app.use('/webhooks', webhooksRouter)

// ─── AI Suite ─────────────────────────────────────────────────
// WhatsApp webhook: GET /ai-suite/webhook  POST /ai-suite/webhook
app.use('/ai-suite',              aiSuiteRouter)
// SMS inbound:      POST /ai-suite/sms/incoming
app.use('/ai-suite/sms',          smsRouter)
// Inbox & takeover: GET  /ai-suite/conversations
//                   GET  /ai-suite/conversations/:id/messages
//                   POST /ai-suite/takeover/:id
//                   POST /ai-suite/handback/:id
app.use('/ai-suite',              takeoverRouter)
// Knowledge base:   GET/POST/DELETE /ai-suite/knowledge/...
app.use('/ai-suite/knowledge',    aiKnowledgeRouter)
// Lead nurture:     POST /ai-suite/lead-nurture/trigger
app.use('/ai-suite/lead-nurture', leadNurtureRouter)
// Debt outreach:    POST /ai-suite/debt/trigger
app.use('/ai-suite/debt',         debtRouter)
// Voice calls:      POST /ai-suite/voice/call
//                   POST /ai-suite/voice/no-answer-sms
//                   GET  /ai-suite/voice/calls
//                   GET/POST /ai-suite/voice/settings
//                   GET  /ai-suite/voice/voices
//                   POST /ai-suite/voice/preview
//                   POST /ai-suite/voice/train
//                   PUT  /ai-suite/voice/voices/:id/assign
//                   DELETE /ai-suite/voice/voices/:id
//                   GET  /ai-suite/voice/agent
//                   POST /ai-suite/voice/agent/provision
app.use('/ai-suite/voice',        voiceRouter)
// Voice LLM:        POST /ai-suite/voice/llm  (ElevenLabs ConvAI custom LLM hook)
app.use('/ai-suite/voice',        voiceLlmRouter)
// Agent control:    GET  /ai-suite/agents
//                   POST /ai-suite/agents/:name/toggle
//                   GET/POST /ai-suite/agents/escalation
app.use('/ai-suite',              agentControlRouter)
// Agent config:     GET/PATCH /ai-suite/config
app.use('/ai-suite',              configRouter)
// Connections:      GET/PATCH /ai-suite/connections/whatsapp
//                   GET/DELETE /ai-suite/connections/facebook/status
//                   GET/DELETE /ai-suite/connections/instagram/status
//                   GET/PATCH /ai-suite/connections/sms
//                   GET/POST/PATCH/DELETE /ai-suite/connections/sip-trunks
app.use('/ai-suite',              connectionsRouter)
// Facebook/Instagram webhooks: GET/POST /ai-suite/facebook/webhook
//                              GET/POST /ai-suite/instagram/webhook
app.use('/ai-suite',              facebookRouter)
// Website chatbot:  POST /ai-suite/website/message
//                   GET  /ai-suite/website/messages/:sessionId
app.use('/ai-suite/website',      websiteRouter)

// ─── Chat widget ─────────────────────────────────────────────
// Embeddable <script src="https://api.../widget.js"> snippet
app.get('/widget.js', (_req, res) => {
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate')
  res.setHeader('Pragma', 'no-cache')
  res.send(WIDGET_JS)
})

// Standalone HTML test page — no Next.js chunks, bypasses browser cache issues.
// The Next.js /chatbot-widget route redirects here.
app.get('/chatbot-widget-test', (_req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate')
  res.setHeader('Pragma', 'no-cache')
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Chat with Code Clinic</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: linear-gradient(135deg, #f0f4ff 0%, #e8f4fd 100%);
      gap: 12px;
      padding: 24px;
      text-align: center;
    }
    .icon  { font-size: 48px; }
    h1     { font-size: 22px; font-weight: 700; color: #0c1e50; }
    p      { font-size: 15px; color: #555; max-width: 340px; line-height: 1.5; }
  </style>
</head>
<body>
  <div class="icon">🦷</div>
  <h1>Code Clinic — Live Chat</h1>
  <p>Click the green chat bubble in the bottom-right corner to start a conversation with Sarah, our AI assistant.</p>
  <script
    src="https://api.codeclinicemr.com/widget.js"
    data-clinic-name="Code Clinic">
  </script>
</body>
</html>`)
})

// ─── 404 ──────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: 'Route not found' })
})

// ─── Global error handler ────────────────────────────────────
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[ERROR]', err.message)
  res.status(500).json({ error: 'Internal server error' })
})

// ─── Start ────────────────────────────────────────────────────
runStartup().then(() => {
  // startScheduler() — disabled, outboundQueue/agentMemory tables not in schema

  // SIP voice — connects to drachtio-server (no-op if DRACHTIO_HOST is not set)
  initializeSIP()

  // AI Suite schedulers — run every hour
  const ONE_HOUR = 60 * 60 * 1000
  setInterval(() => {
    checkAndSendReminders().catch(err => console.error('[Reminder] Scheduler error:', err))
  }, ONE_HOUR)
  setInterval(() => {
    checkAndSendFollowups().catch(err => console.error('[Followup] Scheduler error:', err))
  }, ONE_HOUR)
  setInterval(() => {
    processAfterHoursQueue().catch(err => console.error('[AfterHoursQueue] Scheduler error:', err))
  }, ONE_HOUR)
  setInterval(() => {
    checkAndSendPostAppointmentFollowups().catch(err => console.error('[PostApptFollowup] Scheduler error:', err))
  }, ONE_HOUR)
  setInterval(() => {
    checkAndSendLeadNurtureMessages().catch(err => console.error('[LeadNurture] Scheduler error:', err))
  }, ONE_HOUR)
  // Missed call followup — every 30 minutes
  const THIRTY_MINUTES = 30 * 60 * 1000
  setInterval(() => {
    checkAndSendMissedCallFollowups().catch(err => console.error('[MissedCallFollowup] Scheduler error:', err))
  }, THIRTY_MINUTES)

  const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000
  setInterval(() => {
    updatePatientStatuses().catch(err => console.error('[PatientStatus] Scheduler error:', err))
  }, TWENTY_FOUR_HOURS)
  setInterval(() => {
    checkAndSendReactivationMessages().catch(err => console.error('[Reactivation] Scheduler error:', err))
  }, ONE_HOUR)
  setInterval(() => {
    checkAndSendAppointmentConfirmations().catch(err => console.error('[ApptConfirmation] Scheduler error:', err))
  }, ONE_HOUR)

  // Scheduled campaigns — check every 5 minutes
  const FIVE_MINUTES = 5 * 60 * 1000
  setInterval(() => {
    runScheduledCampaigns().catch(err => console.error('[Campaign] Scheduler error:', err))
  }, FIVE_MINUTES)

  // Weekend summary report — check every minute, fires Monday 8 AM EAT only
  const ONE_MINUTE = 60 * 1000
  setInterval(() => {
    checkAndSendWeekendReport().catch(err => console.error('[WeekendReport] Scheduler error:', err))
  }, ONE_MINUTE)

  // Run once 2 minutes after startup (gives DB time to settle after migrations)
  setTimeout(() => {
    checkAndSendReminders().catch(err => console.error('[Reminder] Initial run error:', err))
    checkAndSendFollowups().catch(err => console.error('[Followup] Initial run error:', err))
    checkAndSendLeadNurtureMessages().catch(err => console.error('[LeadNurture] Initial run error:', err))
    updatePatientStatuses().catch(err => console.error('[PatientStatus] Initial run error:', err))
  }, 2 * 60 * 1000)

  app.listen(PORT, () => {
    logger.info({
      port: PORT,
      env: process.env.NODE_ENV || 'development',
      timezone: 'Africa/Nairobi',
    }, 'CodeClinic API started')
  })
})

// ─── Graceful shutdown ───────────────────────────────────────
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received — shutting down gracefully')
  await prisma.$disconnect()
  process.exit(0)
})

process.on('SIGINT', async () => {
  logger.info('SIGINT received — shutting down')
  await prisma.$disconnect()
  process.exit(0)
})

export default app
