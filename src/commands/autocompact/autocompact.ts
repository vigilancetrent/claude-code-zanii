import { getAutoCompactThreshold } from '../../services/compact/autoCompact.js'
import type { LocalCommandCall } from '../../types/command.js'
import {
  getSettings_DEPRECATED,
  updateSettingsForSource,
} from '../../utils/settings/settings.js'

const MIN_WINDOW = 20_000

export const call: LocalCommandCall = async (args, context) => {
  const arg = args.trim().toLowerCase()
  const model = context.getAppState().mainLoopModel ?? ''
  if (!arg || arg === 'status') {
    const current = getSettings_DEPRECATED()?.autoCompactWindow
    return {
      type: 'text',
      value: `Auto-compact window: ${current ? `${current} tokens` : 'auto (model default)'}; compaction triggers at ~${getAutoCompactThreshold(model)} tokens.\nUsage: /autocompact auto | /autocompact <tokens>`,
    }
  }
  const value =
    arg === 'auto' ? undefined : parseInt(arg.replace(/[_,]/g, ''), 10)
  if (value !== undefined && (!Number.isFinite(value) || value < MIN_WINDOW)) {
    return {
      type: 'text',
      value: `Give a token count ≥ ${MIN_WINDOW}, or "auto".`,
    }
  }
  const result = updateSettingsForSource('userSettings', {
    autoCompactWindow: value,
  })
  if (result.error) {
    return { type: 'text', value: `Failed to save: ${result.error.message}` }
  }
  return {
    type: 'text',
    value:
      value === undefined
        ? `Auto-compact window reset to model default; triggers at ~${getAutoCompactThreshold(model)} tokens.`
        : `Auto-compact window set to ${value} tokens; triggers at ~${getAutoCompactThreshold(model)} tokens.`,
  }
}
