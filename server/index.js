import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import pg from 'pg'
import crypto from 'node:crypto'

const { Pool } = pg
const app = express()
const port = Number(process.env.PORT || 3001)
const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const maxDocumentBytes = 10 * 1024 * 1024

app.use(cors())
app.use(express.json({ limit: '15mb' }))

const hashPassword = (password, salt = crypto.randomBytes(16).toString('hex')) => `${salt}:${crypto.scryptSync(password, salt, 64).toString('hex')}`
const verifyPassword = (password, stored) => {
  const [salt, hash] = stored.split(':')
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), crypto.scryptSync(password, salt, 64))
}
const requireUser = async (request, response) => {
  const userId = Number(request.headers['x-user-id'] || request.body?.userId || request.query?.userId)
  if (!Number.isInteger(userId)) { response.status(401).json({ error: 'Authentication required' }); return null }
  const user = await pool.query('SELECT id, name, email FROM users WHERE id = $1', [userId])
  if (!user.rowCount) { response.status(401).json({ error: 'User not found' }); return null }
  return user.rows[0]
}

const initializeDatabase = async () => {
  await pool.query(`CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY, name VARCHAR(160) NOT NULL, email VARCHAR(320) UNIQUE NOT NULL, password_hash TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
    CREATE TABLE IF NOT EXISTS predictions (id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, disease VARCHAR(40) NOT NULL, clinical_data JSONB NOT NULL DEFAULT '{}'::jsonb, risk_level VARCHAR(20) NOT NULL, risk_percentage INTEGER NOT NULL, analysis TEXT NOT NULL DEFAULT '', recommendations TEXT NOT NULL DEFAULT '', files JSONB NOT NULL DEFAULT '[]'::jsonb, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
    CREATE INDEX IF NOT EXISTS predictions_user_created_idx ON predictions (user_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS chat_messages (id SERIAL PRIMARY KEY, prediction_id INTEGER NOT NULL REFERENCES predictions(id) ON DELETE CASCADE, role VARCHAR(20) NOT NULL, content TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
    CREATE INDEX IF NOT EXISTS chat_messages_prediction_idx ON chat_messages (prediction_id, created_at);
    CREATE INDEX IF NOT EXISTS chat_messages_prediction_order_idx ON chat_messages (prediction_id, created_at, id);`)
}

export { app, initializeDatabase }

app.post('/api/auth/signup', async (request, response) => {
  const { name, email, password } = request.body
  if (!name || !email || !password) return response.status(400).json({ error: 'Name, email, and password are required' })
  try {
    const result = await pool.query('INSERT INTO users (name, email, password_hash) VALUES ($1, LOWER($2), $3) RETURNING id, name, email', [name.trim(), email.trim(), hashPassword(password)])
    response.status(201).json({ user: result.rows[0] })
  } catch { response.status(409).json({ error: 'An account with that email already exists' }) }
})

app.post('/api/auth/login', async (request, response) => {
  const { email, password } = request.body
  const result = await pool.query('SELECT id, name, email, password_hash FROM users WHERE email = LOWER($1)', [email || ''])
  if (!result.rowCount || !verifyPassword(password || '', result.rows[0].password_hash)) return response.status(401).json({ error: 'Invalid email or password' })
  const { password_hash: _passwordHash, ...user } = result.rows[0]
  response.json({ user })
})

app.get('/api/predictions', async (request, response) => {
  const user = await requireUser(request, response); if (!user) return
  const result = await pool.query('SELECT id, disease, risk_level, risk_percentage, analysis, recommendations, files, created_at FROM predictions WHERE user_id = $1 ORDER BY created_at DESC', [user.id])
  response.json({ predictions: result.rows })
})

app.post('/api/predictions', async (request, response) => {
  const user = await requireUser(request, response); if (!user) return
  const { disease, clinicalData, riskLevel, riskPercentage, analysis, recommendations, files } = request.body
  const result = await pool.query('INSERT INTO predictions (user_id, disease, clinical_data, risk_level, risk_percentage, analysis, recommendations, files) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *', [user.id, disease, clinicalData || {}, riskLevel, riskPercentage, analysis || '', recommendations || '', JSON.stringify(files || [])])
  response.status(201).json({ prediction: result.rows[0] })
})

app.get('/api/predictions/:id', async (request, response) => {
  const user = await requireUser(request, response); if (!user) return
  const result = await pool.query('SELECT * FROM predictions WHERE id = $1 AND user_id = $2', [request.params.id, user.id])
  if (!result.rowCount) return response.status(404).json({ error: 'Prediction not found' })
  const messages = await pool.query('SELECT id, role, content, created_at FROM chat_messages WHERE prediction_id = $1 ORDER BY created_at, id', [request.params.id])
  response.json({ prediction: result.rows[0], messages: messages.rows })
})

app.post('/api/predictions/:id/messages', async (request, response) => {
  const user = await requireUser(request, response); if (!user) return
  const ownership = await pool.query('SELECT id FROM predictions WHERE id = $1 AND user_id = $2', [request.params.id, user.id])
  if (!ownership.rowCount) return response.status(404).json({ error: 'Prediction not found' })
  const { role, content } = request.body
  if (!['user', 'assistant'].includes(role) || typeof content !== 'string' || !content.trim() || content.length > 12000) return response.status(400).json({ error: 'A valid chat message is required' })
  const result = await pool.query('INSERT INTO chat_messages (prediction_id, role, content) VALUES ($1,$2,$3) RETURNING id, role, content, created_at', [request.params.id, role, content])
  response.status(201).json({ message: result.rows[0] })
})

