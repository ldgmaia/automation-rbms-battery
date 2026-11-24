import { contextBridge, ipcRenderer } from 'electron'
import type { RbmsBridge } from '../shared/types'

const rbms: RbmsBridge = {
  login: (email, password) =>
    ipcRenderer.invoke('rbms:login', email, password),
  generateReport: () => ipcRenderer.invoke('rbms:generate-report'),
  uploadReport: (serialNumber) =>
    ipcRenderer.invoke('rbms:upload-report', serialNumber),
  printLabel: (printer) => ipcRenderer.invoke('rbms:print-label', printer),
  printTestLabel: (printer) => ipcRenderer.invoke('rbms:print-test-label', printer),
  batteryPresence: () => ipcRenderer.invoke('rbms:battery-presence'),
  checkForUpdate: () => ipcRenderer.invoke('rbms:check-update'),
  installUpdate: () => ipcRenderer.invoke('rbms:install-update'),
}

contextBridge.exposeInMainWorld('rbms', rbms)
