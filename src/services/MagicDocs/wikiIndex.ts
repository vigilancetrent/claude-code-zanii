/**
 * Wiki index for Magic Docs.
 * Builds a cross-link adjacency graph + inverted search index + PageRank scores
 * across all tracked docs. Rebuilt from scratch each session — no persistence.
 */

// ── Types ────────────────────────────────────────────────────────────────────

export type WikiIndexEntry = {
  path: string
  title: string
  content: string
  links: string[] // outbound markdown links resolved to absolute paths
  terms: Map<string, number> // term → frequency (inverted index)
  pageRank: number // computed PageRank score
}

// ── State ────────────────────────────────────────────────────────────────────

const index = new Map<string, WikiIndexEntry>()

// ── PageRank ─────────────────────────────────────────────────────────────────

const DAMPING = 0.85
const ITERATIONS = 20
const PERSONALIZATION = 0 // uniform

function computePageRank(): void {
  const n = index.size
  if (n === 0) return

  // Assign uniform initial scores
  const scores = new Map<string, number>()
  const outDegree = new Map<string, number>()
  const inLinks = new Map<string, string[]>()

  for (const [path, entry] of index) {
    scores.set(path, 1 / n)
    // Count only links to indexed pages — non-indexed targets don't receive rank
    const indexedOutLinks = entry.links.filter(t => index.has(t))
    outDegree.set(path, indexedOutLinks.length)
    if (!inLinks.has(path)) inLinks.set(path, [])
    // Build reverse link map
    for (const target of indexedOutLinks) {
      if (!inLinks.has(target)) inLinks.set(target, [])
      inLinks.get(target)!.push(path)
    }
  }

  // Power iteration
  for (let iter = 0; iter < ITERATIONS; iter++) {
    const newScores = new Map<string, number>()
    for (const path of index.keys()) {
      let sum = 0
      const incoming = inLinks.get(path) ?? []
      for (const src of incoming) {
        const deg = outDegree.get(src) ?? 1
        sum += (scores.get(src) ?? 1 / n) / deg
      }
      newScores.set(path, (1 - DAMPING) / n + DAMPING * sum)
    }
    for (const [k, v] of newScores) scores.set(k, v)
  }

  // Write back
  for (const [path, entry] of index) {
    entry.pageRank = scores.get(path) ?? 0
  }
}

// ── Link extraction ──────────────────────────────────────────────────────────

/**
 * Extract markdown links from content: [text](path) and bare relative references
 */
function extractLinks(content: string, basePath: string): string[] {
  const links: string[] = []
  // Markdown links: [text](url)
  const mdLinkPattern = /\[([^\]]*)\]\(([^)]+)\)/g
  let match: RegExpExecArray | null
  while ((match = mdLinkPattern.exec(content)) !== null) {
    const url = match[2]!
    // Skip external URLs, anchors, images
    if (
      url.startsWith('http') ||
      url.startsWith('#') ||
      url.startsWith('data:')
    )
      continue
    // Strip anchor from relative paths
    const cleanPath = url.split('#')[0]!
    if (cleanPath) links.push(cleanPath)
  }
  return links
}

// ── Term extraction ──────────────────────────────────────────────────────────

/**
 * Tokenize content into lowercase terms for the inverted index.
 * Strips markdown syntax, code blocks, and common stop words.
 */
