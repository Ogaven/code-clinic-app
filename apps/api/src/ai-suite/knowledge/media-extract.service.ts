import fs from 'fs'
import os from 'os'
import path from 'path'
import crypto from 'crypto'
import OpenAI from 'openai'

// ─────────────────────────────────────────────────────────────────────────
// MULTIMEDIA EXTRACTION — turns uploaded binary media into real text the
// clinic AI can actually use. Every function here either returns genuine
// extracted text or throws a specific, honest error — never a placeholder
// like "Image: photo.jpg" (that was the previous behaviour; see
// knowledge-ingest.service.ts's ingestFile and the comment this replaced in
// KnowledgeSourcesPanel.tsx for why it was removed).
//
// PROVIDER CHOICE: this file uses the `openai` SDK, matching every other AI
// feature in this codebase since the 2026-09-07 provider migration (see
// knowledge-studio.routes.ts's own provider-architecture comment). It
// instantiates its own client independently rather than importing one from
// elsewhere because OpenAI's API is the only provider integrated here that
// offers both (a) audio transcription (Whisper) and (b) vision in one
// place — keeping multimedia extraction on one provider with one API key
// to configure, rather than splitting image and audio handling across two.
// ─────────────────────────────────────────────────────────────────────────

function getOpenAI(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not configured — image/audio/video ingestion is unavailable until an administrator sets it.')
  }
  return new OpenAI({ apiKey })
}

// The OpenAI SDK's error messages can echo back request details (including
// fragments of the API key in some auth-error responses) — every provider
// call in this file is wrapped so ONLY this curated, safe message ever
// escapes to a caller. err.message/stack still go to the server log.
// Exported so its status-code -> message mapping can be unit tested
// directly with fake error shapes (see __tests__/media-extract.service.test.ts)
// without ever calling the real OpenAI API.
export function sanitizedProviderError(err: any, action: string): Error {
  console.error(`[Knowledge Ingest] ${action} error:`, err?.message ?? err)
  const status = err?.status ?? err?.response?.status
  if (status === 429) return new Error(`The AI provider is temporarily busy — please retry ${action} in a moment.`)
  if (status === 401 || status === 403) return new Error('The AI provider is not configured correctly. Contact an administrator.')
  if (status === 413) return new Error('File is too large for the AI provider to process.')
  return new Error(`Failed to ${action}. Please try again.`)
}

