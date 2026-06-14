# Agent Instructions — CodeClinic Unified Clinic Operating System

You are building the most complete, production-ready clinic management system ever built for a Ugandan dental practice. This replaces SimplyBook.me, Go High Level, Zoho Books, QuickBooks, Vapi, n8n, and ChatDash — all in one product. The client is Dr. Steven Mugabe, founder of CODE Clinic (codeclinic.ug), Kiira Road, Kamwokya, Kampala, Uganda. Established 2012. Mission: "Deliver a WOW dental experience while saving lives through oral-systemic health."

Read this entire file before writing a single line of code. This is not a prototype.

---

## Competitive Benchmark — What We Are Beating

| We Replace | With |
|---|---|
| SimplyBook.me | Native scheduling — multi-doctor columns, drag-to-book, doctor self-managed slots |
| Go High Level | Full CRM — quizzes, funnels, social media management, website visitor tracking, GBP |
| Zoho Books | Full accounts — invoicing, payments, payroll, P&L, cash flow, better UI |
| QuickBooks | Integrated into accounts module, no separate app |
| Vapi.ai | Native AI callers — voice studio, cloning, RAG, two-way, escalation |
| n8n | Built-in automation engine — no external workflow tool needed |
| ChatDash | Native AI caller KPI dashboard with full conversation playback |

The client must never want to return to any of these tools.

---

## What You Are Building

### Core Modules
1. **Scheduling** — SimplyBook.me-level UI but superior. Multi-doctor columns, colour-coded slots, doctor-managed blocked time, service/doctor matrix.
2. **AI Agent Suite** — One unified agent with multiple responsibilities: inbound booking, outbound reminders, post-visit follow-up, debt reminders, website visitor engagement, birthday/promo campaigns. Two-way calling and WhatsApp. Ugandan personality.
3. **Voice Studio** — Prompt editor, voice cloning, accent training, test preview. Non-technical admin can manage everything.
4. **Call Recordings & KPI Dashboard** — Every call recorded on Cloudflare R2, playable with transcript, quality scoring. ChatDash-level KPI view of all caller metrics.
5. **CRM (GHL-level)** — Patient database, lead management, quiz builder, funnel builder, social media management (FB, Instagram, TikTok), website visitor capture pop-up, Google Business Profile (GBP) management, QR code lead capture.
6. **Knowledge Base** — Accepts PDF, images, audio, video, links, screenshots, text. Trains the AI agent on all of it.
7. **Accounts (Zoho Books level+)** — Invoicing, dual currency (UGX/USD), MTN MoMo/Airtel/card payments, patient accounts, expenses, payroll (NSSF/PAYE), P&L, cash flow, debt aging. Every patient has an account opened automatically.
8. **Lead Nurture** — WhatsApp and SMS drip campaigns. Birthday messages. Promo blasts. Quiz-based lead scoring.
9. **Role-Based Dashboards** — Admin (Dr. Steven), Doctor, Receptionist, Accounts. Each sees only their scope. Beautiful, fast, never slow.
10. **Platform AI Assistant** — Role-aware floating chatbot on every page. Admin gets everything. Others get their scope. Can edit agent prompts.
11. **Patient App (V1)** — Flutter mobile app for patients: book, reschedule, cancel, feedback, health tips.
12. **Developer Dashboard** — Separate panel for you as the developer: system health, KPIs, error logs, support tickets, client activity.
13. **Employee Management** — Admin adds staff, system sends credentials + download links via email. Role assignment, access control.
14. **Offline Access** — Core features (schedule view, patient lookup, note-taking) work offline. Sync on reconnect.
15. **Integrations** — Google Sheets export, email (Gmail/SMTP), payment gateways (MTN MoMo, Airtel Money, Visa/Mastercard via Pesapal or DPO), Google Business Profile API.
16. **UI Polish** — Live clock with nice curves, current weather widget (Kampala), date display on every dashboard. Beautiful throughout.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Web Frontend | Next.js 14 (App Router) + TypeScript + Tailwind CSS + shadcn/ui |
| Mobile App (Patient + Admin mobile) | Flutter (iOS + Android + PWA from one codebase) |
| Backend | Node.js + Express + TypeScript |
| Database | PostgreSQL + Prisma ORM |
| Vector Search | pgvector extension (knowledge base RAG) |
| Auth | JWT (15min) + Refresh tokens (7 days, httpOnly) + TOTP 2FA |
| Caching / Sessions | Redis |
| Communications | Africa's Talking (voice SIP, WhatsApp, SMS — Uganda numbers) |
| AI Agent & Assistant | Anthropic Claude API (`claude-sonnet-4-6`) |
| Voice Cloning / TTS | ElevenLabs API (primary) + Africa's Talking TTS (fallback) |
| Call Recordings | Cloudflare R2 (object storage) + signed URL playback |
| File Storage | Cloudflare R2 (audio, images, videos, documents) |
| Knowledge Base Ingestion | PDF: pdfjs / PyMuPDF · Images: Claude vision · Audio/Video: Whisper transcription → embed |
| Payment Gateways | Pesapal (MTN MoMo, Airtel Money, Visa, Mastercard) — Uganda-native |
| Social Media APIs | Meta Graph API (FB/Instagram), TikTok API |
| Google Integrations | Google Sheets API, Google Business Profile API, Gmail API |
| Website Visitor Tracking | Custom pixel script embedded on codeclinic.ug |
| Containerisation | Docker + docker-compose |
| Reverse Proxy | Nginx |
| CI/CD | GitHub Actions → auto-deploy to Hetzner VPS on push to `main` |
| Monitoring | Portainer + custom uptime WhatsApp alerts |

---

## Project File Structure

