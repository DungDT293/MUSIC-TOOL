// Cloudflare Workers Types
// These types are available in Cloudflare Workers runtime

declare global {
  interface D1Database {
    prepare(query: string): D1PreparedStatement
    exec(query: string): Promise<D1ExecResult>
    batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>
  }

  interface D1PreparedStatement {
    bind(...values: any[]): D1PreparedStatement
    first<T = unknown>(): Promise<T | null>
    run(): Promise<D1Result>
    all<T = unknown>(): Promise<D1Result<T>>
  }

  interface D1Result<T = unknown> {
    success: boolean
    meta: {
      duration: number
      size_after: number
      rows_read: number
      rows_written: number
    }
    results?: T[]
    error?: string
  }

  interface D1ExecResult {
    count: number
    duration: number
  }

  interface KVNamespace {
    get(key: string, options?: { type?: 'text' | 'json' | 'arrayBuffer' | 'stream' }): Promise<string | null>
    put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>
    delete(key: string): Promise<void>
    list(options?: { prefix?: string; limit?: number }): Promise<{ keys: Array<{ name: string }> }>
  }
}

// Cloudflare Workers có sẵn các Web APIs này
// Request, Response, URL, fetch, console, crypto đều có sẵn trong runtime
// TypeScript sẽ tự động nhận diện từ lib config

export {}
