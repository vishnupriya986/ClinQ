CREATE TABLE IF NOT EXISTS reports (
  id SERIAL PRIMARY KEY,
  title VARCHAR(160) NOT NULL,
  report_type VARCHAR(80) NOT NULL,
  file_path TEXT,
  analysis_status VARCHAR(30) NOT NULL DEFAULT 'pending',
  ai_summary TEXT,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS reports_uploaded_at_idx ON reports (uploaded_at DESC);

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  name VARCHAR(160) NOT NULL,
  email VARCHAR(320) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS predictions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  disease VARCHAR(40) NOT NULL,
  clinical_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  risk_level VARCHAR(20) NOT NULL,
  risk_percentage INTEGER NOT NULL,
  analysis TEXT NOT NULL DEFAULT '',
  recommendations TEXT NOT NULL DEFAULT '',
  files JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS predictions_user_created_idx ON predictions (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS chat_messages (
  id SERIAL PRIMARY KEY,
  prediction_id INTEGER NOT NULL REFERENCES predictions(id) ON DELETE CASCADE,
  role VARCHAR(20) NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS chat_messages_prediction_idx ON chat_messages (prediction_id, created_at);
