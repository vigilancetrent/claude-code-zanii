import React from 'react';
import { Box, Dialog, Text, useInput } from '@anthropic/ink';
import type { LocalJSXCommandCall } from '../../types/command.js';
import { listEntries, deleteEntry } from '../../services/SessionMemory/multiStore.js';
import { zaniiRecordMemoryWrite } from '../../utils/zaniiAgent.js';

const STORES = ['ccz-l3', 'ccz-l2', 'ccz-l1'];

function ClearConfirm({ onDone }: { onDone: (msg: string) => void }): React.ReactNode {
  useInput((input, key) => {
    const ch = input.toLowerCase();
    if (ch === 'y' || key.return) {
      let totalCleared = 0;
      for (const store of STORES) {
        const entries = listEntries(store);
        for (const key of entries) {
          try {
            deleteEntry(store, key);
            zaniiRecordMemoryWrite(store, key, '', 'user');
            totalCleared++;
          } catch {
            // continue clearing remaining entries
          }
        }
      }
      onDone(`Cleared ${totalCleared} entries across ${STORES.length} layers.`);
    } else if (ch === 'n' || key.escape) {
      onDone('Memory clear cancelled.');
    }
  });

  return (
    <Dialog title="Clear All Memories" color="warning" onCancel={() => onDone('Memory clear cancelled.')}>
      <Box flexDirection="column">
        <Text>This will delete all distilled memories from L1 (atoms), L2 (scenarios), and L3 (persona).</Text>
        <Box marginTop={1}>
          <Text dimColor>y/Enter = clear all · n/Esc = cancel</Text>
        </Box>
      </Box>
    </Dialog>
  );
}

const call: LocalJSXCommandCall = async onDone => {
  let totalEntries = 0;
  for (const store of STORES) {
    totalEntries += listEntries(store).length;
  }

  if (totalEntries === 0) {
    onDone('No distilled memories to clear.', { display: 'system' });
    return null;
  }

  return <ClearConfirm onDone={msg => onDone(msg, { display: 'system' })} />;
};

export { call };
