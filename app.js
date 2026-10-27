import { AGENTS, getAgent, agentReply, taskAck, taskReport, taskDuration } from './lib/agents.js';

/* ───────────── 데이터 저장소: 서버(Neon) 또는 브라우저(localStorage) ───────────── */

async function api(path, opts = {}) {
  const res = await fetch(path, { ...opts, headers: { 'Content-Type': 'application/json' } });
  if (!res.ok) {
    const err = new Error(`API ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

const remoteStore = {
  mode: 'remote',
  state: () => api('/api/state'),
  messages: (agentId) => api(`/api/messages?agent=${encodeURIComponent(agentId)}`).then((r) => r.messages),
  send: (agentId, text) => api('/api/messages', { method: 'POST', body: JSON.stringify({ agentId, text }) }).then((r) => r.messages),
  addTask: (agentId, title) => api('/api/tasks', { method: 'POST', body: JSON.stringify({ agentId, title }) }),
  completeTask: (id) => api('/api/tasks', { method: 'PATCH', body: JSON.stringify({ id }) }).then((r) => (r.task ? r : null)),
};

const LOCAL_KEY = 'hkmold-office-v1';

function makeLocalStore() {
  let db = null;
  try { db = JSON.parse(localStorage.getItem(LOCAL_KEY)); } catch {}
  if (!db || !Array.isArray(db.tasks) || !Array.isArray(db.messages)) db = { seq: 1, tasks: [], messages: [] };
  const save = () => { try { localStorage.setItem(LOCAL_KEY, JSON.stringify(db)); } catch {} };
  const now = () => new Date().toISOString();
  const addMsg = (agentId, sender, kind, body) => {
    const m = { id: db.seq++, agentId, sender, kind, body, createdAt: now() };
    db.messages.push(m);
    if (db.messages.length > 500) db.messages.splice(0, db.messages.length - 500);
    return m;
  };
  return {
    mode: 'local',
    async state() {
      return { tasks: db.tasks.slice(-100).reverse(), feed: db.messages.slice(-30).reverse() };
    },
    async messages(agentId) {
      return db.messages.filter((m) => m.agentId === agentId).slice(-100);
    },
    async send(agentId, text) {
      const u = addMsg(agentId, 'user', 'chat', text);
      const r = addMsg(agentId, 'agent', 'chat', agentReply(getAgent(agentId), text));
      save();
      return [u, r];
    },
    async addTask(agentId, title) {
      const task = { id: db.seq++, agentId, title, status: 'doing', durationSec: taskDuration(), createdAt: now(), completedAt: null };
      db.tasks.push(task);
      if (db.tasks.length > 200) db.tasks.splice(0, db.tasks.length - 200);
      const message = addMsg(agentId, 'agent', 'ack', taskAck(getAgent(agentId), title));
      save();
      return { task, message };
    },
    async completeTask(id) {
      const task = db.tasks.find((t) => t.id === id);
      if (!task || task.status !== 'doing') return null;
      task.status = 'done';
      task.completedAt = now();
      const message = addMsg(task.agentId, 'agent', 'report', taskReport(getAgent(task.agentId), task.title));
      save();
      return { task, message };
    },
  };
}

/* ───────────── 앱 상태 ───────────── */

const S = {
  store: null,
  tasks: [],
  feed: [],
  chats: {},          // agentId → 메시지 배열
  selected: null,
  tab: 'chat',
  pendingReply: {},   // agentId → true (답변 작성 중)
  completing: new Set(),
};

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hhmm = (iso) => {
  const d = new Date(iso);
  return isNaN(d) ? '' : d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });
};
const busyTasks = (agentId) => S.tasks.filter((t) => t.agentId === agentId && t.status === 'doing');
const progressOf = (t) => {
  if (t.status === 'done') return 1;
  const p = (Date.now() - Date.parse(t.createdAt)) / (t.durationSec * 1000);
  return Math.max(0, Math.min(1, p));
};

/* ───────────── 픽셀아트 사무실 ───────────── */

const W = 320, H = 200, CORR = 100;
const canvas = $('#office');
const ctx = canvas.getContext('2d');

function R(c, x, y, w, h, col) {
  c.fillStyle = col;
  c.fillRect(Math.round(x), Math.round(y), w, h);
}

const DESKS = [
  { x: 24, y: 44, row: 'A' }, { x: 104, y: 44, row: 'A' }, { x: 184, y: 44, row: 'A' },
  { x: 24, y: 146, row: 'B' }, { x: 104, y: 146, row: 'B' }, { x: 184, y: 146, row: 'B' },
];
const seatOf = (desk) => (desk.row === 'A'
  ? { x: desk.x + 24, y: 70, dir: 'up' }
  : { x: desk.x + 18, y: 148, dir: 'down' });

const SPOTS = [
  { x: 292, y: 60, dir: 'up', bubble: 'coffee' },
  { x: 168, y: 38, dir: 'up', bubble: 'idea' },
  { x: 268, y: 136, dir: 'down', bubble: 'talk' },
  { x: 292, y: 136, dir: 'down', bubble: 'talk' },
];

function drawBackground(c) {
  // 바닥 (나무 마루)
  for (let y = 28; y < H; y += 8) {
    const off = (y / 8) % 2 ? 8 : 0;
    for (let x = -16; x < W; x += 16) {
      R(c, x + off, y, 16, 8, ((x + off) / 16 + y / 8) % 3 === 0 ? '#b98f5f' : '#c49a68');
      R(c, x + off, y + 7, 16, 1, '#9e7748');
      R(c, x + off + 15, y, 1, 7, '#a98252');
    }
  }
  // 벽
  R(c, 0, 0, W, 26, '#e7dcc4');
  R(c, 0, 20, W, 2, '#d5c7a8');
  R(c, 0, 24, W, 4, '#7d6142');
  R(c, 0, 28, W, 1, '#5e4630');
  // 창문
  for (const wx of [10, 56]) {
    R(c, wx, 3, 38, 17, '#6f5236');
    R(c, wx + 2, 5, 34, 13, '#9fd8f5');
    R(c, wx + 2, 13, 34, 5, '#bfe6fa');
    R(c, wx + 18, 5, 2, 13, '#6f5236');
    R(c, wx + 6, 7, 6, 2, '#ffffff');
    R(c, wx + 8, 6, 3, 1, '#ffffff');
  }
  // 시계
  R(c, 111, 5, 10, 10, '#3a3a3a');
  R(c, 112, 6, 8, 8, '#fdfdfd');
  R(c, 115, 7, 1, 4, '#222');
  R(c, 116, 10, 2, 1, '#c0392b');
  // 화이트보드
  R(c, 140, 3, 56, 19, '#8d939e');
  R(c, 142, 5, 52, 15, '#fafbfc');
  R(c, 145, 8, 18, 1, '#4f7cff');
  R(c, 145, 11, 26, 1, '#4f7cff');
  R(c, 145, 14, 12, 1, '#e05a7a');
  R(c, 176, 8, 14, 9, '#3fb37f');
  R(c, 177, 9, 12, 7, '#fafbfc');
  R(c, 179, 13, 2, 2, '#3fb37f'); R(c, 182, 11, 2, 4, '#3fb37f'); R(c, 185, 10, 2, 5, '#3fb37f');
  R(c, 146, 22, 44, 2, '#6b717c');
  // 책장
  R(c, 214, 2, 30, 24, '#6b4423');
  for (let i = 0; i < 2; i++) {
    const sy = 4 + i * 11;
    R(c, 216, sy, 26, 9, '#4a2e17');
    const books = ['#c0392b', '#2e86de', '#f1c40f', '#27ae60', '#8e44ad', '#e67e22', '#ecf0f1'];
    for (let b = 0; b < 7; b++) R(c, 217 + b * 3 + (b > 3 ? 1 : 0), sy + 2 + (b % 3 === 0 ? 1 : 0), 2, 7 - (b % 3 === 0 ? 1 : 0), books[(b + i * 3) % books.length]);
  }
  // 커피 카운터
  R(c, 272, 22, 46, 20, '#a86f3a');
  R(c, 272, 22, 46, 3, '#c88a4e');
  R(c, 272, 40, 46, 2, '#6b4423');
  R(c, 284, 8, 16, 17, '#2b2f3a');
  R(c, 286, 10, 12, 5, '#3d4458');
  R(c, 296, 11, 1, 1, '#ff4d4d');
  R(c, 289, 18, 6, 4, '#1a1c24');
  R(c, 290, 21, 4, 3, '#f5f5f5');
  R(c, 304, 19, 4, 4, '#f5f5f5'); R(c, 308, 20, 1, 2, '#f5f5f5');
  R(c, 276, 18, 5, 6, '#3fb37f'); R(c, 277, 16, 3, 2, '#2e8b57');
  // 정수기
  R(c, 306, 62, 10, 20, '#dfe6ee');
  R(c, 307, 52, 8, 10, '#8fd0ff');
  R(c, 308, 54, 2, 6, '#c8ebff');
  R(c, 309, 70, 4, 2, '#4f7cff');
  // 회의 공간 러그
  R(c, 248, 124, 68, 52, '#5d7f8f');
  R(c, 250, 126, 64, 48, '#6e93a3');
  for (let i = 0; i < 64; i += 8) R(c, 250 + i, 172, 4, 2, '#5d7f8f');
  // 화분
  drawPlant(c, 6, 186);
  drawPlant(c, 238, 190);
  drawPlant(c, 6, 40);
}

function drawPlant(c, x, y) {
  R(c, x, y - 7, 9, 7, '#b5562c');
  R(c, x, y - 7, 9, 2, '#cf6a3a');
  R(c, x + 1, y - 13, 3, 6, '#2e8b57');
  R(c, x + 4, y - 16, 3, 9, '#3fb37f');
  R(c, x + 6, y - 12, 3, 5, '#2e8b57');
  R(c, x - 1, y - 11, 2, 3, '#3fb37f');
}

const bg = document.createElement('canvas');
bg.width = W; bg.height = H;
drawBackground(bg.getContext('2d'));

function drawDesk(c, d, idx, on, t) {
  const top = '#a86f3a', front = '#7f5229', dark = '#5e3c1d';
  R(c, d.x, d.y, 48, 10, top);
  R(c, d.x, d.y, 48, 1, '#c88a4e');
  R(c, d.x, d.y + 10, 48, 4, front);
  R(c, d.x + 1, d.y + 14, 2, 3, dark);
  R(c, d.x + 45, d.y + 14, 2, 3, dark);
  if (d.row === 'A') {
    // 모니터 화면이 보이는 쪽
    const mx = d.x + 16, my = d.y - 8;
    R(c, mx, my, 16, 11, '#2b2f3a');
    R(c, mx + 1, my + 1, 14, 9, on ? '#1d3b5c' : '#33465c');
    if (on) {
      for (let i = 0; i < 4; i++) {
        const w = 3 + ((idx * 5 + i * 7 + Math.floor(t * 3)) % 9);
        R(c, mx + 2 + (i % 2) * 2, my + 2 + i * 2, w, 1, i % 3 === 0 ? '#ffd35c' : '#5ec8ff');
      }
    }
    R(c, mx + 7, my + 11, 2, 1, '#2b2f3a');
    R(c, d.x + 15, d.y + 6, 18, 3, '#d9dde6');
    R(c, d.x + 15, d.y + 6, 18, 1, '#eef1f6');
  } else {
    // 모니터 뒷면
    const mx = d.x + 28, my = d.y - 6;
    R(c, mx, my, 16, 10, '#5a6275');
    R(c, mx + 1, my + 1, 14, 8, '#6b7488');
    R(c, mx + 7, my + 10, 2, 2, '#4a5163');
    R(c, mx + 13, my + 7, 1, 1, on ? '#5fd38d' : '#8a91a3');
    R(c, d.x + 8, d.y + 2, 18, 3, '#d9dde6');
  }
  // 책상 소품
  const k = idx % 3;
  if (k === 0) { R(c, d.x + 4, d.y + 2, 4, 4, '#f5f5f5'); R(c, d.x + 8, d.y + 3, 1, 2, '#f5f5f5'); }
  if (k === 1) { R(c, d.x + 38, d.y + 2, 7, 5, '#fdfdfd'); R(c, d.x + 39, d.y + 3, 5, 1, '#9aa3b5'); R(c, d.x + 39, d.y + 5, 4, 1, '#9aa3b5'); }
  if (k === 2) { R(c, d.x + 4, d.y + 1, 5, 6, '#e0a800'); R(c, d.x + 5, d.y + 2, 3, 1, '#fff3c4'); }
}

function drawChairBack(c, s, row) {
  if (row === 'A') {
    R(c, s.x - 5, s.y - 3, 10, 6, '#3d4458');
    R(c, s.x - 5, s.y - 3, 10, 1, '#555e78');
    R(c, s.x - 1, s.y + 3, 2, 2, '#2a2f3d');
  } else {
    R(c, s.x - 5, s.y - 20, 10, 12, '#3d4458');
    R(c, s.x - 5, s.y - 20, 10, 1, '#555e78');
  }
}

function drawMeetingTable(c) {
  R(c, 256, 144, 52, 16, '#a86f3a');
  R(c, 256, 144, 52, 1, '#c88a4e');
  R(c, 256, 160, 52, 3, '#7f5229');
  R(c, 264, 148, 8, 6, '#fdfdfd');
  R(c, 288, 149, 5, 4, '#f5f5f5');
  for (const x of [262, 286]) {
    R(c, x, 166, 12, 7, '#3d4458');
    R(c, x, 166, 12, 1, '#555e78');
  }
}

function drawPerson(c, x, y, look, dir, frame, typing) {
  x = Math.round(x); y = Math.round(y);
  const shade = '#00000033';
  R(c, x - 4, y - 1, 9, 2, '#0000002e');
  // 다리
  const lu = frame === 1 ? 1 : 0, ru = frame === 3 ? 1 : 0;
  R(c, x - 3, y - 6, 2, 6 - lu, look.pants);
  R(c, x + 1, y - 6, 2, 6 - ru, look.pants);
  R(c, x - 3, y - 1 - lu, 2, 1, '#1a1a1a');
  R(c, x + 1, y - 1 - ru, 2, 1, '#1a1a1a');
  // 몸
  R(c, x - 4, y - 12, 8, 6, look.shirt);
  R(c, x - 4, y - 7, 8, 1, shade);
  const armY = typing ? (frame % 2 ? -10 : -9) : -11;
  R(c, x - 5, y + armY, 1, 4, look.shirt);
  R(c, x + 4, y + (typing ? (frame % 2 ? -9 : -10) : -11), 1, 4, look.shirt);
  R(c, x - 5, y + armY + 4, 1, 1, look.skin);
  R(c, x + 4, y + (typing ? (frame % 2 ? -9 : -10) : -11) + 4, 1, 1, look.skin);
  if (look.acc === 'tie' && dir !== 'up') R(c, x, y - 12, 1, 4, '#c0392b');
  // 머리
  R(c, x - 3, y - 18, 6, 6, look.skin);
  if (dir === 'up') {
    R(c, x - 3, y - 19, 6, 6, look.hair);
    if (look.style === 'long') R(c, x - 3, y - 13, 6, 2, look.hair);
  } else {
    R(c, x - 3, y - 19, 6, 2, look.hair);
    if (dir !== 'right') R(c, x - 3, y - 17, 1, 2, look.hair);
    if (dir !== 'left') R(c, x + 2, y - 17, 1, 2, look.hair);
    if (look.style === 'long') {
      if (dir !== 'right') R(c, x - 4, y - 17, 1, 5, look.hair);
      if (dir !== 'left') R(c, x + 3, y - 17, 1, 5, look.hair);
    }
    const eye = '#1f1f2b';
    if (dir === 'down') { R(c, x - 2, y - 15, 1, 1, eye); R(c, x + 1, y - 15, 1, 1, eye); }
    if (dir === 'left') R(c, x - 2, y - 15, 1, 1, eye);
    if (dir === 'right') R(c, x + 1, y - 15, 1, 1, eye);
    if (look.acc === 'glasses' && dir === 'down') { R(c, x - 3, y - 15, 2, 1, '#2b2f3a'); R(c, x + 1, y - 15, 2, 1, '#2b2f3a'); }
  }
  if (look.acc === 'helmet') { R(c, x - 4, y - 20, 8, 2, '#f4c430'); R(c, x - 3, y - 21, 6, 1, '#f4c430'); }
  if (look.acc === 'headset') {
    R(c, x - 3, y - 20, 6, 1, '#222');
    R(c, x - 4, y - 17, 1, 3, '#222');
    R(c, x + 3, y - 17, 1, 3, '#222');
  }
}

function drawBubble(c, x, y, type, t) {
  const bx = Math.round(x), by = Math.round(y);
  R(c, bx - 7, by - 10, 15, 10, '#2b2b2b');
  R(c, bx - 6, by - 9, 13, 8, '#ffffff');
  R(c, bx - 1, by, 3, 1, '#2b2b2b');
  R(c, bx, by - 1, 1, 1, '#ffffff');
  R(c, bx, by + 1, 1, 1, '#2b2b2b');
  if (type === 'typing') {
    const n = Math.floor(t * 4) % 4;
    for (let i = 0; i < 3; i++) R(c, bx - 4 + i * 3, by - 6, 2, 2, i < n ? '#2b2b2b' : '#c9ccd4');
  } else if (type === 'coffee') {
    R(c, bx - 3, by - 6, 5, 4, '#8b5a2b');
    R(c, bx + 2, by - 5, 1, 2, '#8b5a2b');
    R(c, bx - 2, by - 8, 1, 1, '#b0b4bd');
    R(c, bx, by - 8, 1, 1, '#b0b4bd');
  } else if (type === 'check') {
    R(c, bx - 3, by - 5, 1, 1, '#2fa565'); R(c, bx - 2, by - 4, 1, 1, '#2fa565');
    R(c, bx - 1, by - 5, 1, 1, '#2fa565'); R(c, bx, by - 6, 1, 1, '#2fa565');
    R(c, bx + 1, by - 7, 1, 1, '#2fa565'); R(c, bx + 2, by - 8, 1, 1, '#2fa565');
  } else if (type === 'idea') {
    R(c, bx, by - 8, 1, 4, '#e0a800'); R(c, bx, by - 3, 1, 1, '#e0a800');
  } else if (type === 'work') {
    R(c, bx - 3, by - 8, 6, 5, '#5ec8ff'); R(c, bx - 2, by - 7, 2, 1, '#ffffff'); R(c, bx - 1, by - 3, 2, 1, '#2b2b2b');
  } else {
    R(c, bx - 4, by - 7, 8, 1, '#7a808f'); R(c, bx - 4, by - 5, 6, 1, '#7a808f'); R(c, bx - 4, by - 3, 7, 1, '#7a808f');
  }
}

/* ───────────── 직원 움직임 ───────────── */

const rand = (a, b) => a + Math.random() * (b - a);
const actors = AGENTS.map((a) => {
  const desk = DESKS[a.desk];
  const seat = seatOf(desk);
  return {
    agent: a, desk, seat,
    x: seat.x, y: seat.y, dir: seat.dir,
    path: [], target: null, walkT: 0,
    atSeat: true, wait: performance.now() + rand(2000, 9000),
    bubble: null, bubbleUntil: 0,
  };
});
const actorOf = (id) => actors.find((p) => p.agent.id === id);

function say(p, type, ms) {
  p.bubble = type;
  p.bubbleUntil = ms ? performance.now() + ms : Infinity;
}

function goTo(p, t) {
  const pts = [];
  if (Math.abs(p.y - CORR) > 0.5) pts.push({ x: p.x, y: CORR });
  if (Math.abs(p.x - t.x) > 0.5) pts.push({ x: t.x, y: CORR });
  pts.push({ x: t.x, y: t.y });
  p.path = pts;
  p.target = t;
  p.atSeat = false;
}

function pickDestination(p) {
  const options = [...SPOTS];
  for (const other of actors) {
    if (other === p) continue;
    options.push(other.desk.row === 'A'
      ? { x: other.seat.x + 13, y: other.seat.y + 2, dir: 'left', bubble: 'talk' }
      : { x: other.seat.x - 12, y: other.seat.y - 8, dir: 'right', bubble: 'talk' });
  }
  const free = options.filter((o) => !actors.some((q) => q !== p && q.target && q.target.x === o.x && q.target.y === o.y));
  return free[Math.floor(Math.random() * free.length)] || null;
}

function updateActor(p, dt, now) {
  const busy = busyTasks(p.agent.id).length > 0;
  if (p.bubbleUntil < now) p.bubble = null;

  if (p.path.length) {
    const pt = p.path[0];
    const dx = pt.x - p.x, dy = pt.y - p.y;
    const dist = Math.hypot(dx, dy);
    const step = 34 * dt;
    if (dist <= step) {
      p.x = pt.x; p.y = pt.y;
      p.path.shift();
      if (!p.path.length) {
        p.dir = p.target.dir;
        p.atSeat = p.target === p.seat;
        p.wait = now + (p.atSeat ? rand(6000, 16000) : rand(3500, 8000));
        if (p.target.bubble && !p.bubble) say(p, p.target.bubble, 2500);
        p.target = null;
      }
    } else {
      p.x += (dx / dist) * step;
      p.y += (dy / dist) * step;
      p.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
    }
    p.walkT += dt;
    return;
  }

  // 업무 중이거나 대화 중이면 자리로 돌아가 앉는다
  if ((busy || S.selected === p.agent.id) && !p.atSeat) { goTo(p, p.seat); return; }
  if (busy || S.selected === p.agent.id) {
    if (busy && !p.bubble && Math.random() < dt * 0.08) say(p, Math.random() < 0.5 ? 'work' : 'idea', 1800);
    return;
  }
  if (now < p.wait) return;
  if (p.atSeat) {
    const dest = Math.random() < 0.45 ? pickDestination(p) : null;
    if (dest) goTo(p, dest);
    else p.wait = now + rand(5000, 12000);
  } else {
    goTo(p, p.seat);
  }
}

/* ───────────── 렌더 루프 ───────────── */

const tagBox = $('#tags');
for (const p of actors) {
  const b = document.createElement('button');
  b.className = 'tag';
  b.type = 'button';
  b.textContent = p.agent.name;
  b.addEventListener('click', () => select(p.agent.id));
  tagBox.appendChild(b);
  p.tag = b;
}

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  const t = now / 1000;
  for (const p of actors) updateActor(p, dt, now);

  ctx.drawImage(bg, 0, 0);
  const items = [];
  DESKS.forEach((d, i) => {
    const owner = actors.find((p) => p.desk === d);
    const on = owner.atSeat && !owner.path.length && (busyTasks(owner.agent.id).length > 0 || S.selected === owner.agent.id);
    items.push({ z: d.y + 14, draw: () => drawDesk(ctx, d, i, on, t) });
    const s = owner.seat;
    if (d.row === 'A') items.push({ z: s.y + 0.5, draw: () => drawChairBack(ctx, s, 'A') });
    else items.push({ z: s.y - 20, draw: () => drawChairBack(ctx, s, 'B') });
  });
  items.push({ z: 160, draw: () => drawMeetingTable(ctx) });
  for (const p of actors) {
    const moving = p.path.length > 0;
    const working = !moving && p.atSeat && busyTasks(p.agent.id).length > 0;
    const f = moving ? Math.floor(p.walkT * 8) % 4 : working ? Math.floor(t * 6) % 2 : 0;
    items.push({ z: p.y, draw: () => drawPerson(ctx, p.x, p.y, p.agent.look, p.dir, f, working) });
  }
  items.sort((a, b) => a.z - b.z).forEach((it) => it.draw());

  // 말풍선과 선택 표시는 맨 위에
  for (const p of actors) {
    const pend = S.pendingReply[p.agent.id];
    const type = pend ? 'typing' : p.bubble;
    if (type) drawBubble(ctx, p.x, p.y - 23, type, t);
    if (S.selected === p.agent.id) {
      const ay = p.y - (type ? 40 : 28) + (Math.floor(t * 3) % 2);
      R(ctx, p.x - 3, ay, 7, 1, '#ffd35c');
      R(ctx, p.x - 2, ay + 1, 5, 1, '#ffd35c');
      R(ctx, p.x - 1, ay + 2, 3, 1, '#ffd35c');
      R(ctx, p.x, ay + 3, 1, 1, '#ffd35c');
    }
    p.tag.style.left = `${(p.x / W) * 100}%`;
    p.tag.style.top = `${((p.y + 1) / H) * 100}%`;
    p.tag.classList.toggle('busy', busyTasks(p.agent.id).length > 0);
    p.tag.classList.toggle('sel', S.selected === p.agent.id);
  }
  requestAnimationFrame(frame);
}

canvas.addEventListener('click', (e) => {
  const r = canvas.getBoundingClientRect();
  const x = ((e.clientX - r.left) / r.width) * W;
  const y = ((e.clientY - r.top) / r.height) * H;
  const hit = actors
    .filter((p) => Math.abs(p.x - x) <= 6 && y >= p.y - 21 && y <= p.y + 2)
    .sort((a, b) => b.y - a.y)[0];
  if (hit) select(hit.agent.id);
});

/* ───────────── 아바타 ───────────── */

const avatarCache = {};
function avatar(agent) {
  if (!avatarCache[agent.id]) {
    const c = document.createElement('canvas');
    c.width = 16; c.height = 24;
    const g = c.getContext('2d');
    drawPerson(g, 8, 23, agent.look, 'down', 0, false);
    avatarCache[agent.id] = c.toDataURL();
  }
  return avatarCache[agent.id];
}

/* ───────────── 패널 UI ───────────── */

const panel = $('#panel');

function select(id) {
  S.selected = id;
  S.tab = 'chat';
  renderPanel();
  if (id) loadChat(id);
}

function renderPanel() {
  if (!S.selected) {
    panel.innerHTML = `
      <h2>AI 직원 (${AGENTS.length}명)</h2>
      <ul class="roster" id="roster"></ul>
      <h2>오피스 소식</h2>
      <ul class="feed" id="feed"></ul>`;
    panel.querySelector('#roster').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-id]');
      if (b) select(b.dataset.id);
    });
    renderRoster();
    renderFeed();
    return;
  }
  const a = getAgent(S.selected);
  panel.innerHTML = `
    <button class="back" type="button" id="back">← 전체 보기</button>
    <div class="profile">
      <img class="avatar" src="${avatar(a)}" alt="">
      <div>
        <h3>${esc(a.name)}</h3>
        <div class="role">${esc(a.title)}</div>
        <p>${esc(a.intro)}</p>
      </div>
    </div>
    <div class="tabs" role="tablist">
      <button type="button" role="tab" data-tab="chat" aria-selected="${S.tab === 'chat'}">대화</button>
      <button type="button" role="tab" data-tab="tasks" aria-selected="${S.tab === 'tasks'}" id="taskTab"></button>
    </div>
    <div class="pane" id="pane"></div>`;
  $('#back').addEventListener('click', () => select(null));
  panel.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => {
    S.tab = b.dataset.tab;
    renderPanel();
  }));
  renderTaskTab();

  const pane = $('#pane');
  if (S.tab === 'chat') {
    pane.innerHTML = `
      <div class="chat" id="chat"></div>
      <form class="form" id="chatForm" autocomplete="off">
        <input name="text" maxlength="300" placeholder="${esc(a.name)}에게 메시지 보내기" aria-label="메시지">
        <button type="submit">보내기</button>
      </form>`;
    $('#chatForm').addEventListener('submit', onSend);
    renderChat();
    $('#chatForm input').focus({ preventScroll: true });
  } else {
    pane.innerHTML = `
      <form class="form" id="taskForm" autocomplete="off">
        <input name="title" maxlength="100" placeholder="예: A-123 금형 도면 검토" aria-label="업무 내용">
        <button type="submit">업무 지시</button>
      </form>
      <ul class="tasks" id="tasks"></ul>`;
    $('#taskForm').addEventListener('submit', onAddTask);
    renderTasks();
  }
}

function renderTaskTab() {
  const tab = $('#taskTab');
  if (!tab) return;
  const n = busyTasks(S.selected).length;
  tab.textContent = n ? `업무 (${n}건 진행 중)` : '업무';
}

function renderRoster() {
  const ul = $('#roster');
  if (!ul) return;
  ul.innerHTML = AGENTS.map((a) => {
    const n = busyTasks(a.id).length;
    return `<li><button type="button" data-id="${a.id}">
      <img class="avatar sm" src="${avatar(a)}" alt="">
      <span class="who"><b>${esc(a.name)}</b><span>${esc(a.title)}</span></span>
      <span class="chip ${n ? 'busy' : ''}">${n ? `업무 중 ${n}건` : '대기 중'}</span>
    </button></li>`;
  }).join('');
}

function feedText(m) {
  const a = getAgent(m.agentId);
  if (!a) return '';
  if (m.sender === 'user') return `<b>나 → ${esc(a.name)}</b> ${esc(m.body)}`;
  return `<b>${esc(a.name)}</b> ${esc(m.body)}`;
}

function renderFeed() {
  const ul = $('#feed');
  if (!ul) return;
  if (!S.feed.length) {
    ul.innerHTML = '<li><p class="empty">아직 소식이 없어요. 직원을 클릭해서 말을 걸어 보세요.</p></li>';
    return;
  }
  ul.innerHTML = S.feed.map((m) => {
    const a = getAgent(m.agentId);
    if (!a) return '';
    return `<li><img class="avatar sm" src="${avatar(a)}" alt=""><p>${feedText(m)}</p><time>${hhmm(m.createdAt)}</time></li>`;
  }).join('');
}

function renderChat() {
  const box = $('#chat');
  if (!box) return;
  const id = S.selected;
  const list = S.chats[id];
  const a = getAgent(id);
  let html;
  if (!list) html = '<p class="empty">대화를 불러오는 중…</p>';
  else if (!list.length) html = `<p class="empty">${esc(a.name)}에게 첫 메시지를 보내 보세요. 예: "안녕하세요", "견적 부탁해요"</p>`;
  else html = list.map((m) => `<div class="msg ${m.sender === 'user' ? 'user' : m.kind}">
      <div>${esc(m.body)}</div><time>${hhmm(m.createdAt)}</time></div>`).join('');
  if (S.pendingReply[id]) html += '<div class="msg typing"><div>입력 중…</div></div>';
  box.innerHTML = html;
  box.scrollTop = box.scrollHeight;
}

function renderTasks() {
  const ul = $('#tasks');
  if (!ul) return;
  const list = S.tasks.filter((t) => t.agentId === S.selected);
  if (!list.length) {
    ul.innerHTML = '<li><p class="empty">맡긴 업무가 없어요. 위 입력창에 업무를 적어 지시해 보세요.</p></li>';
    return;
  }
  ul.innerHTML = list.map((t) => `<li class="${t.status}" data-task="${t.id}">
      <div class="row"><b>${esc(t.title)}</b><span>${t.status === 'done' ? '완료' : '진행 중'}</span></div>
      <div class="bar"><i style="width:${Math.round(progressOf(t) * 100)}%"></i></div>
    </li>`).join('');
}

function refreshLists() {
  renderRoster();
  renderFeed();
  renderTaskTab();
  renderTasks();
}

async function loadChat(id) {
  try {
    const msgs = await S.store.messages(id);
    S.chats[id] = msgs;
  } catch {
    S.chats[id] = S.chats[id] || [];
  }
  if (S.selected === id) renderChat();
}

function pushFeed(...msgs) {
  S.feed = [...msgs.reverse(), ...S.feed].slice(0, 30);
}

async function onSend(e) {
  e.preventDefault();
  const input = e.target.elements.text;
  const text = input.value.trim();
  const id = S.selected;
  if (!text || S.pendingReply[id]) return;
  input.value = '';
  const now = new Date().toISOString();
  const temp = { id: `tmp${Date.now()}`, agentId: id, sender: 'user', kind: 'chat', body: text, createdAt: now };
  S.chats[id] = [...(S.chats[id] || []), temp];
  S.pendingReply[id] = true;
  renderChat();
  const started = Date.now();
  try {
    const [u, r] = await S.store.send(id, text);
    // 답장이 너무 빨리 오면 어색하니 잠깐 "입력 중"을 보여 준다
    await new Promise((res) => setTimeout(res, Math.max(0, 700 + text.length * 15 - (Date.now() - started))));
    S.chats[id] = [...S.chats[id].filter((m) => m !== temp), u, r];
    pushFeed(u, r);
    say(actorOf(id), 'talk', 2500);
  } catch {
    S.chats[id] = S.chats[id].filter((m) => m !== temp);
    S.chats[id].push({ id: `err${Date.now()}`, agentId: id, sender: 'agent', kind: 'chat', body: '앗, 메시지를 저장하지 못했어요. 잠시 후 다시 시도해 주세요.', createdAt: now });
  }
  S.pendingReply[id] = false;
  if (S.selected === id) renderChat();
  renderFeed();
}

async function onAddTask(e) {
  e.preventDefault();
  const input = e.target.elements.title;
  const button = e.target.querySelector('button');
  const title = input.value.trim();
  const id = S.selected;
  if (!title) return;
  button.disabled = true;
  try {
    const { task, message } = await S.store.addTask(id, title);
    input.value = '';
    S.tasks = [task, ...S.tasks];
    if (S.chats[id]) S.chats[id] = [...S.chats[id], message];
    pushFeed(message);
    say(actorOf(id), 'idea', 2000);
    refreshLists();
  } catch {
    alert('업무를 저장하지 못했어요. 잠시 후 다시 시도해 주세요.');
  }
  button.disabled = false;
  input.focus();
}

async function completeDueTasks() {
  for (const t of S.tasks) {
    if (t.status !== 'doing' || progressOf(t) < 1 || S.completing.has(t.id)) continue;
    S.completing.add(t.id);
    try {
      const r = await S.store.completeTask(t.id);
      if (r) {
        S.tasks = S.tasks.map((x) => (x.id === t.id ? r.task : x));
        if (S.chats[t.agentId]) S.chats[t.agentId] = [...S.chats[t.agentId], r.message];
        pushFeed(r.message);
        say(actorOf(t.agentId), 'check', 4000);
      } else {
        await syncState();
      }
    } catch {}
    S.completing.delete(t.id);
    refreshLists();
    if (S.selected === t.agentId && S.tab === 'chat') renderChat();
  }
}

function tickProgress() {
  document.querySelectorAll('[data-task]').forEach((li) => {
    const t = S.tasks.find((x) => String(x.id) === li.dataset.task);
    if (t) li.querySelector('.bar i').style.width = `${Math.round(progressOf(t) * 100)}%`;
  });
}

async function syncState() {
  const st = await S.store.state();
  S.tasks = st.tasks;
  S.feed = st.feed;
}

function setMode() {
  const b = $('#mode');
  if (S.store.mode === 'remote') {
    b.textContent = 'DB 연결됨';
    b.className = 'badge ok';
    b.title = 'Neon Postgres에 저장되고 모든 방문자가 같은 사무실을 봅니다.';
  } else {
    b.textContent = '브라우저 저장 모드';
    b.className = 'badge local';
    b.title = 'DB에 연결하지 못해 이 브라우저에만 저장됩니다.';
  }
}

function tickClock() {
  $('#clock').textContent = new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });
}

async function init() {
  tickClock();
  setInterval(tickClock, 10000);
  renderPanel();
  requestAnimationFrame(frame);
  try {
    S.store = remoteStore;
    await syncState();
  } catch {
    S.store = makeLocalStore();
    await syncState();
  }
  setMode();
  refreshLists();
  setInterval(() => { tickProgress(); completeDueTasks(); }, 1000);
  if (S.store.mode === 'remote') {
    setInterval(async () => {
      try { await syncState(); refreshLists(); } catch {}
    }, 20000);
  }
}

init();
