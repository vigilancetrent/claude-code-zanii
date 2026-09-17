import { validateBoundedIntEnvVar } from '../envValidation.js'
import { getSettings_DEPRECATED } from '../settings/settings.js'

export const BASH_MAX_OUTPUT_UPPER_LIMIT = 150_000
export const BASH_MAX_OUTPUT_DEFAULT = 30_000

/** settings.<key> wins over the env var; both clamped to upperLimit. */
export function resolveOutputLimit(
  settingValue: unknown,
  envName: string,
  envValue: string | undefined,
  defaultValue: number,
  upperLimit: number,
): number {
  if (typeof settingValue === 'number' && settingValue > 0) {
    return Math.min(Math.floor(settingValue), upperLimit)
  }
  return validateBoundedIntEnvVar(envName, envValue, defaultValue, upperLimit)
    .effective
}

export function getMaxOutputLength(): number {
  return resolveOutputLimit(
    getSettings_DEPRECATED()?.bashOutputMaxChars,
    'BASH_MAX_OUTPUT_LENGTH',
    process.env.BASH_MAX_OUTPUT_LENGTH,
    BASH_MAX_OUTPUT_DEFAULT,
    BASH_MAX_OUTPUT_UPPER_LIMIT,
  )
}
