// End-to-end check against a running dev server: new conversation, live stream, approvals, history.
// Usage: node scripts/e2e.mjs <agent> <cwd> [prompt] [mode] [port]
import WebSocket from 'ws';

const [agent = 'claude', cwd = process.cwd(), prompt = 'Test Pocket Bridge : réponds uniquement « OK pocket » sans utiliser d’outil.', mode, port = '9787'] = process.argv.slice(2);
const base = `http://127.0.0.1:${port}`;
const post = (path, body) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
const counts = {};
const done = new Promise((resolve) => {
  ws.on('message', async (raw) => {
    const ev = JSON.parse(String(raw));
    counts[ev.t] = (counts[ev.t] ?? 0) + 1;
    if (ev.t === 'entry') console.log('entry', ev.entry.id.slice(0, 12), ev.entry.kind, JSON.stringify(ev.entry.text ?? `${ev.entry.tool?.title} ${ev.entry.tool?.status}`).slice(0, 90));
    if (ev.t === 'status') console.log('status', ev.status);
    if (ev.t === 'request') {
      const r = ev.request;
      console.log('REQUEST', r.title, '|', (r.detail ?? '').slice(0, 80), '| choices:', r.choices.map((c) => c.id).join(','));
      console.log('answer ->', await post('/api/answer', { agent, requestId: r.id, choice: r.choices[0].id }));
    }
    if (ev.t === 'request-resolved') console.log('request resolved');
    if (ev.t === 'turn-done') { console.log('turn-done', ev.summary, ev.error ? 'ERROR' : ''); resolve(); }
  });
});
await new Promise((r) => ws.on('open', r));
const body = await post('/api/send', { agent, cwd, text: prompt, mode: mode || (agent === 'claude' ? 'default' : 'read-only') });
console.log('send ->', body);
await Promise.race([done, new Promise((r) => setTimeout(r, 180000))]);
console.log('event counts', counts);
const hist = await (await fetch(`${base}/api/session?agent=${agent}&id=${body.sessionId}`)).json();
console.log('history', hist.entries.map((e) => `${e.kind}:${(e.text ?? `${e.tool?.title}/${e.tool?.status}`).slice(0, 40)}`));
ws.close();
