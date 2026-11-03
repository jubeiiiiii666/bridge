import { h, render } from 'preact';
import { useState, useEffect, useRef, useMemo, useLayoutEffect } from 'preact/hooks';
import htm from 'htm';
import { marked } from 'marked';
import DOMPurify from 'dompurify';

const html = htm.bind(h);
const EMBED = new URLSearchParams(location.search).has('embed');
const AGENTS = ['claude', 'codex'];
const LABEL = { claude: 'Claude', codex: 'Codex' };

// ---------------------------------------------------------------- icons (Lucide, ISC)
const P = {
  back: '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
  gear: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  send: '<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor"/>',
  terminal: '<polyline points="4 17 10 11 4 5"/><line x1="12" x2="20" y1="19" y2="19"/>',
  file: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  web: '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
  agent: '<path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/>',
  todo: '<path d="M11 6h10"/><path d="M11 12h10"/><path d="M11 18h10"/><path d="m3 6 1.5 1.5L7 5"/><path d="m3 12 1.5 1.5L7 11"/><path d="m3 18 1.5 1.5L7 17"/>',
  plan: '<path d="M9 3 3 6v15l6-3 6 3 6-3V3l-6 3z"/><path d="M9 3v15"/><path d="M15 6v15"/>',
  mcp: '<path d="M12 22v-5"/><path d="M9 8V2"/><path d="M15 8V2"/><path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z"/>',
  tool: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  right: '<path d="m9 18 6-6-6-6"/>',
  image: '<rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.09-3.09a2 2 0 0 0-2.82 0L6 21"/>',
  monitor: '<rect width="20" height="14" x="2" y="3" rx="2"/><path d="M8 21h8"/><path d="M12 17v4"/>',
  copy: '<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  refresh: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  folder: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
  spark: '<path d="M9.94 14.06 8.5 18.5l-1.44-4.44L2.5 12.5l4.56-1.44L8.5 6.5l1.44 4.56 4.56 1.44z"/><path d="M18 3v4"/><path d="M16 5h4"/>',
  alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>',
  more: '<circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/>',
  loader: '<path d="M21 12a9 9 0 1 1-6.219-8.56"/>',
  arrowDown: '<path d="M12 5v14"/><path d="m19 12-7 7-7-7"/>',
  offline: '<path d="M12 20h.01"/><path d="M8.5 16.43a5 5 0 0 1 7 0"/><path d="M2 2l20 20"/><path d="M5 12.86a10 10 0 0 1 5.17-2.69"/><path d="M19 12.86a10 10 0 0 0-2.01-1.52"/><path d="M2 8.82a15 15 0 0 1 4.18-2.64"/><path d="M22 8.82a15 15 0 0 0-11.29-3.76"/>',
  sliders: '<path d="M20 7h-9"/><path d="M14 17H5"/><circle cx="17" cy="17" r="3"/><circle cx="7" cy="7" r="3"/>',
  cpu: '<rect width="16" height="16" x="4" y="4" rx="2"/><rect width="6" height="6" x="9" y="9" rx="1"/><path d="M15 2v2"/><path d="M15 20v2"/><path d="M2 15h2"/><path d="M2 9h2"/><path d="M20 15h2"/><path d="M20 9h2"/><path d="M9 2v2"/><path d="M9 20v2"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>',
  chat: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>',
  mic: '<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/>',
  voice: '<path d="M2 10v3"/><path d="M6 6v11"/><path d="M10 3v18"/><path d="M14 8v7"/><path d="M18 5v13"/><path d="M22 10v3"/>',
  speaker: '<path d="M11 4.7a.7.7 0 0 0-1.2-.5L6.4 7.6A1.4 1.4 0 0 1 5.4 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.4a1.4 1.4 0 0 1 1 .4l3.4 3.4a.7.7 0 0 0 1.2-.5z"/><path d="M16 9a5 5 0 0 1 0 6"/><path d="M19.4 18.4a9 9 0 0 0 0-12.8"/>',
};
const Icon = ({ n, cls = '' }) => html`<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true" dangerouslySetInnerHTML=${{ __html: P[n] ?? P.tool }}></svg>`;
const Mark = ({ agent, big }) => html`<span class="agent-mark ${agent} ${big ? 'big' : ''}" aria-hidden="true">${agent === 'claude' ? 'C' : 'X'}</span>`;

// ---------------------------------------------------------------- store
const prefs = loadPrefs();
function loadPrefs() {
  try { return { theme: 'auto', agent: 'claude', model: {}, mode: {}, ...JSON.parse(localStorage.getItem('pb.prefs') || '{}') }; }
  catch { return { theme: 'auto', agent: 'claude', model: {}, mode: {} }; }
}
function savePrefs() { try { localStorage.setItem('pb.prefs', JSON.stringify(prefs)); } catch { /* private mode */ } }

const S = {
  paired: null, // null = checking
  pairInvalid: new URLSearchParams(location.search).get('pair') === 'invalid',
  conn: 'connecting',
  info: null,
  agent: prefs.agent,
  sessions: { claude: null, codex: null },
  statuses: {},
  requests: {},
  since: {},
  live: {}, // key -> entries received over the socket (merged into history on open)
  route: parseRoute(),
  chat: null, // { key, agent, id, entries, loading, error, live }
  toast: null,
  sheet: null,
  installPrompt: null,
  voice: null, // hands-free mode state
};
const subs = new Set();
function set(patch) { Object.assign(S, typeof patch === 'function' ? patch(S) : patch); subs.forEach((f) => f()); }
function useS() {
  const [, force] = useState(0);
  useEffect(() => { const f = () => force((x) => x + 1); subs.add(f); return () => subs.delete(f); }, []);
  return S;
}
const keyOf = (agent, id) => `${agent}:${id}`;

function toast(text, err = false, action) {
  set({ toast: { text, err, action, at: Date.now() } });
  const at = S.toast.at;
  setTimeout(() => { if (S.toast?.at === at) set({ toast: null }); }, err ? 5000 : 3200);
}

