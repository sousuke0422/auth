import { Hono } from "hono";
import { getCookie, setCookie } from 'hono/cookie'
import { BaseClient, Issuer, generators } from 'openid-client';
import { jwtDecode } from 'jwt-decode';
import prisma from "~/lib/prisma";
import { clients } from "../common/clients";
import type { IJwtPayload } from "../common/jwtDecode";

const callbackApp = new Hono()

  callbackApp.get('/:provider', async (c) => {
    const provider = c.req.param('provider');
    if (!clients[provider]) return c.text('Invalid provider', 400);
  
    const params = c.req.query();
    const code = params.code;
    const codeVerifier = getCookie(c, 'code_verifier');
  
    const tokenSet = await (clients[provider] as BaseClient).callback(
      `http://localhost:3000/api/v0/callback/${provider}`,
      { code },
      { code_verifier: codeVerifier }
    );
  
    const userInfo = jwtDecode<IJwtPayload>(tokenSet.id_token!);
    const providerCol = await prisma.providers.findFirst({where: {name: {contains: provider}}})

    console.dir(userInfo)
    
    let identity = await prisma.userIdentity.findUnique({
      where: { providerId_sub: { providerId: providerCol!.id, sub: userInfo.sub! } },
      include: { user: true },
    });
  
    if (!identity) {
      // findUnique
      let user = await prisma.user.findFirst({ where: { mail: userInfo.email } });
  
      if (!user) {
        user = await prisma.user.create({
          data: {
            mail: userInfo.email,
            name: userInfo.name || userInfo.preferred_username || 'unknown name',
            displayName: userInfo.nickname || userInfo.preferred_username || userInfo.name,
            avatarUrl: userInfo.picture,
          },
        });
      }
  
      // @ts-ignore
      identity = await prisma.userIdentity.create({
        data: {
          providerId: providerCol!.id,
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
      await prisma.userIdentity.update({
        where: { id: identity.id },
        data: {
          accessToken: tokenSet.access_token,
          idToken: tokenSet.id_token,
          refreshToken: tokenSet.refresh_token,
          expiresAt: new Date(Date.now() + (tokenSet.expires_in || 0) * 1000),
        },
      });
    }
  
    setCookie(c, 'auth_token', tokenSet.id_token!, { httpOnly: true });
    return c.json({ message: 'Login successful', user: identity!.user });
  });

export { callbackApp as callback };