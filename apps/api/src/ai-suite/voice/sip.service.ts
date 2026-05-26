import * as dgram         from 'dgram'
import { spawn }          from 'child_process'
import { writeFileSync, unlinkSync } from 'fs'
import { join }           from 'path'
import { tmpdir }         from 'os'
import { startVoiceConversation } from './voice-ai.service'
import {
  decodePCMUBuffer, encodePCMUBuffer, silencePCMU,
  upsample8to16k, downsample16to8k,
  int16ToLE, leToInt16,
} from './audio-codec'
import { createConvAISession, getOrCreateAgentId } from './elevenlabs-conv-ai.service'
import { prisma } from '../../lib/prisma'

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
// RTP media flow (bidirectional via ElevenLabs ConvAI):
//   Caller audio  → dgram UDP recv (port 20000) → PCMU decode → 8→16kHz → EL ConvAI WS
//   EL ConvAI TTS → PCM 16kHz → 16→8kHz → PCMU encode → dgram UDP send → Caller

// Process-level safety net for drachtio ENOTFOUND errors before drachtio
// forwards them to the Srf instance — Node.js would crash otherwise.
process.on('uncaughtException', (err: Error & { code?: string }) => {
  if (process.env.DRACHTIO_HOST &&
      (err.message?.includes('drachtio') || err.code === 'ENOTFOUND')) {
    console.warn('[SIP] Suppressed drachtio connection error:', err.message)
    return
  }
  throw err
})

function loadSrf(): any {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('drachtio-srf')
  } catch {
    return null
  }
}

let srf: any        = null
let connected       = false
let _reconnectDelay = 5_000
let _reconnectTimer: ReturnType<typeof setTimeout> | null = null

// ── connectSrf ────────────────────────────────────────────────────────────────
function connectSrf(host: string, port: number, secret: string): void {
  if (srf) {
    try { srf.removeAllListeners() } catch { /* ignore */ }
    srf = null
  }

  const Srf = loadSrf()
  if (!Srf) return

  srf = new Srf()

  srf.on('connect', (_err: Error | null, hostport: string) => {
    connected = true
    _reconnectDelay = 5_000
    if (_reconnectTimer) { clearTimeout(_reconnectTimer); _reconnectTimer = null }
    console.log(`[SIP] Connected to drachtio-server at ${hostport}`)
  })

  srf.on('error', (err: Error) => {
    connected = false
    console.error(`[SIP] drachtio error: ${err.message} — reconnecting in ${_reconnectDelay / 1000}s`)
    try { srf.removeAllListeners() } catch { /* ignore */ }

    if (!_reconnectTimer) {
      _reconnectTimer = setTimeout(() => {
        _reconnectTimer = null
        _reconnectDelay = Math.min(_reconnectDelay * 2, 60_000)
        connectSrf(host, port, secret)
      }, _reconnectDelay)
    }
  })

  srf.invite((req: any, res: any) => {
    handleInboundCall(req, res).catch(err =>
      console.error('[SIP] Inbound call handler error:', err.message)
    )
  })

  console.log(`[SIP] Connecting to drachtio-server at ${host}:${port}…`)
  try {
    srf.connect({ host, port, secret })
  } catch (err: any) {
    console.error('[SIP] srf.connect() threw synchronously:', err.message)
    if (!_reconnectTimer) {
      _reconnectTimer = setTimeout(() => {
        _reconnectTimer = null
        _reconnectDelay = Math.min(_reconnectDelay * 2, 60_000)
        connectSrf(host, port, secret)
      }, _reconnectDelay)
    }
  }
}

// ── initializeSIP ─────────────────────────────────────────────────────────────
export function initializeSIP(): void {
  const drachtioHost = process.env.DRACHTIO_HOST
  if (!drachtioHost) {
    console.log('[SIP] DRACHTIO_HOST not configured — voice calls disabled')
    return
  }

  const Srf = loadSrf()
  if (!Srf) {
    console.warn('[SIP] drachtio-srf not installed — voice calls disabled')
    return
  }

  const drachtioPort   = parseInt(process.env.DRACHTIO_PORT   ?? '9022', 10)
  const drachtioSecret = process.env.DRACHTIO_SECRET           ?? 'cymru'

  connectSrf(drachtioHost, drachtioPort, drachtioSecret)
}