// ── Images → text ────────────────────────────────────────────────────────
// Vision-based extraction: reads any legible text in the image (signage,
// price lists, forms, screenshots) AND produces a short factual description
// of non-text content, so a photo of e.g. a clinic layout is still useful
// grounding even with no text in it. Never invents clinic facts not visibly
// present in the image.
export async function extractFromImage(buffer: Buffer, mimeType: string): Promise<string> {
  const client = getOpenAI()
  const base64 = buffer.toString('base64')

  let response
  try {
    response = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 1000,
      messages: [
        {
          role: 'system',
          content: 'You extract factual, useful information from images for a dental clinic\'s internal knowledge base. Transcribe any legible text verbatim (signage, price lists, forms, schedules). Then briefly describe any other clinic-relevant visual content (e.g. "photo of the waiting room", "diagram of tooth numbering"). Never invent information not actually visible in the image. If the image has no clinic-relevant content, say so plainly.',
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Extract the useful knowledge from this image.' },
            { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}` } },
          ],
        },
      ],
    })
  } catch (err) {
    throw sanitizedProviderError(err, 'read this image')
  }

  const text = response.choices[0]?.message?.content?.trim()
  if (!text) throw new Error('The vision model returned no content for this image.')
  return text
}

// ── Audio → transcript ───────────────────────────────────────────────────
export async function transcribeAudio(buffer: Buffer, filename: string): Promise<string> {
  const client = getOpenAI()
  const tmpFile = await writeTempFile(buffer, filename)
  try {
    let transcription
    try {
      transcription = await client.audio.transcriptions.create({
        file: fs.createReadStream(tmpFile),
        model: 'whisper-1',
      })
    } catch (err) {
      throw sanitizedProviderError(err, 'transcribe this audio')
    }
    const text = transcription.text?.trim()
    if (!text) throw new Error('Transcription returned no speech content — the audio may be silent or unintelligible.')
    return text
  } finally {
    fs.unlink(tmpFile, () => {})
  }
}

// ── Video → transcript ───────────────────────────────────────────────────
// Extracts the audio track with ffmpeg (bundled via the ffmpeg-static npm
// package — no system ffmpeg install required) and transcribes it with the
// same Whisper call as plain audio. Deliberately does NOT do frame-by-frame
// visual analysis: the task this serves is "what does this video say", and
// running vision on extracted frames would multiply API cost for marginal
// value here — see the task's own "only use visual understanding ... if
// genuinely needed" guidance.
export async function extractFromVideo(buffer: Buffer, filename: string): Promise<string> {
  let ffmpegPath: string
  let ffmpeg: typeof import('fluent-ffmpeg')
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    ffmpegPath = require('ffmpeg-static')
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    ffmpeg = require('fluent-ffmpeg')
  } catch {
    throw new Error('Video processing is not available on this server (ffmpeg is not installed).')
  }
  if (!ffmpegPath || !fs.existsSync(ffmpegPath)) {
    throw new Error('Video processing is not available on this server (ffmpeg binary not found).')
  }
  ffmpeg.setFfmpegPath(ffmpegPath)

  const videoPath = await writeTempFile(buffer, filename)
  const audioPath = `${videoPath}.mp3`
  try {
    await new Promise<void>((resolve, reject) => {
      ffmpeg(videoPath)
        .noVideo()
        .audioCodec('libmp3lame')
        .format('mp3')
        .on('error', (err: Error) => reject(new Error(`Failed to extract audio from video: ${err.message}`)))
        .on('end', () => resolve())
        .save(audioPath)
    })
    const audioBuffer = fs.readFileSync(audioPath)
    if (audioBuffer.length === 0) throw new Error('Extracted audio track is empty — the video may have no audio.')
    return await transcribeAudio(audioBuffer, 'audio.mp3')
  } finally {
    fs.unlink(videoPath, () => {})
    fs.unlink(audioPath, () => {})
  }
}

// ── PDF → text ────────────────────────────────────────────────────────────
// pdf-parse 2.x replaced its v1 `pdf(buffer) -> {text}` callable-function API
// with a `PDFParse` class (`new PDFParse({ data }).getText()`) — this
// codebase's package.json already pins "pdf-parse": "^2.4.5" (the v2 line)
// while the pre-existing call site in knowledge-ingest.service.ts's
// ingestFile still used the old v1 calling convention, which throws
// "pdfParse is not a function" against the actually-installed version. That
// was a real, pre-existing bug (silently breaking ALL PDF ingestion, not
// something introduced by this task) — fixed here, and ingestFile now calls
// this same corrected helper instead of duplicating the broken pattern.
export async function extractFromPdf(buffer: Buffer): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { PDFParse } = require('pdf-parse')
  const parser = new PDFParse({ data: buffer })
  try {
    const result = await parser.getText()
    const text = (result.text || '').trim()
    if (!text) throw new Error('No text could be extracted from this PDF — it may be empty or a scanned image with no text layer.')
    return text
  } finally {
    await parser.destroy()
  }
}

// ── DOCX → text ───────────────────────────────────────────────────────────
export async function extractFromDocx(buffer: Buffer): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mammoth = require('mammoth')
  const result = await mammoth.extractRawText({ buffer })
  const text = (result.value as string).trim()
  if (!text) throw new Error('No text could be extracted from this document — it may be empty, scanned images, or corrupted.')
  return text
}

async function writeTempFile(buffer: Buffer, originalName: string): Promise<string> {
  const ext = path.extname(originalName) || ''
  const tmpPath = path.join(os.tmpdir(), `kb-ingest-${crypto.randomBytes(8).toString('hex')}${ext}`)
  await fs.promises.writeFile(tmpPath, buffer)
  return tmpPath
}
