import { createContext, useContext } from 'react'
import type { AccountRec } from './accounts'

export interface SessionState {
  account: AccountRec
  /** 游客模式：仅可浏览与阅读，云同步等功能受限 */
  isGuest: boolean
  /** 结束当前会话回到登录/注册页（游客同义） */
  logout: () => Promise<void>
}

export const SessionContext = createContext<SessionState | null>(null)

export function useSession(): SessionState | null {
  return useContext(SessionContext)
}
