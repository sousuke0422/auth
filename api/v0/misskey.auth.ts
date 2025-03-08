import { Hono } from "hono";
import { setCookie } from "hono/cookie";
import * as client from 'openid-client@6'
import { misskeyClients } from "../common/clients";
import prisma from "~/lib/prisma";
import { host } from "../common/const";
import { misskeyAuthStorage } from "../common/helper/misskeyAuthStorage";

const misskeyAuthApp = new Hono()

misskeyAuthApp.get('/:provider', async (c) => {
    const _provider = c.req.param('provider');
    const provider = misskeyClients[_provider.toLowerCase()]
    console.log(provider);
    if (!provider) return c.text('Invalid provider', 400);
    const providerCol = await prisma.providers.findFirst({where: {name: {contains: _provider}}})
    console.log(providerCol?.scope)

    const code_challenge_method = 'S256'
    const codeVerifier = client.randomPKCECodeVerifier();
    const codeChallenge = await client.calculatePKCECodeChallenge(codeVerifier);
    const state = client.randomState()
    const parameters: Record<string, string> = {
        redirect_uri: `${host}/api/v0/misskey/callback/${providerCol?.name.toLowerCase()}`,
      scope: providerCol!.scope,
      code_challenge: codeChallenge,
      code_challenge_method,
      state
    };
  
    setCookie(c, 'code_verifier', codeVerifier, { httpOnly: true });
    await misskeyAuthStorage.setItem(codeVerifier, state)
    return c.redirect(client.buildAuthorizationUrl(provider, parameters));
  });

export { misskeyAuthApp as misskeyAuth}
