import { useCallback, useRef, useState } from 'react'
import type { PastedContent } from '../utils/config.js'

export type BufferEntry = {
  text: string
  cursorOffset: number
  pastedContents: Record<number, PastedContent>
  timestamp: number
}

export type UseInputBufferProps = {
  maxBufferSize: number
  debounceMs: number
}

export type UseInputBufferResult = {
  pushToBuffer: (
    text: string,
    cursorOffset: number,
    pastedContents?: Record<number, PastedContent>,
  ) => void
  /** Pass the live input so redo can bring it back. */
  undo: (current?: Omit<BufferEntry, 'timestamp'>) => BufferEntry | undefined
  canUndo: boolean
  /** Return to the text that was live before the last undo. */
  redo: () => BufferEntry | undefined
  canRedo: boolean
  clearBuffer: () => void
}

export function useInputBuffer({
  maxBufferSize,
  debounceMs,
}: UseInputBufferProps): UseInputBufferResult {
  const [buffer, setBuffer] = useState<BufferEntry[]>([])
  const [currentIndex, setCurrentIndex] = useState(-1)
  const [redoStack, setRedoStack] = useState<BufferEntry[]>([])
  const lastPushTime = useRef<number>(0)
  const pendingPush = useRef<ReturnType<typeof setTimeout> | null>(null)

  const pushToBuffer = useCallback(
    (
      text: string,
      cursorOffset: number,
      pastedContents: Record<number, PastedContent> = {},
    ) => {
      const now = Date.now()

      // Clear any pending push
      if (pendingPush.current) {
        clearTimeout(pendingPush.current)
        pendingPush.current = null
      }

      // Debounce rapid changes
      if (now - lastPushTime.current < debounceMs) {
        pendingPush.current = setTimeout(
          pushToBuffer,
          debounceMs,
          text,
          cursorOffset,
          pastedContents,
        )
        return
      }

      lastPushTime.current = now
      setRedoStack([])

      setBuffer(prevBuffer => {
        // If we're not at the end of the buffer, truncate everything after current position
        const newBuffer =
          currentIndex >= 0 ? prevBuffer.slice(0, currentIndex + 1) : prevBuffer

        // Don't add if it's the same as the last entry
        const lastEntry = newBuffer[newBuffer.length - 1]
        if (lastEntry && lastEntry.text === text) {
          return newBuffer
        }

        // Add new entry
        const updatedBuffer = [
          ...newBuffer,
          { text, cursorOffset, pastedContents, timestamp: now },
        ]

        // Limit buffer size
        if (updatedBuffer.length > maxBufferSize) {
          return updatedBuffer.slice(-maxBufferSize)
        }

        return updatedBuffer
      })

      // Update current index to point to the new entry
      setCurrentIndex(prev => {
        const newIndex = prev >= 0 ? prev + 1 : buffer.length
        return Math.min(newIndex, maxBufferSize - 1)
      })
    },
    [debounceMs, maxBufferSize, currentIndex, buffer.length],
  )

  const undo = useCallback(
    (current?: Omit<BufferEntry, 'timestamp'>): BufferEntry | undefined => {
      if (currentIndex < 0 || buffer.length === 0) {
        return undefined
      }

      const targetIndex = Math.max(0, currentIndex - 1)
      const entry = buffer[targetIndex]

      if (entry) {
        if (current) {
          setRedoStack(prev => [...prev, { ...current, timestamp: Date.now() }])
        }
        setCurrentIndex(targetIndex)
        return entry
      }

      return undefined
    },
    [buffer, currentIndex],
  )

  const redo = useCallback((): BufferEntry | undefined => {
    const entry = redoStack[redoStack.length - 1]
    if (!entry) return undefined
    setRedoStack(prev => prev.slice(0, -1))
    setCurrentIndex(i => Math.min(i + 1, buffer.length - 1))
    return entry
  }, [buffer.length, redoStack])

  const clearBuffer = useCallback(() => {
    setBuffer([])
    setRedoStack([])
    setCurrentIndex(-1)
    lastPushTime.current = 0
    if (pendingPush.current) {
      clearTimeout(pendingPush.current)
      pendingPush.current = null
    }
  }, [lastPushTime, pendingPush])

  const canUndo = currentIndex > 0 && buffer.length > 1

  return {
    pushToBuffer,
    undo,
    canUndo,
    redo,
    canRedo: redoStack.length > 0,
    clearBuffer,
  }
}
