import { Hono } from "hono";
import { getCookie, setCookie } from 'hono/cookie'
import { BaseClient, Issuer, generators } from 'openid-client';
import { jwtDecode } from 'jwt-decode';
import prisma from "~/lib/prisma";

const authApp = new Hono()

const clients: Record<string, any> = {};

// 各プロバイダーのクライアントを作成
async function initOIDCClients() {
  const providers = await prisma.providers.findMany()
  console.dir(providers)
  for (const provider of providers) {
    const issuer = await Issuer.discover(provider.url);
    clients[provider.name.toLowerCase()] = new issuer.Client({
      client_id: provider.clientId,
      client_secret: provider.clientSecret,
      redirect_uris: [`http://localhost:3000/callback/${provider.name.toLowerCase()}`],
      response_types: ['code'],
    });
  }
}

initOIDCClients();

// ログインエンドポイント
authApp.get('/:provider', async (c) => {
    const _provider = c.req.param('provider');
    const provider = clients[_provider.toLowerCase()] as BaseClient
    if (!provider) return c.text('Invalid provider', 400);
    const scope = await prisma.providers.findFirst({select: {scope: true}, where: {name: _provider}})
    // console.log(scope)

    const codeVerifier = generators.codeVerifier();
    const codeChallenge = generators.codeChallenge(codeVerifier);
    const authUrl = provider.authorizationUrl({
      scope: scope?.scope,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });
  
    setCookie(c, 'code_verifier', codeVerifier, { httpOnly: true });
    return c.redirect(authUrl);
  });

  authApp.get('/callback/:provider', async (c) => {
    const provider = c.req.param('provider');
    if (!clients[provider]) return c.text('Invalid provider', 400);
  
    const params = c.req.query();
    const code = params.code;
    const codeVerifier = getCookie(c, 'code_verifier');
  
    const tokenSet = await (clients[provider] as BaseClient).callback(
      `http://localhost:3000/callback/${provider}`,
      { code },
      { code_verifier: codeVerifier }
    );
  
    const userInfo = jwtDecode(tokenSet.id_token!);
    
    let identity = await prisma.userIdentity.findUnique({
      where: { provider_sub: { provider, sub: userInfo.sub! } },
      include: { user: true },
    });
  
    if (!identity) {
      let user = await prisma.user.findUnique({ where: { mail: userInfo.email } });
  
      if (!user) {
        user = await prisma.user.create({
          data: {
            mail: userInfo.email,
            name: userInfo.name,
            avatarUrl: userInfo.picture,
          },
        });
      }
  
      identity = await prisma.userIdentity.create({
        data: {
          provider,
          sub: userInfo.sub!,
          userId: user.id,
          accessToken: tokenSet.access_token!,
          idToken: tokenSet.id_token!,
          refreshToken: tokenSet.refresh_token!,
          expiresAt: new Date(Date.now() + (tokenSet.expires_in || 0) * 1000),
        },
      });
    } else {
      // 既存の Identity のトークン更新
      await prisma.identity.update({
        where: { id: identity.id },
        data: {
          access_token: tokenSet.access_token,
          id_token: tokenSet.id_token,
          refresh_token: tokenSet.refresh_token,
          expires_at: new Date(Date.now() + (tokenSet.expires_in || 0) * 1000),
        },
      });
    }
  
    setCookie(c, 'auth_token', tokenSet.id_token!, { httpOnly: true });
    return c.json({ message: 'Login successful', user: identity.user });
  });

export const auth = authApp;