export type OperationResult =
  | { ok: true; message?: string }
  | { ok: false; error: string }

export type ReportResult =
  | { ok: true; health: number }
  | { ok: false; error: string }

export type UploadResult =
  | { ok: true; message?: string }
  | { ok: false; error: string; canPrint: boolean }

export type Printer = 'default' | 'backup'

export type BatteryPresence =
  | { ok: true; count: number }
  | { ok: false; error: string }

export type UpdateCheckResult =
  | { ok: true; currentVersion: string; latestVersion: string; available: boolean; canInstall: boolean }
  | { ok: false; error: string }

export interface RbmsBridge {
  login(email: string, password: string): Promise<OperationResult>
  generateReport(): Promise<ReportResult>
  uploadReport(serialNumber: string): Promise<UploadResult>
  printLabel(printer: Printer): Promise<OperationResult>
  printTestLabel(printer: Printer): Promise<OperationResult>
  batteryPresence(): Promise<BatteryPresence>
  checkForUpdate(): Promise<UpdateCheckResult>
  installUpdate(): Promise<OperationResult>
}
