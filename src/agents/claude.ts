// Claude Code adapter, built on the official Agent SDK. It runs the same claude.exe as the
// VS Code extension, against the same ~/.claude transcripts, so a conversation started or
// continued from the phone is an ordinary Claude Code session.
import { randomUUID } from 'node:crypto';
import {
  query, listSessions, getSessionMessages, getSessionInfo,
  type Query, type SDKMessage, type SDKUserMessage, type PermissionResult, type PermissionMode, type PermissionUpdate,
} from '@anthropic-ai/claude-agent-sdk';
import { hub } from '../hub';
import type { Agent, AgentInfo, Answer, Entry, SendOptions, SessionSummary, PendingRequest } from '../types';
import { describeTool, permissionTitle, resultText } from './claudeTools';

const IDLE_CLOSE_MS = 15 * 60_000;
const MAX_OUTPUT = 6000;
const MAX_HISTORY = 500;

const MODES = [
  { id: 'default', label: 'Demander', hint: 'Demande avant chaque modification ou commande' },
  { id: 'acceptEdits', label: 'Éditions auto', hint: 'Modifie les fichiers sans demander, demande pour les commandes' },
  { id: 'plan', label: 'Plan', hint: 'Analyse et propose un plan sans rien modifier' },
  { id: 'bypassPermissions', label: 'Tout autoriser', hint: 'Aucune confirmation (à utiliser avec prudence)' },
];

class Inbox implements AsyncIterable<SDKUserMessage> {
  private items: SDKUserMessage[] = [];
  private waiters: ((r: IteratorResult<SDKUserMessage>) => void)[] = [];
  private closed = false;
  push(m: SDKUserMessage) {
    const w = this.waiters.shift();
    if (w) w({ value: m, done: false });
    else this.items.push(m);
  }
  close() {
    this.closed = true;
    for (const w of this.waiters.splice(0)) w({ value: undefined, done: true });
  }
  [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    return {
      next: () => {
        if (this.items.length) return Promise.resolve({ value: this.items.shift()!, done: false });
        if (this.closed) return Promise.resolve({ value: undefined, done: true });
        return new Promise((r) => this.waiters.push(r));
      },
    };
  }
}

interface Run {
  sessionId: string;
  q: Query;
  inbox: Inbox;
  mode: string;
  model?: string;
  idleTimer?: NodeJS.Timeout;
  blockCount: Map<string, number>; // assistant message id -> blocks seen (aligns final blocks with stream indexes)
  streamMsgId?: string;
}

interface Pending {
  request: PendingRequest;
  resolve: (r: PermissionResult) => void;
  input: Record<string, unknown>;
  suggestions?: PermissionUpdate[];
}

export class ClaudeAgent implements Agent {
  readonly id = 'claude' as const;
  private runs = new Map<string, Run>();
  private pending = new Map<string, Pending>();
  private tools = new Map<string, Entry>(); // tool_use id -> card, to merge results into
  private models: { id: string; label: string }[] = [
    { id: '', label: 'Par défaut' }, { id: 'opus', label: 'Opus' }, { id: 'sonnet', label: 'Sonnet' }, { id: 'haiku', label: 'Haiku' },
  ];

  constructor(private readonly exe: string | undefined, private readonly log: (s: string) => void) {}

  async info(): Promise<AgentInfo> {
    return {
      id: 'claude', label: 'Claude',
      available: !!this.exe,
      reason: this.exe ? undefined : 'Extension « Claude Code » introuvable dans VS Code.',
      models: this.models, modes: MODES, defaultMode: 'default',
    };
  }

  isLive(sessionId: string) {
    return this.runs.has(sessionId);
  }

  async listSessions(): Promise<SessionSummary[]> {
    const list = await listSessions({ limit: 80, includeProgrammatic: false });
    return list.map((s) => ({
      id: s.sessionId,
      title: s.customTitle || s.summary || s.firstPrompt || 'Sans titre',
      cwd: s.cwd ?? '',
      updatedAt: s.lastModified,
      status: hub.status('claude', s.sessionId),
      live: this.runs.has(s.sessionId),
    }));
  }

  async stamp(sessionId: string) {
    return (await getSessionInfo(sessionId))?.lastModified ?? 0;
  }