// ---------------------------------------------------------------- routing
function parseRoute() {
  const [p, q] = location.hash.replace(/^#\/?/, '').split('?');
  const [agent, id] = p.split('/');
  if (AGENTS.includes(agent) && id === 'new') return { view: 'new', agent, cwd: new URLSearchParams(q).get('cwd') || '' };
  if (AGENTS.includes(agent) && id) return { view: 'chat', agent, id: decodeURIComponent(id) };
  return { view: 'home' };
}
function go(hash, replace = false) {
  if (replace) history.replaceState(null, '', hash); else history.pushState(null, '', hash);
  onRoute();
}
function onRoute() {
  const route = parseRoute();
  const patch = { route };
  if (route.view !== 'home') { patch.agent = route.agent; prefs.agent = route.agent; savePrefs(); }
  set(patch);
  if (route.view === 'chat') openChat(route.agent, route.id);
  else { set({ chat: null }); watch(null); if (voice.ctx) voice.stop(); }
}
addEventListener('popstate', onRoute);
addEventListener('hashchange', onRoute);

// ---------------------------------------------------------------- api
async function api(path, body) {
  const r = await fetch(path, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : { cache: 'no-store' });
  if (r.status === 401) { set({ paired: false }); throw new Error('Téléphone non appairé'); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Erreur ${r.status}`);
  return j;
}

async function loadState() {
  const info = await api('/api/state');
  const requests = {};
  for (const r of info.pending) requests[r.id] = r;
  set({ paired: true, info, statuses: info.statuses, requests });
}

const sessionsTimers = {};
async function loadSessions(agent) {
  try {
    const list = await api(`/api/sessions?agent=${agent}`);
    set((s) => ({ sessions: { ...s.sessions, [agent]: list } }));
  } catch (e) {
    if (S.paired) set((s) => ({ sessions: { ...s.sessions, [agent]: s.sessions[agent] ?? [] } }));
  }
}
function refreshSessionsSoon(agent) {
  clearTimeout(sessionsTimers[agent]);
  sessionsTimers[agent] = setTimeout(() => loadSessions(agent), 400);
}

async function openChat(agent, id, keepScroll = false) {
  const key = keyOf(agent, id);
  if (!keepScroll || S.chat?.key !== key) set({ chat: { key, agent, id, entries: S.chat?.key === key ? S.chat.entries : [], loading: true } });
  watch(agent, id);
  try {
    const r = await api(`/api/session?agent=${agent}&id=${encodeURIComponent(id)}`);
    if (S.chat?.key !== key) return;
    const entries = mergeEntries(r.entries, S.live[key] ?? []);
    const requests = { ...S.requests };
    for (const p of r.pending) requests[p.id] = p;
    if (!S.sessions[agent]?.some((x) => x.id === id)) refreshSessionsSoon(agent);
    set({ chat: { key, agent, id, entries, loading: false, live: r.live }, requests, statuses: { ...S.statuses, ...(r.status !== 'idle' ? { [key]: r.status } : {}) } });
  } catch (e) {
    if (S.chat?.key === key) set({ chat: { ...S.chat, loading: false, error: e.message } });
  }
}

function mergeEntries(history, live) {
  const out = [...history];
  const index = new Map(out.map((e, i) => [e.id, i]));
  for (const e of live) {
    if (index.has(e.id)) out[index.get(e.id)] = { ...out[index.get(e.id)], ...e };
    else { index.set(e.id, out.length); out.push(e); }
  }
  return out;
}

function upsert(list, entry) {
  const i = list.findIndex((e) => e.id === entry.id);
  if (i === -1) return [...list, entry];
  const next = list.slice();
  next[i] = entry;
  return next;
}
function appendDelta(list, id, field, text) {
  const i = list.findIndex((e) => e.id === id);
  if (i === -1) return [...list, { id, kind: 'assistant', text }];
  const next = list.slice();
  const e = { ...next[i] };
  if (field === 'output') e.tool = { ...e.tool, output: (e.tool?.output ?? '') + text };
  else e.text = (e.text ?? '') + text;
  next[i] = e;
  return next;
}

// ---------------------------------------------------------------- live socket
let ws;
let wsTimer;
let backoff = 1000;
let pingTimer;
function connect() {
  clearTimeout(wsTimer);
  try { ws?.close(); } catch { /* ignore */ }
  set({ conn: S.conn === 'online' ? 'online' : 'connecting' });
  const sock = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
  ws = sock;
  sock.onopen = async () => {
    backoff = 1000;
    set({ conn: 'online' });
    sendWs({ t: 'visibility', visible: document.visibilityState === 'visible' });
    // Catch up on anything missed while disconnected.
    loadState().catch(() => undefined);
    loadSessions(S.agent);
    if (S.chat) openChat(S.chat.agent, S.chat.id, true);
    clearInterval(pingTimer);
    pingTimer = setInterval(() => sendWs({ t: 'ping' }), 25000);
  };
  sock.onmessage = (e) => onEvent(JSON.parse(e.data));
  sock.onclose = (e) => {
    if (ws !== sock) return;
    clearInterval(pingTimer);
    set({ conn: 'offline' });
    if (e.code === 4001) { set({ paired: false }); return; }
    wsTimer = setTimeout(connect, backoff);
    backoff = Math.min(backoff * 1.7, 15000);
  };
}
function sendWs(m) { if (ws?.readyState === 1) ws.send(JSON.stringify(m)); }
function watch(agent, id) { sendWs({ t: 'watch', agent, sessionId: id }); }

document.addEventListener('visibilitychange', () => {
  const visible = document.visibilityState === 'visible';
  sendWs({ t: 'visibility', visible });
  if (visible && S.paired) {
    if (ws?.readyState !== 1) connect();
    else { loadSessions(S.agent); if (S.chat) openChat(S.chat.agent, S.chat.id, true); }
  }
});

function onEvent(ev) {
  if (ev.t === 'pong') return;
  if (ev.t === 'sessions-changed') return refreshSessionsSoon(ev.agent);
  if (ev.t === 'request') { set((s) => ({ requests: { ...s.requests, [ev.request.id]: ev.request } })); return voice.onRequest(ev.request); }
  if (ev.t === 'request-resolved') { set((s) => { const r = { ...s.requests }; delete r[ev.id]; return { requests: r }; }); return voice.onResolved(); }
  const key = keyOf(ev.agent, ev.sessionId);
  if (ev.t === 'status') {
    return set((s) => {
      const statuses = { ...s.statuses };
      const since = { ...s.since };
      if (ev.status === 'idle') { delete statuses[key]; delete since[key]; } else { statuses[key] = ev.status; since[key] ??= Date.now(); }
      return { statuses, since };
    });
  }
  if (ev.t === 'entry' || ev.t === 'delta') {
    const apply = (list) => (ev.t === 'entry' ? upsert(list, ev.entry) : appendDelta(list, ev.id, ev.field, ev.text));
    return set((s) => ({
      live: { ...s.live, [key]: apply(s.live[key] ?? []).slice(-300) },
      chat: s.chat?.key === key ? { ...s.chat, entries: apply(s.chat.entries), live: true } : s.chat,
    }));
  }
  if (ev.t === 'reload' && S.chat?.key === key) return openChat(ev.agent, ev.sessionId, true);
  if (ev.t === 'turn-done') {
    // Reconcile with the transcript (covers events sent before this page connected).
    if (S.chat?.key === key) openChat(ev.agent, ev.sessionId, true);
    voice.onTurnDone(ev);
  }
  if (ev.t === 'turn-done' && S.chat?.key !== key && document.visibilityState === 'visible') {
    const title = S.sessions[ev.agent]?.find((x) => x.id === ev.sessionId)?.title ?? 'une conversation';
    toast(`${LABEL[ev.agent]} a terminé « ${title.slice(0, 40)} »`, ev.error, { label: 'Voir', run: () => go(`#/${ev.agent}/${ev.sessionId}`) });
  }
}

navigator.serviceWorker?.addEventListener('message', (e) => { if (e.data?.t === 'navigate') go(new URL(e.data.url, location.href).hash || '#/'); });
addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); set({ installPrompt: e }); });

// ---------------------------------------------------------------- helpers
const base = (p) => {
  if (!p) return '—';
  const parts = p.replace(/[\\/]+$/, '').split(/[\\/]/);
  return parts.length <= 1 ? p.toUpperCase() : parts.pop();
};
const normPath = (p) => (p || '').replace(/[\\/]+$/, '').toLowerCase();
function ago(ts) {
  const d = (Date.now() - ts) / 1000;
  if (d < 60) return 'à l’instant';
  if (d < 3600) return `il y a ${Math.floor(d / 60)} min`;
  if (d < 86400) return `il y a ${Math.floor(d / 3600)} h`;
  if (d < 172800) return 'hier';
  return new Date(ts).toLocaleDateString('fr-CA', { day: 'numeric', month: 'short' });
}
function dayGroup(ts) {
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const t = start.getTime();
  if (ts >= t) return 'Aujourd’hui';
  if (ts >= t - 86400000) return 'Hier';
  if (ts >= t - 6 * 86400000) return 'Cette semaine';
  if (ts >= t - 30 * 86400000) return 'Ce mois-ci';
  return 'Plus ancien';
}
const elapsed = (since) => {
  const s = Math.max(0, Math.floor((Date.now() - since) / 1000));
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')}`;
};
function useTick(ms, on = true) {
  const [, f] = useState(0);
  useEffect(() => { if (!on) return; const t = setInterval(() => f((x) => x + 1), ms); return () => clearInterval(t); }, [ms, on]);
}
async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast('Copié'); } catch {
    const ta = document.createElement('textarea'); ta.value = text; document.body.append(ta); ta.select(); document.execCommand('copy'); ta.remove(); toast('Copié');
  }
}
function agentCounts(agent) {
  let running = 0; let waiting = 0;
  for (const [k, v] of Object.entries(S.statuses)) if (k.startsWith(agent + ':')) v === 'waiting' ? waiting++ : running++;
  for (const r of Object.values(S.requests)) if (r.agent === agent && S.statuses[keyOf(agent, r.sessionId)] !== 'waiting') waiting++;
  return { running, waiting };
}

