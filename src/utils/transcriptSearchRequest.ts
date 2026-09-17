// Tiny one-slot signal so the prompt input (vim NORMAL `/`) can open the
// transcript search bar owned by REPL without threading a prop through
// five components. ponytail: single listener; make it a Set if a second
// surface ever needs it.
let listener: (() => void) | null = null

export function onTranscriptSearchRequest(cb: (() => void) | null): void {
  listener = cb
}

export function requestTranscriptSearch(): void {
  listener?.()
}