  async loadSession(sessionId: string): Promise<Entry[]> {
    const messages = await getSessionMessages(sessionId, { includeSystemMessages: true });
    const entries: Entry[] = [];
    const byId = new Map<string, Entry>();
    const counts = new Map<string, number>();
    for (const m of messages) {
      if (m.parent_tool_use_id) continue; // subagent internals
      const msg: any = m.message;
      if (m.type === 'assistant') {
        for (const block of msg?.content ?? []) {
          const n = counts.get(msg.id) ?? 0;
          counts.set(msg.id, n + 1);
          const e = this.blockToEntry(block, `${msg.id}:${n}`);
          if (e) { entries.push(e); byId.set(e.id, e); }
        }
      } else if (m.type === 'user') {
        const content = msg?.content;
        if (typeof content === 'string') {
          const e = userTextEntry(m.uuid, content);
          if (e) entries.push(e);
          continue;
        }
        const texts: string[] = [];
        for (const block of content ?? []) {
          if (block.type === 'tool_result') {
            const tool = byId.get(block.tool_use_id);
            if (tool?.tool) {
              tool.tool.status = block.is_error ? 'error' : 'ok';
              tool.tool.output = clip(resultText(block.content));
            }
          } else if (block.type === 'text') texts.push(block.text);
          else if (block.type === 'image') texts.push('🖼️ image');
        }
        if (texts.length) {
          const e = userTextEntry(m.uuid, texts.join('\n'));
          if (e) entries.push(e);
        }
      } else if (m.type === 'system' && (msg as any)?.subtype === 'compact_boundary') {
        entries.push({ id: m.uuid, kind: 'notice', text: 'Contexte compacté' });
      }
    }
    // Tools still without result in a non-live session were interrupted.
    if (!this.runs.has(sessionId)) for (const e of entries) if (e.tool?.status === 'running') e.tool.status = 'error';
    return entries.slice(-MAX_HISTORY);
  }

  async send(opts: SendOptions): Promise<string> {
    if (!this.exe) throw new Error('Claude Code n’est pas installé dans VS Code.');
    const isNew = !opts.sessionId;
    const sessionId = opts.sessionId ?? randomUUID();
    const uuid = randomUUID() as `${string}-${string}-${string}-${string}-${string}`;
    const content: any[] = (opts.images ?? []).map((img) => ({
      type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.base64 },
    }));
    if (opts.text) content.push({ type: 'text', text: opts.text });
    const message: SDKUserMessage = {
      type: 'user', uuid, parent_tool_use_id: null,
      message: { role: 'user', content: content.length === 1 && content[0].type === 'text' ? opts.text : content },
    };

    hub.publish({
      t: 'entry', agent: 'claude', sessionId,
      entry: { id: uuid, kind: 'user', text: (opts.images?.length ? `🖼️ ${opts.images.length} image(s)\n` : '') + opts.text, ts: Date.now() },
    });
    hub.publish({ t: 'status', agent: 'claude', sessionId, status: 'running' });

