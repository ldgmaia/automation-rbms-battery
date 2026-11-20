import { contextBridge, ipcRenderer } from 'electron'
import type { RbmsBridge } from '../shared/types'

const rbms: RbmsBridge = {
  login: (email, password) =>
    ipcRenderer.invoke('rbms:login', email, password),
  generateReport: () => ipcRenderer.invoke('rbms:generate-report'),
  uploadReport: (serialNumber) =>
    ipcRenderer.invoke('rbms:upload-report', serialNumber),
  printLabel: (printer) => ipcRenderer.invoke('rbms:print-label', printer),
}

contextBridge.exposeInMainWorld('rbms', rbms)
