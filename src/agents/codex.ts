// Codex adapter: speaks JSON-RPC to `codex app-server`, the same protocol and binary the
// Codex VS Code extension uses, so threads are shared with it through ~/.codex.
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { hub } from '../hub';
import type { Agent, AgentInfo, Answer, Entry, PendingRequest, SendOptions, SessionSummary } from '../types';

const MAX_OUTPUT = 6000;

const MODES = [
  { id: 'config', label: 'Selon config', hint: 'Réglages de ~/.codex/config.toml (comme dans VS Code)' },
  { id: 'read-only', label: 'Lecture seule', hint: 'Lit le code, demande avant toute modification' },
  { id: 'auto', label: 'Auto', hint: 'Modifie le projet, demande pour sortir du dossier ou accéder au réseau' },
  { id: 'full', label: 'Accès complet', hint: 'Aucune confirmation, aucun bac à sable' },
];

function modeParams(mode?: string) {
  switch (mode) {
    case 'read-only': return { approvalPolicy: 'on-request', sandbox: 'read-only', sandboxPolicy: { type: 'readOnly', networkAccess: false } };
    case 'auto': return { approvalPolicy: 'on-request', sandbox: 'workspace-write', sandboxPolicy: { type: 'workspaceWrite', writableRoots: [], networkAccess: false, excludeTmpdirEnvVar: false, excludeSlashTmp: false } };
    case 'full': return { approvalPolicy: 'never', sandbox: 'danger-full-access', sandboxPolicy: { type: 'dangerFullAccess' } };
    default: return {};
  }
}

interface PendingRpc { resolve: (v: any) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }
interface PendingApproval { request: PendingRequest; rpcId: number | string; method: string; params: any }

export class CodexAgent implements Agent {
  readonly id = 'codex' as const;
  private proc?: ChildProcessWithoutNullStreams;
  private ready?: Promise<void>;
  private nextId = 1;
  private rpc = new Map<number, PendingRpc>();
  private approvals = new Map<string, PendingApproval>();
  private loaded = new Set<string>(); // threads resumed in our app-server
  private activeTurn = new Map<string, string>(); // threadId -> turnId
  private lastText = new Map<string, string>(); // threadId -> last agent message (for notifications)
  private items = new Map<string, Entry>(); // itemId -> entry (for approval details)
  private clientIds = new Map<string, string>(); // Codex userMessage clientId -> our entry id
  private models: { id: string; label: string }[] = [{ id: '', label: 'Par défaut' }];
  private tmpDir?: string;

  constructor(private readonly exe: string | undefined, private readonly log: (s: string) => void) {}

  // ---------- transport ----------

  private ensure(): Promise<void> {
    if (this.ready) return this.ready;
    if (!this.exe) return Promise.reject(new Error('Extension Codex introuvable dans VS Code.'));
    this.ready = new Promise<void>((resolve, reject) => {
      // Same feature flags the Codex VS Code extension starts its app-server with.
      const proc = spawn(this.exe!, ['-c', 'features.code_mode_host=true', '-c', 'features.windows_sandbox_service=true', 'app-server'], {
        stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
      });
      this.proc = proc;
      readline.createInterface({ input: proc.stdout }).on('line', (l) => this.onLine(l));
      readline.createInterface({ input: proc.stderr }).on('line', (l) => this.log(`[codex] ${l}`));
      proc.on('error', (e) => reject(e));
      proc.on('exit', (code) => {
        this.log(`[codex] app-server exited (${code})`);
        this.proc = undefined;
        this.ready = undefined;
        this.loaded.clear();
        for (const p of this.rpc.values()) p.reject(new Error('Codex app-server arrêté'));
        this.rpc.clear();
        for (const [id, a] of this.approvals) this.dropApproval(id, a);
        for (const threadId of this.activeTurn.keys()) hub.publish({ t: 'status', agent: 'codex', sessionId: threadId, status: 'idle' });
        this.activeTurn.clear();
      });
      this.call('initialize', { clientInfo: { name: 'pocket_bridge', title: 'Pocket Bridge', version: '1.0.0' }, capabilities: null })
        .then(() => {
          this.write({ method: 'initialized' });
          resolve();
          this.call('model/list', {}).then((r) => {
            this.models = [{ id: '', label: 'Par défaut' }, ...(r.data ?? []).filter((m: any) => !m.hidden).map((m: any) => ({ id: m.id, label: m.displayName }))];
          }, () => undefined);
        }, reject);
    });
    this.ready.catch(() => { this.ready = undefined; });
    return this.ready;
  }

