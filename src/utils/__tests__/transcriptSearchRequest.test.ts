import { afterEach, describe, expect, test } from 'bun:test'
import {
  onTranscriptSearchRequest,
  requestTranscriptSearch,
} from '../transcriptSearchRequest.js'

afterEach(() => onTranscriptSearchRequest(null))

describe('requestTranscriptSearch', () => {
  test('notifies only the active REPL listener and clears it on unmount', () => {
    let oldCalls = 0
    let currentCalls = 0
    requestTranscriptSearch()
    onTranscriptSearchRequest(() => oldCalls++)
    requestTranscriptSearch()
    onTranscriptSearchRequest(() => currentCalls++)
    requestTranscriptSearch()
    onTranscriptSearchRequest(null)
    requestTranscriptSearch()
    expect(oldCalls).toBe(1)
    expect(currentCalls).toBe(1)
  })
})
