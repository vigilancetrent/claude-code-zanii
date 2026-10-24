let listener: (() => void) | null = null

export function onTranscriptSearchRequest(callback: (() => void) | null): void {
  listener = callback
}

export function requestTranscriptSearch(): void {
  listener?.()
}
