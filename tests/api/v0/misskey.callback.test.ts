import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockAuthorizationCodeGrant = vi.fn()
const mockMisskeyConfig = { serverMetadata: () => ({ issuer: 'https://misskey.io' }) }
const mockMisskeyApiRequest = vi.fn()

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
  generators: { codeVerifier: vi.fn(), codeChallenge: vi.fn() },
  BaseClient: vi.fn(),
  discovery: vi.fn(),
  randomPKCECodeVerifier: vi.fn(),
  calculatePKCECodeChallenge: vi.fn(),
  randomState: vi.fn(),
  buildAuthorizationUrl: vi.fn(),
  authorizationCodeGrant: mockAuthorizationCodeGrant,
}))

vi.mock('~/api/common/clients', () => ({
  clients: {},
  misskeyClients: {
    misskey: mockMisskeyConfig,
  },
}))

vi.mock('~/api/common/helper/misskeyAuthStorage', () => ({
  misskeyAuthStorage: {
    setItem: vi.fn(),
    getItem: vi.fn().mockResolvedValue('stored-state'),
  },
}))

const MockAPIClient = vi.fn()

vi.mock('misskey-js', () => {
  class APIClient {
    constructor(...args: any[]) {
      MockAPIClient(...args)
      this.request = mockMisskeyApiRequest
    }
    request: typeof mockMisskeyApiRequest
  }
  return {
    api: { APIClient },
  }
})