    let run = this.runs.get(sessionId);
    if (run) {
      clearTimeout(run.idleTimer);
      if (opts.mode && opts.mode !== run.mode) { await run.q.setPermissionMode(opts.mode as PermissionMode); run.mode = opts.mode; }
      if (opts.model && opts.model !== run.model) { await run.q.setModel(opts.model || undefined); run.model = opts.model; }
      run.inbox.push(message);
    } else {
      // Resume in the session's own folder (its transcript and project memory live there).
      const cwd = opts.cwd || (isNew ? undefined : (await getSessionInfo(sessionId))?.cwd);
      run = this.start(sessionId, isNew, { ...opts, cwd });
      run.inbox.push(message);
    }
    if (isNew) hub.publish({ t: 'sessions-changed', agent: 'claude' });
    return sessionId;
  }

  private start(sessionId: string, isNew: boolean, opts: SendOptions): Run {
    const inbox = new Inbox();
    const mode = opts.mode || 'default';
    const q = query({
      prompt: inbox,
      options: {
        ...(isNew ? { sessionId } : { resume: sessionId }),
        cwd: opts.cwd || undefined,
        model: opts.model || undefined,
        permissionMode: mode as PermissionMode,
        allowDangerouslySkipPermissions: true,
        includePartialMessages: true,
        settingSources: ['user', 'project', 'local'],
        systemPrompt: { type: 'preset', preset: 'claude_code' },
        pathToClaudeCodeExecutable: this.exe,
        // Recorded like the VS Code extension's own sessions, so they show in its session picker
        // (SDK/headless entrypoints are filtered out there).
        env: { ...process.env, CLAUDE_CODE_ENTRYPOINT: 'claude-vscode', CLAUDE_AGENT_SDK_CLIENT_APP: 'pocket-bridge/1.0.0' },
        canUseTool: (toolName, input, o) => this.askPermission(sessionId, toolName, input, o),
        stderr: (d) => this.log(`[claude ${sessionId.slice(0, 8)}] ${d.trim()}`),
      },
    });
    const run: Run = { sessionId, q, inbox, mode, model: opts.model, blockCount: new Map() };
    this.runs.set(sessionId, run);
    void this.consume(run);
    return run;
  }

  private async consume(run: Run) {
    const { sessionId } = run;
    try {
      for await (const m of run.q) this.onMessage(run, m);
    } catch (err: any) {
      this.log(`[claude] session ${sessionId} crashed: ${err?.stack ?? err}`);
      hub.publish({ t: 'entry', agent: 'claude', sessionId, entry: { id: randomUUID(), kind: 'error', text: `Claude s’est arrêté : ${err?.message ?? err}` } });
    } finally {
      clearTimeout(run.idleTimer);
      this.runs.delete(sessionId);
      for (const [id, p] of this.pending) if (p.request.sessionId === sessionId) this.resolvePending(id, { behavior: 'deny', message: 'Session terminée' });
      hub.publish({ t: 'status', agent: 'claude', sessionId, status: 'idle' });
      hub.publish({ t: 'sessions-changed', agent: 'claude' });
    }
  }

  private onMessage(run: Run, m: SDKMessage) {
    const { sessionId } = run;
    const pub = (entry: Entry) => hub.publish({ t: 'entry', agent: 'claude', sessionId, entry });
    switch (m.type) {
      case 'stream_event': {
        if (m.parent_tool_use_id) return;
        const ev: any = m.event;
        if (ev.type === 'message_start') run.streamMsgId = ev.message.id;
        else if (ev.type === 'content_block_start') {
          const e = this.blockToEntry(ev.content_block, `${run.streamMsgId}:${ev.index}`, true);
          if (e) pub(e);
        } else if (ev.type === 'content_block_delta') {
          const id = `${run.streamMsgId}:${ev.index}`;
          if (ev.delta.type === 'text_delta') hub.publish({ t: 'delta', agent: 'claude', sessionId, id, field: 'text', text: ev.delta.text });
          else if (ev.delta.type === 'thinking_delta') hub.publish({ t: 'delta', agent: 'claude', sessionId, id, field: 'text', text: ev.delta.thinking });
        }
        return;
      }
      case 'assistant': {
        if (m.parent_tool_use_id) return;
        const msg: any = m.message;
        for (const block of msg.content ?? []) {
          const n = run.blockCount.get(msg.id) ?? 0;
          run.blockCount.set(msg.id, n + 1);
          const e = this.blockToEntry(block, `${msg.id}:${n}`);
          if (e && !(e.kind === 'thinking' && !e.text)) pub(e);
        }
        return;
      }
      case 'user': {
        if (m.parent_tool_use_id) return;
        const content: any = (m.message as any).content;
        if (!Array.isArray(content)) return;
        for (const block of content) {
          if (block.type !== 'tool_result') continue;
          const tool = this.tools.get(block.tool_use_id);
          if (!tool?.tool) continue;
          tool.tool.status = block.is_error ? 'error' : 'ok';
          tool.tool.output = clip(resultText(block.content));
          pub(tool);
        }
        return;
      }
      case 'system': {
        const s: any = m;
        if (s.subtype === 'init' && this.models.length <= 4) {
          run.q.supportedModels().then((list) => {
            this.models = [{ id: '', label: 'Par défaut' }, ...list.filter((x) => x.value !== 'default').map((x) => ({ id: x.value, label: x.displayName }))];
          }, () => undefined);
        } else if (s.subtype === 'session_state_changed') {
          const status = s.state === 'requires_action' ? 'waiting' : s.state === 'running' ? 'running' : 'idle';
          hub.publish({ t: 'status', agent: 'claude', sessionId, status });
        } else if (s.subtype === 'compact_boundary') {
          pub({ id: s.uuid, kind: 'notice', text: 'Contexte compacté' });
        }
        return;
      }
      case 'result': {
        const r: any = m;
        const ok = r.subtype === 'success' && !r.is_error;
        if (!ok) pub({ id: r.uuid ?? randomUUID(), kind: 'error', text: r.result || (r.errors ?? []).join('\n') || `Échec (${r.subtype})` });
        hub.publish({ t: 'status', agent: 'claude', sessionId, status: 'idle' });
        hub.publish({ t: 'turn-done', agent: 'claude', sessionId, summary: oneLine(r.result ?? ''), error: !ok });
        hub.publish({ t: 'sessions-changed', agent: 'claude' });
        clearTimeout(run.idleTimer);
        run.idleTimer = setTimeout(() => run.inbox.close(), IDLE_CLOSE_MS);
        return;
      }
    }
  }

  private blockToEntry(block: any, id: string, streaming = false): Entry | undefined {
    switch (block?.type) {
      case 'text':
        return { id, kind: 'assistant', text: block.text ?? '' };
      case 'thinking':
        return { id, kind: 'thinking', text: block.thinking ?? '' };
      case 'redacted_thinking':
        return undefined;
      case 'tool_use': {
        const prev = this.tools.get(block.id);
        const entry: Entry = {
          id: block.id, kind: 'tool',
          tool: { ...describeTool(block.name, streaming ? {} : block.input), status: prev?.tool?.status ?? 'running', output: prev?.tool?.output },
        };
        if (streaming && prev) return undefined;
        this.tools.set(block.id, entry);
        if (this.tools.size > 2000) this.tools.delete(this.tools.keys().next().value!);
        return entry;
      }
      default:
        return undefined;
    }
  }

  private askPermission(
    sessionId: string, toolName: string, input: Record<string, unknown>,
    o: { signal: AbortSignal; suggestions?: PermissionUpdate[]; title?: string; description?: string; decisionReason?: string; suppressAlwaysAllow?: boolean } & Record<string, any>,
  ): Promise<PermissionResult> {
    const id = randomUUID();
    const inp: any = input;
    let request: PendingRequest;
    if (toolName === 'AskUserQuestion') {
      request = {
        id, agent: 'claude', sessionId, createdAt: Date.now(),
        title: 'Claude te pose une question',
        questions: (inp.questions ?? []).map((q: any, i: number) => ({
          id: String(i), header: q.header, question: q.question, multiSelect: !!q.multiSelect, allowOther: true,
          options: (q.options ?? []).map((op: any) => ({ label: op.label, description: op.description })),
        })),
        choices: [{ id: 'answer', label: 'Répondre', style: 'primary' }, { id: 'deny', label: 'Ignorer', style: 'secondary' }],
      };
    } else if (toolName === 'ExitPlanMode') {
      request = {
        id, agent: 'claude', sessionId, createdAt: Date.now(),
        title: 'Claude a terminé son plan', detail: String(inp.plan ?? ''), detailKind: 'markdown',
        choices: [
          { id: 'allow', label: 'Valider', style: 'primary' },
          { id: 'allow-edits', label: 'Valider + éditions auto', style: 'secondary' },
          { id: 'deny', label: 'Continuer à planifier', style: 'secondary' },
        ],
      };
    } else {
      const d = describeTool(toolName, input);
      const choices: PendingRequest['choices'] = [{ id: 'allow', label: 'Autoriser', style: 'primary' }];
      if (o.suggestions?.length && !o.suppressAlwaysAllow) choices.push({ id: 'always', label: 'Toujours autoriser', style: 'secondary' });
      choices.push({ id: 'deny', label: 'Refuser', style: 'danger' });
      request = {
        id, agent: 'claude', sessionId, createdAt: Date.now(),
        title: o.title || permissionTitle(toolName, input),
        detail: d.diff ?? d.code ?? d.subtitle ?? (o.description || o.decisionReason),
        detailKind: d.diff ? 'diff' : 'code',
        choices,
      };
    }
    return new Promise<PermissionResult>((resolve) => {
      this.pending.set(id, { request, resolve, input, suggestions: o.suggestions });
      hub.publish({ t: 'request', request });
      hub.publish({ t: 'status', agent: 'claude', sessionId, status: 'waiting' });
      o.signal.addEventListener('abort', () => this.resolvePending(id, { behavior: 'deny', message: 'Annulé' }), { once: true });
    });
  }

  answer(requestId: string, a: Answer): boolean {
    const p = this.pending.get(requestId);
    if (!p) return false;
    const input = p.input as any;
    let result: PermissionResult;
    switch (a.choice) {
      case 'answer': {
        const answers: Record<string, string> = {};
        (input.questions ?? []).forEach((q: any, i: number) => {
          const picked = a.answers?.[String(i)];
          if (picked?.length) answers[q.question] = picked.join(', ');
        });
        result = { behavior: 'allow', updatedInput: { ...input, answers } };
        break;
      }
      case 'allow':
        result = { behavior: 'allow', updatedInput: input };
        break;
      case 'always':
        result = { behavior: 'allow', updatedInput: input, updatedPermissions: p.suggestions };
        break;
      case 'allow-edits': {
        result = { behavior: 'allow', updatedInput: input, updatedPermissions: [{ type: 'setMode', mode: 'acceptEdits', destination: 'session' }] };
        const run = this.runs.get(p.request.sessionId);
        if (run) run.mode = 'acceptEdits';
        break;
      }
      default:
        result = { behavior: 'deny', message: p.request.title.startsWith('Claude a terminé') ? 'L’utilisateur veut continuer à planifier.' : 'Refusé par l’utilisateur depuis Pocket Bridge.' };
    }
    this.resolvePending(requestId, result);
    return true;
  }

  private resolvePending(id: string, result: PermissionResult) {
    const p = this.pending.get(id);
    if (!p) return;
    this.pending.delete(id);
    p.resolve(result);
    hub.publish({ t: 'request-resolved', id, agent: 'claude', sessionId: p.request.sessionId });
    if (this.runs.has(p.request.sessionId)) hub.publish({ t: 'status', agent: 'claude', sessionId: p.request.sessionId, status: 'running' });
  }

  async interrupt(sessionId: string) {
    for (const [id, p] of this.pending) if (p.request.sessionId === sessionId) this.resolvePending(id, { behavior: 'deny', message: 'Interrompu', interrupt: true });
    await this.runs.get(sessionId)?.q.interrupt();
  }

  async release(sessionId: string) {
    const run = this.runs.get(sessionId);
    if (run && hub.status('claude', sessionId) === 'idle') run.inbox.close();
  }

  dispose() {
    for (const run of this.runs.values()) { run.inbox.close(); run.q.close?.(); }
    this.runs.clear();
  }
}

