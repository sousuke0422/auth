// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2024-11-01',
  future: {
    compatibilityVersion: 4
  },
  devtools: { enabled: true },
  imports: {
    autoImport: false
  },
  telemetry: {
    enabled: false
  },
  modules: ['@nuxtjs/tailwindcss', 'shadcn-nuxt', '@prisma/nuxt'],
  serverHandlers: [
    {
      route: '/api/v0/**',
      handler: '~/../api/v0/index.ts'
    }
  ],
  shadcn: {
    componentDir: './app/components/ui'
  },
  vite: {
    resolve: {
      alias: {
        '.prisma/client/index-browser': './node_modules/.prisma/client/index-browser.js',
      },
    },
  },
})