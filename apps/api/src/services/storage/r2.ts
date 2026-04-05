import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import sharp from 'sharp'
import fs from 'fs'
import path from 'path'

// ── Local fallback when R2 is not configured ───────────────────────────────
function isR2Configured(): boolean {
  const id  = process.env.CLOUDFLARE_R2_ACCOUNT_ID
  const key = process.env.CLOUDFLARE_R2_ACCESS_KEY_ID
  return !!(id && id !== '...' && key && key !== '...')
}

// Use Railway Volume path if available (/data), else fall back to local uploads dir
const UPLOADS_DIR = fs.existsSync('/data')
  ? path.join('/data', 'uploads')
  : path.resolve(process.cwd(), 'uploads')
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true })

const API_URL = process.env.API_URL || 'http://localhost:4000'

// ── R2 client (only used when configured) ─────────────────────────────────
const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.CLOUDFLARE_R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId:     process.env.CLOUDFLARE_R2_ACCESS_KEY_ID  ?? '',
    secretAccessKey: process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY ?? '',
  },
})

const BUCKET = process.env.CLOUDFLARE_R2_BUCKET || 'codeclinic'

// ── Exports ────────────────────────────────────────────────────────────────

export async function uploadAvatar(
  buffer: Buffer,
  mimeType: string,
  folder: 'avatars' | 'doctors' | 'patients',
  id: string,
): Promise<string> {
  const processed = await sharp(buffer)
    .resize(400, 400, { fit: 'cover', position: 'centre' })
    .webp({ quality: 85 })
    .toBuffer()

  if (!isR2Configured()) {
    const filename = `${folder}-${id}.webp`
    fs.writeFileSync(path.join(UPLOADS_DIR, filename), processed)
    return `local:${filename}`
  }

  const key = `${folder}/${id}.webp`
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: processed,
    ContentType: 'image/webp',
    CacheControl: 'public, max-age=31536000',
  }))
  return key
}

export async function uploadFile(
  buffer: Buffer,
  mimeType: string,
  key: string,
): Promise<string> {
  if (!isR2Configured()) {
    const filename = key.replace(/\//g, '-')
    fs.writeFileSync(path.join(UPLOADS_DIR, filename), buffer)
    return `local:${filename}`
  }

  await s3.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: buffer,
    ContentType: mimeType,
  }))
  return key
}

export async function getSignedDownloadUrl(key: string, expiresIn = 3600): Promise<string> {
  if (key.startsWith('local:')) {
    return `${API_URL}/uploads/${key.replace('local:', '')}`
  }
  const command = new GetObjectCommand({ Bucket: BUCKET, Key: key })
  return getSignedUrl(s3, command, { expiresIn })
}

export async function deleteFile(key: string): Promise<void> {
  if (key.startsWith('local:')) {
    const filepath = path.join(UPLOADS_DIR, key.replace('local:', ''))
    if (fs.existsSync(filepath)) fs.unlinkSync(filepath)
    return
  }
  await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }))
}

export function getPublicUrl(key: string): string {
  if (key.startsWith('local:')) return `${API_URL}/uploads/${key.replace('local:', '')}`
  return `${process.env.CLOUDFLARE_R2_PUBLIC_URL}/${key}`
}
