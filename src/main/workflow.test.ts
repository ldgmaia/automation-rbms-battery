import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, ...args: string[]) => Promise<unknown>>(),
  sendBatteryLabel: vi.fn(),
  health: { value: 105 },
}))

vi.mock('electron', () => ({
  app: {
    getPath: () => 'temp',
    whenReady: () => new Promise(() => {}),
    on: vi.fn(),
  },
  BrowserWindow: vi.fn(),
  ipcMain: {
    handle: (name: string, handler: (event: unknown, ...args: string[]) => Promise<unknown>) =>
      mocks.handlers.set(name, handler),
  },
}))

vi.mock('node:child_process', () => ({
  execFile: (...args: unknown[]) => {
    const callback = args[args.length - 1]
    if (typeof callback === 'function') callback(null, '')
  },
}))

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn().mockResolvedValue('report'),
  writeFile: vi.fn().mockResolvedValue(undefined),
  unlink: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('./battery-report', () => ({
  parseBatteryReport: vi.fn(),
  calculateBatteryHealth: () => mocks.health.value,
}))

vi.mock('./linux-battery', () => ({
  createLinuxBatteryReport: vi.fn().mockResolvedValue('report'),
}))

vi.mock('./battery-label', () => ({
  sendBatteryLabel: mocks.sendBatteryLabel,
  testBatteryLabel: {},
}))

async function invoke(name: string, ...args: string[]): Promise<unknown> {
  const handler = mocks.handlers.get(`rbms:${name}`)
  if (!handler) throw new Error(`Missing handler: ${name}`)
  return handler(null, ...args)
}

describe('report upload and label workflow', () => {
  beforeEach(async () => {
    vi.resetModules()
    mocks.handlers.clear()
    mocks.sendBatteryLabel.mockReset().mockResolvedValue(undefined)
    mocks.health.value = 105
    await import('./index')
  })

  afterEach(() => vi.unstubAllGlobals())

  it('allows printing the actual health after RBMS rejects the report', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ token: 'token' })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Health exceeds 100%' }), { status: 422 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ item: { part_number: 'PART' }, description: 'Battery' }))))

    await invoke('login', 'user', 'password')
    expect(await invoke('generate-report')).toEqual({ ok: true, health: 105 })
    expect(await invoke('upload-report', 'P/N:PART-S/N:SERIAL')).toEqual({
      ok: false, error: 'Health exceeds 100%', canPrint: true,
    })
    expect(await invoke('print-label', 'default')).toEqual({ ok: true, message: 'Label sent to the printer.' })
    expect(mocks.sendBatteryLabel).toHaveBeenCalledWith('default', {
      partNumber: 'PART', serialNumber: 'SERIAL', health: 105, description: 'Battery',
    })
  })

  it('offers printing after a network error, but not for an invalid serial number', async () => {
    mocks.health.value = 85
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ token: 'token' })))
      .mockRejectedValueOnce(new Error('Network unavailable')))

    await invoke('login', 'user', 'password')
    await invoke('generate-report')
    expect(await invoke('upload-report', 'SERIAL')).toEqual({
      ok: false, error: 'Network unavailable', canPrint: true,
    })
    await invoke('generate-report')
    expect(await invoke('upload-report', 'P/N:PART')).toEqual({
      ok: false, error: 'The scanned label has no S/N value.', canPrint: false,
    })
    expect(await invoke('print-label', 'default')).toEqual({
      ok: false, error: 'Generate a battery report and enter its serial number before printing a label.',
    })
  })

  it('continues to print after a successful upload', async () => {
    mocks.health.value = 100
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ token: 'token' })))
      .mockResolvedValueOnce(new Response('{}'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ item: { part_number: 'PART' } }))))

    await invoke('login', 'user', 'password')
    await invoke('generate-report')
    expect(await invoke('upload-report', 'SERIAL')).toEqual({ ok: true, message: 'Battery report saved on RBMS.' })
    expect(await invoke('print-label', 'backup')).toEqual({ ok: true, message: 'Label sent to the printer.' })
    expect(mocks.sendBatteryLabel).toHaveBeenCalledWith('backup', {
      partNumber: 'PART', serialNumber: 'SERIAL', health: 100, description: '',
    })
  })
})