```
codeclinic/
│
├── apps/
│   ├── web/                               # Next.js 14 — staff web app
│   │   ├── app/
│   │   │   ├── (auth)/login/ 2fa/
│   │   │   ├── (admin)/
│   │   │   │   ├── dashboard/             # Clock, weather, KPIs, ChatDash KPIs
│   │   │   │   ├── scheduling/            # SimplyBook-style multi-column calendar
│   │   │   │   ├── patients/              # Full CRM patient list + profiles
│   │   │   │   ├── crm/
│   │   │   │   │   ├── leads/
│   │   │   │   │   ├── funnels/
│   │   │   │   │   ├── quizzes/
│   │   │   │   │   ├── social/            # FB, Instagram, TikTok manager
│   │   │   │   │   ├── gbp/               # Google Business Profile
│   │   │   │   │   └── website-visitors/  # Live visitor feed + pop-up config
│   │   │   │   ├── accounts/
│   │   │   │   │   ├── dashboard/         # Zoho Books-style but better
│   │   │   │   │   ├── invoices/
│   │   │   │   │   ├── payments/
│   │   │   │   │   ├── expenses/
│   │   │   │   │   ├── payroll/
│   │   │   │   │   └── reports/
│   │   │   │   ├── ai-suite/
│   │   │   │   │   ├── voice-studio/      # Prompts, voices, clone, preview
│   │   │   │   │   ├── recordings/        # Call library + player + KPIs
│   │   │   │   │   ├── knowledge-base/    # Upload all media types
│   │   │   │   │   └── agent-config/      # Enable/disable agent responsibilities
│   │   │   │   ├── employees/             # Add staff, send credentials
│   │   │   │   ├── campaigns/             # Birthday, promo, WhatsApp blasts
│   │   │   │   ├── qr-capture/            # QR code generator + lead form config
│   │   │   │   ├── audit-logs/
│   │   │   │   └── settings/
│   │   │   ├── (doctor)/
│   │   │   │   ├── dashboard/
│   │   │   │   ├── schedule/              # Own day view, block time
│   │   │   │   └── patients/
│   │   │   ├── (receptionist)/
│   │   │   │   ├── dashboard/             # Escalation alerts front and centre
│   │   │   │   ├── scheduling/
│   │   │   │   └── ai-activity/
│   │   │   └── (accounts)/
│   │   │       ├── dashboard/
│   │   │       ├── invoices/
│   │   │       ├── payments/
│   │   │       ├── expenses/
│   │   │       ├── payroll/
│   │   │       └── reports/
│   │   ├── components/
│   │   │   ├── ui/
│   │   │   ├── scheduling/
│   │   │   │   ├── MultiDoctorCalendar.tsx  # The SimplyBook-style column view
│   │   │   │   ├── AppointmentSlot.tsx
│   │   │   │   ├── BlockTimeModal.tsx
│   │   │   │   └── BookingDrawer.tsx
│   │   │   ├── accounts/
│   │   │   ├── crm/
│   │   │   ├── ai-suite/
│   │   │   │   ├── VoiceStudio/
│   │   │   │   ├── RecordingPlayer/
│   │   │   │   └── CallerKPIs/            # ChatDash-level metrics
│   │   │   ├── assistant/
│   │   │   │   ├── FloatingAssistant.tsx  # On every page, every role
│   │   │   │   └── AssistantChat.tsx
│   │   │   └── layout/
│   │   │       ├── ClockWeatherWidget.tsx # Live clock + Kampala weather + date
│   │   │       └── EscalationBanner.tsx   # Alert bar for receptionist
│   │   └── public/manifest.json           # PWA manifest
│   │
│   ├── mobile/                            # Flutter app (patient + admin mobile)
│   │   ├── lib/
│   │   │   ├── main.dart
│   │   │   ├── screens/
│   │   │   │   ├── patient/
│   │   │   │   │   ├── home.dart
│   │   │   │   │   ├── book_appointment.dart
│   │   │   │   │   ├── my_appointments.dart
│   │   │   │   │   ├── feedback.dart
│   │   │   │   │   └── health_tips.dart
│   │   │   │   └── admin/
│   │   │   │       ├── dashboard.dart     # Dr. Steven mobile control panel
│   │   │   │       ├── schedule.dart
│   │   │   │       ├── patients.dart
│   │   │   │       └── reports.dart
│   │   │   ├── services/
│   │   │   │   ├── api.dart
│   │   │   │   ├── auth.dart
│   │   │   │   └── offline_cache.dart     # Hive for offline storage
│   │   │   └── widgets/
│   │   └── pubspec.yaml
│   │
│   └── api/                               # Node.js + Express backend
│       ├── src/
│       │   ├── main.ts
│       │   ├── routes/
│       │   │   ├── auth.ts
│       │   │   ├── scheduling.ts
│       │   │   ├── patients.ts
│       │   │   ├── doctors.ts
│       │   │   ├── services.ts
│       │   │   ├── accounts/
│       │   │   │   ├── invoices.ts
│       │   │   │   ├── payments.ts
│       │   │   │   ├── expenses.ts
│       │   │   │   ├── payroll.ts
│       │   │   │   └── reports.ts
│       │   │   ├── crm/
│       │   │   │   ├── leads.ts
│       │   │   │   ├── quizzes.ts
│       │   │   │   ├── funnels.ts
│       │   │   │   └── social.ts
│       │   │   ├── ai/
│       │   │   │   ├── agent.ts
│       │   │   │   ├── voice-studio.ts
│       │   │   │   ├── recordings.ts
│       │   │   │   ├── knowledge.ts
│       │   │   │   └── assistant.ts
│       │   │   ├── campaigns.ts
│       │   │   ├── employees.ts
│       │   │   ├── qr.ts
│       │   │   ├── integrations/
│       │   │   │   ├── google-sheets.ts
│       │   │   │   ├── gbp.ts
│       │   │   │   └── email.ts
│       │   │   ├── webhooks.ts
│       │   │   └── developer.ts           # Developer dashboard API
│       │   ├── services/
│       │   │   ├── ai/
│       │   │   │   ├── claude.ts
│       │   │   │   ├── rag.ts
│       │   │   │   ├── assistant.ts
│       │   │   │   └── agent/
│       │   │   │       └── unified-agent.ts  # One agent, all responsibilities
│       │   │   ├── voice/
│       │   │   │   ├── elevenlabs.ts
│       │   │   │   ├── tts-fallback.ts
│       │   │   │   └── recorder.ts
│       │   │   ├── communications/
│       │   │   │   ├── africastalking.ts
│       │   │   │   ├── voice.ts
│       │   │   │   ├── whatsapp.ts
│       │   │   │   └── sms.ts
│       │   │   ├── knowledge/
│       │   │   │   ├── pdf-ingester.ts
│       │   │   │   ├── image-ingester.ts    # Claude vision
│       │   │   │   ├── audio-ingester.ts    # Whisper → text → embed
│       │   │   │   ├── video-ingester.ts    # Whisper → text → embed
│       │   │   │   └── link-ingester.ts     # Crawl URL → embed
│       │   │   ├── storage/
│       │   │   │   └── r2.ts
│       │   │   ├── payments/
│       │   │   │   └── pesapal.ts
│       │   │   ├── integrations/
│       │   │   │   ├── google-sheets.ts
│       │   │   │   ├── gbp.ts
│       │   │   │   └── email.ts
│       │   │   ├── scheduler/
│       │   │   │   └── cron.ts
│       │   │   └── accounts/
│       │   │       ├── invoicing.ts
│       │   │       └── reports.ts
│       │   └── middleware/
│       │       ├── auth.ts
│       │       ├── rbac.ts
│       │       ├── audit.ts
│       │       ├── validate.ts
│       │       └── rateLimit.ts
│       └── tsconfig.json
│
├── packages/database/
│   └── prisma/
│       ├── schema.prisma
│       ├── migrations/
│       └── seed.ts
│
├── developer-dashboard/                   # Separate Next.js app for you (the developer)
│   └── app/
│       ├── health/                        # System uptime, API status, DB health
│       ├── kpis/                          # Client usage KPIs
│       ├── errors/                        # Error logs, crash reports
│       └── tickets/                       # Support ticket inbox
│
├── website-pixel/                         # Tiny JS snippet for codeclinic.ug
│   └── pixel.js                           # Captures visitor → triggers agent
│
├── docker-compose.yml
├── docker-compose.prod.yml
├── nginx.conf
├── .env.example
├── .github/workflows/deploy.yml
└── README.md
```

---

## Database Schema

