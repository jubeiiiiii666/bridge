// Deletes the conversations created by the e2e/ui test scripts (cwd ending in "e2e-proj").
import { listSessions, deleteSession } from '@anthropic-ai/claude-agent-sdk';
import { spawn } from 'node:child_process';
import readline from 'node:readline';

const isTest = (cwd) => /[\\/]e2e-proj$/i.test(cwd ?? '');
for (const s of await listSessions()) if (isTest(s.cwd)) { await deleteSession(s.sessionId); console.log('claude deleted', s.sessionId); }

const p = spawn(process.argv[2], ['app-server'], { stdio: ['pipe', 'pipe', 'ignore'] });
const rl = readline.createInterface({ input: p.stdout });
let id = 0; const pending = new Map();
rl.on('line', (l) => { const m = JSON.parse(l); if (m.id != null && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
const req = (method, params) => new Promise((r) => { const i = ++id; pending.set(i, r); p.stdin.write(JSON.stringify({ id: i, method, params }) + '\n'); });
await req('initialize', { clientInfo: { name: 'pocket_bridge_cleanup', title: null, version: '1' }, capabilities: null });
p.stdin.write('{"method":"initialized"}\n');
const list = await req('thread/list', { limit: 100 });
for (const t of list.result?.data ?? []) if (isTest(t.cwd)) { const r = await req('thread/delete', { threadId: t.id }); console.log('codex deleted', t.id, r.error?.message ?? 'ok'); }
p.kill();
