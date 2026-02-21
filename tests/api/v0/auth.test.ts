import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockAuthorizationUrl = vi.fn().mockReturnValue('https://provider.example.com/auth?code_challenge=xxx')
const mockCodeVerifier = vi.fn().mockReturnValue('test-code-verifier')
const mockCodeChallenge = vi.fn().mockReturnValue('test-code-challenge')

vi.mock('~/lib/prisma', () => ({
  default: {
    providers: {
      findFirst: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
    },
  },
}))

vi.mock('openid-client', () => ({
  Issuer: {
    discover: vi.fn(),
  },
  generators: {
    codeVerifier: mockCodeVerifier,
    codeChallenge: mockCodeChallenge,
  },
  BaseClient: vi.fn(),
  discovery: vi.fn(),
  randomPKCECodeVerifier: vi.fn(),
  calculatePKCECodeChallenge: vi.fn(),
  randomState: vi.fn(),
  buildAuthorizationUrl: vi.fn(),
  authorizationCodeGrant: vi.fn(),
}))

vi.mock('~/api/common/clients', () => ({
  clients: {
    google: {
      authorizationUrl: mockAuthorizationUrl,
    },
  },
  misskeyClients: {},
}))

describe('api/v0/auth - OIDC認証フロー', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('authモジュールがエクスポートされる', async () => {
    const { auth } = await import('~/api/v0/auth')
    expect(auth).toBeDefined()
  })

  it('有効なプロバイダーでリダイレクトされる', async () => {
    const prisma = (await import('~/lib/prisma')).default
    vi.mocked(prisma.providers.findFirst).mockResolvedValue({
      id: 'p1',
      name: 'Google',
      url: 'https://accounts.google.com',
      clientId: 'google-id',
      clientSecret: 'google-secret',
      scope: 'openid profile email',
      isMisskey: false,
    } as any)

    const { auth } = await import('~/api/v0/auth')
    const res = await auth.request(
      new Request('http://localhost/google'),
      undefined,
      {}
    )

    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe(
      'https://provider.example.com/auth?code_challenge=xxx'
    )
  })

  it('無効なプロバイダーで400エラーが返る', async () => {
    const { auth } = await import('~/api/v0/auth')
    const res = await auth.request(
      new Request('http://localhost/invalid'),
      undefined,
      {}
    )

    expect(res.status).toBe(400)
    const body = await res.text()
    expect(body).toBe('Invalid provider')
  })

  it('PKCE code_verifierがCookieに設定される', async () => {
    const prisma = (await import('~/lib/prisma')).default
    vi.mocked(prisma.providers.findFirst).mockResolvedValue({
      id: 'p1',
      name: 'Google',
      url: 'https://accounts.google.com',
      clientId: 'google-id',
      clientSecret: 'google-secret',
      scope: 'openid profile email',
      isMisskey: false,
    } as any)

    const { auth } = await import('~/api/v0/auth')
    const res = await auth.request(
      new Request('http://localhost/google'),
      undefined,
      {}
    )

    const cookies = res.headers.get('set-cookie') || ''
    expect(cookies).toContain('code_verifier=')
    expect(cookies).toContain('HttpOnly')
  })

  it('authorizationUrlにS256のcode_challenge_methodが渡される', async () => {
    const prisma = (await import('~/lib/prisma')).default
    vi.mocked(prisma.providers.findFirst).mockResolvedValue({
      id: 'p1',
      name: 'Google',
      url: 'https://accounts.google.com',
      clientId: 'google-id',
      clientSecret: 'google-secret',
      scope: 'openid profile email',
      isMisskey: false,
    } as any)

    const { auth } = await import('~/api/v0/auth')
    await auth.request(
      new Request('http://localhost/google'),
      undefined,
      {}
    )

    expect(mockAuthorizationUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        code_challenge_method: 'S256',
        code_challenge: 'test-code-challenge',
        scope: 'openid profile email',
      })
    )
  })

  it('generators.codeVerifierとcodeChallengeが正しく使われる', async () => {
    const prisma = (await import('~/lib/prisma')).default
    vi.mocked(prisma.providers.findFirst).mockResolvedValue({
      id: 'p1',
      name: 'Google',
      url: 'https://accounts.google.com',
      clientId: 'google-id',
      clientSecret: 'google-secret',
      scope: 'openid profile email',
      isMisskey: false,
    } as any)

    const { auth } = await import('~/api/v0/auth')
    await auth.request(
      new Request('http://localhost/google'),
      undefined,
      {}
    )

    expect(mockCodeVerifier).toHaveBeenCalledOnce()
    expect(mockCodeChallenge).toHaveBeenCalledWith('test-code-verifier')
  })
})
