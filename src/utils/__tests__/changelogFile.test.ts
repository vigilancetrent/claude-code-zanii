import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// /release-notes fetches CHANGELOG.md from this repository and splits it on
// "## <version>" headings with "- " bullets. Keep the file in that shape, and
// keep an entry for the version being released.
describe('CHANGELOG.md', () => {
  const root = join(import.meta.dir, '..', '..', '..')
  const changelog = readFileSync(join(root, 'CHANGELOG.md'), 'utf8')
  const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
    .version as string

  test('has an entry with notes for the current version', () => {
    const sections = changelog.split(/^## /gm).slice(1)
    const current = sections.find(
      section => section.split(' - ')[0]?.trim() === version,
    )
    expect(current).toBeDefined()
    expect(
      current!.split('\n').filter(line => line.trim().startsWith('- ')).length,
    ).toBeGreaterThan(0)
  })
})
