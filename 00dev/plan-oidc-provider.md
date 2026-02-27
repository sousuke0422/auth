# OIDC Provider 実装プラン

## 前提

- **フレームワーク**: Nuxt 3 (compatibilityVersion: 4) + Hono (API層)
- **DB (現在)**: Prisma + SQLite
- **DB (将来)**: **PostgreSQL** (永続データ) + **Valkey** (エフェメラルデータ / セッション / キャッシュ)
- **既存の認証**: OIDCクライアント（外部IdPで認証を受ける側）として動作
  - `openid-client` v5: 標準OIDC (GitLab等)
  - `openid-client` v6: Misskey (OAuth2)
- **一時データ**: `unstorage` + LRU cache (misskey auth state)

## 目的

このアプリケーション自体を **OIDC Provider (Identity Provider)** として動作させ、
外部のRelying Party (RP) がこのサービスを使ってユーザー認証できるようにする。

---

## ライブラリ選定

### OIDC Provider: `oidc-provider` (panva/node-oidc-provider)

| 項目 | 内容 |
|------|------|
| npm | `oidc-provider` (現在 v9.6.0) |
| ライセンス | MIT |
| 認定 | OpenID Foundation 認定済み |
| 作者 | Filip Skokan (panva) — `openid-client` と同じ作者 |
| Node.js | v22 対応 |

**選定理由:**

1. **Node.js向け唯一の本格的OIDC Provider ライブラリ** — 他に実用レベルの選択肢がほぼない
2. **OpenID Foundation 認定** — Basic, Implicit, Hybrid, Config, FAPI 等すべてのプロファイルで認定済み
3. **既に `openid-client` を使用中** — 同じ作者のライブラリなので互換性・設計思想が一貫している
4. **Koa ベースだが、任意のフレームワークにマウント可能** — Hono/Nuxt にも統合できる
5. **豊富な機能**: PKCE, Device Flow, DPoP, Token Introspection, Dynamic Client Registration 等
6. **Adapter パターン** — ストレージバックエンドを差し替え可能。Valkey adapter を実装しやすい

**他の選択肢が適さない理由:**

- `better-auth`, `@auth/core`, `nuxt-auth-utils` — すべて「クライアント側」のライブラリ。IdP機能は提供しない
- 自作実装 — OIDCの仕様は広大（Discovery, JWK, 各種Grant Type, Token管理等）で、正しく実装するのは非現実的

---

## アーキテクチャ設計

### 全体構成

```
                          ┌──────────────────────────────┐
                          │        Nuxt 3 App            │
                          │                              │
  ┌───────────┐           │  ┌────────┐  ┌───────────┐  │
  │  外部 RP  │◄─────────┼──┤ oidc-  │  │ Hono API  │  │
  │ (クライ   │  OIDC     │  │provider│  │ /api/v0/**│  │
  │  アント)  │  フロー   │  │/oidc/**│  │           │  │
  └───────────┘           │  └───┬────┘  └─────┬─────┘  │
                          │      │             │         │
                          │  ┌───┴─────────────┴──────┐  │
                          │  │     Adapter 層          │  │
                          │  │  (ストレージ抽象化)      │  │
                          │  └───┬─────────────┬──────┘  │
                          └─────┼─────────────┼──────────┘
                                │             │
                 ┌──────────────┤             ├──────────────┐
                 ▼              │             │              ▼
          ┌────────────┐       │             │       ┌────────────┐
          │ PostgreSQL │       │             │       │  Valkey    │
          │            │       │             │       │ (Redis互換) │
          │ - User     │       │             │       │            │
          │ - Provider │       │             │       │ - Session  │
          │ - Identity │       │             │       │ - Token    │
          │ - Client   │       │             │       │ - Grant    │
          │   (登録情報)│       │             │       │ - AuthCode │
          └────────────┘       │             │       │ - PKCE state│
                               │             │       └────────────┘
                               │             │
                    ┌──────────┘             └─────────┐
                    │  永続データ                エフェメラル │
                    │  (Prisma)                 データ     │
                    │                          (ioredis)   │
                    └──────────────────────────────────────┘
```

### データの分離戦略

`oidc-provider` の Adapter パターンに合わせて、データの性質によりストレージを分ける:

