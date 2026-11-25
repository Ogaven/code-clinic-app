'use strict'

const { createRequire } = require('node:module')

const apiRequire = createRequire('/var/www/codeclinic/apps/api/package.json')
const model = 'deepseek-flash'
const endpoint = 'https://api.deepseek.com/chat/completions'
const fixtureDay = '2099-01-01'
const fixtureSlot = 'synthetic-slot-01'

async function run() {
  if (typeof fetch !== 'function') throw new Error('Node.js 18 or newer is required')
  const { readFileSync } = require('node:fs')
  const { parse } = apiRequire('dotenv')
  const key = parse(readFileSync('/var/www/codeclinic/.env')).DEEPSEEK_API_KEY?.trim()
  if (!key) throw new Error('DEEPSEEK_API_KEY is missing from the API environment file')

  async function complete(stage, request) {
    let response
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(20_000),
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...request, model, thinking: { type: 'disabled' }, max_tokens: 128, stream: false }),
      })
    } catch {
      throw new Error(`${stage}: request timed out or could not reach DeepSeek`)
    }
    if (!response.ok) throw new Error(`${stage}: DeepSeek returned HTTP ${response.status}`)
    const data = await response.json().catch(() => null)
    if (!data?.choices?.[0]?.message || typeof data.model !== 'string') {
      throw new Error(`${stage}: invalid completion response`)
    }
    const { prompt_tokens: input, completion_tokens: output } = data.usage ?? {}
    if (!Number.isSafeInteger(input) || input <= 0 || !Number.isSafeInteger(output) || output < 0) {
      throw new Error(`${stage}: valid token usage was missing`)
    }
    return { choice: data.choices[0], model: data.model, input, output }
  }

  function report(stage, result) {
    const reportedModel = /^[a-zA-Z0-9._-]{1,80}$/.test(result.model) ? result.model : 'unrecognized'
    console.log(`PASS ${stage} | model=${reportedModel} | input=${result.input} | output=${result.output}`)
  }

  const greeting = await complete('generation', { messages: [
    { role: 'system', content: 'You are Sarah, a warm and concise receptionist for fictional Orchid Clinic. Use only fictional facts.' },
    { role: 'user', content: 'I have a question about the fictional clinic.' },
    { role: 'assistant', content: 'Of course. How can I help?' },
    { role: 'user', content: 'Greet me and mention the fictional clinic name in one sentence.' },
  ] })
  if (greeting.choice.finish_reason !== 'stop' || !/orchid clinic/i.test(greeting.choice.message.content ?? '')) {
    throw new Error('generation: expected a completed reply mentioning Orchid Clinic')
  }
  report('generation', greeting)

  const messages = [
    { role: 'system', content: 'This is a synthetic preview. Use the availability tool with the requested date. After its result, reply only with JSON like {"slotId":"example","action":"preview"}. Never create a booking.' },
    { role: 'user', content: `Preview a fictional slot for ${fixtureDay}.` },
  ]
  const tools = [{ type: 'function', function: {
    name: 'lookup_fixture_slot',
    description: 'Look up a fictional slot for a calendar date. Read-only.',
    parameters: { type: 'object', properties: { day: { type: 'string' } }, required: ['day'], additionalProperties: false },
  } }]
  const tool = await complete('tool call', { messages, tools })
  const calls = tool.choice.message.tool_calls
  const call = calls?.[0]
  if (tool.choice.finish_reason !== 'tool_calls' || calls?.length !== 1 ||
      call.type !== 'function' || typeof call.id !== 'string' || call.function?.name !== 'lookup_fixture_slot') {
    throw new Error('tool call: expected exactly one synthetic availability lookup')
  }
  const args = JSON.parse(call.function.arguments)
  if (args?.day !== fixtureDay || Object.keys(args).length !== 1) throw new Error('tool call: invalid synthetic arguments')
  report('tool call', tool)

  const preview = await complete('structured preview', {
    messages: [...messages, { role: 'assistant', content: null, tool_calls: [call] }, {
      role: 'tool', tool_call_id: call.id, content: JSON.stringify({ slotId: fixtureSlot, day: fixtureDay }),
    }],
    tools,
    tool_choice: 'none',
    response_format: { type: 'json_object' },
  })
  const output = JSON.parse(preview.choice.message.content ?? '')
  if (preview.choice.finish_reason !== 'stop' || output?.slotId !== fixtureSlot ||
      output.action !== 'preview' || Object.keys(output).length !== 2) {
    throw new Error('structured preview: output did not match the local preview schema')
  }
  report('structured preview', preview)
  console.log(`PASS total | input=${greeting.input + tool.input + preview.input} | output=${greeting.output + tool.output + preview.output}`)
}

run().catch(error => {
  const message = error instanceof SyntaxError ? 'Provider returned invalid JSON' : error?.message
  // Only prewritten diagnostic messages may reach the terminal.
  const safe = /^(Node.js 18 or newer is required|DEEPSEEK_API_KEY is missing from the API environment file|Provider returned invalid JSON|(?:generation|tool call|structured preview): [a-zA-Z0-9 ]+)$/i
  console.error('FAIL: ' + (safe.test(message ?? '') ? message : 'Could not load the API environment or validate the synthetic response'))
  process.exitCode = 1
})
