let active = false

export function isChatGPTLoginActive(): boolean {
  return active
}

export function setChatGPTLoginActive(value: boolean): void {
  active = value
}

export function handleMainSigint(): void {
  if (
    isChatGPTLoginActive() ||
    process.argv.includes('-p') ||
    process.argv.includes('--print')
  ) {
    return
  }
  process.exit(0)
}
