import { describe, expect, it } from 'vitest'
import fs from 'fs'
import path from 'path'

// Permanent regression guard for the OpenAI provider cutover (2026-09-07).
// Scans every TypeScript source file for a live Anthropic SDK reference —
// import, instantiation, or a claude- model string. Fails the build if
// anyone reintroduces a direct Anthropic runtime call anywhere in the app.
// Historical comments mentioning "Claude"/"Anthropic" are fine and are not
// what this checks for — only actual SDK usage.

const SRC_ROOT = path.resolve(__dirname, '..')

const LIVE_PATTERNS = [
  /@anthropic-ai\/sdk/,
  /\bnew Anthropic\s*\(/,
  /\bAnthropic\.(Tool|MessageParam|ContentBlock|ToolUseBlock|TextBlock|ToolResultBlockParam)\b/,
  /['"`]claude-[\w.-]+['"`]/,
]

function walk(dir: string, files: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '__tests__') continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, files)
    else if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) files.push(full)
  }
  return files
}

describe('no Anthropic runtime dependency', () => {
  it('finds zero live @anthropic-ai/sdk references anywhere under src/', () => {
    const offenders: string[] = []
    for (const file of walk(SRC_ROOT)) {
      const content = fs.readFileSync(file, 'utf8')
      for (const pattern of LIVE_PATTERNS) {
        if (pattern.test(content)) {
          offenders.push(`${path.relative(SRC_ROOT, file)} — matched ${pattern}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })
})
