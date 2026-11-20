import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildBatteryZpl, sendPrinterRequest, testBatteryLabel } from './battery-label'

const label = {
  partNumber: 'CF-VZSU',
  serialNumber: 'ABC123',
  health: 85,
  description: 'Battery',
}

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

  it('builds a clearly marked sample using the normal label template', () => {
    expect(buildBatteryZpl(testBatteryLabel)).toContain('TEST LABEL - NOT INVENTORY')
    expect(buildBatteryZpl(testBatteryLabel)).toContain('S/N:TEST-PRINT')
  })
})

describe('printer HTTP transport', () => {
  let server: Server
  let baseUrl: string
  let received: { method?: string; headers: string[]; body: string } | undefined

  beforeAll(async () => {
    server = createServer((request, response) => {
      if (request.url === '/disconnect') {
        request.socket.destroy()
        return
      }
      const chunks: Buffer[] = []
      request.on('data', (chunk: Buffer) => chunks.push(chunk))
      request.on('end', () => {
        received = {
          method: request.method,
          headers: request.rawHeaders,
          body: Buffer.concat(chunks).toString('utf8'),
        }
        response.writeHead(request.url === '/error' ? 503 : 200)
        response.end()
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  })

  it('posts the actual ZPL with explicit length and no fetch-specific headers', async () => {
    const body = buildBatteryZpl({ ...testBatteryLabel, description: 'TEST é' })
    await sendPrinterRequest(`${baseUrl}/pstprnt`, body)
    expect(received?.method).toBe('POST')
    expect(received?.body).toBe(body)
    expect(received?.headers.slice(0, 4)).toEqual([
      'Content-Type', 'text/plain',
      'Content-Length', String(Buffer.byteLength(body, 'utf8')),
    ])
    expect(received?.headers.map((value) => value.toLowerCase())).not.toContain('sec-fetch-mode')
  })

  it('reports non-success HTTP responses', async () => {
    await expect(sendPrinterRequest(`${baseUrl}/error`, 'test')).rejects.toThrow('HTTP 503')
  })

  it('reports connection failures with the printer address', async () => {
    await expect(sendPrinterRequest(`${baseUrl}/disconnect`, 'test')).rejects.toThrow(
      `Could not send the label to ${baseUrl}/disconnect`,
    )
  })
})
