/**
 * Session Memory Distillation — extracts layered cross-session memories
 * from the per-session markdown summary.
 *
 * Layers:
 *   L1 (Atom)    — atomic facts, preferences, constraints (≤100 tokens each)
 *   L2 (Scenario)— project-specific knowledge blocks
 *   L3 (Persona) — stable user/team patterns
 *
 * Storage: uses multiStore to persist to ccz-l1, ccz-l2, ccz-l3 stores.
 * Runs synchronously after session memory extraction (no LLM call).
 */

import { createHash } from 'node:crypto'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { setEntry, listEntries } from './multiStore.js'
import {
  isZaniiEnabled,
  zaniiRecordMemoryWrite,
} from '../../utils/zaniiAgent.js'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'
import { logEvent } from '../analytics/index.js'

const STORE_L1 = 'ccz-l1'
const STORE_L2 = 'ccz-l2'
const STORE_L3 = 'ccz-l3'

const MAX_L1_ENTRIES = 200
const MAX_L2_ENTRIES = 50
const MAX_L3_ENTRIES = 30

type MemoryLayer = 'l1' | 'l2' | 'l3'

interface DistilledMemory {
  layer: MemoryLayer
  key: string
  content: string
}

function contentHash(content: string): string {
  return createHash('sha256').update(content.trim()).digest('hex').slice(0, 12)
}

function isValidKey(key: string): boolean {
  return /^[A-Za-z0-9._-]{1,128}$/.test(key)
}

function sanitizeKey(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80)
}

/**
 * Parse session memory markdown into layered entries.
 * Pure function — no side effects, no LLM calls.
 */
function parseSessionMemory(content: string): DistilledMemory[] {
  const memories: DistilledMemory[] = []
  const sections = parseSections(content)

  // L3: Persona patterns — from Learnings + Errors & Corrections
  const learnings = sections['# Learnings'] ?? ''
  const errors = sections['# Errors & Corrections'] ?? ''
  const persona = [learnings, errors].filter(Boolean).join('\n')
  if (persona) {
    for (const item of extractBulletItems(persona)) {
      if (item.length < 10) continue
      memories.push({
        layer: 'l3',
        key: `l3-${contentHash(item)}`,
        content: item,
      })
    }
  }

  // L2: Scenario blocks — from Task spec, Files, Workflow, Codebase docs
  const scenarioSections = [
    '# Task specification',
    '# Files and Functions',
    '# Workflow',
    '# Codebase and System Documentation',
  ]
  for (const header of scenarioSections) {
    const text = sections[header]
    if (!text) continue
    // Each section becomes one L2 entry (or split if very long)
    if (text.length > 200) {
      // Split into sub-entries at paragraph boundaries
      for (const para of splitParagraphs(text)) {
        if (para.length < 20) continue
        memories.push({
          layer: 'l2',
          key: `l2-${contentHash(para)}`,
          content: para,
        })
      }
    } else if (text.length > 20) {
      memories.push({
        layer: 'l2',
        key: `l2-${contentHash(text)}`,
        content: text,
      })
    }
  }

  // L1: Atomic facts — bullet points from all sections
  for (const [header, text] of Object.entries(sections)) {
    if (!text) continue
    for (const item of extractBulletItems(text)) {
      if (item.length < 10 || item.length > 500) continue
      memories.push({
        layer: 'l1',
        key: `l1-${contentHash(item)}`,
        content: item,
      })
    }
  }

  return memories
}

function parseSections(markdown: string): Record<string, string> {
  const sections: Record<string, string> = {}
  const lines = markdown.split('\n')
  let currentHeader = ''
  let currentLines: string[] = []

  for (const line of lines) {
    if (line.startsWith('# ')) {
      if (currentHeader) {
        sections[currentHeader] = currentLines.join('\n').trim()
      }
      currentHeader = line
      currentLines = []
    } else {
      currentLines.push(line)
    }
  }
  if (currentHeader) {
    sections[currentHeader] = currentLines.join('\n').trim()
  } else if (currentLines.length > 0) {
    // Content before first header — store as preamble so it's not silently dropped
    sections['_preamble'] = currentLines.join('\n').trim()
  }
  return sections
}

function extractBulletItems(text: string): string[] {
  const items: string[] = []
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      items.push(trimmed.slice(2).trim())
    } else if (trimmed.startsWith('• ')) {
      items.push(trimmed.slice(2).trim())
    }
  }
  return items
}

function splitParagraphs(text: string): string[] {
  return text
    .split(/\n\n+/)
    .map(p => p.trim())
    .filter(p => p.length > 0)
}

/**
 * Check if a key already exists in a store (deduplication).
 */
function keyExists(store: string, key: string): boolean {
  const entries = listEntries(store)
  return entries.includes(key)
}

/**
 * Enforce max entries per store by removing oldest (alphabetically first = smallest hash).
 */
function enforceMaxEntries(store: string, max: number): void {
  const entries = listEntries(store)
  if (entries.length <= max) return
  const toRemove = entries.slice(0, entries.length - max)
  const storeDir = join(getClaudeConfigHomeDir(), 'local-memory', store)
  for (const key of toRemove) {
    try {
      rmSync(join(storeDir, `${key}.md`), { force: true })
    } catch {
      // ignore cleanup errors
    }
  }
}

/**
 * Distill session memory content into layered cross-session memories.
 * Called after session memory extraction completes.
 */
export function distillSessionMemory(sessionMemoryContent: string): void {
  if (!sessionMemoryContent || sessionMemoryContent.trim().length === 0) return

  const memories = parseSessionMemory(sessionMemoryContent)
  if (memories.length === 0) return

  let stored = 0
  for (const mem of memories) {
    const store =
      mem.layer === 'l3' ? STORE_L3 : mem.layer === 'l2' ? STORE_L2 : STORE_L1
    const max =
      mem.layer === 'l3'
        ? MAX_L3_ENTRIES
        : mem.layer === 'l2'
          ? MAX_L2_ENTRIES
          : MAX_L1_ENTRIES

    if (!isValidKey(mem.key)) continue
    if (keyExists(store, mem.key)) continue

    try {
      setEntry(store, mem.key, mem.content)
      stored++

      // Record Zanii receipt for memory provenance
      if (isZaniiEnabled()) {
        zaniiRecordMemoryWrite(store, mem.key, mem.content, 'agent')
      }
    } catch {
      // skip write errors silently
    }
  }

  // Enforce caps
  enforceMaxEntries(STORE_L1, MAX_L1_ENTRIES)
  enforceMaxEntries(STORE_L2, MAX_L2_ENTRIES)
  enforceMaxEntries(STORE_L3, MAX_L3_ENTRIES)

  logEvent('ccz_memory_distillation', {
    input_length: sessionMemoryContent.length,
    memories_found: memories.length,
    memories_stored: stored,
    l1: memories.filter(m => m.layer === 'l1').length,
    l2: memories.filter(m => m.layer === 'l2').length,
    l3: memories.filter(m => m.layer === 'l3').length,
  })
}
