# Auth

## ライセンス

現在、PR作成目的以外の利用は、事前の許可がない限り許可していません。
  - ある程度安定したらAGPLv3かMPLv2辺りにしたい

## 動作確認済みサービス

### openid connect

- GitLab: <https://lab.teamblackcrystal.com/>
  - `https://lab.teamblackcrystal.com/.well-known/openid-configuration`

### oauth2

- Misskey: <https://ac.akirin.xyz/>
  - isMisskeyフラグを立てること
  - `https://ac.akirin.xyz/.well-known/oauth-authorization-server`

<details>
<summary>nuxt</summary>
# Nuxt Minimal Starter

Look at the [Nuxt documentation](https://nuxt.com/docs/getting-started/introduction) to learn more.

## Setup

Make sure to install dependencies:

```bash
# npm
npm install

# pnpm
pnpm install

# yarn
yarn install

# bun
bun install
```

## Development Server

Start the development server on `http://localhost:3000`:

```bash
# npm
npm run dev

# pnpm
pnpm dev

# yarn
yarn dev

# bun
bun run dev
```

## Production

Build the application for production:

```bash
# npm
npm run build

# pnpm
pnpm build

# yarn
yarn build

# bun
bun run build
```

Locally preview production build:

```bash
# npm
npm run preview

# pnpm
pnpm preview

# yarn
yarn preview

# bun
bun run preview
```

Check out the [deployment documentation](https://nuxt.com/docs/getting-started/deployment) for more information.
</details>