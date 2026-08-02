/**
 * Google Identity Services (token model) wrapper.
 *
 * No refresh tokens exist in the browser flow: access tokens last ~1h.
 * Strategy: cache the token; before Drive calls try a silent refresh
 * (works while the Google session cookie is alive); if that fails the
 * caller marks sync as "reconnect_needed" and a user tap re-auths.
 */
import { GOOGLE_OAUTH_CLIENT_ID } from '../config'

const SCOPES = 'https://www.googleapis.com/auth/drive.file openid email'
const TOKEN_KEY = 'ht-gtoken'
const GSI_SRC = 'https://accounts.google.com/gsi/client'

interface CachedToken {
  token: string
  expiresAt: number // ms epoch
}

interface TokenClient {
  requestAccessToken(cfg?: { prompt?: string }): void
}

interface TokenResponse {
  access_token?: string
  expires_in?: number
  error?: string
}

declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient(cfg: {
            client_id: string
            scope: string
            callback: (r: TokenResponse) => void
            error_callback?: (e: { type: string; message?: string }) => void
          }): TokenClient
        }
      }
    }
  }
}

let gsiLoaded: Promise<void> | null = null

function loadGsi(): Promise<void> {
  if (!gsiLoaded) {
    gsiLoaded = new Promise((resolve, reject) => {
      if (window.google?.accounts?.oauth2) return resolve()
      const s = document.createElement('script')
      s.src = GSI_SRC
      s.async = true
      s.onload = () => resolve()
      s.onerror = () => {
        gsiLoaded = null
        reject(new Error('Could not load Google sign-in (offline?)'))
      }
      document.head.appendChild(s)
    })
  }
  return gsiLoaded
}

export function isDriveConfigured(): boolean {
  return GOOGLE_OAUTH_CLIENT_ID.length > 0
}

function readCache(): CachedToken | null {
  try {
    const raw = localStorage.getItem(TOKEN_KEY)
    return raw ? (JSON.parse(raw) as CachedToken) : null
  } catch {
    return null
  }
}

function writeCache(t: CachedToken | null): void {
  if (t) localStorage.setItem(TOKEN_KEY, JSON.stringify(t))
  else localStorage.removeItem(TOKEN_KEY)
}

/** Valid cached token or null. 60s safety margin. */
export function cachedToken(): string | null {
  const c = readCache()
  return c && c.expiresAt - 60_000 > Date.now() ? c.token : null
}

export class AuthNeededError extends Error {
  constructor() {
    super('Google authorization needed')
    this.name = 'AuthNeededError'
  }
}

/**
 * Get an access token.
 * - `interactive: false` — silent only; throws AuthNeededError if consent UI would be needed.
 * - `interactive: true` — may open the Google popup (call from a user tap).
 * - `ignoreCache` — skip the stored token (use after a 401: the cached token
 *   may be revoked yet still look valid by its local expiry).
 */
export async function getAccessToken(
  interactive: boolean,
  opts?: { ignoreCache?: boolean },
): Promise<string> {
  const cached = opts?.ignoreCache ? null : cachedToken()
  if (cached) return cached
  if (!isDriveConfigured()) throw new Error('Google Drive is not configured')

  await loadGsi()

  return new Promise<string>((resolve, reject) => {
    let settled = false
    const finish = (fn: () => void) => {
      if (!settled) {
        settled = true
        fn()
      }
    }
    // Silent attempts can hang if GIS decides it can't respond; time out.
    const timer = setTimeout(
      () => finish(() => reject(new AuthNeededError())),
      interactive ? 120_000 : 15_000,
    )

    const client = window.google!.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_OAUTH_CLIENT_ID,
      scope: SCOPES,
      callback: (resp) => {
        clearTimeout(timer)
        if (resp.access_token) {
          writeCache({
            token: resp.access_token,
            expiresAt: Date.now() + (resp.expires_in ?? 3600) * 1000,
          })
          finish(() => resolve(resp.access_token!))
        } else {
          finish(() => reject(new AuthNeededError()))
        }
      },
      error_callback: () => {
        clearTimeout(timer)
        finish(() => reject(new AuthNeededError()))
      },
    })

    // prompt:'' = never show UI (fails if consent needed) — the silent path.
    client.requestAccessToken(interactive ? {} : { prompt: '' })
  })
}

export async function fetchAccountEmail(token: string): Promise<string | null> {
  try {
    const r = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!r.ok) return null
    const j = (await r.json()) as { email?: string }
    return j.email ?? null
  } catch {
    return null
  }
}

/** Forget the cached token (Disconnect). Does not revoke the grant. */
export function clearToken(): void {
  writeCache(null)
}
