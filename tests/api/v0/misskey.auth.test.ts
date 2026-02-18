import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockBuildAuthorizationUrl = vi.fn().mockReturnValue(new URL('https://misskey.io/auth'))
const mockRandomPKCECodeVerifier = vi.fn().mockReturnValue('misskey-code-verifier')
const mockCalculatePKCECodeChallenge = vi.fn().mockResolvedValue('misskey-code-challenge')
const mockRandomState = vi.fn().mockReturnValue('misskey-random-state')

vi.mock('~/lib/prisma', () => ({
  default: {
    providers: {
      findFirst: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
    },
  },
}))

vi.mock('openid-client', () => ({
  Issuer: { discover: vi.fn() },
  generators: { codeVerifier: vi.fn(), codeChallenge: vi.fn() },
  BaseClient: vi.fn(),
  discovery: vi.fn(),
  randomPKCECodeVerifier: mockRandomPKCECodeVerifier,
  calculatePKCECodeChallenge: mockCalculatePKCECodeChallenge,
  randomState: mockRandomState,
  buildAuthorizationUrl: mockBuildAuthorizationUrl,
  authorizationCodeGrant: vi.fn(),
}))

const mockMisskeyConfig = { serverMetadata: () => ({ issuer: 'https://misskey.io' }) }

vi.mock('~/api/common/clients', () => ({
  clients: {},
  misskeyClients: {
    misskey: mockMisskeyConfig,
  },
}))

vi.mock('~/api/common/helper/misskeyAuthStorage', () => ({
  misskeyAuthStorage: {
    setItem: vi.fn(),
    getItem: vi.fn(),
  },
}))