function extractTerms(content: string): Map<string, number> {
  const terms = new Map<string, number>()
  // Remove code blocks
  const cleaned = content
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`[^`]+`/g, '')
    // Remove markdown headers/bold/italic markers
    .replace(/#{1,6}\s/g, '')
    .replace(/[*_~]/g, '')
    // Remove URLs
    .replace(/https?:\/\/[^\s)]+/g, '')
    // Remove punctuation except hyphens in words
    .replace(/[^\w\s-]/gu, ' ')
    .toLowerCase()

  const STOP_WORDS = new Set([
    'the',
    'a',
    'an',
    'and',
    'or',
    'but',
    'in',
    'on',
    'at',
    'to',
    'for',
    'of',
    'with',
    'by',
    'from',
    'is',
    'it',
    'this',
    'that',
    'are',
    'was',
    'were',
    'be',
    'been',
    'being',
    'have',
    'has',
    'had',
    'do',
    'does',
    'did',
    'will',
    'would',
    'could',
    'should',
    'may',
    'might',
    'can',
    'shall',
    'not',
    'no',
    'nor',
    'so',
    'if',
    'then',
    'else',
    'when',
    'where',
    'how',
    'what',
    'which',
    'who',
    'whom',
    'whose',
    'why',
    'all',
    'each',
    'every',
    'both',
    'few',
    'more',
    'most',
    'other',
    'some',
    'such',
    'than',
    'too',
    'very',
    'just',
    'also',
    'now',
    'here',
    'there',
    'up',
    'out',
    'about',
  ])

  for (const word of cleaned.split(/\s+/)) {
    if (word.length < 2 || STOP_WORDS.has(word)) continue
    terms.set(word, (terms.get(word) ?? 0) + 1)
  }
  return terms
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Add or update a doc in the index. Call after registration or content change.
 * Recomputes PageRank after every mutation to keep rankings current.
 */
export function indexMagicDoc(
  filePath: string,
  title: string,
  content: string,
  resolvePath: (relative: string) => string,
): void {
  const links = extractLinks(content, filePath).map(resolvePath)
  const terms = extractTerms(content)
  index.set(filePath, {
    path: filePath,
    title,
    content,
    links,
    terms,
    pageRank: 0,
  })
  computePageRank()
}

/**
 * Remove a doc from the index.
 */
export function removeMagicDoc(filePath: string): void {
  index.delete(filePath)
  computePageRank()
}

/**
 * Get outbound links from a doc.
 */
export function getLinks(filePath: string): string[] {
  return index.get(filePath)?.links ?? []
}

/**
 * Get all docs that link to a given doc (backlinks).
 */
export function getBacklinks(filePath: string): string[] {
  const backlinks: string[] = []
  for (const entry of index.values()) {
    if (entry.links.includes(filePath)) {
      backlinks.push(entry.path)
    }
  }
  return backlinks
}

/**
 * Search across all indexed docs by keyword query.
 * Returns results ranked by TF score + PageRank (link authority), with context snippets.
 */
export function searchDocs(
  query: string,
  limit = 10,
): Array<{ path: string; title: string; snippet: string; score: number }> {
  const queryTerms = query
    .toLowerCase()
    .split(/\s+/)
    .filter(t => t.length >= 2)

  if (queryTerms.length === 0 || index.size === 0) return []

  const scores = new Map<string, number>()
  const maxPageRank = Math.max(
    ...[...index.values()].map(e => e.pageRank),
    0.001,
  )

  for (const entry of index.values()) {
    let tfScore = 0
    for (const qt of queryTerms) {
      // Exact match in title (high weight)
      if (entry.title.toLowerCase().includes(qt)) {
        tfScore += 10
        continue
      }
      // Term frequency from inverted index
      const tf = entry.terms.get(qt) ?? 0
      if (tf > 0) {
        tfScore += tf * 2
        continue
      }
      // Substring match in content (low weight, expensive fallback)
      if (entry.content.toLowerCase().includes(qt)) tfScore += 1
    }
    if (tfScore > 0) {
      // Blend TF score with PageRank: 70% relevance, 30% link authority
      const rankBoost = maxPageRank > 0 ? (entry.pageRank / maxPageRank) * 3 : 0
      scores.set(entry.path, tfScore + rankBoost)
    }
  }

  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([path, score]) => {
      const entry = index.get(path)!
      const snippet = extractSnippet(entry.content, queryTerms[0]!)
      return {
        path,
        title: entry.title,
        snippet,
        score: Math.round(score * 100) / 100,
      }
    })
}

/**
 * Get all indexed docs (for listing).
 */
export function listIndexedDocs(): Array<{ path: string; title: string }> {
  return [...index.values()].map(e => ({ path: e.path, title: e.title }))
}

/**
 * Get the most authoritative (highest PageRank) pages.
 */
export function getTopPages(
  limit = 5,
): Array<{ path: string; title: string; pageRank: number }> {
  return [...index.values()]
    .sort((a, b) => b.pageRank - a.pageRank)
    .slice(0, limit)
    .map(e => ({
      path: e.path,
      title: e.title,
      pageRank: Math.round(e.pageRank * 1000) / 1000,
    }))
}

/**
 * Get PageRank score for a specific page.
 */
export function getPageRank(filePath: string): number {
  return index.get(filePath)?.pageRank ?? 0
}

/**
 * Clear the entire index.
 */
export function clearWikiIndex(): void {
  index.clear()
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function extractSnippet(
  content: string,
  term: string,
  contextChars = 120,
): string {
  const lower = content.toLowerCase()
  const idx = lower.indexOf(term)
  if (idx === -1) {
    // Return first N chars
    return (
      content.slice(0, contextChars * 2).trim() +
      (content.length > contextChars * 2 ? '...' : '')
    )
  }
  const start = Math.max(0, idx - contextChars)
  const end = Math.min(content.length, idx + term.length + contextChars)
  let snippet = content.slice(start, end).trim()
  if (start > 0) snippet = '...' + snippet
  if (end < content.length) snippet = snippet + '...'
  return snippet
}
