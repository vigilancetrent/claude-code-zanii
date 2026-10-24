import type { LocalCommandCall } from '../../types/command.js'
import {
  fileHistoryCanRestore,
  fileHistoryRewind,
  type FileHistoryState,
} from '../../utils/fileHistory.js'

export const call: LocalCommandCall = async (_args, context) => {
  const state = context.getAppState()
  // Snapshots are taken at each user turn; the latest one that still has a
  // snapshot is "the start of the last turn".
  const target = [...context.messages]
    .reverse()
    .find(
      m =>
        m.type === 'user' &&
        !m.isMeta &&
        !m.toolUseResult &&
        m.uuid !== undefined &&
        fileHistoryCanRestore(state.fileHistory, m.uuid),
    )
  if (!target?.uuid) {
    return {
      type: 'text',
      value: 'Nothing to undo — no file snapshot for the last turn.',
    }
  }
  try {
    await fileHistoryRewind(
      (updater: (prev: FileHistoryState) => FileHistoryState) =>
        context.setAppState(prev => ({
          ...prev,
          fileHistory: updater(prev.fileHistory),
        })),
      target.uuid,
    )
  } catch (error) {
    return {
      type: 'text',
      value: `Undo failed: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
  return {
    type: 'text',
    value:
      'Reverted file edits from the last turn. The conversation is unchanged; use /rewind to restore both.',
  }
}
