import { createContext, useContext } from 'react'
import type { AccountRec } from './accounts'

export interface SessionState {
  account: AccountRec
  logout: () => Promise<void>
}

export const SessionContext = createContext<SessionState | null>(null)

export function useSession(): SessionState | null {
  return useContext(SessionContext)
}
