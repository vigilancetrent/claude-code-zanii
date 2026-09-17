import type { LocalCommandCall } from '../../types/command.js'
import { setFocusModeActive } from '../../utils/focusView.js'

export const call: LocalCommandCall = async (_args, context) => {
  const next = !context.getAppState().focusMode
  context.setAppState(prev => ({ ...prev, focusMode: next }))
  setFocusModeActive(next)
  return {
    type: 'text',
    value: next
      ? 'Focus view on — showing only your prompt and the response. /focus again to restore.'
      : 'Focus view off.',
  }
}
