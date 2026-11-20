export type OperationResult =
  | { ok: true; message?: string }
  | { ok: false; error: string }

export type ReportResult =
  | { ok: true; health: number }
  | { ok: false; error: string }

export type Printer = 'default' | 'backup'

export interface RbmsBridge {
  login(email: string, password: string): Promise<OperationResult>
  generateReport(): Promise<ReportResult>
  uploadReport(serialNumber: string): Promise<OperationResult>
  printLabel(printer: Printer): Promise<OperationResult>
}