DOMPurify.addHook('afterSanitizeAttributes', (node) => { if (node.tagName === 'A') { node.setAttribute('target', '_blank'); node.setAttribute('rel', 'noopener'); } });
marked.setOptions({ gfm: true, breaks: true });
const Markdown = ({ text, cls = '' }) => {
  const __html = useMemo(() => DOMPurify.sanitize(marked.parse(text || '')), [text]);
  return html`<div class="md ${cls}" dangerouslySetInnerHTML=${{ __html }}></div>`;
};

function Diff({ text }) {
  const lines = (text || '').split('\n').slice(0, 1500);
  return html`<div class="diff">${lines.map((l) => {
    const c = l.startsWith('+') && !l.startsWith('+++') ? 'a' : l.startsWith('-') && !l.startsWith('---') ? 'd' : l.startsWith('#') || l.startsWith('@@') ? 'h' : 'c';
    return html`<div class=${c}>${l || ' '}</div>`;
  })}</div>`;
}

// ---------------------------------------------------------------- app
function App() {
  const s = useS();
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = prefs.theme === 'auto' ? '' : prefs.theme;
  }, [prefs.theme]);

  if (s.paired === false) return html`<${Gate} />`;
  if (s.paired === null) return html`<div class="gate"><${Icon} n="loader" cls="lg spin" /></div>`;

  const hasChat = s.route.view !== 'home';
  return html`
    <div class="shell ${hasChat ? 'has-chat' : ''}" data-agent=${s.agent}>
      <div class="pane-list"><${Home} /></div>
      <div class="pane-chat" data-agent=${hasChat ? s.route.agent : s.agent}>
        ${s.route.view === 'chat' ? html`<${Chat} />` : s.route.view === 'new' ? html`<${NewChat} />` : html`
          <div class="pane-empty"><${Icon} n="chat" cls="lg" /><div>Choisis une conversation ou crée-en une nouvelle</div></div>`}
      </div>
    </div>
    ${s.voice && html`<${VoiceOverlay} />`}
    ${s.sheet && html`<${Sheet} />`}
    ${s.toast && html`<div class="toast ${s.toast.err ? 'err' : ''}" role="status" onClick=${() => { s.toast.action?.run(); set({ toast: null }); }}>
      ${s.toast.text}${s.toast.action ? html` · <b>${s.toast.action.label}</b>` : ''}</div>`}
  `;
}

function Gate() {
  return html`<div class="gate">
    <img src="/icons/icon-192.png" alt="" />
    <h2>Connecte ce téléphone</h2>
    ${S.pairInvalid ? html`<p class="err">Ce QR code n’est plus valide.</p>` : html`<p style="color:var(--muted)">Ce téléphone n’est pas encore appairé à ton PC.</p>`}
    <ol>
      <li>Sur le PC, dans VS Code : clique <b>📱 Pocket</b> dans la barre d’état (en bas à droite)</li>
      <li>Scanne le QR code <b>« Appairer »</b> avec l’appareil photo</li>
      <li>L’app s’ouvre, connectée — c’est tout</li>
    </ol>
  </div>`;
}

// ---------------------------------------------------------------- home (sessions)
function Home() {
  const s = useS();
  const [q, setQ] = useState('');
  const [proj, setProj] = useState('');
  const agent = s.agent;
  const info = s.info?.agents.find((a) => a.id === agent);
  const list = s.sessions[agent];
  useEffect(() => { if (!s.sessions[agent]) loadSessions(agent); }, [agent]);
  useEffect(() => setProj(''), [agent]);
  useTick(60000);

  const projects = useMemo(() => {
    const m = new Map();
    for (const x of list ?? []) { const k = normPath(x.cwd); if (!m.has(k)) m.set(k, { path: x.cwd, n: 0 }); m.get(k).n++; }
    return [...m.values()].sort((a, b) => b.n - a.n).slice(0, 12);
  }, [list]);

  const shown = (list ?? []).filter((x) => (!proj || normPath(x.cwd) === proj) && (!q || x.title.toLowerCase().includes(q.toLowerCase())));
  const groups = [];
  for (const x of shown) {
    const g = dayGroup(x.updatedAt);
    if (groups.at(-1)?.label !== g) groups.push({ label: g, items: [] });
    groups.at(-1).items.push(x);
  }
  const pending = Object.values(s.requests);
  const selected = s.route.view === 'chat' ? s.route.id : null;

  return html`
    <header class="topbar">
      <img class="logo" src="/icons/icon-192.png" alt="" />
      <div class="title">
        <h1>Pocket Bridge</h1>
        <div class="sub"><span class="dot ${s.conn === 'online' ? '' : s.conn === 'offline' ? 'off' : 'warn'}"></span>${s.info?.host ?? 'PC'} · ${s.conn === 'online' ? 'connecté' : s.conn === 'offline' ? 'hors ligne' : 'connexion…'}</div>
      </div>
      <button class="icon-btn" aria-label="Actualiser" onClick=${() => { loadSessions(agent); loadState().catch(() => undefined); }}><${Icon} n="refresh" /></button>
      <button class="icon-btn" aria-label="Réglages" onClick=${() => set({ sheet: { type: 'settings' } })}><${Icon} n="gear" /></button>
    </header>

    ${s.conn === 'offline' && html`<button class="banner conn" onClick=${connect}><${Icon} n="offline" /><span>PC injoignable. Vérifie le Wi-Fi et que VS Code est ouvert. <u>Réessayer</u></span></button>`}
    ${pending.length > 0 && html`<button class="banner" onClick=${() => go(`#/${pending[0].agent}/${pending[0].sessionId}`)}>
      <${Icon} n="shield" /><span class="spacer">${pending.length === 1 ? `${LABEL[pending[0].agent]} attend ta validation` : `${pending.length} demandes attendent ta validation`}</span><${Icon} n="right" /></button>`}

    <nav class="agent-switch" role="tablist">
      ${AGENTS.map((a) => {
        const c = agentCounts(a);
        return html`<button role="tab" aria-selected=${a === agent} class=${a === agent ? 'on' : ''} onClick=${() => { prefs.agent = a; savePrefs(); set({ agent: a }); }}>
          <${Mark} agent=${a} />${LABEL[a]}
          ${c.waiting ? html`<span class="count wait">${c.waiting}</span>` : c.running ? html`<span class="count">${c.running}</span>` : ''}
        </button>`;
      })}
    </nav>

    ${info && !info.available ? html`<div class="info" style="margin:0 14px 10px"><b>${info.label} indisponible.</b> ${info.reason}</div>` : ''}

    <div class="searchbar"><${Icon} n="search" cls="sm" /><input type="search" placeholder="Rechercher une conversation" value=${q} onInput=${(e) => setQ(e.target.value)} /></div>
    ${projects.length > 1 && html`<div class="chips">
      <button class="chip ${!proj ? 'on' : ''}" onClick=${() => setProj('')}>Tous</button>
      ${projects.map((p) => html`<button class="chip ${proj === normPath(p.path) ? 'on' : ''}" onClick=${() => setProj(proj === normPath(p.path) ? '' : normPath(p.path))}><${Icon} n="folder" cls="sm" />${base(p.path)}</button>`)}
    </div>`}

    <div class="list">
      ${list === null ? [1, 2, 3, 4].map(() => html`<div class="skeleton"></div>`) : shown.length === 0 ? html`<div class="empty"><div class="big">💬</div>${q || proj ? 'Aucune conversation ne correspond.' : `Aucune conversation ${LABEL[agent]} pour l’instant.`}</div>` : groups.map((g) => html`
        <div class="group-label">${g.label}</div>
        ${g.items.map((x) => html`<${SessionRow} x=${x} agent=${agent} sel=${selected === x.id} />`)}
      `)}
    </div>
    <button class="fab" onClick=${() => set({ sheet: { type: 'project', agent } })}><${Icon} n="plus" />Nouvelle conversation</button>
  `;
}

