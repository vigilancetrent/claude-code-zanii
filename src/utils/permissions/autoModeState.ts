// Auto mode state functions — lives in its own module so callers can
// conditionally require() it on feature('TRANSCRIPT_CLASSIFIER').

let autoModeActive = false
let autoModeFlagCli = false
// Set by the async verifyAutoModeGateAccess check when it
// reads a fresh tengu_auto_mode_config.enabled === 'disabled' from GrowthBook.
// Used by isAutoModeGateEnabled() to block SDK/explicit re-entry after kick-out.
let autoModeCircuitBroken = false

export function setAutoModeActive(active: boolean): void {
  autoModeActive = active
}

export function isAutoModeActive(): boolean {
  return autoModeActive
}

export function setAutoModeFlagCli(passed: boolean): void {
  autoModeFlagCli = passed
}

export function getAutoModeFlagCli(): boolean {
  return autoModeFlagCli
}

export function setAutoModeCircuitBroken(broken: boolean): void {
  autoModeCircuitBroken = broken
}

export function isAutoModeCircuitBroken(): boolean {
  return autoModeCircuitBroken
}

/**
 * Pure decision for the implicit startup mode when neither --permission-mode
 * nor settings.permissions.defaultMode is set. Upstream (2.1.25x+) defaults
 * to auto; we mirror that but stay on 'default' when auto is circuit-broken,
 * disabled by settings, or the session runs in CLAUDE_CODE_REMOTE (CCR only
 * allows acceptEdits/plan/default).
 */
export function pickImplicitDefaultMode(opts: {
  autoCircuitBroken: boolean
  autoDisabledBySettings: boolean
  isRemote: boolean
}): 'auto' | 'default' {
  if (opts.autoCircuitBroken || opts.autoDisabledBySettings || opts.isRemote) {
    return 'default'
  }
  return 'auto'
}

export function _resetForTesting(): void {
  autoModeActive = false
  autoModeFlagCli = false
  autoModeCircuitBroken = false
}
