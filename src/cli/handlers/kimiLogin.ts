import {
  KimiActivationError,
  KimiAuthError,
  activateKimiSubscription,
  startKimiLogin,
  type KimiLogin,
} from '../../services/api/openai/kimiAuth.js'
import { openBrowser } from '../../utils/browser.js'
import { saveGlobalConfig } from '../../utils/config.js'
import { isEnvTruthy } from '../../utils/envUtils.js'
import { setChatGPTLoginActive } from 'src/utils/chatgptLoginSignals.js'
import { getInitialSettings } from '../../utils/settings/settings.js'

export type KimiLoginOptions = {
  email?: string
  sso?: boolean
  console?: boolean
  claudeai?: boolean
}

function authRecovery(error: unknown): string {
  if (error instanceof KimiActivationError) return error.message
  if (error instanceof KimiAuthError) {
    switch (error.code) {
      case 'storage_error':
        return "Cannot read or protect this app's Kimi credentials. Check local storage permissions; use logout to reset an unreadable app record."
      case 'network_error':
      case 'device_authorization_error':
      case 'refresh_error':
        return 'Kimi authentication is temporarily unavailable. Check the connection and retry.'
      case 'expired_token':
        return 'Kimi sign-in expired. Start sign-in again and approve the code in your browser.'
      case 'denied':
        return 'Kimi sign-in was denied. Start sign-in again and approve the code in your browser.'
    }
  }
  return 'Kimi sign-in did not complete. Check local credential protection and network availability, then retry. No model access was confirmed.'
}

export async function authLoginKimi(
  options: KimiLoginOptions = {},
): Promise<void> {
  if (
    options.email !== undefined ||
    options.sso ||
    options.console ||
    options.claudeai
  ) {
    process.stderr.write(
      'Error: --kimi cannot be combined with --email, --sso, --console or --claudeai. Choose the Kimi account in your browser.\n',
    )
    process.exitCode = 1
    return
  }
  if (isEnvTruthy(process.env.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST)) {
    process.stderr.write(
      `Error: ${new KimiActivationError('host_managed').message}\n`,
    )
    process.exitCode = 1
    return
  }
  let settings: ReturnType<typeof getInitialSettings>
  try {
    settings = getInitialSettings()
  } catch {
    process.stderr.write(
      'Error: Login policy settings could not be read. Fix the local settings before signing in.\n',
    )
    process.exitCode = 1
    return
  }
  if (settings.forceLoginMethod || settings.forceLoginOrgUUID) {
    process.stderr.write(
      'Error: Managed settings require an Anthropic login method or organization. Kimi sign-in is not available under that policy.\n',
    )
    process.exitCode = 1
    return
  }

  const controller = new AbortController()
  let login: KimiLogin | undefined
  let interrupted: 'SIGINT' | 'SIGTERM' | undefined
  const onInterrupt = () => {
    interrupted = 'SIGINT'
    controller.abort()
    login?.cancel()
  }
  const onTerminate = () => {
    interrupted = 'SIGTERM'
    controller.abort()
    login?.cancel()
  }
  // Reuses the shared "a sign-in is in progress" signal so Ctrl+C is left to
  // the login flow instead of exiting the process.
  setChatGPTLoginActive(true)
  process.on('SIGINT', onInterrupt)
  process.on('SIGTERM', onTerminate)
  try {
    process.stdout.write(
      'Continue with Kimi\nUse your Kimi Code subscription. Requests count against your Kimi plan limits; model access is checked by Kimi.\n',
    )
    login = await startKimiLogin(controller.signal)
    controller.signal.throwIfAborted()
    process.stdout.write(
      `Open this link in your browser and approve the code ${login.userCode}:\n${login.verificationUriComplete}\n`,
    )
    void openBrowser(login.verificationUriComplete).catch(() => undefined)
    await login.complete()
    controller.signal.throwIfAborted()
    activateKimiSubscription()
    try {
      saveGlobalConfig(current => ({
        ...current,
        hasCompletedOnboarding: true,
      }))
    } catch {
      process.stderr.write(
        'Connected, but onboarding preferences could not be saved. The connection remains active.\n',
      )
    }
    process.stdout.write(
      'Kimi connection saved. Start the normal CLI and send a prompt to verify inference access; no inference request was made during sign-in.\n',
    )
    process.exitCode = 0
  } catch (error) {
    if (controller.signal.aborted) {
      process.stderr.write('Kimi sign-in cancelled.\n')
      process.exitCode = interrupted === 'SIGTERM' ? 143 : 130
    } else {
      process.stderr.write(`Kimi sign-in failed: ${authRecovery(error)}\n`)
      process.exitCode = 1
    }
  } finally {
    controller.abort()
    process.removeListener('SIGINT', onInterrupt)
    process.removeListener('SIGTERM', onTerminate)
    setChatGPTLoginActive(false)
    login?.cancel()
  }
}