// ── formatToE164 ──────────────────────────────────────────────────────────────
export function formatToE164(phone: string): string {
  const cleaned = phone.replace(/[\s\-().+]/g, '')
  if (cleaned.startsWith('256'))   return cleaned
  if (cleaned.startsWith('0'))     return `256${cleaned.slice(1)}`
  if (/^[74]/.test(cleaned))       return `256${cleaned}`
  return cleaned
}

// ── buildLocalSdp ─────────────────────────────────────────────────────────────
// G.711 PCMU sendrecv — tells Roke to also send the caller's audio stream so
// we can pipe it into ElevenLabs ConvAI for real-time STT.
function buildLocalSdp(): string {
  const externalIp = process.env.SIP_EXTERNAL_IP || '165.22.81.15'
  const rtpPort    = parseInt(process.env.SIP_RTP_PORT || '20000', 10)

  return [
    'v=0',
    `o=- ${Date.now()} 1 IN IP4 ${externalIp}`,
    's=Code Clinic Voice',
    `c=IN IP4 ${externalIp}`,
    't=0 0',
    `m=audio ${rtpPort} RTP/AVP 0`,
    'a=rtpmap:0 PCMU/8000',
    'a=ptime:20',
    'a=sendrecv',
  ].join('\r\n')
}

// ── buildRtpPacket ────────────────────────────────────────────────────────────
// Minimal 12-byte RTP header + PCMU payload (no CSRC, no extension).
function buildRtpPacket(pcmu: Buffer, seq: number, ts: number, ssrc: number): Buffer {
  const hdr = Buffer.allocUnsafe(12)
  hdr[0] = 0x80                    // V=2, P=0, X=0, CC=0
  hdr[1] = 0x00                    // M=0, PT=0 (PCMU)
  hdr.writeUInt16BE(seq  & 0xFFFF, 2)
  hdr.writeUInt32BE(ts   >>> 0,    4)
  hdr.writeUInt32BE(ssrc >>> 0,    8)
  return Buffer.concat([hdr, pcmu])
}

// ── parseRemoteSdp ────────────────────────────────────────────────────────────
function parseRemoteSdp(sdp: string): { ip: string; port: number } | null {
  const port = parseInt(sdp.match(/m=audio (\d+)/)?.[1] ?? '0', 10)
  const ip   = sdp.match(/c=IN IP4 ([\d.]+)/)?.[1] ?? ''
  return ip && port ? { ip, port } : null
}

// ── startBidirectionalVoiceCall ───────────────────────────────────────────────
// Full real-time AI voice conversation using ElevenLabs ConvAI:
//
//   1. Opens a dgram UDP socket on SIP_RTP_PORT to receive/send RTP
//   2. Connects to ElevenLabs ConvAI WebSocket
//   3. Bridges audio bidirectionally every 20ms
//   4. ConvAI calls our /ai-suite/voice/llm endpoint (Claude + all 16 tools)
//
// Falls back to one-way greeting mode if ConvAI is unavailable.

