// Minimal Shipink API client (Node 18+ / Bun / Deno / Workers: uses global fetch).
// Copy and adapt. Types are intentionally loose; generate exact ones from
// https://docs.shipink.io/openapi.yaml (e.g. openapi-typescript).

export class ShipinkError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | undefined, // meta.code: branch on this, not on message
    message: string,
    readonly details: { field: string; error: string }[] = [],
  ) {
    super(message)
    this.name = 'ShipinkError'
  }

  /** 503/504 from the API: no shipment was created and any charge was reverted. */
  get retryable(): boolean {
    return this.code === 'CARRIER_UNAVAILABLE' || this.code === 'SHIPMENT_CARRIER_REQUEST_TIMEOUT'
  }
}

interface Envelope<T> {
  success?: boolean
  meta?: { status?: number; code?: string; message?: string; total?: number; details?: { field: string; error: string }[] }
  data?: T
}

export class ShipinkClient {
  private accessToken?: string
  private refreshToken?: string
  private expiresAt = 0

  constructor(
    private readonly opts: {
      baseUrl: string // https://api.dev.shipink.io (test) or https://api.shipink.io
      username: string
      password: string
    },
  ) {}

  async request<T>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    init: { query?: Record<string, string | number>; body?: unknown; timeoutMs?: number; headers?: Record<string, string> } = {},
    retriedAuth = false,
  ): Promise<{ data: T; total?: number }> {
    const url = new URL(path, this.opts.baseUrl)
    for (const [k, v] of Object.entries(init.query ?? {})) url.searchParams.set(k, String(v))

    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${await this.token()}`,
        Accept: 'application/json',
        ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...init.headers,
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(init.timeoutMs ?? 30_000),
    })

    if (res.status === 401 && !retriedAuth) {
      this.expiresAt = 0 // force refresh, then retry once
      return this.request(method, path, init, true)
    }

    const env = await parse<T>(res)
    if (!res.ok || env.success === false) {
      throw new ShipinkError(res.status, env.meta?.code, env.meta?.message || `HTTP ${res.status}`, env.meta?.details)
    }
    return { data: env.data as T, total: env.meta?.total }
  }

  /** POST /shipments waits for the carrier (up to ~45 s) and is NOT idempotent. */
  createShipment<T = unknown>(body: Record<string, unknown>, language: 'tr' | 'en' = 'tr') {
    return this.request<T>('POST', '/shipments', { body, timeoutMs: 50_000, headers: { 'X-Language': language } })
  }

  private async token(): Promise<string> {
    if (this.accessToken && Date.now() < this.expiresAt) return this.accessToken

    const body = this.refreshToken
      ? { refresh_token: this.refreshToken }
      : { username: this.opts.username, password: this.opts.password }
    let res = await fetch(new URL('/token', this.opts.baseUrl), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok && this.refreshToken) {
      // refresh token expired: fall back to a full login
      this.refreshToken = undefined
      return this.token()
    }
    // /token speaks OAuth: errors are {error, error_description}, not the envelope
    const env = await parse<TokenResponse>(res)
    const t = (env.data ?? (env as unknown as TokenResponse & { error?: string; error_description?: string }))
    if (!res.ok || !t.access_token) {
      const oauth = env as { error?: string; error_description?: string }
      throw new ShipinkError(res.status, oauth.error, oauth.error_description || 'Shipink login failed')
    }
    this.accessToken = t.access_token
    this.refreshToken = t.refresh_token
    this.expiresAt = Date.now() + (t.expires_in - 60) * 1000 // refresh a minute early
    return this.accessToken
  }
}

interface TokenResponse {
  access_token: string
  refresh_token: string
  expires_in: number
}

async function parse<T>(res: Response): Promise<Envelope<T>> {
  const text = await res.text()
  try {
    return JSON.parse(text)
  } catch {
    return {} // gateway error pages are not JSON
  }
}

// Usage:
// const shipink = new ShipinkClient({ baseUrl: process.env.SHIPINK_BASE_URL!, username: process.env.SHIPINK_USERNAME!, password: process.env.SHIPINK_PASSWORD! })
// const { data: rates } = await shipink.request<any[]>('POST', '/rates', { body: { warehouse_id, recipient: [addr], packages } })
// const priced = rates.filter((r) => r.carrier_service.price > 0) // price 0 = no price for this route
// const rate = priced.find((r) => r.cheapest) ?? priced[0]
