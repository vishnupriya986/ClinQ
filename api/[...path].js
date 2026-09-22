import { app, initializeDatabase } from '../server/index.js'

let databaseReady

export default async function handler(request, response) {
  try {
    databaseReady ||= initializeDatabase()
    await databaseReady
    return app(request, response)
  } catch (error) {
    console.error('API initialization failed:', error instanceof Error ? error.message : 'unknown error')
    if (!response.headersSent) response.status(503).json({ error: 'The ClinQ API could not connect to its database. Check the Vercel DATABASE_URL environment variable.' })
  }
}