import React from 'react';
import { Text } from '@anthropic/ink';
import { useEffect, useState } from 'react';
import { zaniiStartupProof, type ZaniiStartupStatus } from '../../utils/zaniiAgent.js';

export function ZaniiLine(): React.ReactNode {
  const [status, setStatus] = useState<ZaniiStartupStatus | null>(null);

  useEffect(() => {
    let alive = true;
    zaniiStartupProof()
      .then(s => {
        if (alive) setStatus(s);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  if (!status || status.kind === 'off') return null;

  if (status.kind === 'verified') {
    return (
      <Text dimColor>
        zanii ✓ proof verified · log #{status.size} · root {status.root}
      </Text>
    );
  }

  return (
    <Text dimColor>
      zanii ledger live · {status.receipts ?? status.size} receipts · root {status.root}
    </Text>
  );
}