| データ種別 | ストレージ | 理由 |
|-----------|-----------|------|
| **User / UserIdentity / Providers** | PostgreSQL (Prisma) | 永続。リレーション重要 |
| **OIDCクライアント登録情報** | PostgreSQL (Prisma) | 永続。管理画面で編集 |
| **AccessToken** | Valkey | エフェメラル。TTL付き。高頻度アクセス |
| **AuthorizationCode** | Valkey | 短命 (10分)。一度使ったら消費 |
| **RefreshToken** | Valkey | エフェメラル。TTL付き |
| **Session** | Valkey | エフェメラル。TTL付き |
| **Interaction** | Valkey | 非常に短命 (認可フロー中のみ) |
| **Grant** | Valkey | エフェメラル。TTL付き |
| **Misskey auth state** | Valkey | 現在 LRU cache。Valkey に移行 |

**メリット:**
- Valkey のネイティブ TTL (`EXPIRE`) で期限切れデータが自動削除される → クリーンアップジョブ不要
- PostgreSQL にはトークン等の大量エフェメラルデータが入らない → テーブル肥大化しない
- 水平スケール時にプロセス間でセッション共有できる (LRU cache では不可)

### oidc-provider Adapter の設計

`oidc-provider` は `Adapter` クラスを model (= データ種別) ごとにインスタンス化する。
model 名に応じてストレージを切り替えるハイブリッド Adapter を実装する:

```ts
// server/oidc/adapter.ts
import type { Adapter, AdapterPayload } from 'oidc-provider';
import { Redis } from 'ioredis';
import prisma from '~/lib/prisma';

const valkey = new Redis(process.env.VALKEY_URL || 'redis://localhost:6379');

// クライアント登録情報だけは PostgreSQL に永続化
const PERSISTENT_MODELS = new Set(['Client']);

function valkeyKey(model: string, id: string) {
  return `oidc:${model}:${id}`;
}

export class OidcAdapter implements Adapter {
  private model: string;

  constructor(model: string) {
    this.model = model;
  }

  // --- Valkey 側 (エフェメラルデータ) ---

  async upsert(id: string, payload: AdapterPayload, expiresIn: number): Promise<void> {
    if (PERSISTENT_MODELS.has(this.model)) {
      return this.upsertPersistent(id, payload);
    }

    const key = valkeyKey(this.model, id);
    const data = JSON.stringify(payload);

    if (expiresIn) {
      await valkey.setex(key, expiresIn, data);
    } else {
      await valkey.set(key, data);
    }

    // grantId による逆引きインデックス
    if (payload.grantId) {
      const grantKey = `oidc:grant:${payload.grantId}`;
      await valkey.rpush(grantKey, key);
      if (expiresIn) await valkey.expire(grantKey, expiresIn);
    }

    // userCode による逆引き (Device Flow)
    if (payload.userCode) {
      await valkey.set(`oidc:userCode:${payload.userCode}`, id, 'EX', expiresIn);
    }

    // uid による逆引き (Session)
    if (payload.uid) {
      await valkey.set(`oidc:uid:${payload.uid}`, id, 'EX', expiresIn);
    }
  }

  async find(id: string): Promise<AdapterPayload | undefined> {
    if (PERSISTENT_MODELS.has(this.model)) {
      return this.findPersistent(id);
    }

    const data = await valkey.get(valkeyKey(this.model, id));
    if (!data) return undefined;
    return JSON.parse(data);
  }

  async findByUserCode(userCode: string): Promise<AdapterPayload | undefined> {
    const id = await valkey.get(`oidc:userCode:${userCode}`);
    if (!id) return undefined;
    return this.find(id);
  }

  async findByUid(uid: string): Promise<AdapterPayload | undefined> {
    const id = await valkey.get(`oidc:uid:${uid}`);
    if (!id) return undefined;
    return this.find(id);
  }

  async consume(id: string): Promise<void> {
    const key = valkeyKey(this.model, id);
    const data = await valkey.get(key);
    if (!data) return;

    const payload = JSON.parse(data);
    payload.consumed = Math.floor(Date.now() / 1000);

    const ttl = await valkey.ttl(key);
    if (ttl > 0) {
      await valkey.setex(key, ttl, JSON.stringify(payload));
    } else {
      await valkey.set(key, JSON.stringify(payload));
    }
  }

  async destroy(id: string): Promise<void> {
    if (PERSISTENT_MODELS.has(this.model)) {
      return this.destroyPersistent(id);
    }
    await valkey.del(valkeyKey(this.model, id));
  }

  async revokeByGrantId(grantId: string): Promise<void> {
    const grantKey = `oidc:grant:${grantId}`;
    const keys = await valkey.lrange(grantKey, 0, -1);
    if (keys.length > 0) {
      await valkey.del(...keys, grantKey);
    }
  }

  // --- PostgreSQL 側 (永続データ: Client のみ) ---

  private async upsertPersistent(id: string, payload: AdapterPayload): Promise<void> {
    await prisma.oidcClient.upsert({
      where: { id },
      update: { data: JSON.stringify(payload) },
      create: { id, data: JSON.stringify(payload) },
    });
  }

  private async findPersistent(id: string): Promise<AdapterPayload | undefined> {
    const record = await prisma.oidcClient.findUnique({ where: { id } });
    if (!record) return undefined;
    return JSON.parse(record.data);
  }

  private async destroyPersistent(id: string): Promise<void> {
    await prisma.oidcClient.delete({ where: { id } }).catch(() => {});
  }
}
```

