import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFile, mkdtemp, readFile, readdir, rmdir, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { downloadUpdate, getLatestRelease, isNewerVersion, replacementScript } from './update'

const payload = Buffer.from('new executable')
const digest = createHash('sha256').update(payload).digest('hex')
const url = 'https://github.com/ldgmaia/automation-rbms-battery/releases/download/v1.0.10/RBMS-Battery-Reporter.exe'
const update = { version: '1.0.10', url, digest, size: payload.length }
const directories: string[] = []

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'rbms-update-test-'))
  directories.push(directory)
  return directory
}

afterEach(async () => {
  vi.unstubAllGlobals()
  for (const directory of directories.splice(0)) {
    for (const file of await readdir(directory)) await unlink(join(directory, file))
    await rmdir(directory)
  }
})

describe('portable updates', () => {
  it('compares numeric versions and rejects malformed versions', () => {
    expect(isNewerVersion('1.0.10', '1.0.9')).toBe(true)
    expect(isNewerVersion('1.0.9', '1.0.10')).toBe(false)
    expect(isNewerVersion('1.0.10', '1.0.10')).toBe(false)
    expect(() => isNewerVersion('1.0.1-beta', '1.0.0')).toThrow('Invalid release version')
  })

  it('checks release metadata and rejects untrusted assets', async () => {
    const asset = {
      name: 'RBMS-Battery-Reporter.exe',
      browser_download_url: url,
      digest: `sha256:${digest}`,
      size: payload.length,
    }
    const fetchMock = vi.fn().mockImplementation(async () =>
      new Response(JSON.stringify({ tag_name: 'v1.0.10', assets: [asset] })),
    )
    vi.stubGlobal('fetch', fetchMock)
    await expect(getLatestRelease('1.0.9')).resolves.toEqual({ version: '1.0.10', update })
    await expect(getLatestRelease('1.0.10')).resolves.toEqual({ version: '1.0.10', update: null })
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      tag_name: 'v1.0.10',
      assets: [{ ...asset, digest: null }],
    })))
    await expect(getLatestRelease('1.0.9')).rejects.toThrow('SHA-256')
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      tag_name: 'v1.0.10',
      assets: [{ ...asset, browser_download_url: 'https://example.com/update.exe' }],
    })))
    await expect(getLatestRelease('1.0.9')).rejects.toThrow('URL is invalid')
    fetchMock.mockResolvedValue(new Response('rate limited', { status: 403 }))
    await expect(getLatestRelease('1.0.9')).rejects.toThrow('HTTP 403')
  })

  it('verifies downloaded bytes and removes a corrupt download', async () => {
    const directory = await temporaryDirectory()
    const target = join(directory, 'original.exe')
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response(payload)))
    const staged = await downloadUpdate(update, target)
    expect(await readFile(staged)).toEqual(payload)
    await unlink(staged)
    await expect(downloadUpdate({ ...update, digest: '0'.repeat(64) }, target)).rejects.toThrow('verification')
    await expect(downloadUpdate({ ...update, size: payload.length - 1 }, target)).rejects.toThrow('larger than expected')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('unavailable', { status: 503 })))
    await expect(downloadUpdate(update, target)).rejects.toThrow('HTTP 503')
    expect(await readdir(directory)).toEqual([])
  })

  it.runIf(process.platform === 'win32')('replaces the portable file after the app exits', async () => {
    const directory = await temporaryDirectory()
    const target = join(directory, "app's original.exe")
    const staged = join(directory, 'download.exe')
    await writeFile(target, 'old executable')
    await copyFile(join(process.env.SystemRoot!, 'System32', 'where.exe'), staged)
    const newExecutable = await readFile(staged)
    const script = replacementScript(target, staged, 2147483647)
    await promisify(execFile)('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64'),
    ], { timeout: 15000, windowsHide: true })
    expect(await readFile(target)).toEqual(newExecutable)
    expect(await readdir(directory)).toEqual(["app's original.exe"])
  }, 20000)
})
