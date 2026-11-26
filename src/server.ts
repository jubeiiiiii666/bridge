// HTTPS + WebSocket server for the phone, plus a plain-HTTP port that serves the one-time
// certificate setup page to the LAN and the full app to this PC only (VS Code mirror panel).
import http from 'node:http';
import https from 'node:https';
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { WebSocketServer, type WebSocket } from 'ws';
import QRCode from 'qrcode';
import { hub } from './hub';
import { loadCerts, lanAddresses, type Certs } from './certs';
import { Push } from './push';
import type { Agent, AgentId, HubEvent, SendOptions } from './types';

export interface ServerOptions {
  agents: Record<AgentId, Agent>;
  storageDir: string;
  webDir: string;
  httpPort: number;
  httpsPort: number;
  token: string;
  log: (s: string) => void;
  openInVSCode: (agent: AgentId, sessionId: string) => Promise<void>;
  /** A message was sent from the phone (not from the VS Code mirror). */
  onPhoneSend?: (agent: AgentId, sessionId: string) => void;
  workspaceFolders: () => string[];
}

interface Client {
  ws: WebSocket;
  phone: boolean; // false for the VS Code mirror (loopback)
  visible: boolean;
  watch?: { agent: AgentId; sessionId: string; stamp: number; timer: NodeJS.Timeout };
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

const AGENT_LABEL: Record<AgentId, string> = { claude: 'Claude', codex: 'Codex' };

export class BridgeServer {
  private httpServer?: http.Server;
  private httpsServer?: https.Server;
  private clients = new Set<Client>();
  private unsub?: () => void;
  private certs?: Certs;
  readonly push: Push;

  constructor(private o: ServerOptions) {
    this.push = new Push(o.storageDir, o.log);
  }

  get phoneUrl() {
    const ip = lanAddresses()[0] ?? '127.0.0.1';
    return `https://${ip}:${this.o.httpsPort}`;
  }
  get setupUrl() {
    const ip = lanAddresses()[0] ?? '127.0.0.1';
    return `http://${ip}:${this.o.httpPort}/setup`;
  }
  get pairUrl() {
    return `${this.phoneUrl}/pair?token=${this.o.token}`;
  }
  get mirrorUrl() {
    return `http://127.0.0.1:${this.o.httpPort}/?embed=1`;
  }
  get phoneClients() {
    return [...this.clients].filter((c) => c.phone).length;
  }

  setToken(token: string) {
    this.o.token = token;
    for (const c of this.clients) if (c.phone) c.ws.close(4001, 'token revoked');
  }

  async start() {
    this.certs = await loadCerts(path.join(this.o.storageDir, 'certs'));
    await this.push.init();
    this.httpsServer = https.createServer({ key: this.certs.key, cert: this.certs.cert }, (req, res) => this.handle(req, res, true));
    this.httpServer = http.createServer((req, res) => this.handle(req, res, false));
    for (const server of [this.httpsServer, this.httpServer]) {
      const wss = new WebSocketServer({ noServer: true, maxPayload: 1 << 20 });
      server.on('upgrade', (req, socket, head) => {
        const secure = server === this.httpsServer;
        if (!req.url?.startsWith('/ws') || !this.authorized(req, secure)) { socket.destroy(); return; }
        wss.handleUpgrade(req, socket, head, (ws) => this.onSocket(ws, secure));
      });
    }
    await Promise.all([
      listen(this.httpsServer, this.o.httpsPort),
      listen(this.httpServer, this.o.httpPort),
    ]);
    this.unsub = hub.onEvent((ev) => this.onHubEvent(ev));
    this.o.log(`[server] ${this.phoneUrl} (phone) · ${this.mirrorUrl} (mirror)`);
  }

  stop() {
    this.unsub?.();
    for (const c of this.clients) { clearInterval(c.watch?.timer); c.ws.terminate(); }
    this.clients.clear();
    this.httpServer?.close();
    this.httpsServer?.close();
    this.httpServer?.closeAllConnections?.();
    this.httpsServer?.closeAllConnections?.();
  }

  async qrDataUrl() {
    return QRCode.toDataURL(this.pairUrl, { margin: 1, width: 360, errorCorrectionLevel: 'M' });
  }
  async setupQrDataUrl() {
    return QRCode.toDataURL(this.setupUrl, { margin: 1, width: 360, errorCorrectionLevel: 'M' });
  }

  // ---------- auth ----------

  private isLoopback(req: http.IncomingMessage) {
    const a = req.socket.remoteAddress ?? '';
    return a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1';
  }

