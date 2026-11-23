import type { MozhiApi } from './index'

declare global {
  interface Window {
    mozhi: MozhiApi
  }
}

export {}
