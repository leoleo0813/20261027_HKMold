import { sql, handle, readBody } from './_db.js';
import { getAgent, taskAck, taskReport, taskDuration } from '../lib/agents.js';

// POST {agentId, title} → 업무 지시, PATCH {id} → 시간이 다 된 업무를 완료 처리
export default (req, res) => handle(res, async () => {
  if (req.method === 'POST') {
    const { agentId, title } = readBody(req);
    const agent = getAgent(agentId);
    const name = typeof title === 'string' ? title.trim().slice(0, 100) : '';
    if (!agent || !name) return res.status(400).json({ error: 'bad_request' });
    const [task] = await sql`
      INSERT INTO tasks (agent_id, title, duration_sec) VALUES (${agent.id}, ${name}, ${taskDuration()})
      RETURNING id, agent_id AS "agentId", title, status, duration_sec AS "durationSec",
                created_at AS "createdAt", completed_at AS "completedAt"`;
    const [message] = await sql`
      INSERT INTO messages (agent_id, sender, kind, body) VALUES (${agent.id}, 'agent', 'ack', ${taskAck(agent, name)})
      RETURNING id, agent_id AS "agentId", sender, kind, body, created_at AS "createdAt"`;
    return res.status(200).json({ task, message });
  }

  if (req.method === 'PATCH') {
    const id = Number(readBody(req).id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'bad_request' });
    // 여러 브라우저가 동시에 완료를 요청해도 한 번만 처리되도록 status 조건을 건다
    const [task] = await sql`
      UPDATE tasks SET status = 'done', completed_at = now()
      WHERE id = ${id} AND status = 'doing'
        AND created_at + make_interval(secs => duration_sec) <= now() + interval '5 seconds'
      RETURNING id, agent_id AS "agentId", title, status, duration_sec AS "durationSec",
                created_at AS "createdAt", completed_at AS "completedAt"`;
    if (!task) return res.status(200).json({ task: null });
    const [message] = await sql`
      INSERT INTO messages (agent_id, sender, kind, body)
      VALUES (${task.agentId}, 'agent', 'report', ${taskReport(getAgent(task.agentId), task.title)})
      RETURNING id, agent_id AS "agentId", sender, kind, body, created_at AS "createdAt"`;
    return res.status(200).json({ task, message });
  }

  res.status(405).json({ error: 'method_not_allowed' });
});
