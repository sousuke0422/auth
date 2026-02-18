import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

describe('api/common/const', () => {
  const originalEnv = process.env

  beforeEach(() => {
    vi.resetModules()
    process.env = { ...originalEnv }
  })

  afterEach(() => {
    process.env = originalEnv
  })

  it('開発環境ではisProdがfalseになる', async () => {
    process.env.NODE_ENV = 'development'
    const mod = await import('~/api/common/const')
    expect(mod.isProd).toBe(false)
  })

  it('本番環境ではisProdがtrueになる', async () => {
    process.env.NODE_ENV = 'production'
    const mod = await import('~/api/common/const')
    expect(mod.isProd).toBe(true)
  })

  it('開発環境ではhttpプロトコルが使われる', async () => {
    process.env.NODE_ENV = 'development'
    delete process.env.OVERRIDE_PROTOCOL
    delete process.env.HOST
    const mod = await import('~/api/common/const')
    expect(mod.protocol).toBe('http')
    expect(mod.host).toBe('http://localhost:3000')
  })

  it('HOST環境変数でホストを上書きできる', async () => {
    process.env.NODE_ENV = 'development'
    process.env.HOST = 'example.com'
    delete process.env.OVERRIDE_PROTOCOL
    const mod = await import('~/api/common/const')
    expect(mod.host).toBe('http://example.com')
  })

  it('OVERRIDE_PROTOCOLでプロトコルを上書きできる', async () => {
    process.env.NODE_ENV = 'development'
    process.env.OVERRIDE_PROTOCOL = 'https'
    process.env.HOST = 'example.com'
    const mod = await import('~/api/common/const')
    expect(mod.protocol).toBe('https')
    expect(mod.host).toBe('https://example.com')
  })
})
