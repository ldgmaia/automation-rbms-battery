import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { unlinkSync } from 'node:fs'
import { readFile, unlink, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { promisify } from 'node:util'
import { app, BrowserWindow, ipcMain } from 'electron'
import { calculateBatteryHealth, parseBatteryReport } from './battery-report'
import { sendBatteryLabel, testBatteryLabel } from './battery-label'
import { detectBatteryCount } from './battery-presence'
import { createLinuxBatteryReport } from './linux-battery'
import type {
  OperationResult,
  BatteryPresence,
  Printer,
  ReportResult,
} from '../shared/types'

const API_BASE_URL = 'https://api.ruggedbooksms.com'
const execFileAsync = promisify(execFile)

let authToken: string | null = null
let currentReportPath: string | null = null
let currentReportHealth: number | null = null
let uploadedBattery: { serialNumber: string; health: number } | null = null

function createWindow(): void {
  const window = new BrowserWindow({
    width: 760,
    height: 720,
    minWidth: 620,
    minHeight: 620,
    title: 'RBMS Battery Reporter',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

ipcMain.handle('rbms:battery-presence', async (): Promise<BatteryPresence> => {
  try {
    return { ok: true, count: await detectBatteryCount() }
  } catch (error) {
    return { ok: false, error: errorMessage(error) }
  }
})

ipcMain.handle(
  'rbms:login',
  async (_event, email: string, password: string): Promise<OperationResult> => {
    try {
      const response = await fetch(`${API_BASE_URL}/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password }),
      })
      const body = await readResponseBody(response)

      if (!response.ok) {
        return { ok: false, error: responseError(body, response.status) }
      }

      if (!isRecord(body) || typeof body.token !== 'string' || !body.token) {
        return {
          ok: false,
          error: 'RBMS did not return an authentication token.',
        }
      }

      authToken = body.token
      return { ok: true }
    } catch (error) {
      return { ok: false, error: errorMessage(error) }
    }
  },
)

ipcMain.handle('rbms:generate-report', async (): Promise<ReportResult> => {
  let reportPath: string | null = null

  try {
    if (!authToken) throw new Error('Log in to RBMS before generating a report.')

    await removeCurrentReport()
    currentReportHealth = null
    uploadedBattery = null
    reportPath = join(app.getPath('temp'), `rbms-battery-${randomUUID()}.html`)
    const html = await generateReportHtml(reportPath)
    const health = calculateBatteryHealth(parseBatteryReport(html))

    if (!health) throw new Error('No batteries are currently installed.')

    await writeFile(reportPath, html, 'utf8')
    currentReportPath = reportPath
    currentReportHealth = health
    reportPath = null
    return { ok: true, health }
  } catch (error) {
    let message = errorMessage(error)
    if (reportPath) {
      try {
        await removeFile(reportPath)
      } catch (cleanupError) {
        message += ` Temporary report cleanup failed: ${errorMessage(cleanupError)}`
      }
    }
    return { ok: false, error: message }
  }
})

ipcMain.handle(
  'rbms:upload-report',
  async (_event, serialInput: string): Promise<OperationResult> => {
    let result: OperationResult

    try {
      if (!authToken) throw new Error('Log in to RBMS before uploading a report.')
      if (!currentReportPath || currentReportHealth === null) {
        throw new Error('Generate a battery report before uploading it.')
      }

      const serialNumber = extractSerialNumber(serialInput)
      const file = await readFile(currentReportPath)
      const form = new FormData()
      form.append('file', new Blob([file], { type: 'text/html' }), basename(currentReportPath))
      form.append('serial_number', serialNumber)

      const response = await fetch(
        `${API_BASE_URL}/inventory_items/batteryReportUpload`,
        {
          method: 'PUT',
          headers: { Authorization: `Bearer ${authToken}` },
          body: form,
        },
      )
      const body = await readResponseBody(response)

      if (!response.ok) {
        result = { ok: false, error: responseError(body, response.status) }
      } else if (isRecord(body) && typeof body.error === 'string') {
        result = { ok: false, error: body.error }
      } else {
        result = { ok: true, message: 'Battery report saved on RBMS.' }
        uploadedBattery = { serialNumber, health: currentReportHealth }
      }
    } catch (error) {
      result = { ok: false, error: errorMessage(error) }
    }

    try {
      await removeCurrentReport()
    } catch (error) {
      const cleanupError = `Temporary report cleanup failed: ${errorMessage(error)}`
      result = result.ok
        ? { ok: true, message: `${result.message} ${cleanupError}` }
        : { ok: false, error: `${result.error} ${cleanupError}` }
    }

    return result
  },
)

ipcMain.handle(
  'rbms:print-label',
  async (_event, printer: Printer): Promise<OperationResult> => {
    try {
      if (!authToken) throw new Error('Log in to RBMS before printing a label.')
      if (!uploadedBattery) throw new Error('Upload a battery report before printing a label.')
      if (printer !== 'default' && printer !== 'backup') {
        throw new Error('Select a valid printer.')
      }

      const { serialNumber, health } = uploadedBattery
      let response: Response
      try {
        response = await fetch(`${API_BASE_URL}/inventory_items/showBySerialNumber`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${authToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ serial_number: serialNumber }),
        })
      } catch (error) {
        throw new Error(`Could not retrieve battery details from RBMS: ${errorMessage(error)}`)
      }
      const body = await readResponseBody(response)
      if (!response.ok) throw new Error(responseError(body, response.status))
      if (isRecord(body) && typeof body.error === 'string') throw new Error(body.error)
      if (
        !isRecord(body) ||
        !isRecord(body.item) ||
        typeof body.item.part_number !== 'string' ||
        !body.item.part_number.trim()
      ) {
        throw new Error('RBMS did not return a battery part number for this serial number.')
      }
      if (body.description != null && typeof body.description !== 'string') {
        throw new Error('RBMS returned an invalid battery description.')
      }

      await sendBatteryLabel(printer, {
        partNumber: body.item.part_number,
        serialNumber,
        health,
        description: body.description ?? '',
      })
      return { ok: true, message: 'Label sent to the printer.' }
    } catch (error) {
      return { ok: false, error: errorMessage(error) }
    }
  },
)

ipcMain.handle(
  'rbms:print-test-label',
  async (_event, printer: Printer): Promise<OperationResult> => {
    try {
      if (printer !== 'default' && printer !== 'backup') {
        throw new Error('Select a valid printer.')
      }
      await sendBatteryLabel(printer, testBatteryLabel)
      return {
        ok: true,
        message: 'Printer accepted the test request. Check the printer for the test label.',
      }
    } catch (error) {
      return { ok: false, error: errorMessage(error) }
    }
  },
)

async function generateReportHtml(reportPath: string): Promise<string> {
  if (process.platform === 'win32') {
    try {
      await execFileAsync(
        'powercfg.exe',
        ['/batteryreport', '/output', reportPath],
        { windowsHide: true },
      )
    } catch (error) {
      throw new Error(
        `Could not generate the Windows battery report: ${errorMessage(error)}`,
      )
    }

    return readFile(reportPath, 'utf8')
  }

  if (process.platform === 'linux') {
    return createLinuxBatteryReport()
  }

  throw new Error(`Battery-report generation is not supported on ${process.platform}.`)
}

function extractSerialNumber(input: string): string {
  const value = input.trim()
  const serialLabel = value.match(/S\/N:\s*(.+)$/i)
  if (serialLabel) {
    const serialNumber = serialLabel[1].trim()
    if (serialNumber) return serialNumber
  } else if (/^P\/N:/i.test(value)) {
    throw new Error('The scanned label has no S/N value.')
  } else if (value) {
    return value
  }

  throw new Error('Enter a battery serial number.')
}

async function readResponseBody(response: Response): Promise<unknown> {
  const text = await response.text()
  if (!text) return null

  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new Error(
      `RBMS returned an unreadable response (HTTP ${response.status}).`,
    )
  }
}

function responseError(body: unknown, status: number): string {
  if (isRecord(body)) {
    if (typeof body.error === 'string') return body.error
    if (typeof body.message === 'string') return body.message
  }
  return `RBMS request failed (HTTP ${status}).`
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'An unexpected error occurred.'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function removeCurrentReport(): Promise<void> {
  if (!currentReportPath) return

  const reportPath = currentReportPath
  await removeFile(reportPath)
  currentReportPath = null
}

async function removeFile(reportPath: string): Promise<void> {
  try {
    await unlink(reportPath)
  } catch (error) {
    if (!isErrno(error, 'ENOENT')) throw error
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

app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
  authToken = null
  app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

app.on('will-quit', () => {
  authToken = null
  if (currentReportPath) {
    try {
      unlinkSync(currentReportPath)
    } catch (error) {
      if (!isErrno(error, 'ENOENT')) throw error
    }
    currentReportPath = null
  }
})
