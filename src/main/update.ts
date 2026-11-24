import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { access, open, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

const REPOSITORY = 'ldgmaia/automation-rbms-battery'
const ASSET_NAME = 'RBMS-Battery-Reporter.exe'
const MAX_DOWNLOAD_SIZE = 300 * 1024 * 1024

export interface Update {
  version: string
  url: string
  digest: string
  size: number
}

function versionParts(version: string): number[] {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) {
    throw new Error(`Invalid release version: ${version}`)
  }
  const parts = version.split('.').map(Number)
  if (parts.some((part) => !Number.isSafeInteger(part))) {
    throw new Error(`Invalid release version: ${version}`)
  }
  return parts
}

export function isNewerVersion(latest: string, current: string): boolean {
  const latestParts = versionParts(latest)
  const currentParts = versionParts(current)
  for (let i = 0; i < 3; i++) {
    if (latestParts[i] !== currentParts[i]) return latestParts[i] > currentParts[i]
  }
  return false
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export async function getLatestRelease(currentVersion: string): Promise<{ version: string; update: Update | null }> {
  const response = await fetch(`https://api.github.com/repos/${REPOSITORY}/releases/latest`, {
    headers: { Accept: 'application/vnd.github+json' },
    signal: AbortSignal.timeout(30000),
  })
  if (!response.ok) throw new Error(`Could not check GitHub releases (HTTP ${response.status}).`)
  const body: unknown = await response.json()
  if (!record(body) || typeof body.tag_name !== 'string' || !/^v\d+\.\d+\.\d+$/.test(body.tag_name)) {
    throw new Error('GitHub returned an invalid release version.')
  }
  const version = body.tag_name.slice(1)
  if (!isNewerVersion(version, currentVersion)) return { version, update: null }
  if (!Array.isArray(body.assets)) throw new Error('GitHub returned an invalid release asset list.')
  const asset: unknown = body.assets.find((item: unknown) => record(item) && item.name === ASSET_NAME)
  if (
    !record(asset) ||
    typeof asset.browser_download_url !== 'string' ||
    typeof asset.digest !== 'string' ||
    !/^sha256:[a-f0-9]{64}$/i.test(asset.digest) ||
    typeof asset.size !== 'number' ||
    !Number.isSafeInteger(asset.size) ||
    asset.size <= 0 ||
    asset.size > MAX_DOWNLOAD_SIZE
  ) {
    throw new Error('The latest release has no valid Windows executable and SHA-256 digest.')
  }
  const expectedUrl = `https://github.com/${REPOSITORY}/releases/download/${body.tag_name}/${ASSET_NAME}`
  if (asset.browser_download_url !== expectedUrl) throw new Error('The release executable URL is invalid.')
  return { version, update: { version, url: expectedUrl, digest: asset.digest.slice(7).toLowerCase(), size: asset.size } }
}

export async function downloadUpdate(update: Update, target: string): Promise<string> {
  const staged = join(dirname(target), `.rbms-update-${randomUUID()}.exe`)
  const file = await open(staged, 'wx')
  try {
    const response = await fetch(update.url, { signal: AbortSignal.timeout(180000) })
    if (!response.ok || !response.body) throw new Error(`Could not download the update (HTTP ${response.status}).`)
    const hash = createHash('sha256')
    let size = 0
    for await (const chunk of response.body) {
      size += chunk.length
      if (size > update.size) throw new Error('The downloaded update is larger than expected.')
      hash.update(chunk)
      await file.writeFile(chunk)
    }
    if (size !== update.size || hash.digest('hex') !== update.digest) {
      throw new Error('The downloaded update failed its size or SHA-256 verification.')
    }
    await file.close()
    return staged
  } catch (error) {
    try {
      await file.close()
      await unlink(staged)
    } catch (cleanupError) {
      const message = error instanceof Error ? error.message : String(error)
      const cleanupMessage = cleanupError instanceof Error ? cleanupError.message : String(cleanupError)
      throw new Error(`${message} Download cleanup failed: ${cleanupMessage}`)
    }
    throw error
  }
}

function quotePowerShell(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

function replacementScript(target: string, staged: string, pid: number, ready: string, proceed: string): string {
  const backup = join(dirname(target), `.rbms-backup-${randomUUID()}.exe`)
  return `
$ErrorActionPreference = 'Stop'
$target = ${quotePowerShell(target)}
$staged = ${quotePowerShell(staged)}
$backup = ${quotePowerShell(backup)}
$ready = ${quotePowerShell(ready)}
$proceed = ${quotePowerShell(proceed)}
try {
  [System.IO.File]::WriteAllText($ready, 'ready')
  $confirmed = $false
  for ($i = 0; $i -lt 300; $i++) {
    if (Test-Path -LiteralPath $proceed) { $confirmed = $true; break }
    Start-Sleep -Milliseconds 100
  }
  Remove-Item -LiteralPath $ready -ErrorAction Stop
  if (-not $confirmed) { exit 1 }
  Remove-Item -LiteralPath $proceed -ErrorAction Stop
  Wait-Process -Id ${pid} -ErrorAction SilentlyContinue
  $moved = $false
  for ($i = 0; $i -lt 60; $i++) {
    try { Move-Item -LiteralPath $target -Destination $backup -ErrorAction Stop; $moved = $true; break }
    catch { Start-Sleep -Seconds 1 }
  }
  if (-not $moved) { throw 'The original executable could not be replaced. Check permissions and close other running copies.' }
  try {
    Move-Item -LiteralPath $staged -Destination $target -ErrorAction Stop
    Start-Process -FilePath $target -WorkingDirectory (Split-Path -LiteralPath $target) -ErrorAction Stop
  } catch {
    if (Test-Path -LiteralPath $target) { Move-Item -LiteralPath $target -Destination $staged -ErrorAction Stop }
    Move-Item -LiteralPath $backup -Destination $target -ErrorAction Stop
    throw
  }
  Remove-Item -LiteralPath $backup -ErrorAction Stop
} catch {
  Add-Type -AssemblyName System.Windows.Forms
  [System.Windows.Forms.MessageBox]::Show("Update failed: $($_.Exception.Message)\`nOriginal: $target\`nBackup: $backup\`nDownloaded update: $staged", 'RBMS Battery Reporter') | Out-Null
}
`
}

export async function launchReplacement(target: string, staged: string): Promise<void> {
  const marker = join(tmpdir(), `rbms-updater-${randomUUID()}`)
  const ready = `${marker}.ready`
  const proceed = `${marker}.proceed`
  const script = replacementScript(target, staged, process.pid, ready, proceed)
  const encoded = Buffer.from(script, 'utf16le').toString('base64')
  // PowerShell exits immediately when directly spawned as a detached Windows process.
  const child = spawn('cmd.exe', ['/d', '/s', '/c', `powershell.exe -NoProfile -NonInteractive -EncodedCommand ${encoded}`], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  })
  await new Promise<void>((resolve, reject) => {
    let settled = false
    let checking = false
    const deadline = Date.now() + 15000
    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      clearInterval(timer)
      if (error) reject(error)
      else {
        child.unref()
        resolve()
      }
    }
    const timer = setInterval(async () => {
      if (settled || checking) return
      if (Date.now() >= deadline) {
        finish(new Error('The update helper did not start in time.'))
        return
      }
      checking = true
      try {
        try {
          await access(ready)
        } catch (error) {
          if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') return
          throw error
        }
        if (settled) return
        await writeFile(proceed, 'go', { flag: 'wx' })
        if (!settled) finish()
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)))
      } finally {
        checking = false
      }
    }, 100)
    child.once('error', (error) => finish(error))
    child.once('exit', (code) => finish(new Error(`The update helper exited before starting (code ${code}).`)))
  })
}