function SessionRow({ x, agent, sel }) {
  const key = keyOf(agent, x.id);
  const st = S.statuses[key] ?? 'idle';
  const waiting = st === 'waiting' || Object.values(S.requests).some((r) => r.sessionId === x.id);
  return html`<button class="session ${sel ? 'sel' : ''}" onClick=${() => go(`#/${agent}/${encodeURIComponent(x.id)}`)}>
    <div class="t">${x.title}</div>
    <div class="m">
      <span class="proj"><${Icon} n="folder" cls="sm" /><span>${base(x.cwd)}</span></span>
      <span>· ${ago(x.updatedAt)}</span>
      <span class="spacer"></span>
      ${waiting ? html`<span class="pill waiting"><span class="pulse"></span>À valider</span>` : st === 'running' ? html`<span class="pill running"><span class="pulse"></span>En cours</span>` : ''}
    </div>
  </button>`;
}

// ---------------------------------------------------------------- chat
function ChatHeader({ agent, title, cwd, status, sessionId }) {
  const [menu, setMenu] = useState(false);
  return html`<header class="topbar">
    <button class="icon-btn" aria-label="Retour" onClick=${() => go('#/')}><${Icon} n="back" /></button>
    <${Mark} agent=${agent} big />
    <div class="title">
      <h1 style="font-size:16px">${title}</h1>
      <div class="sub"><${Icon} n="folder" cls="sm" />${base(cwd)}${status === 'running' ? html` · <span style="color:var(--run)">en cours</span>` : status === 'waiting' ? html` · <span style="color:var(--wait)">attend ta validation</span>` : ''}</div>
    </div>
    ${sessionId && html`<button class="icon-btn" aria-label="Plus d’actions" onClick=${() => setMenu(!menu)}><${Icon} n="more" /></button>`}
    ${menu && html`<div class="scrim" style="background:transparent" onClick=${() => setMenu(false)}></div>
      <div class="menu" role="menu">
        <button class="row" onClick=${async () => { setMenu(false); try { await api('/api/open-in-vscode', { agent, sessionId }); toast(`Ouvert dans le panneau ${LABEL[agent]} de VS Code`); } catch (e) { toast(e.message, true); } }}>
          <${Icon} n="monitor" /><div class="rt"><b>Ouvrir dans VS Code</b><small>Affiche cette conversation dans le panneau ${LABEL[agent]} du PC</small></div></button>
        <button class="row" onClick=${() => { setMenu(false); openChat(agent, sessionId, true); }}><${Icon} n="refresh" /><div class="rt"><b>Recharger</b></div></button>
        <button class="row" onClick=${() => { setMenu(false); copy(sessionId); }}><${Icon} n="copy" /><div class="rt"><b>Copier l’identifiant</b><small>${sessionId}</small></div></button>
      </div>`}
  </header>`;
}

function Chat() {
  const s = useS();
  const chat = s.chat;
  const ref = useRef();
  const atBottom = useRef(true);
  const [showJump, setShowJump] = useState(false);
  const key = chat?.key;
  const status = key ? s.statuses[key] ?? 'idle' : 'idle';
  const session = chat && s.sessions[chat.agent]?.find((x) => x.id === chat.id);
  const requests = Object.values(s.requests).filter((r) => r.sessionId === chat?.id);

  useLayoutEffect(() => { atBottom.current = true; }, [key]);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && atBottom.current) el.scrollTop = el.scrollHeight;
  });
  if (!chat) return null;
  const onScroll = () => {
    const el = ref.current;
    const b = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    atBottom.current = b;
    if (showJump === b) setShowJump(!b);
  };

  return html`
    <${ChatHeader} agent=${chat.agent} title=${session?.title ?? 'Conversation'} cwd=${session?.cwd} status=${status} sessionId=${chat.id} />
    <div class="chat-body">
      <div class="messages" ref=${ref} onScroll=${onScroll}>
        <div class="messages-inner">
          ${chat.loading && chat.entries.length === 0 ? html`<div class="working"><${Icon} n="loader" cls="spin" />Chargement de la conversation…</div>` : ''}
          ${chat.error ? html`<div class="error-card"><${Icon} n="alert" />${chat.error}</div>` : ''}
          <${Entries} entries=${chat.entries} running=${status !== 'idle'} agent=${chat.agent} />
          ${status === 'running' && html`<${Working} agent=${chat.agent} since=${s.since[key]} />`}
        </div>
      </div>
      ${showJump && html`<button class="jump" aria-label="Aller en bas" onClick=${() => { const el = ref.current; el.scrollTop = el.scrollHeight; }}><${Icon} n="arrowDown" /></button>`}
    </div>
    ${requests.map((r) => html`<${Request} key=${r.id} r=${r} />`)}
    <${Composer} agent=${chat.agent} sessionId=${chat.id} status=${status} />
  `;
}

function Working({ agent, since }) {
  useTick(1000);
  return html`<div class="working"><span class="dots"><i></i><i></i><i></i></span>${LABEL[agent]} travaille${since ? ` · ${elapsed(since)}` : '…'}</div>`;
}

/** Collapses runs of tool calls so long agentic turns stay readable on a phone. */
function Entries({ entries, running, agent }) {
  const blocks = [];
  for (const e of entries) {
    const isTool = e.kind === 'tool' || e.kind === 'thinking';
    const last = blocks.at(-1);
    if (isTool && last?.type === 'tools') last.items.push(e);
    else if (isTool) blocks.push({ type: 'tools', items: [e], id: e.id });
    else blocks.push({ type: 'entry', e });
  }
  return blocks.map((b, i) => b.type === 'tools'
    ? html`<${ToolGroup} key=${b.id} items=${b.items} live=${running && i === blocks.length - 1} />`
    : html`<${EntryView} key=${b.e.id} e=${b.e} streaming=${running && i === blocks.length - 1} agent=${agent} />`);
}

function ToolGroup({ items, live }) {
  const [open, setOpen] = useState(null);
  const tools = items.filter((x) => x.kind === 'tool');
  const expanded = open ?? (live || items.length <= 3);
  if (expanded) {
    return html`<div>${items.length > 3 && html`<button class="tool-group-more" onClick=${() => setOpen(false)}>Masquer les ${tools.length} actions</button>`}
      ${items.map((e) => (e.kind === 'tool' ? html`<${ToolCard} key=${e.id} e=${e} />` : html`<${Thinking} key=${e.id} e=${e} />`))}</div>`;
  }
  const errors = tools.filter((t) => t.tool.status === 'error').length;
  const names = [...new Set(tools.map((t) => t.tool.title))].slice(0, 3).join(', ');
  return html`<div class="tool"><button onClick=${() => setOpen(true)}>
    <span class="ti"><${Icon} n="tool" cls="sm" /></span>
    <span class="tt"><b>${tools.length} action${tools.length > 1 ? 's' : ''}${errors ? ` · ${errors} en erreur` : ''}</b><code>${names}</code></span>
    <span class="st"><${Icon} n="down" cls="sm" /></span></button></div>`;
}

function ToolCard({ e }) {
  const t = e.tool;
  const [open, setOpen] = useState(false);
  const hasDetail = t.code || t.diff || t.output;
  return html`<div class="tool">
    <button onClick=${() => hasDetail && setOpen(!open)} aria-expanded=${open}>
      <span class="ti"><${Icon} n=${t.icon} cls="sm" /></span>
      <span class="tt"><b>${t.title}</b>${t.subtitle && html`<code>${t.subtitle}</code>`}</span>
      <span class="st ${t.status}">${t.status === 'running' ? html`<${Icon} n="loader" cls="sm spin" />` : t.status === 'ok' ? html`<${Icon} n="check" cls="sm" />` : html`<${Icon} n="x" cls="sm" />`}</span>
    </button>
    ${open && html`<div class="detail">
      ${t.diff ? html`<${Diff} text=${t.diff} />` : t.code && t.code !== t.subtitle ? html`<pre class="code">${t.code}</pre>` : ''}
      ${t.output && html`<div class="lbl">Résultat</div><pre class="out">${t.output}</pre>`}
    </div>`}
  </div>`;
}

function Thinking({ e }) {
  const [open, setOpen] = useState(false);
  if (!e.text) return null;
  return html`<div class="thinking"><button onClick=${() => setOpen(!open)}><${Icon} n="spark" cls="sm" />Réflexion<${Icon} n=${open ? 'down' : 'right'} cls="sm" /></button>
    ${open && html`<div class="body">${e.text}</div>`}</div>`;
}

function EntryView({ e, streaming }) {
  switch (e.kind) {
    case 'user':
      return html`<div class="msg-user"><div class="bubble">${e.text}</div></div>`;
    case 'assistant':
      if (!e.text) return null;
      return html`<div class="msg-assistant">
        <${Markdown} text=${e.text} cls=${streaming ? 'cursor' : ''} />
        ${!streaming && e.text.length > 140 && html`<div class="msg-actions"><button onClick=${() => copy(e.text)}><${Icon} n="copy" cls="sm" />Copier</button></div>`}
      </div>`;
    case 'notice':
      return html`<div class="notice">${e.text}</div>`;
    case 'error':
      return html`<div class="error-card"><${Icon} n="alert" /><span>${e.text}</span></div>`;
    default:
      return null;
  }
}

function Request({ r }) {
  const [busy, setBusy] = useState(false);
  const [answers, setAnswers] = useState({});
  const [other, setOther] = useState({});
  const send = async (choice) => {
    setBusy(true);
    const merged = {};
    for (const q of r.questions ?? []) {
      const picked = [...(answers[q.id] ?? [])];
      if (other[q.id]?.trim()) picked.push(other[q.id].trim());
      if (picked.length) merged[q.id] = picked;
    }
    try { await api('/api/answer', { agent: r.agent, requestId: r.id, choice, answers: merged }); }
    catch (e) { toast(e.message, true); setBusy(false); }
  };
  const toggle = (q, label) => setAnswers((a) => {
    const cur = a[q.id] ?? [];
    return { ...a, [q.id]: q.multiSelect ? (cur.includes(label) ? cur.filter((x) => x !== label) : [...cur, label]) : [label] };
  });
  return html`<div class="request" data-agent=${r.agent} role="alertdialog" aria-label=${r.title}>
    <div class="rh"><${Icon} n="shield" /><span>${r.title}</span></div>
    ${r.detail && (r.detailKind === 'diff' ? html`<div class="rd"><${Diff} text=${r.detail} /></div>`
      : r.detailKind === 'markdown' ? html`<div class="rd md"><${Markdown} text=${r.detail} /></div>`
      : html`<div class="rd"><pre class="code">${r.detail}</pre></div>`)}
    ${(r.questions ?? []).map((q) => html`<div class="q">
      ${q.header && html`<div class="qh">${q.header}</div>`}
      <div class="qq">${q.question}</div>
      ${q.options.map((o) => html`<button class="opt ${(answers[q.id] ?? []).includes(o.label) ? 'on' : ''}" onClick=${() => toggle(q, o.label)}>
        <span class="radio"></span><span><b>${o.label}</b>${o.description && html`<small>${o.description}</small>`}</span></button>`)}
      ${q.allowOther && html`<input placeholder="Autre réponse…" value=${other[q.id] ?? ''} onInput=${(e) => setOther({ ...other, [q.id]: e.target.value })} />`}
    </div>`)}
    <div class="ra">${r.choices.map((c) => html`<button class="btn ${c.style}" disabled=${busy} onClick=${() => send(c.id)}>${c.label}</button>`)}</div>
  </div>`;
}

// ---------------------------------------------------------------- composer
const drafts = (() => { try { return JSON.parse(sessionStorage.getItem('pb.drafts') || '{}'); } catch { return {}; } })();
function saveDraft(k, v) { drafts[k] = v; try { sessionStorage.setItem('pb.drafts', JSON.stringify(drafts)); } catch { /* ignore */ } }

function Composer({ agent, sessionId, status, cwd, placeholder }) {
  const s = useS();
  const draftKey = sessionId ? keyOf(agent, sessionId) : `${agent}:new`;
  const [text, setText] = useState(drafts[draftKey] ?? '');
  const [images, setImages] = useState([]);
  const [sending, setSending] = useState(false);
  const ta = useRef();
  const file = useRef();
  const info = s.info?.agents.find((a) => a.id === agent);
  const model = prefs.model[agent] ?? '';
  const mode = prefs.mode[agent] ?? info?.defaultMode;
  const modelLabel = info?.models.find((m) => m.id === model)?.label ?? (model || 'Par défaut');
  const modeLabel = info?.modes.find((m) => m.id === mode)?.label ?? mode;
  const busy = status !== 'idle';

  useEffect(() => { setText(drafts[draftKey] ?? ''); setImages([]); }, [draftKey]);
  useLayoutEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, innerHeight * 0.4) + 'px';
  }, [text]);

  const [dictating, setDictating] = useState(null); // stop() of the running recognition
  const dictBase = useRef('');
  useEffect(() => () => dictating?.(), [dictating]);

  const submit = async () => {
    const value = text.trim();
    if ((!value && !images.length) || sending) return;
    dictating?.(); setDictating(null);
    setSending(true);
    setText(''); saveDraft(draftKey, '');
    const imgs = images; setImages([]);
    try {
      await sendMessage({ agent, sessionId, cwd, text: value, images: imgs });
    } catch (e) {
      setText(value); setImages(imgs);
      toast(e.message, true);
    } finally { setSending(false); }
  };

  const toggleDictation = () => {
    if (dictating) { dictating(); setDictating(null); return; }
    dictBase.current = text ? text.replace(/\s*$/, ' ') : '';
    const stop = listen({
      continuous: true,
      onText: (t, final) => {
        const v = dictBase.current + t;
        setText(v);
        if (final) saveDraft(draftKey, v);
      },
      onEnd: () => setDictating(null),
      onError: (m) => toast(m, true),
    });
    setDictating(() => stop);
  };

  const onKey = (e) => {
    const desktop = matchMedia('(pointer: fine)').matches;
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey || (desktop && !e.shiftKey))) { e.preventDefault(); submit(); }
  };

  const addFiles = async (files) => {
    const out = [];
    for (const f of files) if (f.type.startsWith('image/')) out.push(await shrink(f));
    setImages((x) => [...x, ...out].slice(0, 6));
  };

  return html`<div class="composer" data-agent=${agent}><div class="composer-inner">
    <div class="opts">
      <button class="chip" onClick=${() => set({ sheet: { type: 'model', agent } })}><${Icon} n="cpu" cls="sm" />${modelLabel}<${Icon} n="down" cls="sm" /></button>
      <button class="chip" onClick=${() => set({ sheet: { type: 'mode', agent } })}><${Icon} n="sliders" cls="sm" />${modeLabel}<${Icon} n="down" cls="sm" /></button>
      ${SR && html`<button class="chip" onClick=${() => voice.start({ agent, sessionId, cwd })}><${Icon} n="voice" cls="sm" />Mode vocal</button>`}
    </div>
    ${images.length > 0 && html`<div class="thumbs">${images.map((img, i) => html`<div><img src=${img.url} alt="" /><button aria-label="Retirer" onClick=${() => setImages(images.filter((_, j) => j !== i))}><${Icon} n="x" cls="sm" /></button></div>`)}</div>`}
    <div class="box">
      <button class="icon-btn" aria-label="Joindre une image" onClick=${() => file.current.click()}><${Icon} n="image" /></button>
      <input ref=${file} type="file" accept="image/*" multiple hidden onChange=${(e) => { addFiles([...e.target.files]); e.target.value = ''; }} />
      <textarea ref=${ta} rows="1" value=${text} placeholder=${placeholder ?? (busy ? 'Ajouter une consigne…' : `Écrire à ${LABEL[agent]}…`)}
        onInput=${(e) => { setText(e.target.value); saveDraft(draftKey, e.target.value); }} onKeyDown=${onKey}
        onPaste=${(e) => { const f = [...(e.clipboardData?.files ?? [])]; if (f.length) { e.preventDefault(); addFiles(f); } }}></textarea>
      ${SR && html`<button class="icon-btn mic ${dictating ? 'on' : ''}" aria-label=${dictating ? 'Arrêter la dictée' : 'Dicter'} aria-pressed=${!!dictating} onClick=${toggleDictation}><${Icon} n="mic" /></button>`}
      ${busy && !text.trim() && !images.length
        ? html`<button class="send stop" aria-label="Arrêter" onClick=${async () => { try { await api('/api/interrupt', { agent, sessionId }); } catch (e) { toast(e.message, true); } }}><${Icon} n="stop" /></button>`
        : html`<button class="send" aria-label="Envoyer" disabled=${(!text.trim() && !images.length) || sending} onClick=${submit}>${sending ? html`<${Icon} n="loader" cls="spin" />` : html`<${Icon} n="send" />`}</button>`}
    </div>
  </div></div>`;
}

async function sendMessage({ agent, sessionId, cwd, text, images = [] }) {
  const info = S.info?.agents.find((a) => a.id === agent);
  const r = await api('/api/send', {
    agent, sessionId, cwd, text, images: images.map(({ mediaType, base64 }) => ({ mediaType, base64 })),
    model: prefs.model[agent] || undefined, mode: prefs.mode[agent] ?? info?.defaultMode,
  });
  if (!sessionId) go(`#/${agent}/${encodeURIComponent(r.sessionId)}`, true);
  return r.sessionId;
}

