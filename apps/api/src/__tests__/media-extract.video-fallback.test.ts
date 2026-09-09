import { describe, expect, it } from 'vitest'
import { extractFromVideo } from '../ai-suite/knowledge/media-extract.service'

// This is a REAL (unmocked) test of extractFromVideo's ffmpeg-unavailable
// path — not a simulation. In this offline/sandboxed environment,
// ffmpeg-static's install-time binary download (see install.js — it fetches
// a platform binary from GitHub releases on `pnpm install`) could not reach
// the network, so no ffmpeg binary actually exists on disk here. That's
// exactly the condition this test exercises and exactly why
// extractFromVideo checks fs.existsSync() before ever touching the file
// instead of assuming the npm package guarantees a working binary.
describe('extractFromVideo when ffmpeg is unavailable (genuine environment condition, not mocked)', () => {
  it('fails clearly and safely instead of crashing or hanging', async () => {
    await expect(extractFromVideo(Buffer.from('not a real video'), 'clip.mp4'))
      .rejects.toThrow('Video processing is not available on this server')
  })
})
