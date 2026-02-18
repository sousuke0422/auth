# OIDC Provider 実装プラン

## 前提: 現在の構成

- **フレームワーク**: Nuxt 3 (compatibilityVersion: 4) + Hono (API層)
- **DB**: Prisma + SQLite
- **既存の認証**: OIDCクライアント（外部IdPで認証を受ける側）として動作
  - `openid-client` v5: 標準OIDC (GitLab等)
  - `openid-client` v6: Misskey (OAuth2)

## 目的

このアプリケーション自体を **OIDC Provider (Identity Provider)** として動作させ、
外部のRelying Party (RP) がこのサービスを使ってユーザー認証できるようにする。

---

## ライブラリ選定

### 推奨: `oidc-provider` (panva/node-oidc-provider)

| 項目 | 内容 |
|------|------|
| npm | `oidc-provider` (現在 v9.6.0) |
| ライセンス | MIT |
| 認定 | OpenID Foundation 認定済み |
| 作者 | Filip Skokan (panva) — `openid-client` と同じ作者 |
| Node.js | v22 対応 ✅ |

**選定理由:**

1. **Node.js向け唯一の本格的OIDC Provider ライブラリ** — 他に実用レベルの選択肢がほぼない
2. **OpenID Foundation 認定** — Basic, Implicit, Hybrid, Config, FAPI 等すべてのプロファイルで認定済み
3. **既に `openid-client` を使用中** — 同じ作者のライブラリなので互換性・設計思想が一貫している
4. **Koa ベースだが、任意のフレームワークにマウント可能** — Hono/Nuxt にも統合できる
5. **豊富な機能**: PKCE, Device Flow, DPoP, Token Introspection, Dynamic Client Registration 等

**他の選択肢が適さない理由:**

- `better-auth`, `@auth/core`, `nuxt-auth-utils` — これらはすべて「クライアント側」のライブラリ。IdP機能は提供しない
- 自作実装 — OIDCの仕様は広大（Discovery, JWK, 各種Grant Type, Token管理等）で、正しく実装するのは非現実的

---

## アーキテクチャ設計

### 全体構成

```
┌─────────────────────────────────────────────────┐
│  Nuxt 3 アプリケーション                          │
│                                                   │
│  ┌──────────────┐  ┌──────────────────────────┐  │
│  │ Nuxt Pages   │  │ Hono API (/api/v0/**)    │  │
│  │ (フロント)    │  │ - 既存の認証API          │  │
│  │              │  │ - ユーザー管理API         │  │
│  └──────────────┘  └──────────────────────────┘  │
│                                                   │
│  ┌──────────────────────────────────────────────┐│
│  │ oidc-provider (/oidc/**)                     ││
│  │ - /.well-known/openid-configuration          ││
│  │ - /oidc/auth (認可エンドポイント)             ││
│  │ - /oidc/token (トークンエンドポイント)        ││
│  │ - /oidc/userinfo                              ││
│  │ - /oidc/jwks                                  ││
│  │ - /oidc/introspection                         ││
│  └──────────────────────────────────────────────┘│
│                                                   │
│  ┌──────────────────────────────────────────────┐│
│  │ Prisma (SQLite)                              ││
│  │ - 既存テーブル (User, UserIdentity, etc.)    ││
│  │ - 新規: OidcClient, Grant, Session, etc.     ││
│  └──────────────────────────────────────────────┘│
└─────────────────────────────────────────────────┘
```

### oidc-provider のマウント方法

`oidc-provider` は Koa ベースだが、`provider.callback()` で標準の Node.js HTTP ハンドラ
`(req, res) => void` を返すため、Nuxt の `serverHandlers` に直接マウントできる。

```ts
// server/routes/oidc/[...path].ts (Nuxt server route)
import { Provider } from 'oidc-provider';
import { defineEventHandler, getRequestURL } from 'h3';

const provider = new Provider('https://your-domain.com', {
  // configuration...
});

export default defineEventHandler((event) => {
  return new Promise((resolve, reject) => {
    const { req, res } = event.node;
    provider.callback()(req, res)
      .then(resolve)
      .catch(reject);
  });
});
```

