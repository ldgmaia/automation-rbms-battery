import { execFile } from 'node:child_process'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const powerSupplyPath = '/sys/class/power_supply'

export async function detectBatteryCount(): Promise<number> {
  if (process.platform === 'win32') {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        '$ErrorActionPreference = "Stop"; @(Get-CimInstance -ClassName Win32_Battery).Count',
      ],
      { windowsHide: true, timeout: 10000 },
    )
    return parseWindowsBatteryCount(stdout)
  }
  if (process.platform === 'linux') return countLinuxBatteries(powerSupplyPath)
  throw new Error(`Battery detection is not supported on ${process.platform}.`)
}

export function parseWindowsBatteryCount(output: string): number {
  const text = output.trim()
  if (!/^\d+$/.test(text)) throw new Error('Windows returned an invalid battery count.')
  const count = Number(text)
  if (!Number.isSafeInteger(count)) throw new Error('Windows returned an invalid battery count.')
  return count
}

export async function countLinuxBatteries(directory: string): Promise<number> {
  const entries = await readdir(directory)
  let count = 0
  for (const entry of entries) {
    const batteryPath = join(directory, entry)
    const type = (await readFile(join(batteryPath, 'type'), 'utf8')).trim()
    if (type.toLowerCase() !== 'battery') continue

    const present = (await readFile(join(batteryPath, 'present'), 'utf8')).trim()
    if (present === '1') count++
    else if (present !== '0') {
      throw new Error(`Linux returned an invalid presence value for ${entry}.`)
    }
  }
  return count
}
