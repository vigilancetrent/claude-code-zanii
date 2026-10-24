import { spawn } from 'child_process'
import { join } from 'path'

const PREFIX = 'dpapi:v1:'
const MAX_BYTES = 1024 * 1024

async function windowsProtection(
  input: string,
  decrypt: boolean,
): Promise<string> {
  const operation = decrypt
    ? '[Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($value),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser))'
    : '[Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect([Text.Encoding]::UTF8.GetBytes($value),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser))'
  return new Promise((resolve, reject) => {
    const executable = join(
      process.env.SystemRoot ?? 'C:\\Windows',
      'System32',
      'WindowsPowerShell',
      'v1.0',
      'powershell.exe',
    )
    let child: ReturnType<typeof spawn>
    try {
      child = spawn(
        executable,
        [
          '-NoProfile',
          '-NonInteractive',
          '-WindowStyle',
          'Hidden',
          '-Command',
          `$ErrorActionPreference='Stop'; [Console]::InputEncoding=[Text.UTF8Encoding]::new($false); [Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); Add-Type -AssemblyName System.Security; $value=[Console]::In.ReadToEnd(); [Console]::Out.Write(${operation})`,
        ],
        { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] },
      )
    } catch {
      reject(new Error('Windows credential protection is unavailable.'))
      return
    }
    const chunks: Buffer[] = []
    let bytes = 0
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error('Windows credential protection timed out.'))
    }, 10_000)
    child.stdout!.on('data', (chunk: Buffer) => {
      bytes += chunk.length
      if (bytes > MAX_BYTES) {
        child.kill()
        reject(
          new Error(
            'Windows credential protection response exceeded its limit.',
          ),
        )
      } else chunks.push(chunk)
    })
    // OS diagnostics can contain input; never forward them to application logs.
    child.stderr!.resume()
    child.stdin!.on('error', () => {})
    child.once('error', () => {
      clearTimeout(timer)
      reject(new Error('Windows credential protection is unavailable.'))
    })
    child.once('close', code => {
      clearTimeout(timer)
      if (code !== 0) reject(new Error('Windows credential protection failed.'))
      else resolve(Buffer.concat(chunks).toString('utf8'))
    })
    child.stdin!.end(input, 'utf8')
  })
}

export async function protectChatGPTCredentials(json: string): Promise<string> {
  return process.platform === 'win32'
    ? PREFIX + (await windowsProtection(json, false))
    : json
}
export async function unprotectChatGPTCredentials(
  stored: string,
): Promise<string> {
  if (stored.startsWith(PREFIX)) {
    if (process.platform !== 'win32')
      throw new Error(
        'These credentials are protected by the Windows account that created them.',
      )
    return windowsProtection(stored.slice(PREFIX.length), true)
  }
  if (process.platform === 'win32') {
    const parsed: unknown = JSON.parse(stored)
    if (parsed && typeof parsed === 'object' && 'version' in parsed)
      throw new Error('Windows app credentials must be protected with DPAPI.')
  }
  return stored
}
