#!/usr/bin/env bun
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import {
  adaptResponsesStreamToAnthropic,
  parseResponsesSSE,
} from '../src/services/api/openai/responsesAdapter.js'

const model = 'synthetic-parser-benchmark'
const expectedPeak = 24
const latencyBudgetMs = 250
const batches = 10
const delta = 'Local parser fixture 🌍 '.repeat(4)
const text = delta.repeat(128)
const tool = {
  type: 'function_call',
  id: 'fc_fixture',
  call_id: 'call_fixture',
  namespace: 'local_tools',
  name: 'read_fixture',
  arguments: '{"path":"fixture.txt"}',
  status: 'completed',
}
const events: Record<string, unknown>[] = [
  { type: 'response.created', response: { id: 'resp_fixture' } },
  ...Array.from({ length: 128 }, () => ({
    type: 'response.output_text.delta',
    output_index: 1,
    content_index: 0,
    delta,
  })),
  { type: 'response.output_item.added', output_index: 2, item: tool },
  { type: 'response.output_item.done', output_index: 2, item: tool },
  {
    type: 'response.completed',
    response: {
      id: 'resp_fixture',
      status: 'completed',
      output: [
        { type: 'reasoning', id: 'rs_fixture', encrypted_content: 'fixture' },
        {
          type: 'message',
          id: 'msg_fixture',
          role: 'assistant',
          status: 'completed',
          content: [{ type: 'output_text', text, annotations: [] }],
        },
        tool,
      ],
      usage: { input_tokens: 12, output_tokens: 34 },
    },
  },
]

function responseFor(fixture: Record<string, unknown>[]): Response {
  const bytes = new TextEncoder().encode(
    fixture.map(event => `data: ${JSON.stringify(event)}\r\n\r\n`).join(''),
  )
  let offset = 0
  return new Response(
    new ReadableStream<Uint8Array>({
      pull(controller) {
        if (offset === bytes.length) {
          controller.close()
          return
        }
        const next = Math.min(offset + 97, bytes.length)
        controller.enqueue(bytes.slice(offset, next))
        offset = next
      },
    }),
    { headers: { 'Content-Type': 'text/event-stream' } },
  )
}

async function consume(fixture = events): Promise<void> {
  let stops = 0
  let tools = 0
  let actualText = ''
  let argumentsText = ''
  for await (const event of adaptResponsesStreamToAnthropic(
    parseResponsesSSE(responseFor(fixture)),
    model,
  )) {
    if (event.type === 'message_stop') stops++
    if (
      event.type === 'content_block_start' &&
      event.content_block.type === 'tool_use'
    ) {
      tools++
      assert.equal(event.content_block.name, 'read_fixture')
      assert.equal(event.content_block.id, 'call_fixture')
    }
    if (event.type === 'content_block_delta') {
      if (event.delta.type === 'text_delta') actualText += event.delta.text
      if (event.delta.type === 'input_json_delta') {
        argumentsText += event.delta.partial_json
      }
    }
  }
  assert.equal(stops, 1)
  assert.equal(tools, 1)
  assert.equal(actualText, text)
  assert.deepEqual(JSON.parse(argumentsText), { path: 'fixture.txt' })
}

await consume()
await assert.rejects(() => consume(events.slice(0, -1)))

const results = []
for (const concurrency of [1, 4, 8, 16, 32, 64, 128, 256, 512]) {
  const durations: number[] = []
  const failures: string[] = []
  const memoryBefore = process.memoryUsage().heapUsed
  const cpuBefore = process.cpuUsage()
  const started = performance.now()
  for (let batch = 0; batch < batches; batch++) {
    await Promise.all(
      Array.from({ length: concurrency }, async () => {
        const requestStarted = performance.now()
        try {
          await consume()
        } catch (error) {
          failures.push(
            error instanceof Error ? error.message : 'Unknown error',
          )
        }
        durations.push(performance.now() - requestStarted)
      }),
    )
  }
  const elapsedMs = performance.now() - started
  const cpu = process.cpuUsage(cpuBefore)
  durations.sort((a, b) => a - b)
  const percentile = (p: number) =>
    durations[
      Math.min(durations.length - 1, Math.ceil(p * durations.length) - 1)
    ]!
  results.push({
    concurrency,
    streams: durations.length,
    errors: failures.length,
    errorRate: failures.length / durations.length,
    elapsedMs,
    streamsPerSecond: (durations.length * 1000) / elapsedMs,
    p50Ms: percentile(0.5),
    p95Ms: percentile(0.95),
    p99Ms: percentile(0.99),
    heapDeltaBytes: process.memoryUsage().heapUsed - memoryBefore,
    cpuTimeMs: (cpu.user + cpu.system) / 1000,
    passesLatencyBudget: percentile(0.99) <= latencyBudgetMs,
    failures: failures.slice(0, 3),
  })
  assert.equal(
    failures.length,
    0,
    'Stream correctness failed under concurrency',
  )
}

const report = {
  runAt: new Date().toISOString(),
  runtime: Bun.version,
  scope:
    'Local synthetic SSE parser and adapter only; no authentication or network',
  expectedPeak,
  qualifyingConcurrency: expectedPeak * 2,
  latencyBudgetMs,
  inputEventsPerStream: events.length,
  decodedTextBytesPerStream: new TextEncoder().encode(text).length,
  results,
  firstBudgetBreachConcurrency:
    results.find(result => !result.passesLatencyBudget)?.concurrency ?? null,
  limit:
    'No live account, model, quota, billing or upstream capacity measurements; heap deltas include garbage collection.',
}
await mkdir('tasks/verification', { recursive: true })
await Bun.write(
  'tasks/verification/chatgpt-parser-benchmark.json',
  `${JSON.stringify(report, null, 2)}\n`,
)
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
