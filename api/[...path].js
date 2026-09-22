import { app, initializeDatabase } from '../server/index.js'

let databaseReady

export default async function handler(request, response) {
  databaseReady ||= initializeDatabase()
  await databaseReady
  return app(request, response)
}