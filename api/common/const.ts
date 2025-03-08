export const isProd = process.env.NODE_ENV == 'production' ? true : false
export const protocol = process.env.OVERRIDE_PROTOCOL || isProd ? 'https' : 'http'
export const host = `${protocol}://${process.env.HOST || 'localhost:3000'}`