```prisma
model User {
  id            String    @id @default(uuid())
  email         String    @unique
  password_hash String
  role          Role
  totp_secret   String?
  totp_enabled  Boolean   @default(false)
  is_active     Boolean   @default(true)
  last_login_at DateTime?
  avatar_url    String?
  created_at    DateTime  @default(now())
  doctor        Doctor?
  audit_logs    AuditLog[]
  assistant_messages AssistantMessage[]
}

enum Role { ADMIN DOCTOR RECEPTIONIST ACCOUNTS DEVELOPER }

model Doctor {
  id             String        @id @default(uuid())
  user_id        String        @unique
  user           User          @relation(fields: [user_id], references: [id])
  name           String
  specialisation String
  working_days   Json          // ["MON","WED","FRI"]
  working_hours  Json          // {"start":"08:00","end":"17:00"}
  colour         String        // Hex for calendar column colour
  avatar_url     String?
  appointments   Appointment[]
  blocked_times  BlockedTime[]
}

model BlockedTime {
  id        String   @id @default(uuid())
  doctor_id String
  doctor    Doctor   @relation(fields: [doctor_id], references: [id])
  start_at  DateTime
  end_at    DateTime
  reason    String?
  created_at DateTime @default(now())
}

model Patient {
  id                      String        @id @default(uuid())
  full_name               String
  phone                   String        @unique
  email                   String?
  date_of_birth           DateTime?
  gender                  String?
  address                 String?
  medical_notes_encrypted String?       // AES-256
  account_opened_at       DateTime      @default(now())
  category                String?       // "vip", "preventive_plan", "orthodontic", etc.
  referral_source         String?
  is_active               Boolean       @default(true)
  created_at              DateTime      @default(now())
  appointments            Appointment[]
  invoices                Invoice[]
  agent_logs              AgentLog[]
  feedback                PatientFeedback[]
}

model PatientFeedback {
  id           String   @id @default(uuid())
  patient_id   String
  patient      Patient  @relation(fields: [patient_id], references: [id])
  rating       Int      // 1-5
  comment      String?
  visit_date   DateTime
  submitted_via String  // "app", "whatsapp", "qr"
  created_at   DateTime @default(now())
}

model Service {
  id               String        @id @default(uuid())
  name             String
  description      String?
  duration_minutes Int
  price_ugx        Decimal
  price_usd        Decimal?
  vat_applicable   Boolean       @default(true)
  is_active        Boolean       @default(true)
  colour           String?       // Appointment block colour
  appointments     Appointment[]
}

model Appointment {
  id           String            @id @default(uuid())
  patient_id   String
  patient      Patient           @relation(fields: [patient_id], references: [id])
  doctor_id    String
  doctor       Doctor            @relation(fields: [doctor_id], references: [id])
  service_id   String
  service      Service           @relation(fields: [service_id], references: [id])
  scheduled_at DateTime
  end_at       DateTime
  status       AppointmentStatus @default(PENDING)
  notes        String?
  created_by   String
  created_at   DateTime          @default(now())
  invoice      Invoice?
  reminder_sent Boolean          @default(false)
  confirmed_at  DateTime?
}

enum AppointmentStatus {
  PENDING CONFIRMED CANCELLED COMPLETED NO_SHOW
}

model Invoice {
  id             String        @id @default(uuid())
  patient_id     String
  patient        Patient       @relation(fields: [patient_id], references: [id])
  appointment_id String?       @unique
  appointment    Appointment?  @relation(fields: [appointment_id], references: [id])
  line_items     Json
  subtotal_ugx   Decimal
  vat_amount     Decimal       @default(0)
  total_ugx      Decimal
  currency       Currency      @default(UGX)
  exchange_rate  Decimal?
  status         InvoiceStatus @default(DRAFT)
  due_date       DateTime?
  paid_at        DateTime?
  created_at     DateTime      @default(now())
  payments       Payment[]
}

enum Currency      { UGX USD }
enum InvoiceStatus { DRAFT SENT PAID PARTIAL OVERDUE CANCELLED }

model Payment {
  id          String        @id @default(uuid())
  invoice_id  String
  invoice     Invoice       @relation(fields: [invoice_id], references: [id])
  amount      Decimal
  method      PaymentMethod
  reference   String?
  gateway_ref String?       // Pesapal transaction ID
  recorded_by String
  created_at  DateTime      @default(now())
}

enum PaymentMethod {
  CASH MTN_MOMO AIRTEL_MONEY VISA MASTERCARD BANK_TRANSFER USD_CASH
}

model Expense {
  id           String   @id @default(uuid())
  category     String
  description  String
  amount_ugx   Decimal
  receipt_url  String?
  recorded_by  String
  expense_date DateTime
  created_at   DateTime @default(now())
}

model StaffPayroll {
  id         String    @id @default(uuid())
  user_id    String
  period     String
  gross_ugx  Decimal
  nssf_ugx   Decimal
  paye_ugx   Decimal
  net_ugx    Decimal
  payslip_url String?
  paid_at    DateTime?
  created_at DateTime  @default(now())
}

model AuditLog {
  id          String   @id @default(uuid())
  user_id     String
  user        User     @relation(fields: [user_id], references: [id])
  action      String
  entity_type String
  entity_id   String?
  metadata    Json?
  ip_address  String?
  created_at  DateTime @default(now())
}

model AgentLog {
  id             String         @id @default(uuid())
  agent_type     AgentType
  channel        Channel
  patient_id     String?
  patient        Patient?       @relation(fields: [patient_id], references: [id])
  phone_number   String?        // For leads without a patient record yet
  outcome        String
  transcript     Json?          // [{role, content, timestamp_s}]
  duration_s     Int?
  escalated      Boolean        @default(false)
  escalation_note String?
  recording_id   String?
  recording      CallRecording? @relation(fields: [recording_id], references: [id])
  created_at     DateTime       @default(now())
}

enum AgentType { BOOKING REMINDER FOLLOWUP DEBT VISITOR_CAPTURE BIRTHDAY PROMO }
enum Channel   { VOICE WHATSAPP SMS }

model CallRecording {
  id            String     @id @default(uuid())
  agent_log     AgentLog[]
  patient_id    String?
  agent_type    AgentType
  r2_key        String
  duration_s    Int
  transcript    Json?      // [{speaker:"AGENT"|"PATIENT", text, timestamp_s}]
  quality_score Int?       // Admin 1-5 rating
  admin_notes   String?
  created_at    DateTime   @default(now())
}

model AgentPrompt {
  id            String    @id @default(uuid())
  agent_type    AgentType
  name          String
  system_prompt String
  voice_id      String?
  voice_name    String?
  language      String    @default("en")
  tone          String    @default("friendly")
  personality   String    @default("ugandan_warm")
  is_active     Boolean   @default(false)
  version       Int       @default(1)
  created_by    String
  created_at    DateTime  @default(now())
  updated_at    DateTime  @updatedAt
}

model VoiceProfile {
  id                  String   @id @default(uuid())
  name                String
  elevenlabs_voice_id String   @unique
  sample_url          String?
  is_cloned           Boolean  @default(false)
  is_active           Boolean  @default(true)
  created_by          String
  created_at          DateTime @default(now())
}

model KnowledgeBase {
  id           String   @id @default(uuid())
  title        String
  content      String   // Extracted/transcribed text
  embedding    Unsupported("vector(1536)")?
  source_type  String   // "pdf","image","audio","video","link","screenshot","text"
  file_url     String?
  agent_types  Json     // Which agents can use this chunk
  is_active    Boolean  @default(true)
  created_at   DateTime @default(now())
}

model Lead {
  id                   String    @id @default(uuid())
  full_name            String?
  phone                String
  email                String?
  source               String    // "website_popup","qr","facebook","instagram","quiz","referral"
  quiz_topic           String?
  quiz_score           Int?
  funnel_stage         String    @default("new")
  lead_score           Int       @default(0)
  notes                String?
  last_contacted_at    DateTime?
  converted_patient_id String?
  created_at           DateTime  @default(now())
  nurture_messages     NurtureLog[]
}

model NurtureLog {
  id         String   @id @default(uuid())
  lead_id    String
  lead       Lead     @relation(fields: [lead_id], references: [id])
  channel    Channel
  message    String
  sent_at    DateTime @default(now())
  status     String   // "sent","delivered","read","failed"
}

model Quiz {
  id          String   @id @default(uuid())
  title       String
  topic       String
  questions   Json     // [{question, options, correct_answer, score_weight}]
  result_text Json     // {low, medium, high} — what to show after quiz
  is_active   Boolean  @default(true)
  created_at  DateTime @default(now())
}

model Campaign {
  id           String    @id @default(uuid())
  name         String
  type         CampaignType
  channel      Channel
  message      String
  media_url    String?
  scheduled_at DateTime?
  sent_at      DateTime?
  target       Json      // {birthday: true} or {category: "orthodontic"} or {all: true}
  status       String    @default("draft")
  created_by   String
  created_at   DateTime  @default(now())
}

enum CampaignType { BIRTHDAY PROMO FOLLOWUP REACTIVATION }

model QRCapture {
  id           String   @id @default(uuid())
  label        String
  questions    Json     // Form fields to show after scan
  destination  String   // "google_sheets" | "crm"
  sheet_id     String?
  scan_count   Int      @default(0)
  created_at   DateTime @default(now())
}

model WebsiteVisitor {
  id           String   @id @default(uuid())
  session_id   String   @unique
  page_url     String
  referrer     String?
  name         String?
  phone        String?
  captured_at  DateTime?
  contacted    Boolean  @default(false)
  agent_log_id String?
  created_at   DateTime @default(now())
}

model AssistantMessage {
  id           String   @id @default(uuid())
  user_id      String
  user         User     @relation(fields: [user_id], references: [id])
  role         String   // "user" | "assistant"
  content      String
  page_context String?
  created_at   DateTime @default(now())
}

model SupportTicket {
  id           String   @id @default(uuid())
  title        String
  description  String
  status       String   @default("open")
  priority     String   @default("normal")
  created_at   DateTime @default(now())
  resolved_at  DateTime?
}
```

