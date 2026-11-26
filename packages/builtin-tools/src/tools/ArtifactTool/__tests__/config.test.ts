import { afterEach, describe, expect, test } from 'bun:test'
import {
  getArtifactsBaseUrl,
  getUploadUrl,
  isArtifactsConfigured,
} from '../config.js'

const original = process.env.CLAUDE_ARTIFACTS_URL
afterEach(() => {
  if (original === undefined) delete process.env.CLAUDE_ARTIFACTS_URL
  else process.env.CLAUDE_ARTIFACTS_URL = original
})

describe('artifacts config', () => {
  test('is off with no server set: nothing is uploaded to a built-in host', () => {
    delete process.env.CLAUDE_ARTIFACTS_URL
    expect(isArtifactsConfigured()).toBe(false)
    expect(getArtifactsBaseUrl()).toBe('')
    process.env.CLAUDE_ARTIFACTS_URL = '   '
    expect(isArtifactsConfigured()).toBe(false)
  })

  test('uses the server the user set', () => {
    process.env.CLAUDE_ARTIFACTS_URL = 'https://artifacts.example/'
    expect(isArtifactsConfigured()).toBe(true)
    expect(getUploadUrl()).toBe('https://artifacts.example/upload')
  })
})
