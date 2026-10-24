import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import * as React from 'react';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { authMock } from '../../../../tests/mocks/auth';
import { debugMock } from '../../../../tests/mocks/debug';
import { logMock } from '../../../../tests/mocks/log';

const directory = await mkdtemp(join(tmpdir(), 'ccz-chatgpt-usage-'));
if (!resolve(directory).startsWith(resolve(tmpdir(), 'ccz-chatgpt-usage-')))
  throw new Error('Invalid usage fixture directory');
const envKeys = [
  'CLAUDE_CONFIG_DIR',
  'OPENAI_AUTH_MODE',
  'CLAUDE_CODE_USE_OPENAI',
  'CLAUDE_CODE_USE_GEMINI',
  'CLAUDE_CODE_USE_GROK',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_FOUNDRY',
];
const originalEnv = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
const originalFetch = globalThis.fetch;
process.env.CLAUDE_CONFIG_DIR = directory;
let providerSetting: string | undefined = 'openai';
const utilization = mock(async () => {
  throw new Error('Anthropic utilization must not be fetched in ChatGPT mode');
});
const network = mock(async () => {
  throw new Error('Usage presentation must not initiate external requests');
});
mock.module('bun:bundle', () => ({ feature: () => false }));
mock.module('src/utils/debug.ts', debugMock);
mock.module('src/utils/log.ts', logMock);
mock.module('src/services/api/usage.ts', () => ({ fetchUtilization: utilization }));
mock.module('src/services/api/overageCreditGrant.ts', () => ({
  getCachedOverageCreditGrant: () => null,
  refreshOverageCreditGrantCache: async () => null,
  formatGrantAmount: () => null,
}));
mock.module('src/services/api/client.ts', () => ({
  getAnthropicClient: () => {
    throw new Error('Unexpected Anthropic client access during usage rendering');
  },
}));
mock.module('src/utils/auth.ts', () => ({
  ...authMock(),
  getSubscriptionType: () => null,
  isTeamPremiumSubscriber: () => false,
  getAnthropicApiKey: () => null,
  hasProfileScope: () => false,
  handleOAuth401Error: async () => false,
  refreshAndGetAwsCredentials: async () => undefined,
  isOverageProvisioningAllowed: () => false,
}));
mock.module('src/utils/settings/settings.ts', () => ({
  getInitialSettings: () => ({ modelType: providerSetting }),
  getSettings_DEPRECATED: () => ({ modelType: providerSetting }),
  getSettingsForSource: () => ({}),
  updateSettingsForSource: () => ({}),
}));
mock.module('src/utils/config.ts', () => ({
  getGlobalConfig: () => ({}),
  saveGlobalConfig: () => {},
  getCurrentProjectConfig: () => ({}),
  saveCurrentProjectConfig: () => {},
  checkHasTrustDialogAccepted: () => false,
}));
mock.module('src/services/analytics/growthbook.ts', () => ({
  getFeatureValue_CACHED_MAY_BE_STALE: (_key: string, fallback: unknown) => fallback,
  getFeatureFlag: () => false,
  checkStatsigFeatureGate_CACHED_MAY_BE_STALE: () => false,
}));

const { Usage } = await import('../Usage.js');
const { Link } = await import('@anthropic/ink');

function links(node: React.ReactNode): string[] {
  const result: string[] = [];
  React.Children.forEach(node, child => {
    if (!React.isValidElement<{ url?: string; children?: React.ReactNode }>(child)) return;
    if (child.type === Link && child.props.url) result.push(child.props.url);
    result.push(...links(child.props.children));
  });
  return result;
}

function text(node: React.ReactNode): string {
  let result = '';
  React.Children.forEach(node, child => {
    if (typeof child === 'string' || typeof child === 'number') result += String(child);
    else if (React.isValidElement<{ children?: React.ReactNode }>(child)) result += text(child.props.children);
  });
  return result;
}

beforeEach(() => {
  for (const key of envKeys) if (key !== 'CLAUDE_CONFIG_DIR') delete process.env[key];
  process.env.OPENAI_AUTH_MODE = 'chatgpt';
  providerSetting = 'openai';
  utilization.mockClear();
  network.mockClear();
  globalThis.fetch = network as unknown as typeof fetch;
});

afterAll(async () => {
  globalThis.fetch = originalFetch;
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await rm(directory, { recursive: true, force: true });
});

describe('actual ChatGPT Usage presentation', () => {
  test('returns the native subscription usage tree and exact management link without Anthropic utilization', () => {
    const tree = Usage();
    expect(links(tree)).toEqual(['https://chatgpt.com/settings/usage']);
    const output = text(tree).replace(/\s+/g, ' ');
    expect(output).toContain('ChatGPT plan usage');
    expect(output).toContain('OpenAI checks model access and limits for each request.');
    expect(output).toContain('API dollar estimates do not apply to subscription requests.');
    expect(output).toContain('Manage usage');
    expect(output).toContain('/cost');
    expect(output).not.toContain('% used');
    expect(output).not.toContain('Unlimited');
    expect(utilization).not.toHaveBeenCalled();
    expect(network).not.toHaveBeenCalled();
  });

  test('requires both the selected OpenAI provider and ChatGPT auth mode', () => {
    providerSetting = undefined;
    expect(links(Usage())).toEqual([]);
    providerSetting = 'openai';
    process.env.OPENAI_AUTH_MODE = 'api-key';
    expect(links(Usage())).toEqual([]);
    expect(utilization).not.toHaveBeenCalled();
  });
});