---

## Build Order — Follow This Exactly

### Phase 1 — Monorepo Scaffold & Database
1. Initialise monorepo with workspaces (web, mobile, api, packages/database, developer-dashboard)
2. Prisma schema, `prisma generate`, first migration
3. `docker-compose.yml` — services: postgres, redis, api, web
4. Enable `pgvector` in Postgres init script
5. Run seed data (see Seed Data section)
6. Verify: `docker compose up` runs with no errors

### Phase 2 — Authentication & Employee Management
1. Express app — CORS, Helmet, rate limiting, body parsing
2. Auth routes: login, refresh, logout, 2FA setup, 2FA verify
3. `middleware/auth.ts`, `middleware/rbac.ts`, `middleware/audit.ts`, `middleware/validate.ts`
4. `POST /employees` — Admin creates staff, system auto-generates secure password, sends email with credentials and Flutter app download link
5. `GET /employees` — list all staff with role and last login
6. `PATCH /employees/:id/role` — change role, revoke access
7. Verify: Employee receives email, logs in, sees only their dashboard

### Phase 3 — Scheduling Module (SimplyBook.me Level)

The scheduling UI is the most-used screen. It must feel fast, beautiful, and intuitive. Reference the SimplyBook.me screenshots provided — replicate and exceed that quality.

**Backend:**
- `GET /doctors` — list with working days, hours, colour
- `GET /scheduling/calendar?date=YYYY-MM-DD` — returns all doctors' appointments for that day in column format
- `GET /doctors/:id/availability?date=YYYY-MM-DD` — available time slots
- `POST /appointments` — validates availability, blocks double-booking, auto-calculates end_at from service duration
- `PATCH /appointments/:id/status` — confirm, cancel, complete, no-show
- `POST /doctors/:id/block-time` — doctor marks themselves unavailable for a time range
- `DELETE /doctors/:id/block-time/:blockId` — remove blocked time

**Frontend `MultiDoctorCalendar.tsx`:**
- Horizontal header row: one column per doctor with their name and avatar
- Each doctor column has a colour (matching their `colour` field)
- Time slots run vertically (07:00–20:00 in 30-minute rows)
- Appointment blocks show: patient name, service name, time range — colour-coded by service
- Click empty slot → opens `BookingDrawer` with patient search, service select, auto-filled doctor and time
- Click existing appointment → opens detail modal: patient info, service, status, action buttons (Confirm, Cancel, No-Show, Complete)
- Doctors can mark blocked time from their own dashboard (appears as a greyed hatched block in the calendar)
- Day/week view toggle
- "Today" button always returns to current date
- Verify: two appointments cannot be booked in the same slot for the same doctor

### Phase 4 — Patient & CRM Module (GHL Level)

**Patient Database:**
- Every patient automatically gets an account record opened on first appointment booking
- `POST /patients` — AES-256 encrypt `medical_notes`, set `account_opened_at`
- `GET /patients` — paginated, searchable by name/phone/category
- `GET /patients/:id` — full profile: personal info, appointment history, invoice history, agent interaction history, feedback
- `PUT /patients/:id` — re-encrypt medical notes on save
- Patient categories (Admin can define and assign): VIP, Preventive Plan, Orthodontic, Dentophobic, Corporate, etc.

**Lead Management:**
- `POST /leads` — capture with source tag
- `GET /leads` — list filterable by source, funnel_stage, lead_score
- `POST /leads/:id/convert` — create Patient from Lead, mark lead as converted

**Quiz Builder:**
- `POST /quizzes` — create quiz with title, questions (multiple choice), scoring, result text
- `GET /quizzes/:id/public` — public-facing quiz page (no login required)
- `POST /quizzes/:id/submit` — score responses, create Lead, trigger agent outreach
- Admin can embed quiz link in social media, WhatsApp, or on the website

**QR Code Lead Capture:**
- `POST /qr-captures` — define label, questions to ask after scan, destination (Google Sheets or CRM)
- `GET /qr-captures/:id/render` — returns scannable QR code image
- `POST /qr-captures/:id/submit` — save contact to CRM and/or push row to Google Sheet
- Use case: patient scans QR in waiting room → fills form → stored in system → tagged by category

