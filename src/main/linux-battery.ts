import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  type BatteryCapacities,
  createCompatibleBatteryReport,
} from './battery-report'

const POWER_SUPPLY_PATH = '/sys/class/power_supply'

export async function createLinuxBatteryReport(): Promise<string> {
  let entries: string[]

  try {
    entries = await readdir(POWER_SUPPLY_PATH)
  } catch (error) {
    if (isErrno(error, 'ENOENT')) {
      throw new Error('No Linux battery data was found on this computer.')
    }
    throw error
  }

  for (const entry of entries) {
    const batteryPath = join(POWER_SUPPLY_PATH, entry)
    const type = await readOptionalText(join(batteryPath, 'type'))
    if (type?.toLowerCase() !== 'battery') continue

    const energy = await readCapacityPair(batteryPath, 'energy_full', 'energy_full_design')
    if (energy) {
      return createCompatibleBatteryReport({
        designCapacityMwh: energy.design / 1000,
        fullChargeCapacityMwh: energy.full / 1000,
      })
    }

    const charge = await readCapacityPair(batteryPath, 'charge_full', 'charge_full_design')
    if (!charge) continue

    const voltage =
      (await readPositiveNumber(join(batteryPath, 'voltage_min_design'))) ??
      (await readPositiveNumber(join(batteryPath, 'voltage_now')))
    if (!voltage) continue

    const capacities: BatteryCapacities = {
      designCapacityMwh: (charge.design * voltage) / 1_000_000_000,
      fullChargeCapacityMwh: (charge.full * voltage) / 1_000_000_000,
    }
    return createCompatibleBatteryReport(capacities)
  }

  throw new Error(
    'No usable battery capacity data was found in /sys/class/power_supply.',
  )
}

async function readCapacityPair(
  directory: string,
  fullName: string,
  designName: string,
): Promise<{ full: number; design: number } | null> {
  const full = await readPositiveNumber(join(directory, fullName))
  const design = await readPositiveNumber(join(directory, designName))
  return full && design ? { full, design } : null
}

async function readPositiveNumber(path: string): Promise<number | null> {
  const value = await readOptionalText(path)
  if (value === null) return null

  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : null
}

async function readOptionalText(path: string): Promise<string | null> {
  try {
    return (await readFile(path, 'utf8')).trim()
  } catch (error) {
    if (isErrno(error, 'ENOENT')) return null
    throw error
  }
}

function isErrno(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === code
  )
}
