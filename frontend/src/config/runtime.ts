const DEFAULT_BACKEND_HTTP_ORIGIN = 'http://localhost:8080'
const BACKEND_HTTP_ORIGIN = (import.meta.env.VITE_BACKEND_HTTP_ORIGIN ?? DEFAULT_BACKEND_HTTP_ORIGIN).trim()

function toWebSocketUrl(origin: string): string {
  if (origin.startsWith('https://')) {
    return `wss://${origin.slice('https://'.length)}/ws`
  }
  if (origin.startsWith('http://')) {
    return `ws://${origin.slice('http://'.length)}/ws`
  }
  return `${origin}/ws`
}

export const API_BASE_URL = BACKEND_HTTP_ORIGIN
export const WS_URL = toWebSocketUrl(BACKEND_HTTP_ORIGIN)
export const ACTION_TOKEN = (import.meta.env.VITE_ACTION_TOKEN ?? '').trim()