**Social Media Manager:**
- Connect Facebook Page, Instagram Business, TikTok Business via OAuth
- `GET /crm/social/feed` — combined feed: recent posts, comments, DMs across all connected accounts
- `POST /crm/social/post` — create post with text + media, schedule or publish immediately, multi-platform
- `GET /crm/social/analytics` — reach, engagement, follower count per platform
- Reply to comments and DMs directly from the system

**Google Business Profile (GBP):**
- Connect GBP via Google API OAuth
- View and respond to Google reviews from within the system
- Post updates and offers to GBP
- View GBP insights: search impressions, direction requests, calls

**Website Visitor Capture:**
- `website-pixel/pixel.js` — tiny script embedded on codeclinic.ug
- On page load: fires to `POST /webhooks/visitor` with session_id, page_url, referrer
- After 10 seconds on page: pop-up appears — "Hi! We noticed you visiting us. Can we get your name and number so we can help?"
- On form submit: creates `WebsiteVisitor` record → triggers Unified Agent to WhatsApp or call them immediately
- Agent opening line: "Hello! I'm from Code Clinic. I noticed you visited our website just now. Can I help you with anything?"
- All visitor sessions visible in admin under `Website Visitors` with live feed

### Phase 5 — Accounts Module (Zoho Books Level+)

The accounts dashboard must look as good as Zoho Books but better. Clean, data-rich, fast.

**Patient Account Opening:**
Every patient automatically has a financial account. When an appointment is completed, an invoice is auto-drafted. The Accounts user sees all patients and their financial standing.

**Invoices:**
- `POST /invoices` — auto-generate from completed appointment or manual
- VAT toggle per line item (18% URA rate)
- Dual currency: store UGX, optional USD display with exchange rate
- `POST /invoices/:id/send` — deliver via WhatsApp, email, or both
- `GET /invoices` — filterable by status, date range, patient, doctor

**Payments:**
- `POST /payments` — record manually or via Pesapal webhook
- Payment methods: CASH, MTN_MOMO, AIRTEL_MONEY, VISA, MASTERCARD, BANK_TRANSFER, USD_CASH
- Partial payment tracking — invoice stays PARTIAL until fully paid
- Pesapal payment link generation: `POST /payments/pesapal-link` → returns URL to send patient

**Expenses:**
- `POST /expenses` — record with category, receipt upload to R2

**Payroll:**
- `POST /payroll` — NSSF (10% employee + 10% employer) and PAYE per Uganda tax bands auto-calculated
- Generate payslip PDF, upload to R2, email to staff member

**Reports:**
- `GET /reports/pl` — Profit & Loss with period filter
- `GET /reports/cashflow` — daily position + 30-day forecast
- `GET /reports/debt-aging` — 0-30, 31-60, 61-90, 90+ day buckets
- `GET /reports/doctor-revenue` — revenue and appointment count per doctor
- `GET /reports/patient-account/:id` — full financial history for one patient
- All exportable as PDF and Excel
- `POST /integrations/google-sheets/export` — push any report to a specified Google Sheet

**Accounts Dashboard UI:**
- Inspired by Zoho Books but more beautiful and faster
- Large KPI cards: Total Revenue (UGX), Outstanding Debt, Net Profit, Expenses This Month
- Revenue trend chart (line, 12 months)
- Payment method breakdown (donut chart): Cash vs MoMo vs Airtel vs Card
- Top 5 debtor patients table
- Recent invoices list with coloured status pills
- Quick actions: Record Payment, New Invoice, Export Report

### Phase 6 — Unified AI Agent

This is one agent with multiple responsibilities. It does not hallucinate. It remembers patients and builds rapport. It has a Ugandan personality — warm, friendly, uses appropriate Ugandan greetings where suitable via text (e.g. "Oli otya!" / "Webale"). For voice, the accent and tone are controlled via ElevenLabs voice cloning.

**Responsibilities the Unified Agent handles:**

1. **Inbound booking** — WhatsApp or voice call to book/reschedule/cancel
2. **Outbound appointment reminders** — calls or WhatsApp the day before
3. **Post-visit follow-up** — calls the day after a completed appointment
4. **Debt reminders** — calls or WhatsApps patients with overdue invoices
5. **Website visitor engagement** — contacts fresh website visitors immediately
6. **Birthday messages** — sends warm birthday WhatsApp/SMS with promo offer
7. **Promo campaigns** — sends promotional messages to targeted patient segments
8. **FAQ handling** — answers any clinic question from the knowledge base
9. **Escalation** — when it cannot handle something, it escalates to the receptionist dashboard in real time with a notification

**Escalation flow:**
1. Agent detects it cannot handle the situation (complex medical query, angry patient, billing dispute)
2. Agent says: "Let me connect you with our team right away. One moment please."
3. `POST /escalations` — creates escalation record with patient info, transcript so far, urgency level
4. Receptionist dashboard shows a real-time alert banner: "🔔 Escalation — [Patient Name] — [reason] — [View Transcript]"
5. Receptionist clicks → sees full conversation → can call patient or continue on WhatsApp
6. Agent logs escalation in `AgentLog` with `escalated: true`

**RAG Memory & Rapport:**
- Every time the agent interacts with a known patient, it loads their profile: name, appointment history, last agent conversation transcript, outstanding balance, doctor preference
- Agent greets returning patients by name and references their history naturally: "Welcome back, Hanan! How was your last visit with Dr. Lois?"
- For new leads, agent builds rapport from the quiz responses or stated interest

**Anti-hallucination rule (enforce in every system prompt):**
> "You must only answer using information explicitly present in the provided context or the patient's profile. If you do not have enough information to answer correctly, say: Let me check on that for you and get back to you shortly — then escalate."

**Two-way calling:**
- Patients can call the clinic's Africa's Talking number and reach the agent directly
- Agent can place outbound calls to patients
- All calls are recorded

### Phase 7 — Knowledge Base (All Media Types)

The knowledge base is the agent's brain. It must accept everything.

**Accepted types and ingestion method:**

| Type | Ingestion |
|---|---|
| PDF | pdfjs extract text → chunk 500 tokens → embed |
| Image / Screenshot | Send to Claude vision API → extract text/description → embed |
| Audio | Whisper transcription → chunk → embed |
| Video | Whisper transcription of audio track → chunk → embed |
| Link / URL | Crawl with cheerio → extract main text → chunk → embed |
| Plain text | Chunk directly → embed |

**Routes:**
- `POST /knowledge/upload` — accept any of the above, detect type, run correct ingester, store chunks in pgvector
- `GET /knowledge` — list all items with type icon and agent assignments
- `DELETE /knowledge/:id` — remove item and all its chunks from pgvector
- `POST /knowledge/query` — internal: given query string, return top 5 chunks by cosine similarity

**UI — Knowledge Base Manager:**
- Drag-and-drop upload zone that accepts all file types listed above
- Paste URL field for link ingestion
- Each uploaded item shows: icon by type, title, upload date, chunk count, assigned agents, status (processing/ready/failed)
- "Assign to agents" toggle per item — which of the 7 agent responsibilities can use this document
- Processing progress indicator (especially for video/audio which take longer)

