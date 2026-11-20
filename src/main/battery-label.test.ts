import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildBatteryZpl, sendBatteryLabel } from './battery-label'

const label = {
  partNumber: 'CF-VZSU',
  serialNumber: 'ABC123',
  health: 85,
  description: 'Battery',
}

afterEach(() => vi.unstubAllGlobals())

describe('battery label', () => {
  it('uses the battery layout, health, serial number and QR data', () => {
    const zpl = buildBatteryZpl(label)
    expect(zpl).toContain('^FDBATTERY^FS')
    expect(zpl).toContain('^FDBATTERY: 85%^FS')
    expect(zpl).toContain('^FDP/N:CF-VZSU^FS')
    expect(zpl).toContain('^FDS/N:ABC123^FS')
    expect(zpl).toContain('^FD85%\\&^FS')
    expect(zpl).toContain('^FDMM,AP/N:CF-VZSU-S/N:ABC123^FS')
    expect(zpl).toContain('^FDBattery^FS')
    expect(zpl).toMatch(/^\^XA.*\^XZ$/)
  })

  it('escapes ZPL control characters in dynamic fields', () => {
    const zpl = buildBatteryZpl({ ...label, serialNumber: 'a^FS~_\\' })
    expect(zpl).toContain('a_5EFS_7E_5F_5C')
    expect(zpl).not.toContain('a^FS')
  })

  it.each([
    ['default', 'http://192.168.50.140/pstprnt'],
    ['backup', 'http://192.168.51.111/pstprnt'],
  ] as const)('sends ZPL as plain text to the %s printer', async (printer, url) => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    await sendBatteryLabel(printer, label)
    expect(fetchMock).toHaveBeenCalledWith(
      url,
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: buildBatteryZpl(label),
      }),
    )
  })

  it('reports printer HTTP failures', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 503 })))
    await expect(sendBatteryLabel('default', label)).rejects.toThrow('HTTP 503')
  })
})