あるいは、Nuxt の `serverHandlers` で `/oidc/**` にマウントする方法:

```ts
// nuxt.config.ts
serverHandlers: [
  { route: '/api/v0/**', handler: '~/../api/v0/index.ts' },
  { route: '/oidc/**',   handler: '~/server/oidc.ts' },
]
```

---

## 実装ステップ

### Phase 1: 基盤セットアップ

1. **`oidc-provider` のインストール**
   ```bash
   pnpm add oidc-provider
   pnpm add -D @types/oidc-provider
   ```

2. **Prisma スキーマ拡張** — oidc-provider が必要とするデータを保存するテーブル追加
   ```prisma
   model OidcClient {
     id            String   @id
     data          String   // JSON: client metadata
     createdAt     DateTime @default(now())
     updatedAt     DateTime @updatedAt
   }

   model OidcGrant {
     id            String   @id
     data          String   // JSON
     expiresAt     DateTime
     consumedAt    DateTime?
   }

   model OidcSession {
     id            String   @id
     data          String   // JSON
     expiresAt     DateTime
   }

   model OidcInteraction {
     id            String   @id
     data          String   // JSON
     expiresAt     DateTime
   }

   model OidcAccessToken {
     id            String   @id
     data          String   // JSON
     expiresAt     DateTime
     consumedAt    DateTime?
     grantId       String?
     userCode      String?
   }

   model OidcAuthorizationCode {
     id            String   @id
     data          String   // JSON
     expiresAt     DateTime
     consumedAt    DateTime?
     grantId       String?
   }

   model OidcRefreshToken {
     id            String   @id
     data          String   // JSON
     expiresAt     DateTime
     consumedAt    DateTime?
     grantId       String?
   }
   ```
   
   > **注意**: `oidc-provider` は Adapter パターンを使用する。上記は一つのアプローチだが、
   > 汎用的な `OidcPayload` テーブル1つにまとめるパターン（modelName + id をキーにする）
   > の方がシンプルな場合もある。

   **汎用テーブルパターン（推奨）:**
   ```prisma
   model OidcPayload {
     id            String    @id
     modelName     String    @map("model_name")
     data          String    // JSON
     expiresAt     DateTime? @map("expires_at")
     consumedAt    DateTime? @map("consumed_at")
     grantId       String?   @map("grant_id")
     userCode      String?   @map("user_code")
     uid           String?
     createdAt     DateTime  @default(now()) @map("created_at")

     @@unique([modelName, id])
     @@index([grantId])
     @@index([userCode])
     @@index([uid])
   }
   ```

3. **Prisma Adapter の実装** — `oidc-provider` が要求するAdapterインターフェースをPrismaで実装

### Phase 2: oidc-provider の設定

4. **Provider Configuration の作成**
   ```ts
   // server/oidc/config.ts
   const configuration = {
     // クライアント (後でDBから動的にもできる)
     clients: [{
       client_id: 'example-rp',
       client_secret: 'secret',
       redirect_uris: ['https://rp.example.com/cb'],
       grant_types: ['authorization_code', 'refresh_token'],
       response_types: ['code'],
       scope: 'openid profile email',
     }],

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

     // 機能フラグ
     features: {
       devInteractions: { enabled: false }, // 本番では無効化
       introspection: { enabled: true },
       revocation: { enabled: true },
       resourceIndicators: { enabled: false },
     },

     // PKCE 強制
     pkce: {
       required: () => true,
       methods: ['S256'],
     },

     // Cookie設定
     cookies: {
       keys: [process.env.OIDC_COOKIE_SECRET],
     },

     // JWK (署名鍵)
     jwks: {
       keys: [/* JWK形式の鍵 — 起動時に生成 or 環境変数から読み込み */],
     },

     // TTL設定
     ttl: {
       AccessToken: 3600,        // 1時間
       AuthorizationCode: 600,   // 10分
       IdToken: 3600,            // 1時間
       RefreshToken: 14 * 24 * 60 * 60, // 14日
       Interaction: 3600,
       Session: 14 * 24 * 60 * 60,
       Grant: 14 * 24 * 60 * 60,
     },
   };
   ```