---

### oidc-provider のマウント方法 — サブパス問題と解決策

#### 問題: oidc-provider はルートを前提としたルーティングを行う

`oidc-provider` は内部で Koa ルーターを使い、 `/auth`, `/token`, `/.well-known/openid-configuration`
等のルートを **ルート直下** に登録する。そのため、単純に `/oidc/**` にマウントすると:

- `issuer` に `/oidc` パスを含めても、**内部ルーティングには反映されない**
- Discovery の `authorization_endpoint` が `/auth` (ルート直下) として公開されてしまう
- `/oidc/auth` へのリクエストが 404 になる

```
❌ 単純マウントの場合:
  GET /oidc/.well-known/openid-configuration → 404
  GET /.well-known/openid-configuration      → 200 (だがエンドポイントURLが /auth 等ルート直下)
```

#### 解決策: `req.baseUrl` + prefix stripping + proxy

`oidc-provider` は Express 互換の `req.baseUrl` プロパティを参照して、
エンドポイントURLのプレフィックスを組み立てる。これを利用する:

1. リクエストURLからプレフィックス (`/oidc`) を除去
2. `req.baseUrl = '/oidc'` を設定
3. `req.originalUrl` に元のURLを保持
4. `provider.proxy = true` + `X-Forwarded-*` ヘッダーで正しいホスト名を伝達

```
✅ 正しいマウント:
  GET /oidc/.well-known/openid-configuration → 200
    issuer: https://example.com/oidc
    authorization_endpoint: https://example.com/oidc/auth
    token_endpoint: https://example.com/oidc/token
    jwks_uri: https://example.com/oidc/jwks
  GET /oidc/auth → 400 (パラメータ不足=ルーティング成功)
  GET /auth      → 404 (oidc-provider に到達しない)
```

#### 実装コード (Nuxt serverHandler)

```ts
// server/oidc/index.ts
import { Provider } from 'oidc-provider';
import { defineEventHandler } from 'h3';
import { OidcAdapter } from './adapter';

const MOUNT_PATH = '/oidc';
const issuer = `${process.env.HOST || 'http://localhost:3000'}${MOUNT_PATH}`;

const provider = new Provider(issuer, {
  adapter: OidcAdapter,
  /* ...config */
});
provider.proxy = true;

const callback = provider.callback();

export default defineEventHandler((event) => {
  const { req, res } = event.node;

  const originalUrl = req.url || '/';
  if (!originalUrl.startsWith(MOUNT_PATH)) {
    req.originalUrl = `${MOUNT_PATH}${originalUrl}`;
    req.url = originalUrl;
  } else {
    req.originalUrl = originalUrl;
    req.url = originalUrl.slice(MOUNT_PATH.length) || '/';
  }
  req.baseUrl = MOUNT_PATH;

  return new Promise<void>((resolve, reject) => {
    res.on('finish', resolve);
    callback(req, res).catch(reject);
  });
});
```

```ts
// nuxt.config.ts
serverHandlers: [
  { route: '/api/v0/**', handler: '~/../api/v0/index.ts' },
  { route: '/oidc/**',   handler: '~/server/oidc/index.ts' },
]
```

