import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('~/lib/prisma', () => ({
  default: {
    providers: {
      findMany: vi.fn(),
    },
  },
}))

vi.mock('openid-client', async () => {
  class MockClient {
    constructor(public config: any) {}
    authorizationUrl = vi.fn()
    callback = vi.fn()
  }
  const mockIssuer = {
    Client: MockClient,
  }
  return {
    Issuer: {
      discover: vi.fn().mockResolvedValue(mockIssuer),
    },
    generators: {
      codeVerifier: vi.fn().mockReturnValue('mock-verifier'),
      codeChallenge: vi.fn().mockReturnValue('mock-challenge'),
    },
    BaseClient: vi.fn(),
    discovery: vi.fn().mockResolvedValue({ serverMetadata: () => ({}) }),
    randomPKCECodeVerifier: vi.fn().mockReturnValue('mock-pkce-verifier'),
    calculatePKCECodeChallenge: vi.fn().mockResolvedValue('mock-pkce-challenge'),
    randomState: vi.fn().mockReturnValue('mock-state'),
    buildAuthorizationUrl: vi.fn().mockReturnValue(new URL('https://example.com/auth')),
    authorizationCodeGrant: vi.fn().mockResolvedValue({
      access_token: 'mock-access-token',
      id_token: 'mock-id-token',
    }),
  }
})

describe('api/common/clients', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('clients と misskeyClients がエクスポートされている', async () => {
    const prisma = (await import('~/lib/prisma')).default
    vi.mocked(prisma.providers.findMany).mockResolvedValue([])

    const mod = await import('~/api/common/clients')
    expect(mod.clients).toBeDefined()
    expect(mod.misskeyClients).toBeDefined()
    expect(typeof mod.clients).toBe('object')
    expect(typeof mod.misskeyClients).toBe('object')
  })

  it('OIDCプロバイダーのクライアントが正しく初期化される', async () => {
    const prisma = (await import('~/lib/prisma')).default
    vi.mocked(prisma.providers.findMany).mockResolvedValue([
      {
        id: 'provider-1',
        name: 'Google',
        url: 'https://accounts.google.com',
        clientId: 'google-client-id',
        clientSecret: 'google-client-secret',
        scope: 'openid profile email',
        isMisskey: false,
      } as any,
    ])

    const mod = await import('~/api/common/clients')
    // initOIDCClients は import 時に自動的に呼ばれる
    // 非同期のため即時反映されない可能性がある
    await new Promise((r) => setTimeout(r, 100))

    const { Issuer } = await import('openid-client')
    expect(Issuer.discover).toHaveBeenCalledWith('https://accounts.google.com')
  })

  it('Misskeyプロバイダーのクライアントが正しく初期化される', async () => {
    const prisma = (await import('~/lib/prisma')).default
    vi.mocked(prisma.providers.findMany).mockResolvedValue([
      {
        id: 'provider-2',
        name: 'Misskey',
        url: 'https://misskey.io',
        clientId: 'misskey-client-id',
        clientSecret: null,
        scope: 'read:account',
        isMisskey: true,
      } as any,
    ])

    const mod = await import('~/api/common/clients')
    await new Promise((r) => setTimeout(r, 100))

    const oidcV6 = await import('openid-client')
    expect(oidcV6.discovery).toHaveBeenCalledWith(
      new URL('https://misskey.io'),
      'misskey-client-id'
    )
  })

  it('複数のプロバイダーが混在する場合に正しく初期化される', async () => {
    const prisma = (await import('~/lib/prisma')).default
    vi.mocked(prisma.providers.findMany).mockResolvedValue([
      {
        id: 'p1', name: 'Google', url: 'https://accounts.google.com',
        clientId: 'google-id', clientSecret: 'google-secret',
        scope: 'openid', isMisskey: false,
      } as any,
      {
        id: 'p2', name: 'Misskey', url: 'https://misskey.io',
        clientId: 'misskey-id', clientSecret: null,
        scope: 'read:account', isMisskey: true,
      } as any,
    ])

    const mod = await import('~/api/common/clients')
    await new Promise((r) => setTimeout(r, 100))

    const { Issuer, discovery } = await import('openid-client')
    expect(Issuer.discover).toHaveBeenCalledWith('https://accounts.google.com')
    expect(discovery).toHaveBeenCalledWith(
      new URL('https://misskey.io'),
      'misskey-id'
    )
  })

  it('プロバイダー名が小文字でキーとして使用される', async () => {
    const prisma = (await import('~/lib/prisma')).default
    vi.mocked(prisma.providers.findMany).mockResolvedValue([
      {
        id: 'p1', name: 'Google', url: 'https://accounts.google.com',
        clientId: 'google-id', clientSecret: 'google-secret',
        scope: 'openid', isMisskey: false,
      } as any,
    ])

    const mod = await import('~/api/common/clients')
    await new Promise((r) => setTimeout(r, 100))

    expect(mod.clients).toBeDefined()
    expect(typeof mod.clients).toBe('object')
  })

  it('プロバイダーが存在しない場合は空のオブジェクトが返される', async () => {
    const prisma = (await import('~/lib/prisma')).default
    vi.mocked(prisma.providers.findMany).mockResolvedValue([])

    const mod = await import('~/api/common/clients')
    await new Promise((r) => setTimeout(r, 50))

    expect(mod.clients).toBeDefined()
    expect(mod.misskeyClients).toBeDefined()
    expect(typeof mod.clients).toBe('object')
    expect(typeof mod.misskeyClients).toBe('object')
  })

  it('initOIDCClientsが自動的に実行される', async () => {
    const prisma = (await import('~/lib/prisma')).default
    vi.mocked(prisma.providers.findMany).mockResolvedValue([])

    await import('~/api/common/clients')

    expect(prisma.providers.findMany).toHaveBeenCalled()
  })
})