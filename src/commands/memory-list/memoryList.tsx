import React from 'react';
import type { LocalJSXCommandCall } from '../../types/command.js';
import { listEntries, getEntry } from '../../services/SessionMemory/multiStore.js';

const STORES = [
  { name: 'ccz-l3', label: 'L3 Persona', desc: 'Stable user/team patterns' },
  { name: 'ccz-l2', label: 'L2 Scenario', desc: 'Project-specific knowledge' },
  { name: 'ccz-l1', label: 'L1 Atom', desc: 'Atomic facts and preferences' },
];

const call: LocalJSXCommandCall = async onDone => {
  const lines: string[] = ['Distilled Cross-Session Memories', ''];
  let totalEntries = 0;

  for (const { name, label, desc } of STORES) {
    const entries = listEntries(name);
    totalEntries += entries.length;
    lines.push(`── ${label} (${entries.length}) — ${desc}`);

    if (entries.length === 0) {
      lines.push('  (empty)');
    } else {
      for (const key of entries.slice(0, 20)) {
        const content = getEntry(name, key);
        const preview = content ? (content.split('\n')[0]?.slice(0, 100) ?? '') : '';
        lines.push(`  ${key}: ${preview}`);
      }
      if (entries.length > 20) {
        lines.push(`  ... and ${entries.length - 20} more`);
      }
    }
    lines.push('');
  }

  lines.push(`Total: ${totalEntries} entries across 3 layers`);
  lines.push('Use /memory-clear to wipe all layers.');

  onDone(lines.join('\n'), { display: 'system' });
  return null;
};

export { call };
