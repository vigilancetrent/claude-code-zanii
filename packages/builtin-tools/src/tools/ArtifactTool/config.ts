/**
 * Cloud Artifacts service configuration.
 *
 * Opt-in: there is no built-in server. Uploading sends the user's HTML or
 * Markdown to whoever runs the server, so it only happens when the user has
 * pointed CLAUDE_ARTIFACTS_URL at one they chose (packages/cloud-artifacts
 * is the worker to deploy). CLAUDE_ARTIFACTS_TOKEN is that server's token.
 */
export function isArtifactsConfigured(): boolean {
  return !!process.env.CLAUDE_ARTIFACTS_URL?.trim()
}

export function getArtifactsToken(): string {
  return process.env.CLAUDE_ARTIFACTS_TOKEN ?? ''
}

export function getArtifactsBaseUrl(): string {
  return process.env.CLAUDE_ARTIFACTS_URL?.trim() ?? ''
}

/** Strip trailing slash so `${base}/upload` is well-formed. */
export function getUploadUrl(): string {
  const base = getArtifactsBaseUrl()
  return base.endsWith('/') ? `${base}upload` : `${base}/upload`
}
