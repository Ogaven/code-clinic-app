import { describe, expect, it, vi, afterEach } from 'vitest'
import fs from 'fs'
import { extractFromVideo } from '../ai-suite/knowledge/media-extract.service'

// extractFromVideo checks fs.existsSync(ffmpegPath) before ever touching the
// uploaded file, specifically so a missing/broken ffmpeg-static binary fails
// clearly instead of crashing or hanging (see media-extract.service.ts ~128).
// This test forces that exact condition deterministically via fs.existsSync
// rather than depending on whether ffmpeg genuinely happens to be missing on
// whatever machine runs the suite — a real ffmpeg install (as on this build
// machine) must not flip this test to a false failure.
describe('extractFromVideo when ffmpeg is unavailable (deterministically simulated)', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('fails clearly and safely instead of crashing or hanging', async () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(false)

    await expect(extractFromVideo(Buffer.from('not a real video'), 'clip.mp4'))
      .rejects.toThrow('Video processing is not available on this server')
  })
})
