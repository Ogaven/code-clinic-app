import { startVoiceConversation } from './voice-ai.service'

// ── drachtio-srf ──────────────────────────────────────────────────────────────
// drachtio-srf connects to a drachtio-server process which handles SIP signaling.
//
// Deployment architecture:
//   Roke Telecom SIP trunk (41.191.76.76:5060)
//       ↕  SIP / RTP
//   drachtio-server  (DRACHTIO_HOST:5060 for SIP, DRACHTIO_HOST:9022 for mgmt TCP)
//       ↕  TCP management (port 9022)
//   This Node.js process (drachtio-srf)
//
// On Railway: run drachtio-server as a sidecar service and set DRACHTIO_HOST to
// its private hostname. Set SIP_HOST to the Roke trunk IP in drachtio-server's
// config, not here (this service only talks to drachtio-server, not the trunk).

// eslint-disable-next-line @typescript-eslint/no-require-imports
const Srf = require('drachtio-srf') as any

let srf: any        = null
let connected       = false

// ── initializeSIP ─────────────────────────────────────────────────────────────
// Call once from main.ts after startup.  No-op and logs a warning if
// DRACHTIO_HOST is not set so the rest of the app keeps running.

export function initializeSIP(): void {
  const drachtioHost   = process.env.DRACHTIO_HOST
  const drachtioPort   = parseInt(process.env.DRACHTIO_PORT   || '9022',  10)
  const drachtioSecret = process.env.DRACHTIO_SECRET || 'cymru'

  if (!drachtioHost) {
    console.warn('[SIP] DRACHTIO_HOST not set — SIP voice calls disabled')
    return
  }

  srf = new Srf()

  srf.connect({
    host:   drachtioHost,
    port:   drachtioPort,
    secret: drachtioSecret,
  })

  srf.on('connect', (_err: Error | null, hostport: string) => {
    connected = true
    console.log(`[SIP] Connected to drachtio-server at ${hostport}`)
  })

  srf.on('error', (err: Error) => {
    connected = false
    console.error('[SIP] drachtio error:', err.message)
  })

  // Inbound call handler — Roke trunk will INVITE us for calls to 256205477000/1
  srf.invite((req: any, res: any) => {
    handleInboundCall(req, res).catch(err =>
      console.error('[SIP] Inbound call handler error:', err.message)
    )
  })

  console.log(`[SIP] Connecting to drachtio-server at ${drachtioHost}:${drachtioPort}…`)
}

// ── formatToE164 ──────────────────────────────────────────────────────────────

export function formatToE164(phone: string): string {
  const cleaned = phone.replace(/[\s\-().+]/g, '')
  if (cleaned.startsWith('256'))    return cleaned               // already 256XXXXXXXXX
  if (cleaned.startsWith('0'))      return `256${cleaned.slice(1)}` // 07X… → 256 7X…
  if (/^[74]/.test(cleaned))        return `256${cleaned}`       // 7X… / 4X… → 256…
  return cleaned
}

// ── makeOutboundCall ──────────────────────────────────────────────────────────
// Fires a SIP INVITE via drachtio. Calls onConnected() when the remote answers
// and onHangup() when the call ends or times out (30 s no-answer).

export async function makeOutboundCall(
  toNumber:    string,
  onConnected: () => void,
  onHangup:    () => void,
): Promise<void> {
  if (!connected || !srf) {
    console.warn('[SIP] Not connected to drachtio-server — outbound call skipped')
    onHangup()
    return
  }

  const sipHost  = process.env.SIP_HOST      || '41.191.76.76'
  const sipPort  = process.env.SIP_PORT      || '5060'
  const callerId = process.env.SIP_CALLER_ID || '256205477000'
  const e164     = formatToE164(toNumber)
  const sipUri   = `sip:${e164}@${sipHost}:${sipPort}`

  // Minimal G.711A (PCMA, payload 8) SDP — drachtio-server fills in the real RTP IP/port
  const localSdp = [
    'v=0',
    `o=- ${Date.now()} 1 IN IP4 0.0.0.0`,
    's=Code Clinic Voice',
    'c=IN IP4 0.0.0.0',
    't=0 0',
    'm=audio 0 RTP/AVP 8 0',
    'a=rtpmap:8 PCMA/8000',
    'a=rtpmap:0 PCMU/8000',
    'a=fmtp:101 0-15',
    'a=ptime:20',
    'a=sendrecv',
  ].join('\r\n')

  // Guard against calling onHangup() twice (timer race + dialog destroy)
  let hungUp = false
  const safeHangup = () => {
    if (!hungUp) { hungUp = true; onHangup() }
  }

  // 30-second no-answer timeout — starts counting from when we send INVITE
  const noAnswerTimer = setTimeout(() => {
    console.log(`[SIP] No answer from ${e164} after 30s`)
    safeHangup()
  }, 30_000)

  try {
    const dlg = await srf.createUAC(sipUri, {
      localSdp,
      headers: {
        From:            `<sip:${callerId}@${sipHost}>`,
        'X-Call-Reason': 'Code Clinic AI',
      },
    })

    clearTimeout(noAnswerTimer)
    console.log(`[SIP] Outbound call connected to ${e164}`)
    onConnected()

    dlg.on('destroy', () => {
      console.log(`[SIP] Call to ${e164} ended`)
      safeHangup()
    })
  } catch (err: any) {
    clearTimeout(noAnswerTimer)
    console.error(`[SIP] Outbound call to ${e164} failed:`, err.message ?? err)
    safeHangup()
  }
}

// ── handleInboundCall ─────────────────────────────────────────────────────────
// drachtio calls this for every incoming SIP INVITE.

export async function handleInboundCall(req: any, res: any): Promise<void> {
  // Extract caller's number from the From header URI
  const fromHeader = req.getParsedHeader('from') as { uri?: { user?: string } } | undefined
  const callerNumber = fromHeader?.uri?.user ?? 'unknown'
  const callId       = (req.get('call-id') as string | undefined) ?? `call-${Date.now()}`

  console.log(`[SIP] Inbound call from ${callerNumber}  call-id=${callId}`)

  try {
    // Answer with G.711A — echo remote SDP for now (drachtio-server handles RTP)
    const dialog = await srf.createUAS(req, res, {
      localSdp: req.body as string,
    })

    await startVoiceConversation(callId, callerNumber, 'inbound')

    dialog.on('destroy', () => {
      console.log(`[SIP] Inbound call from ${callerNumber} ended`)
    })
  } catch (err: any) {
    console.error(`[SIP] Failed to handle inbound call from ${callerNumber}:`, err.message)
    try { res.send(500) } catch { /* already responded */ }
  }
}

export function isSipConnected(): boolean {
  return connected
}
