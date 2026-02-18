import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockCallback = vi.fn()

vi.mock('~/lib/prisma', () => ({
  default: {
    providers: {
      findFirst: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
    },
    userIdentity: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    user: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
  },
}))

vi.mock('openid-client', () => ({
  Issuer: { discover: vi.fn() },
  generators: {
    codeVerifier: vi.fn(),
    codeChallenge: vi.fn(),
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
      callback: mockCallback,
    },
  },
  misskeyClients: {},
}))

vi.mock('jwt-decode', () => ({
  jwtDecode: vi.fn().mockReturnValue({
    sub: 'user-sub-123',
    email: 'test@example.com',
    name: 'Test User',
    nickname: 'testuser',
    preferred_username: 'testuser',
    picture: 'https://example.com/avatar.png',
  }),
}))

describe('api/v0/callback - OIDCコールバックフロー', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('callbackモジュールがエクスポートされる', async () => {
    const { callback } = await import('~/api/v0/callback')
    expect(callback).toBeDefined()
  })

  it('無効なプロバイダーで400エラーが返る', async () => {
    const { callback } = await import('~/api/v0/callback')
    const res = await callback.request(
      new Request('http://localhost/invalid?code=xxx'),
      undefined,
      {}
    )
    expect(res.status).toBe(400)
    const body = await res.text()
    expect(body).toBe('Invalid provider')
  })

  it('新規ユーザーが正しく作成される', async () => {
    const prisma = (await import('~/lib/prisma')).default

    mockCallback.mockResolvedValue({
      access_token: 'mock-access-token',
      id_token: 'mock-id-token',
      refresh_token: 'mock-refresh-token',
      expires_in: 3600,
    })

    vi.mocked(prisma.providers.findFirst).mockResolvedValue({
      id: 'provider-1',
      name: 'Google',
      url: 'https://accounts.google.com',
      clientId: 'client-id',
      clientSecret: 'client-secret',
      scope: 'openid profile email',
      isMisskey: false,
    } as any)

    vi.mocked(prisma.userIdentity.findUnique).mockResolvedValue(null)
    vi.mocked(prisma.user.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.user.create).mockResolvedValue({
      id: 'new-user-id',
      mail: 'test@example.com',
      name: 'Test User',
      displayName: 'testuser',
      avatarUrl: 'https://example.com/avatar.png',
      isAdmin: false,
      passwordId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any)
    vi.mocked(prisma.userIdentity.create).mockResolvedValue({
      id: 'identity-1',
      providerId: 'provider-1',
      sub: 'user-sub-123',
      userId: 'new-user-id',
      accessToken: 'mock-access-token',
      idToken: 'mock-id-token',
      refreshToken: 'mock-refresh-token',
      expiresAt: new Date(),
      user: { id: 'new-user-id', name: 'Test User' },
    } as any)

    const { callback } = await import('~/api/v0/callback')
    const req = new Request(
      'http://localhost/google?code=auth-code-123',
      {
        headers: {
          Cookie: 'code_verifier=test-verifier',
        },
      }
    )
    const res = await callback.request(req, undefined, {})

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.message).toBe('Login successful')
    expect(body.user).toBeDefined()

    expect(prisma.user.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        mail: 'test@example.com',
        name: 'Test User',
      }),
    })

    expect(prisma.userIdentity.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        providerId: 'provider-1',
        sub: 'user-sub-123',
        accessToken: 'mock-access-token',
        idToken: 'mock-id-token',
        refreshToken: 'mock-refresh-token',
      }),
    })
  })

  it('既存ユーザーのトークンが更新される', async () => {
    const prisma = (await import('~/lib/prisma')).default

    mockCallback.mockResolvedValue({
      access_token: 'new-access-token',
      id_token: 'new-id-token',
      refresh_token: 'new-refresh-token',
      expires_in: 3600,
    })

    vi.mocked(prisma.providers.findFirst).mockResolvedValue({
      id: 'provider-1',
      name: 'Google',
      url: 'https://accounts.google.com',
      clientId: 'client-id',
      clientSecret: 'client-secret',
      scope: 'openid profile email',
      isMisskey: false,
    } as any)

    vi.mocked(prisma.userIdentity.findUnique).mockResolvedValue({
      id: 'existing-identity',
      providerId: 'provider-1',
      sub: 'user-sub-123',
      userId: 'existing-user-id',
      accessToken: 'old-access-token',
      idToken: 'old-id-token',
      refreshToken: 'old-refresh-token',
      expiresAt: new Date(),
      user: { id: 'existing-user-id', name: 'Existing User' },
    } as any)

    vi.mocked(prisma.userIdentity.update).mockResolvedValue({} as any)

    const { callback } = await import('~/api/v0/callback')
    const req = new Request(
      'http://localhost/google?code=auth-code-456',
      {
        headers: {
          Cookie: 'code_verifier=test-verifier',
        },
      }
    )
    const res = await callback.request(req, undefined, {})

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.message).toBe('Login successful')

    expect(prisma.userIdentity.update).toHaveBeenCalledWith({
      where: { id: 'existing-identity' },
      data: expect.objectContaining({
        accessToken: 'new-access-token',
        idToken: 'new-id-token',
        refreshToken: 'new-refresh-token',
      }),
    })

    expect(prisma.user.create).not.toHaveBeenCalled()
  })

  it('既存メールユーザーに新しいIdentityが紐付けられる', async () => {
    const prisma = (await import('~/lib/prisma')).default

    mockCallback.mockResolvedValue({
      access_token: 'mock-access-token',
      id_token: 'mock-id-token',
      refresh_token: 'mock-refresh-token',
      expires_in: 3600,
    })

    vi.mocked(prisma.providers.findFirst).mockResolvedValue({
      id: 'provider-1',
      name: 'Google',
      url: 'https://accounts.google.com',
      clientId: 'client-id',
      clientSecret: 'client-secret',
      scope: 'openid profile email',
      isMisskey: false,
    } as any)

    vi.mocked(prisma.userIdentity.findUnique).mockResolvedValue(null)
    vi.mocked(prisma.user.findFirst).mockResolvedValue({
      id: 'existing-user-id',
      mail: 'test@example.com',
      name: 'Existing User',
    } as any)
    vi.mocked(prisma.userIdentity.create).mockResolvedValue({
      id: 'new-identity',
      providerId: 'provider-1',
      sub: 'user-sub-123',
      userId: 'existing-user-id',
      user: { id: 'existing-user-id', name: 'Existing User' },
    } as any)

    const { callback } = await import('~/api/v0/callback')
    const req = new Request(
      'http://localhost/google?code=auth-code',
      {
        headers: { Cookie: 'code_verifier=test-verifier' },
      }
    )
    const res = await callback.request(req, undefined, {})

    expect(res.status).toBe(200)
    expect(prisma.user.create).not.toHaveBeenCalled()
    expect(prisma.userIdentity.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'existing-user-id',
      }),
    })
  })

  it('auth_tokenがCookieに設定される', async () => {
    const prisma = (await import('~/lib/prisma')).default

    mockCallback.mockResolvedValue({
      access_token: 'mock-access-token',
      id_token: 'mock-id-token-cookie-test',
      refresh_token: 'mock-refresh-token',
      expires_in: 3600,
    })

    vi.mocked(prisma.providers.findFirst).mockResolvedValue({
      id: 'provider-1', name: 'Google', url: 'https://accounts.google.com',
      clientId: 'cid', clientSecret: 'cs', scope: 'openid', isMisskey: false,
    } as any)
    vi.mocked(prisma.userIdentity.findUnique).mockResolvedValue({
      id: 'identity-1', user: { id: 'user-1' },
    } as any)
    vi.mocked(prisma.userIdentity.update).mockResolvedValue({} as any)

    const { callback } = await import('~/api/v0/callback')
    const req = new Request(
      'http://localhost/google?code=code',
      { headers: { Cookie: 'code_verifier=verifier' } }
    )
    const res = await callback.request(req, undefined, {})

    const cookies = res.headers.get('set-cookie') || ''
    expect(cookies).toContain('auth_token=')
    expect(cookies).toContain('HttpOnly')
  })

  it('callback呼び出し時にcode_verifierが渡される', async () => {
    const prisma = (await import('~/lib/prisma')).default

    mockCallback.mockResolvedValue({
      access_token: 'at', id_token: 'it', refresh_token: 'rt', expires_in: 3600,
    })
    vi.mocked(prisma.providers.findFirst).mockResolvedValue({
      id: 'p1', name: 'Google', url: 'https://accounts.google.com',
      clientId: 'cid', clientSecret: 'cs', scope: 'openid', isMisskey: false,
    } as any)
    vi.mocked(prisma.userIdentity.findUnique).mockResolvedValue({
      id: 'i1', user: { id: 'u1' },
    } as any)
    vi.mocked(prisma.userIdentity.update).mockResolvedValue({} as any)

    const { callback } = await import('~/api/v0/callback')
    const req = new Request(
      'http://localhost/google?code=the-auth-code',
      { headers: { Cookie: 'code_verifier=my-verifier' } }
    )
    await callback.request(req, undefined, {})

    expect(mockCallback).toHaveBeenCalledWith(
      expect.any(String),
      { code: 'the-auth-code' },
      { code_verifier: 'my-verifier' }
    )
  })
})