app.post('/api/chat', async (request, response) => {
  const { message, disease, prediction, clinicalData, files, file, predictionId } = request.body
  const user = await requireUser(request, response); if (!user) return
  if (!message || typeof message !== 'string') return response.status(400).json({ error: 'A message is required' })
  if (message.length > 4000) return response.status(400).json({ error: 'Please keep the question under 4,000 characters' })
  if (file) {
    const allowedType = typeof file.type === 'string' && (file.type.startsWith('image/') || file.type === 'application/pdf' || file.type.startsWith('text/'))
    const encodedSize = typeof file.data === 'string' ? Math.ceil(file.data.length * 0.75) : 0
    if (!allowedType || !file.data || encodedSize > maxDocumentBytes) return response.status(400).json({ error: 'The document is missing, unsupported, or larger than 10 MB' })
  }
  let previousMessages = []
  if (predictionId) {
    const ownership = await pool.query('SELECT id FROM predictions WHERE id = $1 AND user_id = $2', [predictionId, user.id])
    if (!ownership.rowCount) return response.status(404).json({ error: 'Prediction not found' })
    const history = await pool.query('SELECT role, content FROM chat_messages WHERE prediction_id = $1 ORDER BY created_at DESC, id DESC LIMIT 20', [predictionId])
    previousMessages = history.rows.reverse()
  }
  if (!process.env.OPENAI_API_KEY) return response.status(503).json({ error: 'AI provider is not configured' })

  try {
    const conversation = previousMessages.map((item) => `${item.role === 'user' ? 'User' : 'Assistant'}: ${item.content}`).join('\n') || 'No previous conversation.'
    const context = `Current topic: ${disease || 'general health'}\nEducational estimate: ${prediction || 'not generated'}\nClinical data: ${JSON.stringify(clinicalData || {})}\nUploaded files: ${files?.join(', ') || 'none'}\nPrevious conversation (most recent 20 messages):\n${conversation}\nAttachment handling: Report only text or image details that are actually legible or visible. If an image is blurry, cropped, rotated, low-resolution, poorly lit, handwritten, or otherwise uncertain, say so and do not guess. Separate observed or transcribed content from possible interpretations and unknowns.\nQuestion: ${message}`
    const inputContent = [{ type: 'input_text', text: context }]
    if (file?.data && file?.type?.startsWith('image/')) inputContent.push({ type: 'input_image', image_url: file.data })
    if (file?.data && (file?.type === 'application/pdf' || file?.type?.startsWith('text/'))) inputContent.push({ type: 'input_file', filename: file.name || 'health-report', file_data: file.data })
    const aiResponse = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
        instructions: 'You are ClinQ, a careful health education assistant for patients. Answer health questions using the user context and attached report or image when present. For X-rays, describe only clearly visible features and state that an image cannot establish a diagnosis. For reports, identify only values, reference ranges, findings, and impressions actually present. For prescriptions, transcribe medicine names, strength, frequency, duration, route, and instructions only when legible; mark uncertain handwriting as unreadable and never invent a dosage. Explain medical terms in plain language. Separate observed facts from possible interpretations and unknowns. Never diagnose, prescribe, recommend starting/stopping/changing a medicine, or claim certainty. Ask for a clearer image when quality prevents reliable reading. Encourage a qualified clinician for interpretation. For chest pain, severe breathing difficulty, sudden weakness, confusion, severe allergic reaction, heavy bleeding, or thoughts of self-harm, recommend urgent emergency care immediately. Give concise answers with what is known, what it may mean, what to do next, and when to seek care. This is education, not a replacement for professional medical advice.',
        input: [{ role: 'user', content: inputContent }],
        max_output_tokens: 500,
      }),
    })
    if (!aiResponse.ok) return response.status(502).json({ error: 'The AI provider could not answer right now' })
    const data = await aiResponse.json()
    const answer = data.output_text || 'I could not generate an answer right now.'
    response.json({ answer })
  } catch {
    response.status(502).json({ error: 'Unable to reach the AI provider' })
  }
})

app.get('/api/health', async (_request, response) => {
  try {
    await pool.query('SELECT 1')
    response.json({ status: 'ok', database: 'connected' })
  } catch {
    response.status(503).json({ status: 'error', database: 'unavailable' })
  }
})

app.get('/api/reports', async (_request, response) => {
  try {
    const result = await pool.query(
      'SELECT id, title, report_type, uploaded_at, analysis_status FROM reports ORDER BY uploaded_at DESC',
    )
    response.json(result.rows)
  } catch {
    response.status(500).json({ error: 'Unable to load reports' })
  }
})

app.use((error, _request, response, _next) => {
  console.error('API request failed:', error instanceof Error ? error.message : 'unknown error')
  if (!response.headersSent) response.status(500).json({ error: 'The ClinQ API could not complete that request.' })
})

if (!process.env.VERCEL) {
  initializeDatabase().then(() => app.listen(port, () => {
    console.log(`ClinQ API running at http://localhost:${port}`)
  })).catch((error) => {
    console.error('Database initialization failed:', error.message)
    process.exit(1)
  })
}
