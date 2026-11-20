/// <reference types="vite/client" />

import type { RbmsBridge } from '../../shared/types'

declare global {
  interface Window {
    rbms: RbmsBridge
  }
}
