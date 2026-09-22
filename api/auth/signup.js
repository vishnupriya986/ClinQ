import { app, initializeDatabase } from '../../server/index.js'

let databaseReady

export default async function handler(request, response) {
	try {
		databaseReady ||= initializeDatabase()
		await databaseReady
		request.url = '/api/auth/signup'
		return app(request, response)
	} catch {
		if (!response.headersSent) response.status(503).json({ error: 'The ClinQ API could not connect to its database.' })
	}
}