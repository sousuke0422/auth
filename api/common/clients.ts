import { Issuer } from "openid-client";
import prisma from "~/lib/prisma";

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
      redirect_uris: [`http://localhost:3000/api/v0/callback/${provider.name.toLowerCase()}`],
      response_types: ['code'],
    });
  }
}

initOIDCClients();

export {clients}