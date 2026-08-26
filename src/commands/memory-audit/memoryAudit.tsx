import React from 'react';
import { Box, Text } from '@anthropic/ink';
import type { LocalJSXCommandCall } from '../../types/command.js';
import { isZaniiEnabled, zaniiStartupProof } from '../../utils/zaniiAgent.js';
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

type AccountInfo = {
  org_id: number;
  api_key: string;
  hw_name: string;
  created_at: string;
};

type IdentityInfo = {
  agentDid: string;
  ownerDid: string;
};

function readJson<T>(path: string): T | null {
  try {
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, 'utf-8')) as T;
  } catch {
    return null;
  }
}

const call: LocalJSXCommandCall = async onDone => {
  if (!isZaniiEnabled()) {
    onDone('Zanii proof is disabled. Set ZANII_PROOF=1 or add to settings.json.', { display: 'system' });
    return null;
  }

  const configHome = getClaudeConfigHomeDir();
  const account = readJson<AccountInfo>(join(configHome, 'zanii-account.json'));
  const identity = readJson<IdentityInfo>(join(configHome, 'zanii-agent.json'));

  const lines: string[] = ['Zanii Memory Audit', ''];

  if (identity) {
    lines.push(`Agent DID:  ${identity.agentDid}`);
    lines.push(`Owner DID:  ${identity.ownerDid}`);
  } else {
    lines.push('Agent DID:  (not provisioned yet)');
  }

  if (account) {
    lines.push(`Org ID:     ${account.org_id}`);
    lines.push(`Org Name:   ${account.hw_name}`);
    lines.push(`Created:    ${account.created_at}`);
  } else {
    lines.push('Org:        (not provisioned yet)');
  }

  lines.push('');

  try {
    const status = await zaniiStartupProof();
    if (status.kind === 'verified') {
      lines.push(`Status:     verified (log size: ${status.size}, root: ${status.root})`);
    } else if (status.kind === 'live') {
      lines.push(`Status:     live (log size: ${status.size}, root: ${status.root})`);
      if (status.receipts !== undefined) {
        lines.push(`Receipts:   ${status.receipts}`);
      }
    } else {
      lines.push('Status:     offline or disabled');
    }
  } catch {
    lines.push('Status:     could not reach server');
  }

  lines.push('');
  lines.push('Memory writes are recorded as Zanii receipts (hash-only, fire-and-forget).');
  lines.push('Each receipt is client-side verifiable via Merkle inclusion proof.');

  onDone(lines.join('\n'), { display: 'system' });
  return null;
};

export { call };