  private authorized(req: http.IncomingMessage, secure: boolean) {
    if (!secure) return this.isLoopback(req);
    const cookie = /(?:^|;\s*)pb_token=([^;]+)/.exec(req.headers.cookie ?? '')?.[1];
    const header = req.headers['x-pb-token'];
    const given = cookie ?? (typeof header === 'string' ? header : undefined);
    if (!given) return false;
    const a = Buffer.from(given);
    const b = Buffer.from(this.o.token);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  // ---------- HTTP ----------

  private async handle(req: http.IncomingMessage, res: http.ServerResponse, secure: boolean) {
    const url = new URL(req.url ?? '/', 'http://x');
    try {
      if (!secure && !this.isLoopback(req)) return await this.handlePublicHttp(req, res, url);
      if (url.pathname === '/pair') return this.pair(res, url);
      if (url.pathname === '/ca.crt') return this.sendCa(res);
      if (url.pathname.startsWith('/api/')) {
        if (!this.authorized(req, secure)) return json(res, 401, { error: 'Téléphone non appairé' });
        return await this.api(req, res, url, secure);
      }
      return await this.static(res, url.pathname);
    } catch (e: any) {
      this.o.log(`[server] ${req.method} ${url.pathname}: ${e?.stack ?? e}`);
      json(res, e?.code ? 409 : 500, { error: e?.message ?? String(e), code: e?.code });
    }
  }

  private async handlePublicHttp(req: http.IncomingMessage, res: http.ServerResponse, url: URL) {
    if (url.pathname === '/ca.crt') return this.sendCa(res);
    if (url.pathname === '/setup' || url.pathname === '/') {
      const html = (await readFile(path.join(this.o.webDir, 'setup.html'), 'utf8'))
        .replaceAll('{{HTTPS_URL}}', this.phoneUrl);
      res.writeHead(200, { 'content-type': MIME['.html'], 'cache-control': 'no-store' });
      return res.end(html);
    }
    if (url.pathname.startsWith('/icons/')) return this.static(res, url.pathname);
    const host = (req.headers.host ?? '').split(':')[0] || lanAddresses()[0];
    res.writeHead(302, { location: `https://${host}:${this.o.httpsPort}${url.pathname}${url.search}` });
    res.end();
  }

  private pair(res: http.ServerResponse, url: URL) {
    const given = Buffer.from(url.searchParams.get('token') ?? '');
    const expected = Buffer.from(this.o.token);
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
      res.writeHead(302, { location: '/?pair=invalid' });
      return res.end();
    }
    res.writeHead(302, {
      location: '/',
      'set-cookie': `pb_token=${this.o.token}; Path=/; Max-Age=31536000; HttpOnly; Secure; SameSite=Strict`,
    });
    res.end();
  }

  private sendCa(res: http.ServerResponse) {
    res.writeHead(200, {
      'content-type': 'application/x-x509-ca-cert',
      'content-disposition': 'attachment; filename="pocket-bridge-ca.crt"',
    });
    res.end(this.certs!.caDer);
  }

  private async static(res: http.ServerResponse, pathname: string) {
    if (pathname === '/') pathname = '/index.html';
    const file = path.normalize(path.join(this.o.webDir, decodeURIComponent(pathname)));
    if (!file.startsWith(path.normalize(this.o.webDir))) return json(res, 403, { error: 'forbidden' });
    let body: Buffer;
    try { body = await readFile(file); } catch { return json(res, 404, { error: 'not found' }); }
    const ext = path.extname(file);
    res.writeHead(200, {
      'content-type': MIME[ext] ?? 'application/octet-stream',
      'cache-control': ext === '.png' ? 'max-age=86400' : 'no-cache',
      ...(pathname === '/sw.js' ? { 'service-worker-allowed': '/' } : {}),
    });
    res.end(body);
  }

  private async api(req: http.IncomingMessage, res: http.ServerResponse, url: URL, fromPhone: boolean) {
    const agentOf = (id: unknown) => {
      const a = this.o.agents[id as AgentId];
      if (!a) throw new Error(`Agent inconnu : ${id}`);
      return a;
    };
    const route = `${req.method} ${url.pathname}`;
    if (route === 'GET /api/state') {
      const agents = await Promise.all(Object.values(this.o.agents).map((a) => a.info()));
      return json(res, 200, {
        agents,
        workspaceFolders: this.o.workspaceFolders(),
        pending: [...hub.requests.values()],
        statuses: Object.fromEntries(hub.statuses),
        push: { publicKey: this.push.publicKey },
        host: os.hostname(),
      });
    }
    if (route === 'GET /api/sessions') return json(res, 200, await agentOf(url.searchParams.get('agent')).listSessions());
    if (route === 'GET /api/session') {
      const agent = agentOf(url.searchParams.get('agent'));
      const id = url.searchParams.get('id')!;
      const entries = await agent.loadSession(id);
      return json(res, 200, { entries, status: hub.status(agent.id, id), live: agent.isLive(id), pending: [...hub.requests.values()].filter((r) => r.sessionId === id) });
    }
    if (req.method !== 'POST') return json(res, 404, { error: 'not found' });
    const body = await readJson(req);
    switch (url.pathname) {
      case '/api/send': {
        const opts: SendOptions = { sessionId: body.sessionId || undefined, cwd: body.cwd, text: String(body.text ?? ''), images: body.images, model: body.model, mode: body.mode, device: deviceOf(req.headers['user-agent']) };
        if (!opts.text.trim() && !opts.images?.length) return json(res, 400, { error: 'Message vide' });
        const sessionId = await agentOf(body.agent).send(opts);
        if (fromPhone) this.o.onPhoneSend?.(body.agent, sessionId);
        return json(res, 200, { sessionId });
      }
      case '/api/fork': {
        const agent = agentOf(body.agent);
        if (!('fork' in agent)) return json(res, 400, { error: 'Copie non disponible pour cet agent' });
        return json(res, 200, { sessionId: await (agent as any).fork(body.sessionId, body.mode) });
      }
      case '/api/interrupt':
        await agentOf(body.agent).interrupt(body.sessionId);
        return json(res, 200, { ok: true });
      case '/api/answer':
        return json(res, 200, { ok: agentOf(body.agent).answer(body.requestId, { choice: body.choice, answers: body.answers }) });
      case '/api/open-in-vscode':
        await this.o.openInVSCode(body.agent, body.sessionId);
        return json(res, 200, { ok: true });
      case '/api/push/subscribe':
        await this.push.subscribe(body.subscription);
        return json(res, 200, { ok: true });
      case '/api/push/unsubscribe':
        await this.push.unsubscribe(body.endpoint);
        return json(res, 200, { ok: true });
      case '/api/push/test':
        await this.push.send({ title: 'Pocket Bridge', body: 'Les notifications fonctionnent ✅', url: '/', tag: 'test' });
        return json(res, 200, { ok: true });
    }
    return json(res, 404, { error: 'not found' });
  }