// ---------------------------------------------------------------- voice (Web Speech API, built into Chrome)
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const LANG = navigator.language?.startsWith('fr') ? navigator.language : 'fr-FR';
const MIC_ERR = {
  'not-allowed': 'Micro refusé : autorise-le pour ce site dans Chrome.',
  'service-not-allowed': 'Reconnaissance vocale indisponible (HTTPS requis).',
  network: 'Reconnaissance vocale : pas de connexion Internet.',
  'audio-capture': 'Aucun micro détecté.',
};
const joinText = (a, b) => [a.trim(), b.trim()].filter(Boolean).join(' ');

/**
 * Speech to text. Android Chrome duplicates results in `continuous` mode, so continuous
 * listening is done by chaining short single-utterance sessions instead.
 */
function listen({ continuous, onText, onEnd, onError }) {
  let stopped = false;
  let committed = '';
  let rec;
  const run = () => {
    rec = new SR();
    rec.lang = LANG;
    rec.interimResults = true;
    rec.continuous = false;
    let cur = '';
    rec.onresult = (e) => {
      const results = [...e.results];
      cur = results.map((r) => r[0].transcript).join('');
      onText(joinText(committed, cur), results.every((r) => r.isFinal));
    };
    rec.onerror = (e) => {
      if (e.error === 'no-speech' || e.error === 'aborted') return;
      stopped = true;
      onError?.(MIC_ERR[e.error] ?? `Micro : ${e.error}`);
    };
    rec.onend = () => {
      committed = joinText(committed, cur);
      if (continuous && !stopped) run(); else onEnd?.(committed);
    };
    try { rec.start(); } catch (e) { stopped = true; onError?.(e.message); }
  };
  run();
  return () => { stopped = true; try { rec.stop(); } catch { /* already stopped */ } };
}

