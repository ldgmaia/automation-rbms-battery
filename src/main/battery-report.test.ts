import { describe, expect, it } from 'vitest'
import {
  calculateBatteryHealth,
  createCompatibleBatteryReport,
  parseBatteryReport,
} from './battery-report'

describe('battery report parsing', () => {
  it('calculates health from the same capacity fields RBMS reads', () => {
    const report = createCompatibleBatteryReport({
      designCapacityMwh: 50_000,
      fullChargeCapacityMwh: 42_500,
    })

    const capacities = parseBatteryReport(report)
    expect(calculateBatteryHealth(capacities)).toBe(85)
  })

  it('rejects missing or invalid battery capacity values', () => {
    const report = createCompatibleBatteryReport({
      designCapacityMwh: 0,
      fullChargeCapacityMwh: 42_500,
    })

    expect(() => parseBatteryReport(report)).toThrow('Battery capacity not valid')
  })

  it('preserves the server rounding behavior', () => {
    expect(
      calculateBatteryHealth({
        designCapacityMwh: 3,
        fullChargeCapacityMwh: 2,
      }),
    ).toBe(67)
  })
})