  private write(msg: object) {
    this.proc?.stdin.write(JSON.stringify(msg) + '\n');
  }

  private call(method: string, params: unknown, timeoutMs = 60_000): Promise<any> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.rpc.delete(id); reject(new Error(`${method}: délai dépassé`)); }, timeoutMs);
      this.rpc.set(id, { resolve, reject, timer });
      this.write({ id, method, params });
    });
  }

  private async request(method: string, params: unknown, timeoutMs?: number) {
    await this.ensure();
    return this.call(method, params, timeoutMs);
  }

  private onLine(line: string) {
    let m: any;
    try { m = JSON.parse(line); } catch { return; }
    if (m.id != null && m.method) return this.onServerRequest(m.id, m.method, m.params);
    if (m.id != null) {
      const p = this.rpc.get(m.id);
      if (!p) return;
      this.rpc.delete(m.id);
      clearTimeout(p.timer);
      if (m.error) p.reject(new Error(m.error.message ?? JSON.stringify(m.error)));
      else p.resolve(m.result);
      return;
    }
    if (m.method) this.onNotification(m.method, m.params ?? {});
  }

  // ---------- events from Codex ----------

  private onNotification(method: string, p: any) {
    const threadId: string = p.threadId;
    const pubEntry = (entry: Entry) => hub.publish({ t: 'entry', agent: 'codex', sessionId: threadId, entry });
    switch (method) {
      case 'turn/started':
        this.activeTurn.set(threadId, p.turn.id);
        hub.publish({ t: 'status', agent: 'codex', sessionId: threadId, status: 'running' });
        break;
      case 'turn/completed': {
        this.activeTurn.delete(threadId);
        const failed = p.turn.status === 'failed';
        if (failed) pubEntry({ id: `${p.turn.id}:error`, kind: 'error', text: p.turn.error?.message ?? 'Échec du tour' });
        if (p.turn.status === 'interrupted') pubEntry({ id: `${p.turn.id}:int`, kind: 'notice', text: 'Interrompu' });
        hub.publish({ t: 'status', agent: 'codex', sessionId: threadId, status: 'idle' });
        hub.publish({ t: 'turn-done', agent: 'codex', sessionId: threadId, summary: oneLine(this.lastText.get(threadId) ?? ''), error: failed });
        hub.publish({ t: 'sessions-changed', agent: 'codex' });
        break;
      }
      case 'item/started':
      case 'item/completed': {
        const e = this.itemToEntry(p.item, threadId);
        if (e) pubEntry(e);
        break;
      }
      case 'item/agentMessage/delta':
      case 'item/reasoning/summaryTextDelta':
      case 'item/plan/delta':
        hub.publish({ t: 'delta', agent: 'codex', sessionId: threadId, id: p.itemId, field: 'text', text: p.delta });
        break;
      case 'item/commandExecution/outputDelta':
        hub.publish({ t: 'delta', agent: 'codex', sessionId: threadId, id: p.itemId, field: 'output', text: p.delta });
        break;
      case 'serverRequest/resolved':
        for (const [id, a] of this.approvals) if (a.rpcId === p.requestId) this.dropApproval(id, a);
        break;
      case 'thread/started':
      case 'thread/name/updated':
        hub.publish({ t: 'sessions-changed', agent: 'codex' });
        break;
      case 'error':
        if (!p.willRetry) pubEntry({ id: randomUUID(), kind: 'error', text: p.error?.message ?? 'Erreur Codex' });
        break;
    }
  }

  private onServerRequest(rpcId: number | string, method: string, p: any) {
    const threadId: string = p.threadId;
    const base = { id: randomUUID(), agent: 'codex' as const, sessionId: threadId, createdAt: Date.now() };
    let request: PendingRequest | undefined;
    const accept = [
      { id: 'accept', label: 'Autoriser', style: 'primary' as const },
      { id: 'acceptForSession', label: 'Autoriser pour la session', style: 'secondary' as const },
      { id: 'decline', label: 'Refuser', style: 'danger' as const },
    ];
    switch (method) {
      case 'item/commandExecution/requestApproval':
        request = { ...base, title: p.reason || 'Exécuter une commande', detail: unwrapShell(p.command ?? ''), detailKind: 'code', choices: accept };
        break;
      case 'item/fileChange/requestApproval': {
        const item = this.items.get(p.itemId);
        request = {
          ...base, title: p.reason || (item?.tool?.subtitle ? `Modifier ${item.tool.subtitle}` : 'Modifier des fichiers'),
          detail: item?.tool?.diff, detailKind: 'diff', choices: accept,
        };
        break;
      }
      case 'item/permissions/requestApproval':
        request = {
          ...base, title: p.reason || 'Codex demande des permissions supplémentaires',
          detail: JSON.stringify(p.permissions, null, 2), detailKind: 'code',
          choices: [
            { id: 'turn', label: 'Pour ce tour', style: 'primary' },
            { id: 'session', label: 'Pour la session', style: 'secondary' },
            { id: 'decline', label: 'Refuser', style: 'danger' },
          ],
        };
        break;
      case 'item/tool/requestUserInput':
        request = {
          ...base, title: 'Codex te pose une question',
          questions: (p.questions ?? []).map((q: any) => ({
            id: q.id, header: q.header, question: q.question, allowOther: q.isOther || !q.options?.length,
            options: (q.options ?? []).map((o: any) => ({ label: o.label, description: o.description })),
          })),
          choices: [{ id: 'answer', label: 'Répondre', style: 'primary' }],
        };
        break;
      case 'mcpServer/elicitation/request':
        this.write({ id: rpcId, result: { action: 'decline', content: null, _meta: null } });
        return;
      default:
        this.write({ id: rpcId, error: { code: -32601, message: `Pocket Bridge ne gère pas ${method}` } });
        return;
    }
    this.approvals.set(request.id, { request, rpcId, method, params: p });
    hub.publish({ t: 'request', request });
    hub.publish({ t: 'status', agent: 'codex', sessionId: threadId, status: 'waiting' });
  }

  private dropApproval(id: string, a: PendingApproval) {
    this.approvals.delete(id);
    hub.publish({ t: 'request-resolved', id, agent: 'codex', sessionId: a.request.sessionId });
    if (this.activeTurn.has(a.request.sessionId)) hub.publish({ t: 'status', agent: 'codex', sessionId: a.request.sessionId, status: 'running' });
  }

  answer(requestId: string, ans: Answer): boolean {
    const a = this.approvals.get(requestId);
    if (!a) return false;
    let result: unknown;
    if (a.method === 'item/tool/requestUserInput') {
      const answers: Record<string, { answers: string[] }> = {};
      for (const [qid, picked] of Object.entries(ans.answers ?? {})) answers[qid] = { answers: picked };
      result = { answers };
    } else if (a.method === 'item/permissions/requestApproval') {
      result = ans.choice === 'decline'
        ? { permissions: {}, scope: 'turn' }
        : { permissions: stripNulls(a.params.permissions), scope: ans.choice === 'session' ? 'session' : 'turn' };
    } else {
      result = { decision: ['accept', 'acceptForSession'].includes(ans.choice) ? ans.choice : 'decline' };
    }
    this.write({ id: a.rpcId, result });
    this.dropApproval(requestId, a);
    return true;
  }

  // ---------- item mapping ----------

  private itemToEntry(item: any, threadId?: string): Entry | undefined {
    const done = (s: string) => (s === 'completed' ? 'ok' : s === 'failed' ? 'error' : s === 'declined' ? 'denied' : 'running');
    let e: Entry | undefined;
    switch (item?.type) {
      case 'userMessage': {
        const text = (item.content ?? []).map((c: any) => (c.type === 'text' ? c.text : c.type === 'image' || c.type === 'localImage' ? '🖼️ image' : c.type === 'mention' ? `@${c.name}` : '')).filter(Boolean).join('\n');
        e = { id: (item.clientId && this.clientIds.get(item.clientId)) || item.id, kind: 'user', text };
        break;
      }
      case 'agentMessage':
        if (threadId && item.text) this.lastText.set(threadId, item.text);
        e = { id: item.id, kind: 'assistant', text: item.text ?? '' };
        break;
      case 'reasoning':
        e = { id: item.id, kind: 'thinking', text: [...(item.summary ?? []), ...(item.summary?.length ? [] : item.content ?? [])].join('\n\n') };
        break;
      case 'plan':
        e = { id: item.id, kind: 'tool', tool: { icon: 'plan', title: 'Plan', code: item.text, status: 'ok' } };
        break;
      case 'commandExecution': {
        const command = unwrapShell(String(item.command ?? ''));
        const action = item.commandActions?.length === 1 ? item.commandActions[0] : undefined;
        const [title, icon, subtitle] =
          action?.type === 'read' ? ['Lecture', 'file', action.path ?? action.name]
          : action?.type === 'search' ? ['Recherche dans le code', 'search', action.query ?? command]
          : action?.type === 'listFiles' ? ['Liste des fichiers', 'search', action.path ?? command]
          : ['Commande', 'terminal', command.split('\n')[0]];
        e = {
          id: item.id, kind: 'tool',
          tool: {
            icon: icon as any, title, subtitle, code: command,
            output: clip(item.aggregatedOutput ?? ''), status: item.exitCode != null && item.exitCode !== 0 ? 'error' : done(item.status),
          },
        };
        break;
      }
      case 'fileChange': {
        const changes: any[] = item.changes ?? [];
        const names = changes.map((c) => c.path.split(/[\\/]/).pop());
        e = {
          id: item.id, kind: 'tool',
          tool: {
            icon: 'edit', title: changes.length > 1 ? `${changes.length} fichiers modifiés` : 'Modification',
            subtitle: names.join(', '), diff: changes.map((c) => `# ${c.path}\n${c.diff}`).join('\n'), status: done(item.status),
          },
        };
        break;
      }
      case 'mcpToolCall':
        e = {
          id: item.id, kind: 'tool',
          tool: {
            icon: 'mcp', title: `${item.server} · ${item.tool}`, code: JSON.stringify(item.arguments, null, 2),
            output: clip(item.error?.message ?? JSON.stringify(item.result?.content ?? item.result ?? '', null, 2)), status: done(item.status),
          },
        };
        break;
      case 'webSearch':
        e = { id: item.id, kind: 'tool', tool: { icon: 'web', title: 'Recherche web', subtitle: item.query, status: 'ok' } };
        break;
      case 'imageView':
        e = { id: item.id, kind: 'tool', tool: { icon: 'file', title: 'Image', subtitle: item.path, status: 'ok' } };
        break;
      case 'contextCompaction':
        e = { id: item.id, kind: 'notice', text: 'Contexte compacté' };
        break;
      case 'enteredReviewMode':
        e = { id: item.id, kind: 'notice', text: 'Revue de code démarrée' };
        break;
      default:
        return undefined;
    }
    if (e.kind === 'tool') this.items.set(e.id, e);
    if (this.items.size > 2000) this.items.delete(this.items.keys().next().value!);
    return e;
  }

  // ---------- Agent API ----------

  async info(): Promise<AgentInfo> {
    let reason: string | undefined;
    if (!this.exe) reason = 'Extension Codex (openai.chatgpt) introuvable dans VS Code.';
    else await this.ensure().catch((e) => { reason = `Codex ne démarre pas : ${e.message}`; });
    return { id: 'codex', label: 'Codex', available: !reason, reason, models: this.models, modes: MODES, defaultMode: 'config' };
  }

  isLive(threadId: string) {
    return this.loaded.has(threadId);
  }

  async listSessions(): Promise<SessionSummary[]> {
    const r = await this.request('thread/list', { limit: 80, sortKey: 'updated_at' });
    const seen = new Set<string>();
    return (r.data ?? []).filter((t: any) => !t.parentThreadId && !seen.has(t.id) && seen.add(t.id)).map((t: any) => ({
      id: t.id,
      title: t.name || t.preview || 'Sans titre',
      cwd: t.cwd ?? '',
      updatedAt: (t.updatedAt ?? t.createdAt) * 1000,
      status: hub.status('codex', t.id),
      live: this.loaded.has(t.id),
    }));
  }

  async stamp(threadId: string) {
    const r = await this.request('thread/read', { threadId });
    return (r.thread?.updatedAt ?? 0) * 1000;
  }

  async loadSession(threadId: string): Promise<Entry[]> {
    let items: any[];
    try {
      const r = await this.request('thread/items/list', { threadId, limit: 400, sortDirection: 'desc' });
      items = (r.data ?? []).map((x: any) => x.item).reverse();
    } catch {
      const r = await this.request('thread/read', { threadId, includeTurns: true });
      items = (r.thread?.turns ?? []).flatMap((t: any) => t.items);
    }
    const entries = items.map((it) => this.itemToEntry(it, threadId)).filter((e): e is Entry => !!e);
    if (!this.activeTurn.has(threadId)) for (const e of entries) if (e.tool?.status === 'running') e.tool.status = 'error';
    return entries;
  }

  async send(opts: SendOptions): Promise<string> {
    const mp: any = modeParams(opts.mode);
    let threadId = opts.sessionId;
    if (!threadId) {
      const r = await this.request('thread/start', {
        cwd: opts.cwd || null, model: opts.model || null,
        approvalPolicy: mp.approvalPolicy ?? null, sandbox: mp.sandbox ?? null,
      });
      threadId = r.thread.id as string;
      this.loaded.add(threadId);
      hub.publish({ t: 'sessions-changed', agent: 'codex' });
    } else if (!this.loaded.has(threadId)) {
      try {
        await this.request('thread/resume', {
          threadId, excludeTurns: true,
          approvalPolicy: mp.approvalPolicy ?? null, sandbox: mp.sandbox ?? null, model: opts.model || null,
        });
      } catch (err: any) {
        // Codex allows one writer per thread; the VS Code Codex panel holds it while the thread is open there.
        if (/active writer/i.test(err?.message ?? '')) {
          throw Object.assign(new Error('Cette conversation est ouverte dans le panneau Codex de VS Code, qui la verrouille en écriture.'), { code: 'codex_locked' });
        }
        throw err;
      }
      this.loaded.add(threadId);
    }

    const input: any[] = [{ type: 'text', text: opts.text, text_elements: [] }];
    for (const img of opts.images ?? []) input.push({ type: 'localImage', path: await this.saveImage(img) });

    const clientId = randomUUID();
    this.clientIds.set(clientId, clientId);
    hub.publish({ t: 'entry', agent: 'codex', sessionId: threadId, entry: { id: clientId, kind: 'user', text: (opts.images?.length ? `🖼️ ${opts.images.length} image(s)\n` : '') + opts.text, ts: Date.now() } });
    hub.publish({ t: 'status', agent: 'codex', sessionId: threadId, status: 'running' });

    const active = this.activeTurn.get(threadId);
    try {
      if (active) {
        await this.request('turn/steer', { threadId, input, expectedTurnId: active, clientUserMessageId: clientId });
      } else {
        const r = await this.request('turn/start', {
          threadId, input, clientUserMessageId: clientId,
          model: opts.model || null,
          ...(mp.approvalPolicy ? { approvalPolicy: mp.approvalPolicy, sandboxPolicy: mp.sandboxPolicy } : {}),
        });
        this.activeTurn.set(threadId, r.turn.id);
      }
    } catch (err) {
      hub.publish({ t: 'status', agent: 'codex', sessionId: threadId, status: 'idle' });
      throw err;
    }
    return threadId;
  }

  private async saveImage(img: { mediaType: string; base64: string }) {
    this.tmpDir ??= await mkdtemp(path.join(tmpdir(), 'pocket-bridge-'));
    const file = path.join(this.tmpDir, `${randomUUID()}.${img.mediaType.split('/')[1] || 'png'}`);
    await writeFile(file, Buffer.from(img.base64, 'base64'));
    return file;
  }

  /** Copy a thread (history included) into a new one that we own, leaving the original to its writer. */
  async fork(threadId: string, mode?: string): Promise<string> {
    const mp: any = modeParams(mode);
    const r = await this.request('thread/fork', { threadId, excludeTurns: true, approvalPolicy: mp.approvalPolicy ?? null, sandbox: mp.sandbox ?? null });
    this.loaded.add(r.thread.id);
    hub.publish({ t: 'sessions-changed', agent: 'codex' });
    return r.thread.id;
  }

  async interrupt(threadId: string) {
    const turnId = this.activeTurn.get(threadId);
    if (turnId) await this.request('turn/interrupt', { threadId, turnId });
  }

  async release(threadId: string) {
    if (!this.loaded.has(threadId) || this.activeTurn.has(threadId)) return;
    await this.request('thread/unsubscribe', { threadId }).catch(() => undefined);
    this.loaded.delete(threadId);
  }

  dispose() {
    this.proc?.kill();
  }
}

/** `"C:\…\powershell.exe" -Command "Get-ChildItem"` -> `Get-ChildItem` */
function unwrapShell(cmd: string) {
  const m = /^"?[^"]*(?:powershell|pwsh|cmd|bash)(?:\.exe)?"?\s+(?:-NoProfile\s+|-NoLogo\s+)*(?:-Command|-c|\/c)\s+([\s\S]+)$/i.exec(cmd.trim());
  if (!m) return cmd;
  const inner = m[1].trim();
  return /^".*"$/s.test(inner) ? inner.slice(1, -1).replace(/\\"/g, '"') : inner;
}

function stripNulls(o: any) {
  return Object.fromEntries(Object.entries(o ?? {}).filter(([, v]) => v != null));
}
const clip = (s: string, n = MAX_OUTPUT) => (s.length > n ? s.slice(0, n) + `\n… (${s.length - n} caractères de plus)` : s);
const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim().slice(0, 160);