async function startBidirectionalVoiceCall(
  dialog:      any,
  callId:      string,
  callerPhone: string,
): Promise<void> {
  const offerSdp   = (dialog.remote?.sdp ?? '') as string
  const remoteEndp = parseRemoteSdp(offerSdp)

  // If remote SDP has 0.0.0.0 as media IP, Roke will send a re-INVITE with the
  // real IP after the ACK.  We start the session anyway and update liveRemote
  // when the re-INVITE fires.  Until then RTP goes to 0.0.0.0 (silently dropped).
  const localPort = parseInt(process.env.SIP_RTP_PORT ?? '20000', 10)

  // Mutable remote endpoint — updated on re-INVITE
  const liveRemote = {
    ip:   remoteEndp?.ip   ?? '0.0.0.0',
    port: remoteEndp?.port ?? 0,
  }

  console.log(`[SIP] Bidirectional RTP: 0.0.0.0:${localPort} ↔ ${liveRemote.ip}:${liveRemote.port}`)

  // Wire up re-INVITE updates so RTP starts flowing to the real address
  dialog.on('modify', (modReq: any) => {
    const newEndp = parseRemoteSdp((modReq.body as string | undefined) ?? '')
    if (newEndp && newEndp.ip !== '0.0.0.0' && newEndp.port > 0) {
      console.log(`[SIP] re-INVITE — updating RTP destination to ${newEndp.ip}:${newEndp.port}`)
      liveRemote.ip   = newEndp.ip
      liveRemote.port = newEndp.port
    }
  })

  // ── Resolve ElevenLabs agent ─────────────────────────────────────────────
  const apiKey = process.env.ELEVENLABS_API_KEY
  if (!apiKey) {
    console.warn('[SIP] ELEVENLABS_API_KEY not set — falling back to greeting-only mode')
    return fallbackGreeting(dialog, callId, callerPhone)
  }

  const voiceId = (await prisma.appSetting.findUnique({ where: { key: 'voice_elevenlabs_id' } }))?.value
               ?? process.env.ELEVENLABS_VOICE_ID
               ?? '21m00Tcm4TlvDq8ikWAM'

  const apiUrl  = process.env.APP_URL?.split(',')[0]?.trim() ?? 'https://api.codeclinic.ug'
  const agentId = await getOrCreateAgentId(prisma, apiKey, voiceId, apiUrl)

  if (!agentId) {
    console.warn('[SIP] No ElevenLabs agent ID — falling back to greeting-only mode')
    return fallbackGreeting(dialog, callId, callerPhone)
  }

  console.log(`[SIP] ConvAI agent_id=${agentId}`)

  // ── RTP send state ───────────────────────────────────────────────────────
  let   seqNum    = Math.floor(Math.random() * 0xFFFF)
  let   timestamp = Math.floor(Math.random() * 0xFFFFFFFF)
  const ssrc      = Math.floor(Math.random() * 0xFFFFFFFF)

  const outChunks: Buffer[] = []   // queue of 160-byte PCMU packets to send

  // ── dgram UDP socket ─────────────────────────────────────────────────────
  const socket = dgram.createSocket('udp4')
  let   socketClosed = false

  const safeCloseSocket = () => {
    if (!socketClosed) { socketClosed = true; try { socket.close() } catch { /* */ } }
  }

  let rtpTimer: ReturnType<typeof setInterval> | null = null

  // ── ElevenLabs ConvAI session ─────────────────────────────────────────────
  const convAI = createConvAISession({
    agentId,
    apiKey,
    callMeta: { caller_phone: callerPhone, call_id: callId },

    onAgentAudio(pcm16kLE: Buffer) {
      // Agent TTS audio arrives as PCM 16kHz LE → downsample → PCMU → queue
      const pcm16k = leToInt16(pcm16kLE)
      const pcm8k  = downsample16to8k(pcm16k)

      for (let i = 0; i < pcm8k.length; i += 160) {
        const slice = pcm8k.slice(i, Math.min(i + 160, pcm8k.length))
        // Pad last short chunk with silence
        const chunk = slice.length === 160
          ? slice
          : (() => { const p = new Int16Array(160); p.set(slice); return p })()
        outChunks.push(encodePCMUBuffer(chunk))
      }
    },

    onClose() {
      console.log('[SIP] ConvAI session closed — ending call')
      if (rtpTimer) { clearInterval(rtpTimer); rtpTimer = null }
      safeCloseSocket()
      try { dialog.destroy() } catch { /* ignore */ }
    },

    onError(err) {
      console.error('[SIP] ConvAI error:', err.message)
    },
  })

  // ── Receive incoming caller RTP → forward to ConvAI ──────────────────────
  socket.on('message', (packet: Buffer) => {
    if (packet.length < 12) return
    const csrcCount    = packet[0] & 0x0F
    const payloadType  = packet[1] & 0x7F
    const payloadStart = 12 + csrcCount * 4
    if (payloadType !== 0 || packet.length <= payloadStart) return  // only PCMU (PT=0)

    const pcmuPayload = packet.subarray(payloadStart)
    const pcm8k       = decodePCMUBuffer(pcmuPayload)
    const pcm16k      = upsample8to16k(pcm8k)
    convAI.sendCallerAudio(int16ToLE(pcm16k))
  })

  socket.on('error', (err) => {
    if (!socketClosed) console.error('[SIP] RTP socket error:', err.message)
  })

  // ── Bind → start 20ms RTP send loop ──────────────────────────────────────
  socket.bind(localPort, '0.0.0.0', () => {
    console.log(`[SIP] RTP socket bound on 0.0.0.0:${localPort}`)

    rtpTimer = setInterval(() => {
      if (socketClosed) return
      const pcmu   = outChunks.shift() ?? silencePCMU(160)
      const packet = buildRtpPacket(pcmu, seqNum, timestamp, ssrc)

      // Use liveRemote — updated dynamically if Roke sends a re-INVITE
      if (liveRemote.port > 0 && liveRemote.ip !== '0.0.0.0') {
        socket.send(packet, liveRemote.port, liveRemote.ip, (err) => {
          if (err && !socketClosed) console.error('[SIP] RTP send error:', err.message)
        })
      }

      seqNum    = (seqNum + 1) & 0xFFFF
      timestamp = (timestamp + 160) >>> 0
    }, 20)
  })

  // ── Caller hangs up ───────────────────────────────────────────────────────
  dialog.on('destroy', () => {
    console.log('[SIP] Remote hung up — tearing down voice session')
    if (rtpTimer) { clearInterval(rtpTimer); rtpTimer = null }
    convAI.close()
    safeCloseSocket()
  })
}

