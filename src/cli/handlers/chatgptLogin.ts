import {
  ChatGPTAuthError,
  startChatGPTLogin,
  type ChatGPTLogin,
} from '../../services/api/openai/chatgptAuth.js'
import {
  clearChatGPTModelCatalog,
  fetchChatGPTModelCatalog,
} from '../../services/api/openai/chatgptModels.js'
import {
  activateChatGPTSubscription,
  ChatGPTActivationError,
} from '../../services/api/openai/chatgptActivation.js'
import { openBrowser } from '../../utils/browser.js'
import { saveGlobalConfig } from '../../utils/config.js'
import { isEnvTruthy } from '../../utils/envUtils.js'
import { setChatGPTLoginActive } from 'src/utils/chatgptLoginSignals.js'
import { CHATGPT_USAGE_URL } from '../../utils/model/chatgptModels.js'
import { getInitialSettings } from '../../utils/settings/settings.js'

export type ChatGPTLoginOptions = {
  email?: string
  sso?: boolean
  console?: boolean
  claudeai?: boolean
}

function authRecovery(
  error: unknown,
  stage: 'authorization' | 'models' | 'settings',
): string {
  if (error instanceof ChatGPTActivationError) return error.message
  if (error instanceof ChatGPTAuthError) {
    switch (error.code) {
      case 'storage_error':
        return "Cannot read or protect this app's ChatGPT credentials. Check local storage permissions; use logout to reset an unreadable app record."
      case 'invalid_callback':
      case 'invalid_identity':
      case 'stale_login':
        return 'ChatGPT authorization could not be verified. Start sign-in again and complete the browser flow for this app.'
      case 'invalid_client':
      case 'invalid_discovery':
      case 'invalid_issuer':
        return 'ChatGPT client registration could not be verified. Check the app configuration and try sign-in again.'
      case 'plan_usage_disabled':
        return 'ChatGPT plan usage was not authorized. Sign in again and allow plan usage to run models.'
      case 'network_error':
      case 'discovery_error':
      case 'jwks_error':
      case 'temporarily_unavailable':
        return 'OpenAI authentication is temporarily unavailable. Check the connection and retry later.'
      case 'lock_timeout':
        return 'Another app process is updating ChatGPT credentials. Wait for it to finish and retry.'
    }
  }
  if (stage === 'models')
    return "OpenAI did not provide an available model catalog. Check the selected account's plan permission and access, then retry."
  if (stage === 'settings')
    return 'The ChatGPT connection could not be saved. Check user settings permissions and retry.'
  return 'ChatGPT sign-in did not complete. Check local credential protection and network availability, then retry sign-in. No model access was confirmed.'
}

export async function authLoginChatGPT(
  options: ChatGPTLoginOptions = {},
): Promise<void> {
  if (
    options.email !== undefined ||
    options.sso ||
    options.console ||
    options.claudeai
  ) {
    process.stderr.write(
      'Error: --chatgpt cannot be combined with --email, --sso, --console or --claudeai. Choose the ChatGPT account in your browser.\n',
    )
    process.exitCode = 1
    return
  }
  if (isEnvTruthy(process.env.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST)) {
    process.stderr.write(
      `Error: ${new ChatGPTActivationError('host_managed').message}\n`,
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
      'Error: Managed settings require an Anthropic login method or organization. ChatGPT sign-in is not available under that policy.\n',
    )
    process.exitCode = 1
    return
  }

  const controller = new AbortController()
  let login: ChatGPTLogin | undefined
  let interrupted: 'SIGINT' | 'SIGTERM' | undefined
  let stage: 'authorization' | 'models' | 'settings' = 'authorization'
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
  setChatGPTLoginActive(true)
  process.on('SIGINT', onInterrupt)
  process.on('SIGTERM', onTerminate)
  try {
    process.stdout.write(
      `Continue with ChatGPT\nAny ChatGPT account can attempt sign-in; OpenAI determines model access and whether plan usage is available. Eligible requests use your ChatGPT plan or credits and are subject to OpenAI and app usage limits.\nManage usage: ${CHATGPT_USAGE_URL}\n`,
    )
    clearChatGPTModelCatalog()
    login = await startChatGPTLogin(controller.signal)
    controller.signal.throwIfAborted()
    process.stdout.write(
      `Opening your browser. If it does not open, visit this authorization link:\n${login.authorizationUrl}\n`,
    )
    void openBrowser(login.authorizationUrl).catch(() => undefined)
    const tokens = await login.complete()
    controller.signal.throwIfAborted()
    if (!tokens.planUsageEnabled) {
      process.stderr.write(
        'Signed in, but ChatGPT plan usage was not authorized. Sign in again and allow plan usage to run models. The selected provider was not changed.\n',
      )
      process.exitCode = 1
      return
    }
    stage = 'models'
    await fetchChatGPTModelCatalog(tokens, controller.signal)
    controller.signal.throwIfAborted()
    stage = 'settings'
    activateChatGPTSubscription()
    try {
      saveGlobalConfig(current => ({
        ...current,
        chatgptPlanUsageNoticeSeen: true,
        hasCompletedOnboarding: true,
      }))
    } catch {
      process.stderr.write(
        'Connected, but onboarding preferences could not be saved. The connection remains active.\n',
      )
    }
    process.stdout.write(
      'ChatGPT connection saved. Start the normal CLI and send a prompt to verify inference access; no inference request was made during sign-in.\n',
    )
    process.exitCode = 0
  } catch (error) {
    if (controller.signal.aborted) {
      process.stderr.write('ChatGPT sign-in cancelled.\n')
      process.exitCode = interrupted === 'SIGTERM' ? 143 : 130
    } else {
      process.stderr.write(
        `ChatGPT sign-in failed: ${authRecovery(error, stage)}\n`,
      )
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