#### 検証済み動作

実際にテストスクリプトで以下を確認済み:

| リクエストパス | 期待 | 結果 |
|---|---|---|
| `GET /oidc/.well-known/openid-configuration` | 200 + 正しいエンドポイントURL | ✅ |
| `GET /oidc/auth` | 400 (パラメータ不足 = ルーティング正常) | ✅ |
| `GET /auth` (ルート直下) | 404 (oidc-provider に到達しない) | ✅ |
| `GET /.well-known/openid-configuration` (ルート) | 404 | ✅ |
| Discovery の `authorization_endpoint` | `http://host/oidc/auth` | ✅ |
| Discovery の `token_endpoint` | `http://host/oidc/token` | ✅ |
| Discovery の `jwks_uri` | `http://host/oidc/jwks` | ✅ |

---

## Prisma スキーマ変更

### 追加テーブル

```prisma
// PostgreSQL に永続化する OIDC クライアント登録情報
model OidcClient {
  id        String   @id                    // client_id
  data      String                          // JSON: クライアントメタデータ全体
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  @@map("oidc_client")
}
```

> エフェメラルデータ (Token, Session, Grant, Interaction, AuthorizationCode 等) は
> Valkey に保存するため、Prisma テーブルは不要。

### 既存テーブルの変更

なし。既存の `User`, `UserIdentity`, `Providers` はそのまま利用。

### DB マイグレーション戦略 (SQLite → PostgreSQL)

```prisma
// prisma/schema.prisma
datasource db {
  provider = "postgresql"  // sqlite → postgresql に変更
  url      = env("DATABASE_URL")
  // DATABASE_URL=postgresql://user:pass@localhost:5432/auth
}
```

Prisma は `prisma migrate diff` でスキーマ差分を出せるため、
SQLite → PostgreSQL の移行は Prisma の標準機能で対応可能。

---

## 既存の unstorage (LRU cache) の Valkey 移行

現在 `misskeyAuthStorage` が `unstorage` + LRU cache を使っている。
`unstorage` は `ioredis` ベースの Redis ドライバを標準搭載しているため、
ドライバを差し替えるだけで移行できる:

```ts
// api/common/helper/misskeyAuthStorage.ts
import { createStorage } from "unstorage";
import redisDriver from "unstorage/drivers/redis";

export const misskeyAuthStorage = createStorage({
  driver: redisDriver({
    url: process.env.VALKEY_URL || 'redis://localhost:6379',
    base: 'misskey-auth:',
    ttl: 600, // 10分
  }),
});
```

`unstorage` の API (`getItem`, `setItem`) は変わらないため、呼び出し側の変更は不要。

---

## JWK 自動生成・永続化 (実装済み)

### 方針

再起動のたびに鍵を再生成すると既発行トークンが全て無効になるため、
**初回起動時に生成 → DB に永続化 → 以降は DB から読み込み** とする。

### 優先順位

1. **環境変数 `OIDC_JWKS`** — 明示的な鍵指定。CI/CD やマネージド環境向け
2. **DB (SystemConfig テーブル)** — 起動時に読み込み
3. **新規生成** — 初回起動時。RS256 鍵ペアを生成し DB に永続化

### 実装

`server/oidc/jwks.ts` と `prisma/schema.prisma` の `SystemConfig` テーブルで実装済み。

```ts
// server/oidc/jwks.ts — 使い方
import { loadOrGenerateJwks } from './jwks';

const jwks = await loadOrGenerateJwks();
// → { keys: [{ kty: 'RSA', kid: '...', alg: 'RS256', use: 'sig', n: '...', e: '...', d: '...', ... }] }

const provider = new Provider(issuer, {
  jwks,
  // ...
});
```

### 検証済み

- `jose` の `generateKeyPair('RS256')` + `exportJWK()` で RS256 鍵ペアを生成
- DB への保存・読み込みのラウンドトリップ正常
- `oidc-provider` に渡して `/oidc/jwks` エンドポイントで**公開鍵のみ**が返却されること確認 (秘密鍵はリークしない)

### 鍵ローテーション

将来的に鍵ローテーションが必要な場合:
- `jwks.keys` 配列に新しい鍵を追加し、古い鍵も残す
- `oidc-provider` は `kid` で鍵を区別するため、古いトークンの検証は継続可能
- 一定期間後に古い鍵を削除