5. **Nuxt へのマウント**

### Phase 3: 認可フロー用 UI

6. **ログイン画面** — oidc-provider は `interactions` (認可中にユーザーに確認を求めるフロー) を提供
   - ログインフォーム (既存ユーザーのパスワード認証 or 外部IdP経由)
   - 同意画面 (スコープの確認)
   
   oidc-provider は interaction URL にリダイレクトするので、Nuxt のページで処理:
   ```
   /oidc/interaction/:uid  → ログイン画面
   /oidc/interaction/:uid  → 同意画面
   ```

7. **Interaction API** — ログイン/同意の結果を oidc-provider に返すエンドポイント

### Phase 4: クライアント管理

8. **管理画面** — OIDCクライアント (RP) の登録・管理 UI
   - client_id / client_secret の発行
   - redirect_uri の設定
   - 許可するスコープの設定

9. **（オプション）Dynamic Client Registration** — RFC 7591 対応

### Phase 5: 既存認証との統合

10. **既存の外部IdP認証との連携**
    - 現在の「外部IdPでログインしたユーザー」が、今度はこのサービスのIdPとしても認証できるようにする
    - oidc-provider の `findAccount` で既存 User テーブルを参照
    - interaction のログインフローで、外部IdP経由のログインも選択肢にする

---

## ファイル構成案

```
server/
  oidc/
    index.ts              # Provider インスタンスの生成・マウント
    config.ts             # oidc-provider の設定
    adapter.ts            # Prisma Adapter (データ永続化)
    jwks.ts               # JWK鍵の管理
    interactions.ts       # Interaction (ログイン/同意) API

app/
  pages/
    oidc/
      interaction/
        [uid].vue         # ログイン/同意 UI

prisma/
  schema.prisma           # OidcPayload テーブル追加
```

---

## 考慮事項

### セキュリティ

- **JWK 鍵管理**: RS256 の鍵ペアを安全に保管（環境変数 or ファイル）。起動時に自動生成する仕組みも検討
- **Cookie Secret**: oidc-provider 用の cookie 暗号化キーを環境変数で管理
- **HTTPS 必須**: 本番環境では HTTPS が前提（`oidc-provider` はデフォルトで強制）
- **PKCE 強制**: public client に対しては必須にする

### パフォーマンス

- SQLite は小〜中規模なら十分。大規模になればPostgreSQL等への移行を検討
- Token の期限切れデータのクリーンアップジョブが必要（定期的に expired なレコードを削除）

### 開発時の注意

- `oidc-provider` はデフォルトで `https` を要求する。開発時は以下で緩和:
  ```ts
  // 開発環境のみ
  const provider = new Provider(issuer, config);
  provider.proxy = true;
  // または環境変数で NODE_TLS_REJECT_UNAUTHORIZED=0
  ```

### 既存コードとの共存

- 既存の `/api/v0/**` (Hono) は変更不要。OIDC Provider は別パス `/oidc/**` で動作
- 既存の `User` テーブルをそのまま OIDC Provider の account として利用
- 将来的に `/api/v0/me` 等でも oidc-provider が発行したトークンで認証できるようにすると統一的

---

## まとめ

| 項目 | 内容 |
|------|------|
| ライブラリ | `oidc-provider` v9 |
| マウントパス | `/oidc/**` |
| データ保存 | Prisma (OidcPayload テーブル) |
| ユーザー情報 | 既存 User テーブルを `findAccount` で参照 |
| UI | Nuxt ページで ログイン/同意画面 |
| 工数見積 | Phase 1-2: 1-2日, Phase 3: 1-2日, Phase 4-5: 1-2日 |