### Phase 8 — Voice Studio

**Three-tab UI (admin only):**

*Tab 1 — Agent Prompts:*
- All 7 agent responsibility types listed on left
- Click any → rich text prompt editor opens on right
- Fields: system prompt text, language, tone, personality (dropdown: ugandan_warm, professional, playful)
- "Save Draft" / "Activate" buttons. Version history with one-click rollback.
- Status badge: LIVE / DRAFT

*Tab 2 — Voice Library:*
- Grid of all ElevenLabs voices + all cloned voices
- Each card: voice name, language/accent tag, Preview button (plays 5 seconds)
- "Clone a new voice" button:
  1. Name the voice (e.g. "Clinic Receptionist")
  2. Record in-browser (minimum 2 minutes clean speech) or upload audio file
  3. Submit → ElevenLabs processes → appears in grid ready to assign
- Assign voice to any agent responsibility

*Tab 3 — Test & Preview:*
- Choose: agent type, prompt version, voice
- Type a sample patient message
- "Preview Call" → synthesises response audio → plays in-page
- "Activate" button to go live from this tab

### Phase 9 — Call Recordings & Caller KPI Dashboard

**Recording flow:**
1. Call ends → Africa's Talking webhook → backend downloads recording
2. Upload to R2: `recordings/{year}/{month}/{agent_type}/{call_id}.mp3`
3. Send audio to Whisper for speaker-diarised transcript
4. Save `CallRecording` with r2_key, duration_s, transcript
5. Update `AgentLog` with recording_id

**Caller KPI Dashboard (ChatDash-level):**
- Total calls today / this week / this month
- Answer rate, completion rate, escalation rate, no-answer rate
- Average call duration
- Outcome breakdown: BOOKED, CONFIRMED, CANCELLED, ESCALATED, NO_ANSWER, FAILED
- Per-agent-type breakdown (Booking vs Reminder vs Followup etc.)
- Hourly call volume heatmap
- Trend charts: 30-day answer rate, escalation rate

**Recording Player:**
- Filterable list: date, agent type, outcome, quality score, escalated
- Click row → split-screen: audio player + synced transcript
- Playback speed: 0.75×, 1×, 1.25×, 1.5×
- Quality score 1-5 stars + admin notes
- "Fix This Prompt" → opens Voice Studio with that agent's prompt pre-loaded

### Phase 10 — Campaigns (Birthday, Promo, Reactivation)

- `POST /campaigns` — create campaign: type, channel, message, media, target, schedule
- Target options: all active patients, by category, by last visit date, birthday today/this week
- `POST /campaigns/:id/send` — trigger immediate send or schedule for future
- Birthday campaigns: cron runs daily at 08:00, finds all patients with birthday today, sends warm WhatsApp message with a promo offer
- Promo campaigns: admin composes message, selects target segment, schedules or sends now
- Reactivation: targets patients who have not visited in 90+ days
- All campaign sends logged to `NurtureLog`
- Campaign analytics: sent count, delivered, read, replied, converted to appointment

### Phase 11 — Communications Layer

1. Africa's Talking client configured with Uganda number for voice, WhatsApp, SMS
2. Webhook routes:
   - `POST /webhooks/at/voice` — inbound call → Unified Agent
   - `POST /webhooks/at/whatsapp` — inbound WhatsApp → Unified Agent
   - `POST /webhooks/at/sms` — inbound SMS → Unified Agent
   - `POST /webhooks/visitor` — website pixel fires → Website Visitor record + immediate agent outreach
   - `POST /webhooks/pesapal` — payment confirmed → update Invoice and Payment records
3. Validate Africa's Talking signature on every webhook
4. Voice handler: ElevenLabs TTS (fallback: AT TTS), DTMF capture, transfer to human
5. On call end: download recording → R2 → transcript → save CallRecording
6. Verify: full end-to-end — WhatsApp in → booking created → confirmation sent → recording saved

### Phase 12 — Integrations

**Google Sheets:**
- `POST /integrations/google-sheets/connect` — OAuth, save credentials
- `POST /integrations/google-sheets/export` — push any data (patients, QR captures, reports) to a specified sheet
- QR Capture forms auto-push each submission to a configured sheet in real time

**Gmail / Email:**
- Connect via Gmail API OAuth or SMTP for generic email
- Used for: sending invoices, payslips, staff credentials, appointment confirmations
- `POST /integrations/email/send` — generic email send with HTML template and attachments

**Google Business Profile:**
- `GET /integrations/gbp/reviews` — list recent reviews
- `POST /integrations/gbp/reviews/:id/reply` — post reply to a review
- `POST /integrations/gbp/posts` — create GBP update post

**Pesapal (Payment Gateway):**
- `POST /payments/pesapal-link` — generate payment link for invoice → return URL
- Webhook: `POST /webhooks/pesapal` — on payment confirmed → auto-mark invoice PAID
- Supports: MTN MoMo, Airtel Money, Visa, Mastercard — all via one Pesapal integration

### Phase 13 — Platform-Wide AI Assistant

Floating bubble on every page for every logged-in user. Role-scoped intelligence.

**Role data access:**

```
ADMIN gets:
- Live financials: today's revenue, outstanding debt, P&L this month
- All agent KPIs: call success rates, escalation rates, no-answer rates
- Appointment stats: completion rate, no-shows per doctor
- CRM insights: new leads today, quiz submissions, funnel conversion
- System health: API status, AT balance, last backup, cron last run
- Can request draft improved prompts → assistant returns revised prompt text
- Current page context injected for contextual answers

DOCTOR gets:
- Their own appointments and patient list only
- Own revenue and performance stats
- Patient notes for their own patients only

RECEPTIONIST gets:
- Full appointment schedule all doctors
- AI agent live activity and escalation status
- Patient search results
- No financial data, no medical notes

ACCOUNTS gets:
- All financial data, invoices, payments, payroll, reports
- All patient account balances
- No medical records, no agent details
```

**Prompt improvement (Admin only):**
Admin can say: *"The booking agent sounds too formal. Make it warmer and more Ugandan — it should feel like talking to a friendly Ugandan receptionist."*
Assistant returns full revised prompt with an inline **"Open in Voice Studio"** button.

### Phase 14 — Patient Mobile App (Flutter — V1)

Build a clean, fast Flutter app for patients. Downloadable from a link — no app store required (Flutter PWA build + direct APK download link sent via WhatsApp/email).

**Screens:**
1. **Home** — Welcome, upcoming appointments, health tips, clinic contact
2. **Book Appointment** — Select doctor, service, date, time slot → confirm
3. **My Appointments** — List of upcoming and past appointments. Reschedule / Cancel buttons.
4. **Feedback** — Star rating + comment after each completed appointment
5. **Health Tips** — Short dental health articles pulled from knowledge base

**Admin Mobile (Dr. Steven):**
The ADMIN role on Flutter sees a control panel:
1. Today's schedule overview
2. Revenue snapshot (today and this month)
3. Live AI agent activity feed
4. Patient list and quick search
5. Approve/reject escalations
6. Financial reports (P&L, cash flow)