describe('api/v0/misskey.auth - Misskey認証フロー', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('misskeyAuthモジュールがエクスポートされる', async () => {
    const { misskeyAuth } = await import('~/api/v0/misskey.auth')
    expect(misskeyAuth).toBeDefined()
  })

  it('有効なMisskeyプロバイダーでリダイレクトされる', async () => {
    const prisma = (await import('~/lib/prisma')).default
    vi.mocked(prisma.providers.findFirst).mockResolvedValue({
      id: 'mp1',
      name: 'Misskey',
      url: 'https://misskey.io',
      clientId: 'misskey-client-id',
      clientSecret: null,
      scope: 'read:account',
      isMisskey: true,
    } as any)

    const { misskeyAuth } = await import('~/api/v0/misskey.auth')
    const res = await misskeyAuth.request(
      new Request('http://localhost/misskey'),
      undefined,
      {}
    )

    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('https://misskey.io/auth')
  })

  it('無効なプロバイダーで400エラーが返る', async () => {
    const { misskeyAuth } = await import('~/api/v0/misskey.auth')
    const res = await misskeyAuth.request(
      new Request('http://localhost/nonexistent'),
      undefined,
      {}
    )

    expect(res.status).toBe(400)
    const body = await res.text()
    expect(body).toBe('Invalid provider')
  })

  it('PKCEパラメータが正しく生成される', async () => {
    const prisma = (await import('~/lib/prisma')).default
    vi.mocked(prisma.providers.findFirst).mockResolvedValue({
      id: 'mp1', name: 'Misskey', url: 'https://misskey.io',
      clientId: 'cid', clientSecret: null, scope: 'read:account', isMisskey: true,
    } as any)

    const { misskeyAuth } = await import('~/api/v0/misskey.auth')
    await misskeyAuth.request(
      new Request('http://localhost/misskey'),
      undefined,
      {}
    )

    expect(mockRandomPKCECodeVerifier).toHaveBeenCalledOnce()
    expect(mockCalculatePKCECodeChallenge).toHaveBeenCalledWith('misskey-code-verifier')
    expect(mockRandomState).toHaveBeenCalledOnce()
  })

  it('buildAuthorizationUrlに正しいパラメータが渡される', async () => {
    const prisma = (await import('~/lib/prisma')).default
    vi.mocked(prisma.providers.findFirst).mockResolvedValue({
      id: 'mp1', name: 'Misskey', url: 'https://misskey.io',
      clientId: 'cid', clientSecret: null, scope: 'read:account', isMisskey: true,
    } as any)

    const { misskeyAuth } = await import('~/api/v0/misskey.auth')
    await misskeyAuth.request(
      new Request('http://localhost/misskey'),
      undefined,
      {}
    )

    expect(mockBuildAuthorizationUrl).toHaveBeenCalledWith(
      mockMisskeyConfig,
      expect.objectContaining({
        redirect_uri: expect.stringContaining('/api/v0/misskey/callback/misskey'),
        scope: 'read:account',
        code_challenge: 'misskey-code-challenge',
        code_challenge_method: 'S256',
        state: 'misskey-random-state',
      })
    )
  })

  it('code_verifierがCookieに設定される', async () => {
    const prisma = (await import('~/lib/prisma')).default
    vi.mocked(prisma.providers.findFirst).mockResolvedValue({
      id: 'mp1', name: 'Misskey', url: 'https://misskey.io',
      clientId: 'cid', clientSecret: null, scope: 'read:account', isMisskey: true,
    } as any)

    const { misskeyAuth } = await import('~/api/v0/misskey.auth')
    const res = await misskeyAuth.request(
      new Request('http://localhost/misskey'),
      undefined,
      {}
    )

    const cookies = res.headers.get('set-cookie') || ''
    expect(cookies).toContain('code_verifier=misskey-code-verifier')
    expect(cookies).toContain('HttpOnly')
  })

  it('stateがmisskeyAuthStorageに保存される', async () => {
    const prisma = (await import('~/lib/prisma')).default
    vi.mocked(prisma.providers.findFirst).mockResolvedValue({
      id: 'mp1', name: 'Misskey', url: 'https://misskey.io',
      clientId: 'cid', clientSecret: null, scope: 'read:account', isMisskey: true,
    } as any)

    const { misskeyAuthStorage } = await import('~/api/common/helper/misskeyAuthStorage')

    const { misskeyAuth } = await import('~/api/v0/misskey.auth')
    await misskeyAuth.request(
      new Request('http://localhost/misskey'),
      undefined,
      {}
    )

    expect(misskeyAuthStorage.setItem).toHaveBeenCalledWith(
      'misskey-code-verifier',
      'misskey-random-state'
    )
  })

  it('code_challenge_methodがS256に設定される', async () => {
    const prisma = (await import('~/lib/prisma')).default
    vi.mocked(prisma.providers.findFirst).mockResolvedValue({
      id: 'mp1', name: 'Misskey', url: 'https://misskey.io',
      clientId: 'cid', clientSecret: null, scope: 'read:account', isMisskey: true,
    } as any)

    const { misskeyAuth } = await import('~/api/v0/misskey.auth')
    await misskeyAuth.request(
      new Request('http://localhost/misskey'),
      undefined,
      {}
    )

    expect(mockBuildAuthorizationUrl).toHaveBeenCalledWith(
      mockMisskeyConfig,
      expect.objectContaining({
        code_challenge_method: 'S256',
      })
    )
  })

  it('プロバイダー名が小文字に正規化される', async () => {
    const prisma = (await import('~/lib/prisma')).default
    vi.mocked(prisma.providers.findFirst).mockResolvedValue({
      id: 'mp1', name: 'MISSKEY', url: 'https://misskey.io',
      clientId: 'cid', clientSecret: null, scope: 'read:account', isMisskey: true,
    } as any)

    const { misskeyAuth } = await import('~/api/v0/misskey.auth')
    const res = await misskeyAuth.request(
      new Request('http://localhost/MISSKEY'),
      undefined,
      {}
    )

    expect(res.status).toBe(302)
  })

  it('scopeが空文字列の場合でも処理される', async () => {
    const prisma = (await import('~/lib/prisma')).default
    vi.mocked(prisma.providers.findFirst).mockResolvedValue({
      id: 'mp1', name: 'Misskey', url: 'https://misskey.io',
      clientId: 'cid', clientSecret: null, scope: '', isMisskey: true,
    } as any)

    const { misskeyAuth } = await import('~/api/v0/misskey.auth')
    const res = await misskeyAuth.request(
      new Request('http://localhost/misskey'),
      undefined,
      {}
    )

    expect(res.status).toBe(302)
    expect(mockBuildAuthorizationUrl).toHaveBeenCalledWith(
      mockMisskeyConfig,
      expect.objectContaining({
        scope: '',
      })
    )
  })
})