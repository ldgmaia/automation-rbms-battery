import { request } from 'node:http'
import type { Printer } from '../shared/types'

export interface BatteryLabel {
  partNumber: string
  serialNumber: string
  health: number
  description: string
}

export const testBatteryLabel: BatteryLabel = {
  partNumber: 'TEST',
  serialNumber: 'TEST-PRINT',
  health: 85,
  description: 'TEST LABEL - NOT INVENTORY',
}

const printers: Record<Printer, string> = {
  default: 'http://192.168.50.140/pstprnt',
  backup: 'http://192.168.51.111/pstprnt',
}

// ^FH prevents text from being interpreted as ZPL commands or field formatting.
function field(value: string): string {
  return value.replace(/[\^~_\\]/g, (character) =>
    `_${character.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`,
  )
}

export function buildBatteryZpl(label: BatteryLabel): string {
  const partNumber = field(label.partNumber)
  const serialNumber = field(label.serialNumber)
  const description = field(label.description.padEnd(2, ' '))

  return (
    '^XA' +
    '^FO5,5^GB600,400,4^FS' +
    '^FO5,60^GB480,280,4^FS' +
    '^FO481,5^GB124,400,4^FS' +
    '^FO482,133^GB120,3,3^FS' +
    '^FO482,266^GB120,3,3^FS' +
    '^FO8,113^GB475,2,2^FS' +
    '^FO245,115^GB1,225,1^FS' +
    '^FO490,15^CF0,20^FDBATTERY^FS' +
    `^FO13,120^TBN,230,20^CF0,20^FDBATTERY: ${label.health}%^FS` +
    `^FO12,11^CF0,28^FH_^FDP/N:${partNumber}^FS` +
    `^FO12,37^CF0,28^FH_^FDS/N:${serialNumber}^FS` +
    `^FB145,1,0,C^FO470,45^CF0,50^FD${label.health}%\\&^FS` +
    `^FB175,1,0,C^FO505,265^BQN,2,3^FH_^FDMM,AP/N:${partNumber}-S/N:${serialNumber}^FS` +
    `^FO12,345^FB465,110^CF0,19^FH_^FD${description}^FS` +
    '^XZ'
  )
}

export async function sendBatteryLabel(
  printer: Printer,
  label: BatteryLabel,
): Promise<void> {
  const url = printers[printer]
  if (!url) throw new Error('Select a valid printer.')
  await sendPrinterRequest(url, buildBatteryZpl(label))
}

export async function sendPrinterRequest(url: string, body: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const req = request(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain',
        'Content-Length': Buffer.byteLength(body, 'utf8'),
      },
      signal: AbortSignal.timeout(15000),
    }, (response) => {
      response.resume()
      response.on('error', reject)
      response.on('aborted', () => reject(new Error('Printer response was interrupted.')))
      response.on('end', () => {
        if (response.statusCode !== undefined && response.statusCode >= 200 && response.statusCode < 300) {
          resolve()
        } else {
          reject(new Error(`Printer at ${url} returned HTTP ${response.statusCode ?? 'unknown'}. Check the printer before retrying.`))
        }
      })
    })
    req.on('error', (error) => {
      reject(new Error(`Could not send the label to ${url}: ${error.message}. The label may still have printed; check the printer before retrying.`))
    })
    req.end(body, 'utf8')
  })
}