**Offline Access (Hive local storage):**
- Patient list (read-only) cached offline
- Today's schedule cached offline
- Note-taking works offline — syncs on reconnect
- Invoice viewing works offline
- New bookings and mutations require internet — show clear offline indicator

### Phase 15 — Developer Dashboard

Separate Next.js app, accessible only to you (the developer), protected by a separate developer secret key.

**Screens:**
1. **System Health** — uptime per service, DB connection status, Redis status, disk usage, memory
2. **KPIs** — CodeClinic usage: DAU, appointments booked, calls made, WhatsApp messages sent, knowledge base queries
3. **Error Logs** — all server errors with stack traces, timestamp, affected user
4. **Support Tickets** — CodeClinic staff can submit a ticket from within the app → appears here instantly with notification
5. **Client Activity** — last login per user, feature usage heatmap
6. **Deploy Log** — last 10 deployments with commit message and timestamp

### Phase 16 — UI Polish (All Dashboards)

Every dashboard must have in the top bar or sidebar:
- **Live clock** — digital clock with nice curves/font, updates every second
- **Current date** — formatted as "Wednesday, 01 April 2026"
- **Kampala weather** — current temperature and condition (sunny ☀ / cloudy / rain) via OpenWeatherMap API (free tier, Kampala coordinates)

General UI quality standards:
- Dark mode default with light mode toggle
- Transitions and micro-animations — nothing jumpy or static
- Loading skeletons instead of spinners
- All tables have sticky headers
- All charts have hover tooltips
- Monetary values always formatted: UGX 1,250,000 or USD 340
- Phone numbers always formatted: +256 7XX XXX XXX
- Status badges colour-coded consistently across all pages

### Phase 17 — Security Hardening
1. AES-256 encrypt `medical_notes` — key from environment, never in code
2. PostgreSQL not exposed outside Docker internal network
3. SSH key-only auth on VPS
4. Firewall: ports 80 and 443 only
5. Fail2ban on SSH and Nginx
6. Daily DB backup — encrypted, uploaded to secondary Cloudflare R2 bucket
7. R2 recordings accessible only via signed URLs (1-hour expiry)
8. All Pesapal webhook calls validated by signature
9. Verify: direct DB access from outside container network must fail

### Phase 18 — Deployment & CI/CD
1. `docker-compose.prod.yml` with resource limits and restart: always
2. `nginx.conf` — SSL termination, reverse proxy to api:4000 and web:3000
3. `.github/workflows/deploy.yml` — push to `main` → SSH to Hetzner → git pull → docker compose up --build -d
4. Uptime monitor: cron every 5 minutes → pings `/health` → WhatsApp alert to developer if down
5. Verify: push to main → deployed within 3 minutes

---

## Environment Variables

```env
# Database
DATABASE_URL=postgresql://codeclinic:password@postgres:5432/codeclinic
REDIS_URL=redis://redis:6379

# Auth
JWT_SECRET=
JWT_REFRESH_SECRET=
ENCRYPTION_KEY=            # AES-256, 32 bytes hex — for patient medical notes
DEVELOPER_SECRET=          # Access key for developer dashboard

# Anthropic
ANTHROPIC_API_KEY=

# Africa's Talking
AT_API_KEY=
AT_USERNAME=
AT_SENDER_ID=
AT_WHATSAPP_NUMBER=

# ElevenLabs
ELEVENLABS_API_KEY=
ELEVENLABS_DEFAULT_VOICE_ID=

# Cloudflare R2
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET_NAME=codeclinic-main
R2_BACKUP_BUCKET=codeclinic-backups
R2_PUBLIC_URL=

# Pesapal (payment gateway)
PESAPAL_CONSUMER_KEY=
PESAPAL_CONSUMER_SECRET=
PESAPAL_CALLBACK_URL=

# Google
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_SHEETS_SCOPES=https://www.googleapis.com/auth/spreadsheets
GOOGLE_GBP_SCOPES=https://www.googleapis.com/auth/business.manage

# Email
SMTP_HOST=
SMTP_PORT=
SMTP_USER=
SMTP_PASS=

# Weather
OPENWEATHER_API_KEY=
KAMPALA_LAT=0.3476
KAMPALA_LON=32.5825

# Accounts
DEFAULT_VAT_RATE=0.18
DEFAULT_CURRENCY=UGX

# App
NODE_ENV=production
API_PORT=4000
WEB_PORT=3000
BASE_URL=https://app.codeclinic.ug
PIXEL_ALLOWED_ORIGIN=https://codeclinic.ug

# Backups
BACKUP_SCHEDULE=0 2 * * *   # 02:00 Africa/Kampala daily
```

---

## Role Permission Matrix

| Feature | ADMIN | DOCTOR | RECEPTIONIST | ACCOUNTS |
|---|---|---|---|---|
| View all patients | ✅ | ✅ own only | ✅ | ✅ (financial view) |
| Edit patient medical notes | ✅ | ✅ | ❌ | ❌ |
| Create / cancel appointments | ✅ | Block own time only | ✅ | ❌ |
| View invoices | ✅ | ❌ | ✅ view only | ✅ |
| Create / edit invoices | ✅ | ❌ | ❌ | ✅ |
| Record payments | ✅ | ❌ | ❌ | ✅ |
| View financial reports | ✅ | ❌ | ❌ | ✅ |
| Manage employees | ✅ | ❌ | ❌ | ❌ |
| Audit logs | ✅ | ❌ | ❌ | ❌ |
| Voice Studio | ✅ | ❌ | ❌ | ❌ |
| Call recordings | ✅ | ❌ | ❌ | ❌ |
| Knowledge base | ✅ | ❌ | ❌ | ❌ |
| View AI agent logs | ✅ | ❌ | ✅ | ❌ |
| See escalation alerts | ✅ | ❌ | ✅ | ❌ |
| CRM — leads & funnels | ✅ | ❌ | ✅ | ❌ |
| Social media manager | ✅ | ❌ | ✅ | ❌ |
| Quiz builder | ✅ | ❌ | ❌ | ❌ |
| Campaign manager | ✅ | ❌ | ✅ | ❌ |
| QR code generator | ✅ | ❌ | ✅ | ❌ |
| Website visitor feed | ✅ | ❌ | ✅ | ❌ |
| Google integrations | ✅ | ❌ | ❌ | ✅ (Sheets export) |
| AI assistant — full | ✅ | ❌ | ❌ | ❌ |
| AI assistant — own scope | ✅ | ✅ | ✅ | ✅ |
| Developer dashboard | DEVELOPER only | ❌ | ❌ | ❌ |

---

## Ugandan Personality & Language Standards

The AI agent represents CODE Clinic. It must feel authentically Ugandan — warm, professional, and human.

**Text channel personality (WhatsApp/SMS):**
- Greet with: "Hello [Name]! 😊" or occasionally "Oli otya, [Name]!"
- Warm sign-off: "Have a beautiful day!" or "Take care and stay smiling! 😁"
- Use natural Ugandan phrasing — not American or British corporate speak
- For birthday messages: "Wishing you a wonderful birthday from your friends at Code Clinic! 🎂 May your smile be as bright as ever!"

