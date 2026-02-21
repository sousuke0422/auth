import { Issuer } from "openid-client";
import * as client from 'openid-client@6'
import prisma from "~/lib/prisma";
import { host, isProd, maskPlaceholder } from "../common/const";
import { Logger } from "tslog";
import { honoLogger } from "../common/logger";

const logger = honoLogger.getSubLogger({ name: 'Client', maskValuesOfKeys: ['clientSecret'] })

const clients: Record<string, any> = {};
const misskeyClients: Record<string, client.Configuration> = {};

// 各プロバイダーのクライアントを作成
async function initOIDCClients() {
  const providers = await prisma.providers.findMany()
  // console.dir(providers)
  logger.info(`isProd: ${isProd}, host: ${host}`)
  for (const provider of providers) {
    if (provider.isMisskey) {
      logger.debug(provider)
      misskeyClients[provider.name.toLowerCase()] = await client.discovery(new URL(provider.url), provider.clientId)
    } else {
      logger.debug(provider)
      const issuer = await Issuer.discover(provider.url);
      clients[provider.name.toLowerCase()] = new issuer.Client({
        client_id: provider.clientId,
        client_secret: provider.clientSecret!,
        redirect_uris: [`${host}/api/v0/callback/${provider.name.toLowerCase()}`],
        response_types: ['code'],
      });
    }
  }
}

initOIDCClients();

export {clients, misskeyClients}