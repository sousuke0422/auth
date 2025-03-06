import { defineEventHandler, toWebRequest } from 'h3'
import { Hono } from 'hono'
import { logger } from 'hono/logger'
import prisma from '~/lib/prisma'
import { auth } from './auth'
import { callback } from './callback'

const app = new Hono()

app.use(logger())

app.get('/api/v0/health', (c) => {
    return c.json({
        ok: true
    })
})

app.route('/api/v0/auth', auth)
app.route('/api/v0/callback', callback)

app.get('/api/v0/:param', async (c) => {
  return c.text(`This is Hono with param: ${c.req.param('param')}, count: ${await prisma.user.count()}`)
})

export default defineEventHandler((event) => {
  event.node.req.originalUrl = '' // /api/hono/
  const webReq = toWebRequest(event)
  return app.fetch(webReq)
})