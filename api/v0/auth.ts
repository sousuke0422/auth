import { Hono } from "hono";
import { getCookie, setCookie } from 'hono/cookie'
import { BaseClient, Issuer, generators } from 'openid-client';
import prisma from "~/lib/prisma";
import { clients } from "../common/clients";

const authApp = new Hono()

// ログインエンドポイント
authApp.get('/:provider', async (c) => {
    const _provider = c.req.param('provider');
    const provider = clients[_provider.toLowerCase()] as BaseClient
    if (!provider) return c.text('Invalid provider', 400);
    const _scope = await prisma.providers.findFirst({where: {name: {contains: _provider}}})
    console.log(_scope?.scope)

    const codeVerifier = generators.codeVerifier();
    const codeChallenge = generators.codeChallenge(codeVerifier);
    const authUrl = provider.authorizationUrl({
      scope: _scope?.scope,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });
  
    setCookie(c, 'code_verifier', codeVerifier, { httpOnly: true });
    return c.redirect(authUrl);
  });

export { authApp as auth };