/** Markdown answer -> something pleasant to hear (code is shown, not read). */
function speakable(md) {
  return (md || '')
    .replace(/```[\s\S]*?```/g, ' Le code est affiché à l’écran. ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s*#+\s*/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\|.*\|\s*$/gm, '')
    .replace(/[*_>~#|]/g, '')
    .replace(/https?:\/\/\S+/g, 'un lien')
    .replace(/\n{2,}/g, '. ')
    .replace(/\s+/g, ' ')
    .trim();
}

let ttsVoice;
function pickVoice() {
  const voices = speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith('fr'));
  ttsVoice = voices.find((v) => v.lang === LANG) ?? voices.find((v) => v.lang.startsWith('fr-FR')) ?? voices[0];
}
if ('speechSynthesis' in window) { pickVoice(); speechSynthesis.onvoiceschanged = pickVoice; }

/** Text to speech, split in sentences: Chrome silently stops utterances longer than ~15 s. */
function speak(text) {
  return new Promise((resolve) => {
    speechSynthesis.cancel();
    const parts = (text.match(/[^.!?…]+[.!?…]*\s*/g) ?? [text]).reduce((acc, s) => {
      if (acc.length && (acc.at(-1) + s).length < 220) acc[acc.length - 1] += s; else acc.push(s);
      return acc;
    }, []).filter((s) => s.trim());
    if (!parts.length) return resolve();
    parts.forEach((p, i) => {
      const u = new SpeechSynthesisUtterance(p);
      u.lang = ttsVoice?.lang ?? LANG;
      if (ttsVoice) u.voice = ttsVoice;
      u.rate = 1.05;
      if (i === parts.length - 1) { u.onend = () => resolve(); u.onerror = () => resolve(); }
      speechSynthesis.speak(u);
    });
  });
}

/** Hands-free conversation: listen -> send -> read the answer aloud -> listen again. */
const voice = {
  ctx: null,
  stopListen: null,
  gen: 0,
  key() { return this.ctx?.sessionId ? keyOf(this.ctx.agent, this.ctx.sessionId) : null; },
  phase(phase, extra = {}) { if (this.ctx) set({ voice: { ...S.voice, agent: this.ctx.agent, phase, ...extra } }); },
  start(ctx) {
    this.ctx = { ...ctx };
    set({ voice: { agent: ctx.agent, phase: 'idle', text: '' } });
    const st = this.key() ? S.statuses[this.key()] : null;
    if (st === 'running') this.phase('working');
    else this.listenTurn();
  },
  stop() {
    this.ctx = null;
    this.gen++;
    this.stopListen?.();
    speechSynthesis.cancel();
    set({ voice: null });
  },
  pending() { return this.ctx?.sessionId && Object.values(S.requests).find((r) => r.sessionId === this.ctx.sessionId); },
  listenTurn(misses = 0) {
    if (!this.ctx) return;
    const g = ++this.gen;
    const req = this.pending();
    if (req) return this.askRequest(req);
    this.phase('listening', { text: '' });
    this.stopListen = listen({
      continuous: false,
      onText: (t) => g === this.gen && this.phase('listening', { text: t }),
      onError: (m) => { toast(m, true); this.stop(); },
      onEnd: async (t) => {
        if (g !== this.gen || !this.ctx) return;
        if (!t) return misses < 1 ? this.listenTurn(misses + 1) : this.phase('idle', { text: '' });
        if (/^(stop|arr[êe]te|quitte|fin du mode vocal)\W*$/i.test(t)) return this.stop();
        this.phase('sending', { text: t });
        try {
          this.ctx.sessionId = await sendMessage({ ...this.ctx, text: t });
          if (g === this.gen) this.phase('working', { text: t });
        } catch (e) { toast(e.message, true); this.phase('idle', { text: '' }); }
      },
    });
  },
  async onTurnDone(ev) {
    if (!this.ctx || keyOf(ev.agent, ev.sessionId) !== this.key()) return;
    const g = ++this.gen;
    const list = S.chat?.key === this.key() ? S.chat.entries : S.live[this.key()] ?? [];
    const last = [...list].reverse().find((e) => e.kind === 'assistant' && e.text);
    this.phase('speaking', { text: last?.text?.slice(0, 280) ?? '' });
    await speak(ev.error ? `${LABEL[ev.agent]} a rencontré une erreur.` : speakable(last?.text) || `${LABEL[ev.agent]} a terminé.`);
    if (g === this.gen) this.listenTurn();
  },
  onRequest(r) {
    if (!this.ctx || r.sessionId !== this.ctx.sessionId || S.voice?.phase === 'request') return;
    this.stopListen?.();
    this.askRequest(r);
  },
  onResolved() {
    if (this.ctx && S.voice?.phase === 'request' && !this.pending()) { this.gen++; this.stopListen?.(); this.phase('working'); }
  },
  async askRequest(r, retry = false) {
    const g = ++this.gen;
    this.phase('request', { text: r.title });
    if (r.questions) {
      await speak(`${LABEL[r.agent]} te pose une question : ${r.questions.map((q) => q.question).join('. ')}. Réponds à l’écran.`);
      return;
    }
    await speak(retry ? 'Je n’ai pas compris. Dis autoriser, ou refuser.' : `${LABEL[r.agent]} demande une autorisation : ${r.title}. Le détail est à l’écran. Dis autoriser, ou refuser.`);
    if (g !== this.gen) return;
    this.stopListen = listen({
      continuous: false,
      onText: (t) => g === this.gen && this.phase('request', { text: r.title, heard: t }),
      onError: (m) => toast(m, true),
      onEnd: async (t) => {
        if (g !== this.gen || !this.ctx) return;
        const by = (id) => r.choices.find((c) => c.id === id);
        let choice;
        if (/toujours|session/i.test(t)) choice = by('always') ?? by('acceptForSession') ?? by('session');
        if (!choice && /autoris|oui|ok|d.accord|vas-y|valide|accepte|go\b/i.test(t)) choice = r.choices.find((c) => c.style === 'primary');
        if (!choice && /refus|non|annule|pas question|stop/i.test(t)) choice = r.choices.find((c) => c.style === 'danger') ?? r.choices.at(-1);
        if (!choice) return t ? this.askRequest(r, true) : this.phase('request', { text: r.title, heard: '' });
        try { await api('/api/answer', { agent: r.agent, requestId: r.id, choice: choice.id }); speak(choice.style === 'danger' ? 'Refusé.' : 'C’est parti.'); this.phase('working'); }
        catch (e) { toast(e.message, true); }
      },
    });
  },
};

const VOICE_LABEL = {
  idle: 'En pause — touche le micro pour parler',
  listening: 'Je t’écoute…',
  sending: 'Envoi…',
  working: '{agent} travaille…',
  speaking: 'Lecture de la réponse',
  request: 'Validation demandée',
};
function VoiceOverlay() {
  const s = useS();
  const v = s.voice;
  const label = VOICE_LABEL[v.phase].replace('{agent}', LABEL[v.agent]);
  const main = () => {
    if (v.phase === 'listening') voice.stopListen?.();
    else if (v.phase === 'speaking') { voice.gen++; speechSynthesis.cancel(); voice.listenTurn(); }
    else if (v.phase === 'idle') voice.listenTurn();
    else if (v.phase === 'request' && !voice.pending()?.questions) voice.askRequest(voice.pending());
  };
  const pending = v.phase === 'request' && voice.pending();
  return html`<div class="voice" data-agent=${v.agent} role="dialog" aria-label="Mode vocal">
    ${pending && html`<${Request} key=${pending.id} r=${pending} />`}
    <div class="voice-text">${v.phase === 'request' && v.heard ? `« ${v.heard} »` : v.text || ' '}</div>
    <button class="voice-orb ${v.phase}" aria-label=${label} onClick=${main}>
      <${Icon} n=${v.phase === 'speaking' ? 'speaker' : v.phase === 'working' || v.phase === 'sending' ? 'loader' : 'mic'} cls=${`lg ${v.phase === 'working' || v.phase === 'sending' ? 'spin' : ''}`} />
    </button>
    <div class="voice-label">${label}</div>
    <div class="voice-actions">
      ${v.phase === 'working' && voice.ctx?.sessionId && html`<button class="btn" onClick=${() => api('/api/interrupt', { agent: v.agent, sessionId: voice.ctx.sessionId }).catch((e) => toast(e.message, true))}><${Icon} n="stop" cls="sm" />Interrompre</button>`}
      <button class="btn" onClick=${() => voice.stop()}><${Icon} n="x" cls="sm" />Quitter le mode vocal</button>
    </div>
  </div>`;
}

/** Downscale photos so a 12 MP camera shot doesn't travel as 8 MB of base64. */
async function shrink(file) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  const url = c.toDataURL('image/jpeg', 0.85);
  return { url, mediaType: 'image/jpeg', base64: url.split(',')[1] };
}

// ---------------------------------------------------------------- new conversation
const IDEAS = {
  claude: ['Explique-moi l’architecture de ce projet', 'Trouve et corrige les erreurs TypeScript', 'Résume les changements non commités'],
  codex: ['Fais une revue des derniers changements', 'Ajoute des tests pour le module principal', 'Que fait ce projet ?'],
};
function NewChat() {
  const s = useS();
  const { agent, cwd } = s.route;
  return html`
    <${ChatHeader} agent=${agent} title=${`Nouvelle conversation ${LABEL[agent]}`} cwd=${cwd} status="idle" />
    <div class="chat-body"><div class="messages"><div class="messages-inner">
      <div class="new-hero">
        <${Mark} agent=${agent} big />
        <h2>Que doit faire ${LABEL[agent]} ?</h2>
        <div>La conversation s’exécute sur ton PC, dans ce dossier :</div>
        <button class="where" onClick=${() => set({ sheet: { type: 'project', agent } })}><${Icon} n="folder" cls="sm" /><span>${cwd || 'Choisir un dossier'}</span><${Icon} n="down" cls="sm" /></button>
        <div class="suggest">${IDEAS[agent].map((t) => html`<button onClick=${() => { saveDraft(`${agent}:new`, t); set({}); document.querySelector('.composer textarea')?.focus(); }}>${t}</button>`)}</div>
      </div>
    </div></div></div>
    <${Composer} key=${`new-${agent}-${drafts[`${agent}:new`] ?? ''}`} agent=${agent} cwd=${cwd} status="idle" placeholder=${`Décris la tâche pour ${LABEL[agent]}…`} />
  `;
}

// ---------------------------------------------------------------- sheets
function Sheet() {
  const s = useS();
  const close = () => set({ sheet: null });
  const sh = s.sheet;
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && close();
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, []);
  let body;
  if (sh.type === 'project') body = html`<${ProjectSheet} agent=${sh.agent} close=${close} />`;
  else if (sh.type === 'model' || sh.type === 'mode') body = html`<${OptionSheet} kind=${sh.type} agent=${sh.agent} close=${close} />`;
  else body = html`<${SettingsSheet} close=${close} />`;
  return html`<div class="scrim" onClick=${close}></div><div class="sheet" role="dialog" aria-modal="true" data-agent=${sh.agent ?? s.agent}><div class="grab"></div>${body}</div>`;
}

