import type { Message } from '../types/message.js'
import { escapeXml } from './xml.js'

export function renderMessagesToMarkdown(text: string, title: string): string {
  const heading = escapeXml(title)
    .replace(/[\r\n]+/g, ' ')
    .replace(/([\\`*_{}[\]()#+.!|>-])/g, '\\$1')
  let fence = '```'
  for (const match of text.matchAll(/`+/g)) {
    if (match[0].length >= fence.length) fence = '`'.repeat(match[0].length + 1)
  }
  return `# ${heading}\n\n${fence}text\n${text}\n${fence}\n`
}

export function renderMessagesToJson(messages: Message[]): string {
  return `${JSON.stringify(messages, null, 2)}\n`
}