describe('api/v0/misskey.callback - Misskeyコールバックフロー', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('misskeyCallbackモジュールがエクスポートされる', async () => {
    const { misskeyCallback } = await import('~/api/v0/misskey.callback')
    expect(misskeyCallback).toBeDefined()
  })

  it('無効なプロバイダーで400エラーが返る', async () => {
    const { misskeyCallback } = await import('~/api/v0/misskey.callback')
    const res = await misskeyCallback.request(
      new Request('http://localhost/invalid?code=xxx'),
      undefined,
      {}
    )
    expect(res.status).toBe(400)
    const body = await res.text()
    expect(body).toBe('Invalid provider')
  })

  it('新規Misskeyユーザーが正しく作成される', async () => {
    const prisma = (await import('~/lib/prisma')).default

    mockAuthorizationCodeGrant.mockResolvedValue({
      access_token: 'misskey-access-token',
    })

    mockMisskeyApiRequest.mockResolvedValue({
      id: 'misskey-user-id',
      username: 'misskeyuser',
      name: 'Misskey User',
      email: 'misskey@example.com',
      avatarUrl: 'https://misskey.io/avatar.png',
    })

    vi.mocked(prisma.providers.findFirst).mockResolvedValue({
      id: 'mp1',
      name: 'Misskey',
      url: 'https://misskey.io',
      clientId: 'cid',
      clientSecret: null,
      scope: 'read:account',
      isMisskey: true,
    } as any)

    vi.mocked(prisma.userIdentity.findUnique).mockResolvedValue(null)
    vi.mocked(prisma.user.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.user.create).mockResolvedValue({
      id: 'new-user',
      mail: 'misskey@example.com',
      name: 'misskeyuser',
      displayName: 'Misskey User',
      avatarUrl: 'https://misskey.io/avatar.png',
    } as any)
    vi.mocked(prisma.userIdentity.create).mockResolvedValue({
      id: 'new-identity',
      providerId: 'mp1',
      sub: 'misskey-user-id',
      userId: 'new-user',
      accessToken: 'misskey-access-token',
      user: { id: 'new-user', name: 'misskeyuser' },
    } as any)

    const { misskeyCallback } = await import('~/api/v0/misskey.callback')
    const req = new Request(
      'http://localhost/misskey?code=misskey-code',
      { headers: { Cookie: 'code_verifier=mk-verifier' } }
    )
    const res = await misskeyCallback.request(req, undefined, {})

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.message).toBe('Login successful')

    expect(prisma.user.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        mail: 'misskey@example.com',
        name: 'misskeyuser',
        displayName: 'Misskey User',
        avatarUrl: 'https://misskey.io/avatar.png',
      }),
    })

    expect(prisma.userIdentity.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        providerId: 'mp1',
        sub: 'misskey-user-id',
        accessToken: 'misskey-access-token',
      }),
    })
  })

  it('既存Misskeyユーザーのトークンが更新される', async () => {
    const prisma = (await import('~/lib/prisma')).default

    mockAuthorizationCodeGrant.mockResolvedValue({
      access_token: 'new-misskey-at',
    })

    mockMisskeyApiRequest.mockResolvedValue({
      id: 'misskey-user-id',
      username: 'misskeyuser',
      name: 'Misskey User',
      email: 'misskey@example.com',
      avatarUrl: 'https://misskey.io/avatar.png',
    })

    vi.mocked(prisma.providers.findFirst).mockResolvedValue({
      id: 'mp1', name: 'Misskey', url: 'https://misskey.io',
      clientId: 'cid', clientSecret: null, scope: 'read:account', isMisskey: true,
    } as any)

    vi.mocked(prisma.userIdentity.findUnique).mockResolvedValue({
      id: 'existing-id',
      providerId: 'mp1',
      sub: 'misskey-user-id',
      userId: 'existing-user',
      user: { id: 'existing-user', name: 'misskeyuser' },
    } as any)
    vi.mocked(prisma.userIdentity.update).mockResolvedValue({} as any)

    const { misskeyCallback } = await import('~/api/v0/misskey.callback')
    const req = new Request(
      'http://localhost/misskey?code=code',
      { headers: { Cookie: 'code_verifier=mk-verifier' } }
    )
    const res = await misskeyCallback.request(req, undefined, {})

    expect(res.status).toBe(200)

    expect(prisma.userIdentity.update).toHaveBeenCalledWith({
      where: { id: 'existing-id' },
      data: { accessToken: 'new-misskey-at' },
    })
    expect(prisma.user.create).not.toHaveBeenCalled()
  })

  it('authorizationCodeGrantにPKCEとstateが渡される', async () => {
    const prisma = (await import('~/lib/prisma')).default

    mockAuthorizationCodeGrant.mockResolvedValue({ access_token: 'at' })
    mockMisskeyApiRequest.mockResolvedValue({
      id: 'uid', username: 'user', name: 'User', email: 'u@e.com', avatarUrl: null,
    })

    vi.mocked(prisma.providers.findFirst).mockResolvedValue({
      id: 'mp1', name: 'Misskey', url: 'https://misskey.io',
      clientId: 'cid', clientSecret: null, scope: 'read:account', isMisskey: true,
    } as any)
    vi.mocked(prisma.userIdentity.findUnique).mockResolvedValue({
      id: 'i1', user: { id: 'u1' },
    } as any)
    vi.mocked(prisma.userIdentity.update).mockResolvedValue({} as any)

    const { misskeyCallback } = await import('~/api/v0/misskey.callback')
    const req = new Request(
      'http://localhost/misskey?code=the-code',
      { headers: { Cookie: 'code_verifier=stored-verifier' } }
    )
    await misskeyCallback.request(req, undefined, {})

    expect(mockAuthorizationCodeGrant).toHaveBeenCalledWith(
      mockMisskeyConfig,
      expect.any(URL),
      expect.objectContaining({
        pkceCodeVerifier: 'stored-verifier',
        expectedState: 'stored-state',
      })
    )
  })

  it('Misskey APIクライアントが正しいoriginとcredentialで作成される', async () => {
    const prisma = (await import('~/lib/prisma')).default

    mockAuthorizationCodeGrant.mockResolvedValue({ access_token: 'mk-at-123' })
    mockMisskeyApiRequest.mockResolvedValue({
      id: 'uid', username: 'u', name: 'N', email: 'e@e.com', avatarUrl: null,
    })

    vi.mocked(prisma.providers.findFirst).mockResolvedValue({
      id: 'mp1', name: 'Misskey', url: 'https://misskey.io/.well-known/openid-configuration',
      clientId: 'cid', clientSecret: null, scope: 'read:account', isMisskey: true,
    } as any)
    vi.mocked(prisma.userIdentity.findUnique).mockResolvedValue({
      id: 'i1', user: { id: 'u1' },
    } as any)
    vi.mocked(prisma.userIdentity.update).mockResolvedValue({} as any)

    const { misskeyCallback } = await import('~/api/v0/misskey.callback')
    const req = new Request(
      'http://localhost/misskey?code=c',
      { headers: { Cookie: 'code_verifier=v' } }
    )
    await misskeyCallback.request(req, undefined, {})

    expect(MockAPIClient).toHaveBeenCalledWith({
      origin: 'https://misskey.io',
      credential: 'mk-at-123',
    })
    expect(mockMisskeyApiRequest).toHaveBeenCalledWith('i', {})
  })

  it('auth_tokenがCookieに設定される', async () => {
    const prisma = (await import('~/lib/prisma')).default

    mockAuthorizationCodeGrant.mockResolvedValue({ access_token: 'mk-cookie-token' })
    mockMisskeyApiRequest.mockResolvedValue({
      id: 'uid', username: 'u', name: 'N', email: 'e@e.com', avatarUrl: null,
    })

    vi.mocked(prisma.providers.findFirst).mockResolvedValue({
      id: 'mp1', name: 'Misskey', url: 'https://misskey.io',
      clientId: 'cid', clientSecret: null, scope: 'read:account', isMisskey: true,
    } as any)
    vi.mocked(prisma.userIdentity.findUnique).mockResolvedValue({
      id: 'i1', user: { id: 'u1' },
    } as any)
    vi.mocked(prisma.userIdentity.update).mockResolvedValue({} as any)

    const { misskeyCallback } = await import('~/api/v0/misskey.callback')
    const req = new Request(
      'http://localhost/misskey?code=c',
      { headers: { Cookie: 'code_verifier=v' } }
    )
    const res = await misskeyCallback.request(req, undefined, {})

    const cookies = res.headers.get('set-cookie') || ''
    expect(cookies).toContain('auth_token=mk-cookie-token')
    expect(cookies).toContain('HttpOnly')
  })

  it('URLから正しいoriginが抽出される', async () => {
    const prisma = (await import('~/lib/prisma')).default

    mockAuthorizationCodeGrant.mockResolvedValue({ access_token: 'at' })
    mockMisskeyApiRequest.mockResolvedValue({
      id: 'uid', username: 'u', name: 'N', email: 'e@e.com', avatarUrl: null,
    })

    vi.mocked(prisma.providers.findFirst).mockResolvedValue({
      id: 'mp1', name: 'Misskey', url: 'https://misskey.io/.well-known/openid-configuration',
      clientId: 'cid', clientSecret: null, scope: 'read:account', isMisskey: true,
    } as any)
    vi.mocked(prisma.userIdentity.findUnique).mockResolvedValue({
      id: 'i1', user: { id: 'u1' },
    } as any)
    vi.mocked(prisma.userIdentity.update).mockResolvedValue({} as any)

    const { misskeyCallback } = await import('~/api/v0/misskey.callback')
    const req = new Request(
      'http://localhost/misskey?code=c',
      { headers: { Cookie: 'code_verifier=v' } }
    )
    await misskeyCallback.request(req, undefined, {})

    expect(MockAPIClient).toHaveBeenCalledWith({
      origin: 'https://misskey.io',
      credential: 'at',
    })
  })

  it('emailが無いMisskeyユーザーでも処理される', async () => {
    const prisma = (await import('~/lib/prisma')).default

    mockAuthorizationCodeGrant.mockResolvedValue({ access_token: 'at' })
    mockMisskeyApiRequest.mockResolvedValue({
      id: 'uid', username: 'user', name: 'User', email: null, avatarUrl: null,
    })

    vi.mocked(prisma.providers.findFirst).mockResolvedValue({
      id: 'mp1', name: 'Misskey', url: 'https://misskey.io',
      clientId: 'cid', clientSecret: null, scope: 'read:account', isMisskey: true,
    } as any)
    vi.mocked(prisma.userIdentity.findUnique).mockResolvedValue(null)
    vi.mocked(prisma.user.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.user.create).mockResolvedValue({
      id: 'new-user', mail: null,
    } as any)
    vi.mocked(prisma.userIdentity.create).mockResolvedValue({
      id: 'new-identity', user: { id: 'new-user' },
    } as any)

    const { misskeyCallback } = await import('~/api/v0/misskey.callback')
    const req = new Request(
      'http://localhost/misskey?code=code',
      { headers: { Cookie: 'code_verifier=v' } }
    )
    const res = await misskeyCallback.request(req, undefined, {})

    expect(res.status).toBe(200)
    expect(prisma.user.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        mail: null,
        name: 'user',
      }),
    })
  })

  it('Misskey APIの"i"エンドポイントが呼ばれる', async () => {
    const prisma = (await import('~/lib/prisma')).default

    mockAuthorizationCodeGrant.mockResolvedValue({ access_token: 'at' })
    mockMisskeyApiRequest.mockResolvedValue({
      id: 'uid', username: 'u', name: 'N', email: 'e@e.com', avatarUrl: null,
    })

    vi.mocked(prisma.providers.findFirst).mockResolvedValue({
      id: 'mp1', name: 'Misskey', url: 'https://misskey.io',
      clientId: 'cid', clientSecret: null, scope: 'read:account', isMisskey: true,
    } as any)
    vi.mocked(prisma.userIdentity.findUnique).mockResolvedValue({
      id: 'i1', user: { id: 'u1' },
    } as any)
    vi.mocked(prisma.userIdentity.update).mockResolvedValue({} as any)

    const { misskeyCallback } = await import('~/api/v0/misskey.callback')
    const req = new Request(
      'http://localhost/misskey?code=c',
      { headers: { Cookie: 'code_verifier=v' } }
    )
    await misskeyCallback.request(req, undefined, {})

    expect(mockMisskeyApiRequest).toHaveBeenCalledWith('i', {})
  })
})