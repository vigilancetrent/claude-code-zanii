import { describe, expect, test } from 'bun:test'
import {
  HOOK_EVENTS,
  HookInputSchema,
  InterruptHookInputSchema,
} from '../coreSchemas.js'

describe('Interrupt hook event', () => {
  test('is a registered hook event', () => {
    expect(HOOK_EVENTS).toContain('Interrupt')
  })

  test('input schema parses and is part of the HookInput union', () => {
    const input = {
      session_id: 's',
      transcript_path: '/t',
      cwd: '/c',
      permission_mode: 'default',
      hook_event_name: 'Interrupt',
      reason: 'user_cancel',
      query_in_flight: true,
    }
    expect(InterruptHookInputSchema().safeParse(input).success).toBe(true)
    expect(HookInputSchema().safeParse(input).success).toBe(true)
    expect(
      InterruptHookInputSchema().safeParse({ ...input, reason: 'other' })
        .success,
    ).toBe(false)
  })
})
