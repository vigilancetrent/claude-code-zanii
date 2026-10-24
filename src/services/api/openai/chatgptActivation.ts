import { isEnvTruthy } from '../../../utils/envUtils.js'
import {
  getInitialSettings,
  updateSettingsForSource,
} from '../../../utils/settings/settings.js'
import { clearOpenAIClientCache } from './client.js'

const MESSAGES = {
  policy:
    'Managed settings require an Anthropic login method or organization. ChatGPT activation is not allowed under that policy.',
  host_managed:
    'The host manages model providers. Configure the ChatGPT connection through the host instead of changing app provider settings.',
  settings:
    'The ChatGPT connection could not be read or saved. Check user settings permissions and retry.',
  overridden:
    'Higher-priority settings override the ChatGPT provider or auth mode. Change those settings explicitly and retry; the active connection was not changed.',
} as const

export class ChatGPTActivationError extends Error {
  constructor(readonly code: keyof typeof MESSAGES) {
    super(MESSAGES[code])
    this.name = 'ChatGPTActivationError'
  }
}

export function activateChatGPTSubscription(): void {
  if (isEnvTruthy(process.env.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST))
    throw new ChatGPTActivationError('host_managed')
  try {
    const before = getInitialSettings()
    if (before.forceLoginMethod || before.forceLoginOrgUUID)
      throw new ChatGPTActivationError('policy')
    const { error } = updateSettingsForSource('userSettings', {
      modelType: 'openai',
      env: { OPENAI_AUTH_MODE: 'chatgpt' },
    })
    if (error) throw new ChatGPTActivationError('settings')
    const effective = getInitialSettings()
    if (effective.forceLoginMethod || effective.forceLoginOrgUUID)
      throw new ChatGPTActivationError('policy')
    if (
      effective.modelType !== 'openai' ||
      effective.env?.OPENAI_AUTH_MODE !== 'chatgpt'
    )
      throw new ChatGPTActivationError('overridden')
  } catch (error) {
    if (error instanceof ChatGPTActivationError) throw error
    throw new ChatGPTActivationError('settings')
  }
  process.env.OPENAI_AUTH_MODE = 'chatgpt'
  clearOpenAIClientCache()
}
