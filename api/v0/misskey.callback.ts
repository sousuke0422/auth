import { Hono } from "hono";
import { getCookie, setCookie } from 'hono/cookie'
import * as client from 'openid-client@6'
import { api as misskeyApi } from 'misskey-js';
import prisma from "~/lib/prisma";
import { misskeyClients } from "../common/clients";
import { misskeyAuthStorage } from "../common/helper/misskeyAuthStorage";

const misskeyCallbackApp = new Hono()

misskeyCallbackApp.get('/:provider', async (c) => {
    const _provider = c.req.param('provider');
    const provider = misskeyClients[_provider];
    if (!provider) return c.text('Invalid provider', 400);
    const providerCol = await prisma.providers.findFirst({where: {name: {contains: _provider}}})
  
    const params = c.req.query();
    const code = params.code;
    const codeVerifier = getCookie(c, 'code_verifier');
  
    // const tokenSet = await (misskeyClients[provider] as BaseClient).callback(
    //   `http://localhost:3000/api/v0/callback/${provider}`,
    //   { code },
    //   { code_verifier: codeVerifier, scope: providerCol?.scope }
    // );
    const tokens = await client.authorizationCodeGrant(provider, new URL(c.req.url), {
      pkceCodeVerifier: codeVerifier,
      expectedState: await misskeyAuthStorage.getItem<string>(codeVerifier!) || 'err'
    })

    const instanecHost = () => {
      const url = new URL(providerCol!.url)
      return url.origin
    }

    const cli = new misskeyApi.APIClient({
    origin: instanecHost(),
    credential: tokens.access_token
  })
    // const userInfo = jwtDecode<IJwtPayload>(tokenSet.id_token!);
    const userI = await cli.request('i',{})

    console.dir(userI)
    
    let identity = await prisma.userIdentity.findUnique({
      where: { providerId_sub: { providerId: providerCol!.id, sub: userI.id } },
      include: { user: true },
    });
  
    if (!identity) {
      // findUnique
      let user = await prisma.user.findFirst({ where: { mail: userI.email } });
  
      if (!user) {
        user = await prisma.user.create({
          data: {
            mail: userI.email,
            name: userI.username,
            displayName: userI.name || userI.username,
            avatarUrl: userI.avatarUrl,
          },
        });
      }

      console.log(user.id)
  
      // @ts-ignore
      identity = await prisma.userIdentity.create({
        data: {
          providerId: providerCol!.id,
          sub: userI.id,
          userId: user.id,
          accessToken: tokens.access_token!,
        },
      });
    } else {
      // 既存の Identity のトークン更新
      await prisma.userIdentity.update({
        where: { id: identity.id },
        data: {
          accessToken: tokens.access_token,
        },
      });
    }
  
    setCookie(c, 'auth_token', tokens.access_token!, { httpOnly: true });
    return c.json({ message: 'Login successful', user: identity!.user });
  });

export { misskeyCallbackApp as misskeyCallback };