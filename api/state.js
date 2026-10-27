import { sql, handle } from './_db.js';

// 사무실 전체 상태: 최근 업무와 오피스 소식(최근 메시지)
export default (req, res) => handle(res, async () => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });
  const tasks = await sql`
    SELECT id, agent_id AS "agentId", title, status, duration_sec AS "durationSec",
           created_at AS "createdAt", completed_at AS "completedAt"
    FROM tasks ORDER BY id DESC LIMIT 100`;
  const feed = await sql`
    SELECT id, agent_id AS "agentId", sender, kind, body, created_at AS "createdAt"
    FROM messages ORDER BY id DESC LIMIT 30`;
  res.status(200).json({ tasks, feed });
});
