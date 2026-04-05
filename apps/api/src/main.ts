import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import cookieParser from 'cookie-parser'
import path from 'path'
import fs from 'fs'
import { generalLimiter } from './middleware/rateLimit'
import { runStartup } from './startup'

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
import campaignsRouter from './routes/campaigns'
import developerRouter from './routes/developer'
import integrationsRouter from './routes/integrations'
import receptionistRouter from './routes/receptionist'
import assistantRouter from './routes/assistant'

const app = express()
const PORT = process.env.PORT || 4000

// ─── Ensure uploads directory exists ──────────────────────────
const uploadsDir = path.resolve(process.cwd(), 'uploads')
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true })

// ─── Security middleware ───────────────────────────────────────
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}))
const allowedOrigins = (process.env.APP_URL || 'http://localhost:3000')
  .split(',')
  .map(o => o.trim())

app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true) // allow non-browser requests
    if (allowedOrigins.some(o => origin === o || origin.endsWith('.railway.app') || origin.endsWith('.up.railway.app'))) {
      return cb(null, true)
    }
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
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'CodeClinic API',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    timezone: 'Africa/Kampala',
  })
})

// ─── Routes ───────────────────────────────────────────────────
app.use('/auth', authRouter)
app.use('/employees', employeesRouter)
app.use('/scheduling', schedulingRouter)
app.use('/patients', patientsRouter)
app.use('/doctors', doctorsRouter)
app.use('/services', servicesRouter)
app.use('/accounts', accountsRouter)
app.use('/ai', aiRouter)
app.use('/crm', crmRouter)
app.use('/campaigns', campaignsRouter)
app.use('/developer', developerRouter)
app.use('/integrations', integrationsRouter)
app.use('/receptionist', receptionistRouter)
app.use('/assistant', assistantRouter)

// ─── 404 ──────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: 'Route not found' })
})

// ─── Global error handler ────────────────────────────────────
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[ERROR]', err.message)
  res.status(500).json({ error: 'Internal server error' })
})

runStartup().then(() => {
  app.listen(PORT, () => {
    console.log(`\n🦷 CodeClinic API running on http://localhost:${PORT}`)
    console.log(`   Environment: ${process.env.NODE_ENV || 'development'}`)
    console.log(`   Timezone:    Africa/Kampala\n`)
  })
})

export default app