**Voice channel personality:**
- Controlled via ElevenLabs cloned voice — accent and warmth encoded in the voice itself
- System prompt tone: warm, reassuring, never robotic
- If patient seems anxious about dental treatment: acknowledge it empathetically, reference Dr. Arnold's spa approach if relevant

**RAG memory rule:**
The agent always loads the patient's full profile before responding. It references previous visits, preferred doctors, and past conversations naturally. This is not optional — it is what makes the agent feel human.

---

## Uganda-Specific Financial Requirements

- **Currency**: UGX stored as bigint (no floating point). USD displayed via stored exchange rate.
- **VAT**: 18% URA rate. Per-line-item toggle. On all reports.
- **NSSF**: 10% employee + 10% employer. Auto-calculated in payroll.
- **PAYE tax bands**:
  - 0 – 235,000 UGX/month: 0%
  - 235,001 – 335,000: 10%
  - 335,001 – 410,000: 20%
  - 410,001+: 30%
- **Mobile Money**: MTN MoMo and Airtel Money via Pesapal — first-class, not afterthoughts.
- **Card payments**: Visa and Mastercard via Pesapal.
- **Phone format**: +256XXXXXXXXX throughout. Africa's Talking requires this.
- **Timezone**: Store UTC, display Africa/Kampala (UTC+3).

---

## Seed Data

```
Admin:
  email: admin@codeclinic.ug
  password: Admin@2024!
  role: ADMIN

Receptionist:
  email: reception@codeclinic.ug
  password: Staff@2024!

Accounts:
  email: accounts@codeclinic.ug
  password: Staff@2024!

Doctors (from SimplyBook screenshots):
  1. Dr. Steven Mugabe — Founder / Lead Dentist — colour: #4A90D9
  2. Dr. Angella Kissa — colour: #E8A838
  3. Dr. Arnold Nshimye — colour: #9B59B6
  4. Dr. Lois Kisakye — colour: #2ECC71
  5. Dr. Joseline Babirye — colour: #E74C3C
  6. Dr. Kutesa Eben — colour: #1ABC9C
  7. Dr. Kajumba Faith — colour: #F39C12
  8. Dr. Papa Joel — colour: #3498DB
  All working: Mon-Sat 08:00-18:00 (adjust per doctor as needed)

Services (from SimplyBook screenshots):
  - Check and Treat — 60min — UGX 60,000
  - Review Check Up — 60min — UGX 50,000
  - Periodontal Therapy — 60min — UGX 120,000
  - Braces Review — 30min — UGX 40,000
  - GI Filling — 60min — UGX 80,000
  - Dental Consultation — 30min — UGX 50,000
  - Dental Cleaning — 45min — UGX 80,000
  - Tooth Extraction — 60min — UGX 100,000
  - Snoring Assessment — 45min — UGX 90,000
  - Dental Implant Consultation — 60min — UGX 80,000

Default AgentPrompts: one per AgentType, is_active = true
Default Quiz: "Oral DNA Assessment" — 5 questions, scoring 0-100
```

---

## Deliverables Checklist

- [ ] `docker compose up` starts all services with no errors
- [ ] Login + 2FA works for all roles, wrong role returns 403
- [ ] Admin adds employee → email received with credentials + Flutter download link
- [ ] Multi-doctor calendar renders with colour-coded columns matching seed doctors
- [ ] Doctor can block own time → appears in calendar as hatched unavailable slot
- [ ] Double-booking same doctor same slot is impossible
- [ ] Patient account auto-opens on first appointment booking
- [ ] Invoice auto-generates from completed appointment with correct VAT
- [ ] Pesapal payment link generated → on payment → invoice marked PAID automatically
- [ ] MTN MoMo manual payment records correctly, invoice status updates
- [ ] P&L figures match manually verified totals
- [ ] PAYE and NSSF calculated correctly per Uganda bands
- [ ] PDF uploaded to knowledge base → agent correctly uses it in test query
- [ ] Image uploaded to knowledge base → Claude vision extracts text → embedded
- [ ] Audio file uploaded → Whisper transcribes → embedded
- [ ] URL submitted → crawled → embedded
- [ ] Website pixel fires on page load, creates WebsiteVisitor record, agent calls/WhatsApps within 60 seconds
- [ ] QR code generated → scan → form submits → stored in CRM + Google Sheet
- [ ] Quiz built in admin → submitted by test user → lead created → agent triggered
- [ ] Birthday cron fires → finds patient born today → sends WhatsApp message
- [ ] Agent escalates to receptionist → alert banner appears on receptionist dashboard in real time
- [ ] Call recorded → uploaded to R2 → transcript generated → playable from admin recordings page
- [ ] Transcript syncs with audio playback position
- [ ] "Fix This Prompt" from recording opens Voice Studio with correct agent prompt
- [ ] Voice clone: upload audio → new voice appears in library → assigned to agent
- [ ] Test preview: admin hears synthesised call audio before activating
- [ ] Platform AI assistant answers Admin's revenue question from live DB data
- [ ] Platform AI assistant answers Receptionist with only their scoped data
- [ ] Social media manager connects Facebook → posts a test update
- [ ] Google Business Profile connects → reviews visible → reply sent
- [ ] Google Sheets export works for QR captures and patient report
- [ ] Flutter patient app: book, reschedule, cancel works end-to-end
- [ ] Flutter admin app: Dr. Steven can see schedule, revenue, escalations on mobile
- [ ] Offline mode: schedule and patient list visible when network disconnected
- [ ] Developer dashboard shows system health and last deployment
- [ ] Clock, date, and Kampala weather widget display correctly on all dashboards
- [ ] Medical notes are AES-256 encrypted cipher text in DB (verify in psql)
- [ ] R2 signed URLs expire after 1 hour
- [ ] Push to `main` → server deployed within 3 minutes
- [ ] No API keys or secrets hardcoded anywhere
- [ ] `.env.example` documents every variable with a comment

---

## README.md Must Include

1. What each role dashboard is for
2. How to add staff and send them login credentials
3. How to use the scheduling calendar — booking, blocking time, managing appointments
4. How to use Voice Studio — edit prompts, clone voices, preview calls
5. How to review call recordings and fix agent prompts
6. How to upload any file type to the knowledge base
7. How to create a quiz and link it to social media
8. How to set up a QR code capture for the waiting room
9. How to run a birthday or promo campaign
10. How to export a report to Google Sheets
11. How to generate a Pesapal payment link for a patient
12. How to restore from a backup
13. Developer support contact and ticket submission instructions

---

## Bottom Line

Dr. Steven Mugabe has been frustrated by fragmented AI tools that promised much and delivered complexity. This software is the answer to that frustration. It must be so complete, so fast, and so user-friendly that no one at Code Clinic ever needs to open SimplyBook, GHL, Zoho, QuickBooks, Vapi, or n8n again.

Every screen must make someone smile. Every interaction must feel instant. Every patient who calls must feel like the clinic already knows them.

Build it like it is going to serve 20 million people across Africa. Because that is exactly Dr. Steven's vision.

**Start with Phase 1. Do not skip ahead.**
