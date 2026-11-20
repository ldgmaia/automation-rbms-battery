import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { countLinuxBatteries, parseWindowsBatteryCount } from './battery-presence'

const fs = vi.hoisted(() => ({
  readdir: vi.fn<() => Promise<string[]>>(),
  readFile: vi.fn<(path: string, encoding: string) => Promise<string>>(),
}))
vi.mock('node:fs/promises', () => fs)

beforeEach(() => {
  vi.resetAllMocks()
})

describe('battery presence', () => {
  it('accepts Windows battery counts and rejects malformed output', () => {
    expect(parseWindowsBatteryCount('0\r\n')).toBe(0)
    expect(parseWindowsBatteryCount('2\r\n')).toBe(2)
    expect(() => parseWindowsBatteryCount('')).toThrow('invalid battery count')
    expect(() => parseWindowsBatteryCount('2 batteries')).toThrow('invalid battery count')
  })

  it('counts only present Linux batteries and ignores other power supplies', async () => {
    fs.readdir.mockResolvedValue(['BAT0', 'BAT1', 'AC'])
    const files: Record<string, string> = {
      [join('sys', 'BAT0', 'type')]: 'Battery\n',
      [join('sys', 'BAT0', 'present')]: '1\n',
      [join('sys', 'BAT1', 'type')]: 'Battery\n',
      [join('sys', 'BAT1', 'present')]: '0\n',
      [join('sys', 'AC', 'type')]: 'Mains\n',
    }
    fs.readFile.mockImplementation(async (path) => {
      const value = files[path]
      if (value === undefined) throw new Error(`Unexpected read: ${path}`)
      return value
    })

    expect(await countLinuxBatteries('sys')).toBe(1)
    files[join('sys', 'BAT0', 'present')] = '0\n'
    expect(await countLinuxBatteries('sys')).toBe(0)
    files[join('sys', 'BAT1', 'present')] = '1\n'
    expect(await countLinuxBatteries('sys')).toBe(1)
  })

  it('reports inaccessible or malformed presence data instead of treating it as absent', async () => {
    fs.readdir.mockResolvedValue(['BAT0'])
    fs.readFile
      .mockResolvedValueOnce('Battery')
      .mockRejectedValueOnce(new Error('Cannot read present'))
    await expect(countLinuxBatteries('sys')).rejects.toThrow('Cannot read present')

    fs.readFile
      .mockResolvedValueOnce('Battery')
      .mockResolvedValueOnce('unknown')
    await expect(countLinuxBatteries('sys')).rejects.toThrow('invalid presence value')
  })
})
