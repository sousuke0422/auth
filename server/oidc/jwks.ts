import { generateKeyPair, exportJWK, type JWK } from 'jose';
import prisma from '~/lib/prisma';

const SYSTEM_CONFIG_KEY = 'oidc_jwks';

interface JWKSet {
  keys: JWK[];
}

/**
 * OIDC Provider 用の JWKS を取得する。
 *
 * 優先順位:
 *   1. 環境変数 OIDC_JWKS (明示的な鍵指定。CI/CD やマネージド環境向け)
 *   2. DB (SystemConfig) に保存済みの鍵
 *   3. 新規生成 → DB に永続化 (初回起動時)
 */
export async function loadOrGenerateJwks(): Promise<JWKSet> {
  const envJwks = process.env.OIDC_JWKS;
  if (envJwks) {
    return JSON.parse(envJwks) as JWKSet;
  }

  const existing = await prisma.systemConfig.findUnique({
    where: { key: SYSTEM_CONFIG_KEY },
  });

  if (existing) {
    return JSON.parse(existing.value) as JWKSet;
  }

  const jwks = await generateJwks();

  await prisma.systemConfig.create({
    data: {
      key: SYSTEM_CONFIG_KEY,
      value: JSON.stringify(jwks),
    },
  });

  console.log('[oidc] Generated and persisted new JWKS (kid: %s)', jwks.keys[0]?.kid);
  return jwks;
}

async function generateJwks(): Promise<JWKSet> {
  const { privateKey } = await generateKeyPair('RS256', { extractable: true });
  const jwk = await exportJWK(privateKey);

  jwk.alg = 'RS256';
  jwk.use = 'sig';
  jwk.kid = generateKid();

  return { keys: [jwk] };
}

function generateKid(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${ts}-${rand}`;
}