function ProjectSheet({ agent, close }) {
  const s = useS();
  const [custom, setCustom] = useState('');
  const pick = (cwd) => { close(); go(`#/${agent}/new?cwd=${encodeURIComponent(cwd)}`, s.route.view === 'new'); };
  const open = s.info?.workspaceFolders ?? [];
  const seen = new Set(open.map(normPath));
  const recent = [];
  for (const a of AGENTS) for (const x of s.sessions[a] ?? []) {
    const k = normPath(x.cwd);
    if (x.cwd && !seen.has(k)) { seen.add(k); recent.push({ path: x.cwd, at: x.updatedAt }); }
  }
  recent.sort((a, b) => b.at - a.at);
  useEffect(() => { for (const a of AGENTS) if (!S.sessions[a]) loadSessions(a); }, []);
  const Row = ({ p, hint }) => html`<button class="row" onClick=${() => pick(p)}><${Icon} n="folder" /><div class="rt"><b>${base(p)}</b><small>${hint ? `${hint} · ` : ''}${p}</small></div><${Icon} n="right" cls="sm" /></button>`;
  return html`<h3>Nouvelle conversation ${LABEL[agent]}</h3>
    <div class="info">Choisis le dossier de travail sur le PC. ${LABEL[agent]} pourra lire et modifier ses fichiers.</div>
    ${open.length > 0 && html`<div class="sec">Ouvert dans VS Code</div>${open.map((p) => html`<${Row} p=${p} hint="espace de travail" />`)}`}
    ${recent.length > 0 && html`<div class="sec">Récents</div>${recent.slice(0, 8).map((r) => html`<${Row} p=${r.path} />`)}`}
    <div class="sec">Autre dossier</div>
    <div class="field"><input placeholder="C:\\Users\\…\\mon-projet" value=${custom} onInput=${(e) => setCustom(e.target.value)} onKeyDown=${(e) => e.key === 'Enter' && custom.trim() && pick(custom.trim())} />
      <button class="btn primary" style="flex:0 0 auto" disabled=${!custom.trim()} onClick=${() => pick(custom.trim())}>OK</button></div>`;
}

