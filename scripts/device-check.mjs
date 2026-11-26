// Checks that Claude is told which device a prompt comes from (User-Agent → hook context).
// Usage (dev server running): node scripts/device-check.mjs <cwd>
import WebSocket from 'ws';

const cwd = process.argv[2] ?? process.cwd();
const base = 'http://127.0.0.1:9787';
const UA = {
  phone: 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36',
  pc: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0',
};
const ws = new WebSocket(`ws://127.0.0.1:9787/ws`);
await new Promise((r) => ws.on('open', r));
let sessionId;
for (const [name, ua] of Object.entries(UA)) {
  const done = new Promise((resolve) => {
    let reply = '';
    const on = (raw) => {
      const ev = JSON.parse(String(raw));
      if (ev.t === 'entry' && ev.entry.kind === 'assistant' && ev.entry.text) reply = ev.entry.text;
      if (ev.t === 'turn-done') { ws.off('message', on); resolve(reply); }
    };
    ws.on('message', on);
  });
  const r = await fetch(base + '/api/send', {
    method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': ua },
    body: JSON.stringify({ agent: 'claude', sessionId, cwd, mode: 'default', text: 'Sans outil, en une ligne : depuis quel appareil je t’écris ce message ?' }),
  }).then((x) => x.json());
  sessionId = r.sessionId;
  console.log(name, '->', await done);
}
console.log('session', sessionId);
ws.close();
