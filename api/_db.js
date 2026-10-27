// Neon Postgres 연결과 공용 헬퍼. 파일 이름이 _로 시작해서 Vercel이 API 경로로 노출하지 않는다.
import { neon } from '@neondatabase/serverless';

const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
export const sql = url ? neon(url) : null;

let ready = null;
function ensureSchema() {
  ready ??= (async () => {
    await sql`CREATE TABLE IF NOT EXISTS tasks (
      id SERIAL PRIMARY KEY,
      agent_id TEXT NOT NULL,
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'doing',
      duration_sec INT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      completed_at TIMESTAMPTZ
    )`;
    await sql`CREATE TABLE IF NOT EXISTS messages (
      id SERIAL PRIMARY KEY,
      agent_id TEXT NOT NULL,
      sender TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'chat',
      body TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`;
    await sql`CREATE INDEX IF NOT EXISTS messages_agent_idx ON messages (agent_id, id)`;
  })().catch((err) => {
    ready = null;
    throw err;
  });
  return ready;
}

export function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  try { return JSON.parse(req.body || '{}'); } catch { return {}; }
}

export async function handle(res, fn) {
  if (!sql) return res.status(503).json({ error: 'db_not_configured' });
  try {
    await ensureSchema();
    await fn();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'server_error' });
  }
}