function OptionSheet({ kind, agent, close }) {
  const s = useS();
  const info = s.info?.agents.find((a) => a.id === agent);
  const items = kind === 'model' ? info?.models ?? [] : info?.modes ?? [];
  const current = kind === 'model' ? prefs.model[agent] ?? '' : prefs.mode[agent] ?? info?.defaultMode;
  const choose = (id) => { prefs[kind][agent] = id; savePrefs(); close(); };
  return html`<h3>${kind === 'model' ? 'Modèle' : 'Mode d’autorisation'} · ${LABEL[agent]}</h3>
    ${kind === 'model' && html`<div class="info">« Par défaut » garde le modèle de la conversation ou de ta configuration.</div>`}
    ${items.map((m) => html`<button class="row ${m.id === current ? 'on' : ''}" onClick=${() => choose(m.id)}>
      <${Icon} n=${kind === 'model' ? 'cpu' : 'sliders'} /><div class="rt"><b>${m.label}</b>${m.hint && html`<small>${m.hint}</small>`}</div>
      ${m.id === current && html`<span class="check"><${Icon} n="check" /></span>`}</button>`)}`;
}

function SettingsSheet() {
  const s = useS();
  const [push, setPush] = useState('…');
  const supported = 'serviceWorker' in navigator && 'PushManager' in window && isSecureContext && !EMBED;
  useEffect(() => { pushState().then(setPush); }, []);
  const theme = (t) => { prefs.theme = t; savePrefs(); document.documentElement.dataset.theme = t === 'auto' ? '' : t; set({}); };
  return html`<h3>Réglages</h3>
    <div class="sec">Connexion</div>
    <div class="info"><span class="dot ${s.conn === 'online' ? '' : 'off'}"></span> ${s.conn === 'online' ? 'Connecté à' : 'Hors ligne :'} <b>${s.info?.host}</b><br /><code>${location.origin}</code>
      <br />Hors de chez toi : active Tailscale sur le téléphone, la même adresse fonctionne si ton NAS partage le sous-réseau local.</div>
    ${!EMBED && html`<div class="sec">Notifications</div>
    ${!supported ? html`<div class="info">${EMBED ? '' : 'Indisponibles : installe d’abord le certificat (page d’installation) puis rouvre l’app en https.'}</div>`
      : push === 'on' ? html`
        <button class="row" onClick=${async () => { try { await api('/api/push/test', {}); toast('Notification envoyée'); } catch (e) { toast(e.message, true); } }}><${Icon} n="bell" /><div class="rt"><b>Notifications activées</b><small>Touche pour envoyer une notification de test</small></div></button>
        <button class="row danger" onClick=${async () => { await disablePush(); setPush(await pushState()); }}><${Icon} n="x" /><div class="rt"><b>Désactiver sur ce téléphone</b></div></button>`
      : push === 'denied' ? html`<div class="info">Bloquées par Android. Paramètres → Applications → Chrome → Notifications.</div>`
      : html`<button class="row" onClick=${async () => { try { await enablePush(); setPush(await pushState()); toast('Notifications activées'); } catch (e) { toast(e.message, true); } }}>
          <${Icon} n="bell" /><div class="rt"><b>Activer les notifications</b><small>Prévenu quand ${LABEL.claude} ou ${LABEL.codex} attend une validation ou a terminé</small></div><${Icon} n="right" cls="sm" /></button>`}
    ${s.installPrompt && html`<button class="row" onClick=${async () => { s.installPrompt.prompt(); await s.installPrompt.userChoice; set({ installPrompt: null }); }}><${Icon} n="download" /><div class="rt"><b>Installer l’application</b><small>Ajoute Pocket Bridge à l’écran d’accueil</small></div></button>`}`}
    <div class="sec">Thème</div>
    <div class="seg">${[['auto', 'Auto'], ['light', 'Clair'], ['dark', 'Sombre']].map(([id, l]) => html`<button class=${prefs.theme === id ? 'on' : ''} onClick=${() => theme(id)}>${l}</button>`)}</div>
    <div class="sec">À propos</div>
    <div class="info">Pocket Bridge 1.0 — tes conversations s’exécutent sur le PC avec les mêmes Claude Code et Codex que VS Code, sur les mêmes historiques.</div>`;
}

// ---------------------------------------------------------------- push
async function pushState() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !isSecureContext) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  const reg = await navigator.serviceWorker.ready;
  return (await reg.pushManager.getSubscription()) ? 'on' : 'off';
}
async function enablePush() {
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Permission refusée');
  const reg = await navigator.serviceWorker.ready;
  const key = S.info.push.publicKey;
  const raw = Uint8Array.from(atob(key.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((key.length + 3) % 4)), (c) => c.charCodeAt(0));
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: raw });
  await api('/api/push/subscribe', { subscription: sub.toJSON() });
}
async function disablePush() {
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (sub) { await api('/api/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => undefined); await sub.unsubscribe(); }
}

// ---------------------------------------------------------------- boot
if ('serviceWorker' in navigator && isSecureContext && !EMBED) navigator.serviceWorker.register('/sw.js').catch(() => undefined);
if (location.search.includes('pair=')) history.replaceState(null, '', '/' + location.hash);
render(html`<${App} />`, document.getElementById('app'));
loadState().then(() => { connect(); onRoute(); }).catch(() => { if (S.paired !== false) { set({ paired: true, conn: 'offline' }); wsTimer = setTimeout(connect, 2000); } });