function userTextEntry(id: string, raw: string): Entry | undefined {
  const command = raw.match(/<command-name>(.*?)<\/command-name>/s);
  if (command) {
    const args = raw.match(/<command-args>(.*?)<\/command-args>/s)?.[1]?.trim();
    return { id, kind: 'user', text: `${command[1].trim()}${args ? ' ' + args : ''}` };
  }
  const stdout = raw.match(/<local-command-stdout>(.*?)<\/local-command-stdout>/s);
  if (stdout) return stdout[1].trim() ? { id, kind: 'notice', text: clip(stdout[1].trim(), 400) } : undefined;
  if (raw.startsWith('This session is being continued from a previous conversation')) return { id, kind: 'notice', text: 'Suite d’une conversation compactée' };
  if (raw.startsWith('[Request interrupted')) return { id, kind: 'notice', text: 'Interrompu' };
  const text = raw.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').replace(/<(ide_selection|ide_opened_file)>[\s\S]*?<\/\1>/g, '').trim();
  if (!text || text.startsWith('<')) return undefined;
  return { id, kind: 'user', text };
}

const clip = (s: string, n = MAX_OUTPUT) => (s.length > n ? s.slice(0, n) + `\n… (${s.length - n} caractères de plus)` : s);
const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim().slice(0, 160);
