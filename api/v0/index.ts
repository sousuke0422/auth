import { defineEventHandler, toWebRequest } from 'h3'
import { Hono } from 'hono'
import { logger } from 'hono/logger'
import prisma from '~/lib/prisma'

const app = new Hono()

app.use(logger())
app.get('/api/v0/health', (c) => {
    return c.json({
        ok: true
    })
})

app.get('/api/v0/:param', async (c) => {
  return c.text(`This is Hono with param: ${c.req.param('param')}, count: ${await prisma.user.count()}`)
})

export default defineEventHandler((event) => {
  event.node.req.originalUrl = '' // /api/hono/
  const webReq = toWebRequest(event)
  return app.fetch(webReq)
})