  // ---------- WebSocket ----------

  private onSocket(ws: WebSocket, secure: boolean) {
    const client: Client = { ws, phone: secure, visible: true };
    this.clients.add(client);
    ws.on('message', (raw) => {
      let m: any;
      try { m = JSON.parse(String(raw)); } catch { return; }
      if (m.t === 'visibility') client.visible = !!m.visible;
      else if (m.t === 'watch') this.watch(client, m.agent, m.sessionId);
      else if (m.t === 'ping') ws.send('{"t":"pong"}');
    });
    ws.on('close', () => { clearInterval(client.watch?.timer); this.clients.delete(client); });
  }

  /** Follow a session that runs in another process (e.g. the VS Code panel) by polling its transcript. */
  private watch(client: Client, agentId: AgentId, sessionId?: string) {
    clearInterval(client.watch?.timer);
    client.watch = undefined;
    const agent = this.o.agents[agentId];
    if (!agent || !sessionId) return;
    const w = { agent: agentId, sessionId, stamp: 0, timer: setInterval(async () => {
      if (agent.isLive(sessionId) || !client.visible) return;
      try {
        const s = await agent.stamp(sessionId);
        if (w.stamp && s !== w.stamp) client.ws.send(JSON.stringify({ t: 'reload', agent: agentId, sessionId }));
        w.stamp = s;
      } catch { /* session may not exist on disk yet */ }
    }, 3000) };
    client.watch = w;
  }

  private onHubEvent(ev: HubEvent) {
    const data = JSON.stringify(ev);
    for (const c of this.clients) if (c.ws.readyState === c.ws.OPEN) c.ws.send(data);
    // Fresh content from our own process: don't make watchers reload it.
    if (ev.t === 'entry' || ev.t === 'turn-done') for (const c of this.clients) if (c.watch?.sessionId === ev.sessionId) c.watch.stamp = 0;

    const phoneLooking = [...this.clients].some((c) => c.phone && c.visible);
    if (phoneLooking) return;
    if (ev.t === 'request') {
      const r = ev.request;
      void this.push.send({
        title: `${AGENT_LABEL[r.agent]} attend ta réponse`, body: `${r.title}${r.detail ? ' — ' + r.detail.split('\n')[0].slice(0, 120) : ''}`,
        url: `/#/${r.agent}/${r.sessionId}`, tag: r.id, requireInteraction: true,
      });
    } else if (ev.t === 'turn-done') {
      void this.push.send({
        title: ev.error ? `${AGENT_LABEL[ev.agent]} a rencontré une erreur` : `${AGENT_LABEL[ev.agent]} a terminé`,
        body: ev.summary || 'Réponse disponible', url: `/#/${ev.agent}/${ev.sessionId}`, tag: `done-${ev.sessionId}`,
      });
    }
  }
}

export function newToken() {
  return randomBytes(24).toString('base64url');
}

function listen(server: http.Server | https.Server, port: number) {
  return new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '0.0.0.0', () => { server.off('error', reject); resolve(); });
  });
}

/** "smartphone (Android)", "tablette (iPad)", "PC (Windows)"… from a User-Agent header. */
function deviceOf(ua = ''): string {
  const os = /Android/i.test(ua) ? 'Android' : /iPhone|iPad|iPod/i.test(ua) ? 'iOS'
    : /Windows/i.test(ua) ? 'Windows' : /Mac OS X/i.test(ua) ? 'macOS' : /Linux/i.test(ua) ? 'Linux' : 'inconnu';
  if (/iPad|Tablet/i.test(ua) || (os === 'Android' && !/Mobile/i.test(ua))) return `tablette (${os})`;
  if (/Mobi|iPhone|Android/i.test(ua)) return `smartphone (${os})`;
  return `PC (${os})`;
}

function json(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

function readJson(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > 30 * 1024 * 1024) { reject(new Error('Requête trop volumineuse')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}