---

## 実装ステップ

### Phase 1: 基盤セットアップ

1. **依存パッケージの追加**
   ```bash
   pnpm add oidc-provider ioredis
   pnpm add -D @types/oidc-provider
   ```

2. **Valkey 接続ユーティリティ**
   ```ts
   // lib/valkey.ts
   import { Redis } from 'ioredis';

   let instance: Redis | null = null;

   export function getValkey(): Redis {
     if (!instance) {
       instance = new Redis(process.env.VALKEY_URL || 'redis://localhost:6379');
     }
     return instance;
   }
   ```

3. **Prisma スキーマに `OidcClient` テーブル追加** (上記参照)

4. **oidc-provider Adapter 実装** — Valkey (エフェメラル) + Prisma (Client永続化) のハイブリッド

### Phase 2: oidc-provider の設定とマウント

5. **Provider Configuration の作成**
   ```ts
   // server/oidc/config.ts
   import type { Configuration } from 'oidc-provider';
   import prisma from '~/lib/prisma';
   import { OidcAdapter } from './adapter';

   export const configuration: Configuration = {
     adapter: OidcAdapter,

     // どのクレームを提供するか
     claims: {
       openid: ['sub'],
       profile: ['name', 'preferred_username', 'picture'],
       email: ['email', 'email_verified'],
     },

     // ユーザー情報の解決
     async findAccount(ctx, id) {
       const user = await prisma.user.findUnique({ where: { id } });
       if (!user) return undefined;
       return {
         accountId: user.id,
         async claims(use, scope) {
           return {
             sub: user.id,
             name: user.displayName || user.name,
             preferred_username: user.name,
             email: user.mail,
             picture: user.avatarUrl,
           };
         },
       };
     },

     features: {
       devInteractions: { enabled: false },
       introspection: { enabled: true },
       revocation: { enabled: true },
     },

     pkce: {
       required: () => true,
       methods: ['S256'],
     },

     cookies: {
       keys: [process.env.OIDC_COOKIE_SECRET!],
     },

     // JWK は loadOrGenerateJwks() で取得 (後述)
     jwks: await loadOrGenerateJwks(),

     ttl: {
       AccessToken: 3600,
       AuthorizationCode: 600,
       IdToken: 3600,
       RefreshToken: 14 * 24 * 60 * 60,
       Interaction: 3600,
       Session: 14 * 24 * 60 * 60,
       Grant: 14 * 24 * 60 * 60,
     },
   };
   ```

6. **Nuxt serverHandler としてマウント** (上記の検証済みコード)

### Phase 3: 認可フロー用 UI

7. **ログイン画面** — oidc-provider の `interactions` をハンドリング
   - ログインフォーム (既存ユーザーのパスワード認証 or 外部IdP経由)
   - 同意画面 (スコープの確認)
   
   oidc-provider は interaction URL にリダイレクトするので、Nuxt のページで処理:
   ```
   /oidc/interaction/:uid  → ログイン画面 or 同意画面
   ```

8. **Interaction API** — ログイン/同意の結果を oidc-provider に返すエンドポイント

### Phase 4: クライアント管理

9. **管理画面** — OIDCクライアント (RP) の登録・管理 UI
   - client_id / client_secret の発行
   - redirect_uri の設定
   - 許可するスコープの設定
   - PostgreSQL の `OidcClient` テーブルに永続化

10. **（オプション）Dynamic Client Registration** — RFC 7591 対応

### Phase 5: 既存認証との統合

11. **既存の外部IdP認証との連携**
    - oidc-provider の `findAccount` で既存 User テーブルを参照
    - interaction のログインフローで、外部IdP経由のログインも選択肢にする

12. **unstorage の Valkey ドライバ移行** (misskey auth state)

---

## ファイル構成案

```
lib/
  valkey.ts               # Valkey (ioredis) 接続シングルトン
  prisma.ts               # (既存)

server/
  oidc/
    index.ts              # Provider インスタンス生成 + Nuxt serverHandler
    config.ts             # oidc-provider の設定 (Configuration)
    adapter.ts            # ハイブリッド Adapter (Valkey + Prisma)
    jwks.ts               # JWK鍵の生成・読み込み
    interactions.ts       # Interaction (ログイン/同意) API ハンドラ

api/
  common/
    helper/
      misskeyAuthStorage.ts  # unstorage: LRU → Valkey ドライバに変更

app/
  pages/
    oidc/
      interaction/
        [uid].vue         # ログイン/同意 UI

prisma/
  schema.prisma           # OidcClient テーブル追加, provider を postgresql に変更
```