// ── fallbackGreeting ──────────────────────────────────────────────────────────
// One-way mode: generate greeting via ElevenLabs TTS → stream via ffmpeg → hang up.
async function fallbackGreeting(dialog: any, callId: string, callerPhone: string): Promise<void> {
  const { audioBuffer } = await startVoiceConversation(callId, callerPhone, 'inbound')
  if (audioBuffer) {
    await legacyStreamAudio(dialog, audioBuffer)
  } else {
    try { dialog.destroy() } catch { /* ignore */ }
  }
}

// ── legacyStreamAudio ─────────────────────────────────────────────────────────
// ffmpeg-based one-way audio stream (used as fallback when ConvAI unavailable).
async function legacyStreamAudio(dialog: any, audioBuffer: Buffer): Promise<void> {
  const remoteSdp  = (dialog.remote?.sdp ?? '') as string
  const remoteEndp = parseRemoteSdp(remoteSdp)

  if (!remoteEndp) {
    console.warn('[SIP] legacyStreamAudio — invalid remote SDP')
    try { dialog.destroy() } catch { /* ignore */ }
    return
  }

  const { ip: remoteIp, port: remotePort } = remoteEndp
  const tmpFile = join(tmpdir(), `voice-${Date.now()}.mp3`)
  writeFileSync(tmpFile, audioBuffer)
  console.log(`[SIP] Streaming greeting → ${remoteIp}:${remotePort}`)

  try {
    await new Promise<void>((resolve, reject) => {
      const ff = spawn('ffmpeg', [
        '-re', '-i', tmpFile,
        '-ar', '8000', '-ac', '1',
        '-acodec', 'pcm_mulaw',
        '-f', 'rtp', `rtp://${remoteIp}:${remotePort}`,
      ])
      ff.stderr.on('data', (c: Buffer) => {
        const l = c.toString().trim(); if (l) console.log('[ffmpeg]', l)
      })
      ff.on('close', (code) => {
        try { unlinkSync(tmpFile) } catch { /* */ }
        code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`))
      })
      ff.on('error', (err) => {
        try { unlinkSync(tmpFile) } catch { /* */ }
        reject(err)
      })
    })
    console.log('[SIP] Greeting complete — hanging up')
    try { dialog.destroy() } catch { /* ignore */ }
  } catch (err: any) {
    console.error('[SIP] legacyStreamAudio failed:', err.message)
    try { dialog.destroy() } catch { /* ignore */ }
  }
}

// ── makeOutboundCall ──────────────────────────────────────────────────────────
export async function makeOutboundCall(
  toNumber:    string,
  onConnected: (dialog: any) => Promise<void>,
  onHangup:    () => void,
): Promise<void> {
  if (!connected || !srf) {
    console.warn('[SIP] Not connected — outbound call skipped')
    onHangup()
    return
  }

  const sipHost  = process.env.SIP_HOST      || '41.191.76.76'
  const sipPort  = process.env.SIP_PORT      || '5060'
  const callerId = process.env.SIP_CALLER_ID || '256205477000'
  const e164     = formatToE164(toNumber)
  const sipUri   = `sip:${e164}@${sipHost}:${sipPort}`

  let hungUp = false
  const safeHangup = () => { if (!hungUp) { hungUp = true; onHangup() } }

  const noAnswerTimer = setTimeout(() => {
    console.log(`[SIP] No answer from ${e164} after 30s`)
    safeHangup()
  }, 30_000)

  const sipUsername = process.env.SIP_USERNAME
  const sipPassword = process.env.SIP_PASSWORD

  try {
    const dlg = await srf.createUAC(sipUri, {
      localSdp: buildLocalSdp(),
      ...(sipUsername && sipPassword ? { auth: { username: sipUsername, password: sipPassword } } : {}),
      headers: {
        From:            `<sip:${callerId}@${sipHost}>`,
        'X-Call-Reason': 'Code Clinic AI',
      },
    })

    clearTimeout(noAnswerTimer)
    console.log(`[SIP] Outbound call connected to ${e164}`)

    await onConnected(dlg).catch(err =>
      console.error('[SIP] onConnected error:', err.message)
    )

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
export async function handleInboundCall(req: any, res: any): Promise<void> {
  // Try multiple paths to extract the caller's E.164 number from the FROM header.
  // Roke may send:  sip:+256701234567@...  or  sip:256701234567@...  or <sip:0701234567@...>
  const fromHeader = req.getParsedHeader('from') as { uri?: { user?: string }; name?: string } | undefined
  const fromUser   = fromHeader?.uri?.user ?? ''
  const fromRaw    = (req.get('from') as string | undefined) ?? ''
  // Log once per call so we can see the exact format Roke sends
  console.log(`[SIP] FROM header raw="${fromRaw}"  parsed user="${fromUser}"`)

  // Use parsed user if available, otherwise pull number out of the raw header string
  const rawMatch   = fromRaw.match(/sip:([+\d]+)@/)
  const callerNumber = fromUser || rawMatch?.[1] || 'unknown'

  const callId = (req.get('call-id') as string | undefined) ?? `call-${Date.now()}`
  console.log(`[SIP] Inbound call from ${callerNumber}  call-id=${callId}`)

  // Log the offer SDP so we can see Roke's media IP/port
  const offerSdp = (req.body as string | undefined) ?? ''
  console.log(`[SIP] Offer SDP snippet: ${offerSdp.slice(0, 200).replace(/\r\n/g, ' | ')}`)

  try {
    const dialog = await srf.createUAS(req, res, { localSdp: buildLocalSdp() })

    // ── re-INVITE / UPDATE handler ────────────────────────────────────────────
    // Some SIP providers (including Roke) send the initial INVITE with
    // c=IN IP4 0.0.0.0 (hold/placeholder) and then send a re-INVITE with the
    // real media IP once the call is established.  We handle this by watching
    // for the 'modify' event on the dialog, which fires on re-INVITEs.
    dialog.on('modify', (modReq: any, modRes: any) => {
      try {
        const newSdp     = (modReq.body as string | undefined) ?? ''
        const newEndp    = parseRemoteSdp(newSdp)
        console.log(`[SIP] re-INVITE received — new media endpoint: ${newEndp?.ip ?? '?'}:${newEndp?.port ?? '?'}`)
        // Accept the re-INVITE with our same local SDP
        modRes.send(200, { body: buildLocalSdp() })
      } catch (e: any) {
        console.error('[SIP] re-INVITE handling error:', e.message)
      }
    })

    await startBidirectionalVoiceCall(dialog, callId, callerNumber)

    dialog.on('destroy', () => {
      console.log(`[SIP] Inbound call from ${callerNumber} ended`)
    })
  } catch (err: any) {
    console.error(`[SIP] Failed to handle inbound call from ${callerNumber}:`, err.message)
    try { res.send(500) } catch { /* already responded */ }
  }
}

// ── Public exports ────────────────────────────────────────────────────────────

export { startBidirectionalVoiceCall }

export function isSipConnected(): boolean { return connected }

// Legacy export — voice.routes.ts still imports this; kept for compatibility
export async function streamAudioToCall(dialog: any, audioBuffer: Buffer): Promise<void> {
  return legacyStreamAudio(dialog, audioBuffer)
}
