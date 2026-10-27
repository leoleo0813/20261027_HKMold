import { sql, handle, readBody } from './_db.js';
import { getAgent, agentReply } from '../lib/agents.js';

// GET ?agent=ID → 해당 직원과의 대화, POST {agentId, text} → 메시지 저장 + 직원 답장
export default (req, res) => handle(res, async () => {
  if (req.method === 'GET') {
    const agent = getAgent(String(req.query.agent || ''));
    if (!agent) return res.status(400).json({ error: 'unknown_agent' });
    const rows = await sql`
      SELECT id, agent_id AS "agentId", sender, kind, body, created_at AS "createdAt"
      FROM messages WHERE agent_id = ${agent.id} ORDER BY id DESC LIMIT 100`;
    return res.status(200).json({ messages: rows.reverse() });
  }

  if (req.method === 'POST') {
    const { agentId, text } = readBody(req);
    const agent = getAgent(agentId);
    const body = typeof text === 'string' ? text.trim().slice(0, 300) : '';
    if (!agent || !body) return res.status(400).json({ error: 'bad_request' });
    const rows = await sql`
      INSERT INTO messages (agent_id, sender, kind, body)
      VALUES (${agent.id}, 'user', 'chat', ${body}), (${agent.id}, 'agent', 'chat', ${agentReply(agent, body)})
      RETURNING id, agent_id AS "agentId", sender, kind, body, created_at AS "createdAt"`;
    return res.status(200).json({ messages: rows.sort((a, b) => a.id - b.id) });
  }

  res.status(405).json({ error: 'method_not_allowed' });
});