---

## インフラ構成 (将来)

### docker-compose 例

```yaml
services:
  app:
    build: .
    ports: ["3000:3000"]
    environment:
      DATABASE_URL: postgresql://auth:auth@postgres:5432/auth
      VALKEY_URL: redis://valkey:6379
      OIDC_COOKIE_SECRET: <secret>
      HOST: https://auth.example.com
    depends_on: [postgres, valkey]

  postgres:
    image: postgres:17
    environment:
      POSTGRES_USER: auth
      POSTGRES_PASSWORD: auth
      POSTGRES_DB: auth
    volumes: ["pgdata:/var/lib/postgresql/data"]

  valkey:
    image: valkey/valkey:8
    volumes: ["valkeydata:/data"]

volumes:
  pgdata:
  valkeydata:
```

### 環境変数一覧

| 変数 | 説明 | 例 |
|------|------|-----|
| `DATABASE_URL` | PostgreSQL 接続文字列 | `postgresql://user:pass@localhost:5432/auth` |
| `VALKEY_URL` | Valkey/Redis 接続文字列 | `redis://localhost:6379` |
| `HOST` | 公開ホスト名 (protocol含む) | `https://auth.example.com` |
| `OIDC_COOKIE_SECRET` | oidc-provider cookie 暗号化キー | ランダム文字列 |
| `OIDC_JWKS` | JWK Set (JSON文字列、省略時はDB自動生成) | `{"keys":[...]}` |

---

## 考慮事項

### セキュリティ

- **JWK 鍵管理**: 下記「JWK 自動生成・永続化」セクション参照。実装済み
- **Cookie Secret**: oidc-provider 用の cookie 暗号化キーを環境変数で管理
- **HTTPS 必須**: 本番環境では HTTPS が前提（`oidc-provider` はデフォルトで強制）
- **PKCE 強制**: public client に対しては必須にする

### パフォーマンス

- **Valkey にエフェメラルデータを分離** → PostgreSQL の負荷軽減、テーブル肥大化防止
- **Valkey の TTL** → トークン/セッションの期限切れが自動削除される。クリーンアップジョブ不要
- **接続プール**: Prisma (PostgreSQL) は内蔵の接続プールを使用。ioredis も接続管理を内蔵

### スケーラビリティ

- Valkey でセッション共有 → **複数プロセス/コンテナ間でセッションが共有される**
  - 現在の LRU cache はプロセスローカルなので、スケールアウト時にセッションが失われる問題が解消
- PostgreSQL はリードレプリカで読み取りスケール可能

### 開発環境

- 開発時は docker-compose で PostgreSQL + Valkey を起動
- `oidc-provider` は `provider.proxy = true` で HTTP 許可
- Valkey が無い環境では `unstorage` の LRU ドライバにフォールバックする設計も可能:
  ```ts
  const driver = process.env.VALKEY_URL
    ? redisDriver({ url: process.env.VALKEY_URL })
    : lruCacheDriver({});
  ```

### 既存コードとの共存

- 既存の `/api/v0/**` (Hono) は変更不要。OIDC Provider は別パス `/oidc/**` で動作
- 既存の `User` テーブルをそのまま OIDC Provider の account として利用
- 将来的に `/api/v0/me` 等でも oidc-provider が発行したトークンで認証できるようにすると統一的

---

## まとめ

| 項目 | 内容 |
|------|------|
| ライブラリ | `oidc-provider` v9 + `ioredis` |
| マウントパス | `/oidc/**` |
| 永続データ | PostgreSQL (Prisma) — User, Client登録 |
| エフェメラルデータ | Valkey — Token, Session, Grant, Interaction, AuthCode |
| 一時データ (既存) | `unstorage` Redis ドライバで Valkey に移行 |
| ユーザー情報 | 既存 User テーブルを `findAccount` で参照 |
| UI | Nuxt ページで ログイン/同意画面 |
| 工数見積 | Phase 1-2: 1-2日, Phase 3: 1-2日, Phase 4-5: 1-2日 |
