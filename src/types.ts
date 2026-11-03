// Wire model shared by both agents and the PWA. Each agent adapter converts its own
// transcript format (Claude JSONL messages, Codex thread items) into these entries.

export type AgentId = 'claude' | 'codex';

export type SessionStatus = 'idle' | 'running' | 'waiting';

export interface SessionSummary {
  id: string;
  title: string;
  cwd: string;
  updatedAt: number; // ms epoch
  status: SessionStatus;
  live: boolean; // a process owned by Pocket Bridge is attached to it
}

export type ToolStatus = 'running' | 'ok' | 'error' | 'denied';

export interface Entry {
  id: string;
  kind: 'user' | 'assistant' | 'thinking' | 'tool' | 'notice' | 'error';
  text?: string;
  ts?: number;
  // tool entries
  tool?: {
    icon: 'terminal' | 'file' | 'edit' | 'search' | 'web' | 'agent' | 'todo' | 'plan' | 'mcp' | 'tool';
    title: string; // "Commande", "Modification"…
    subtitle?: string; // command line, file path, query…
    code?: string; // full command / content preview
    diff?: string; // unified diff
    output?: string;
    status: ToolStatus;
  };
}

export interface Choice {
  id: string;
  label: string;
  style: 'primary' | 'secondary' | 'danger';
}

export interface Question {
  id: string;
  header?: string;
  question: string;
  options: { label: string; description?: string }[];
  multiSelect?: boolean;
  allowOther?: boolean;
}

export interface PendingRequest {
  id: string;
  agent: AgentId;
  sessionId: string;
  title: string; // "Claude veut exécuter une commande"
  detail?: string; // command, path, plan markdown…
  detailKind?: 'code' | 'markdown' | 'diff';
  choices: Choice[];
  questions?: Question[]; // when set, the UI collects answers instead of showing choices only
  createdAt: number;
}

export interface Answer {
  choice: string;
  answers?: Record<string, string[]>;
}

export type HubEvent =
  | { t: 'sessions-changed'; agent: AgentId }
  | { t: 'status'; agent: AgentId; sessionId: string; status: SessionStatus }
  | { t: 'entry'; agent: AgentId; sessionId: string; entry: Entry }
  | { t: 'delta'; agent: AgentId; sessionId: string; id: string; field: 'text' | 'output'; text: string }
  | { t: 'request'; request: PendingRequest }
  | { t: 'request-resolved'; id: string; agent: AgentId; sessionId: string }
  | { t: 'turn-done'; agent: AgentId; sessionId: string; summary: string; error?: boolean }
  | { t: 'reload'; agent: AgentId; sessionId: string };

export interface SendOptions {
  sessionId?: string; // absent = new conversation
  cwd?: string;
  text: string;
  images?: { mediaType: string; base64: string }[];
  model?: string;
  mode?: string;
}

export interface ModeOption {
  id: string;
  label: string;
  hint: string;
}

export interface AgentInfo {
  id: AgentId;
  label: string;
  available: boolean;
  reason?: string;
  models: { id: string; label: string }[];
  modes: ModeOption[];
  defaultMode: string;
}

export interface Agent {
  readonly id: AgentId;
  info(): Promise<AgentInfo>;
  listSessions(): Promise<SessionSummary[]>;
  loadSession(sessionId: string): Promise<Entry[]>;
  /** Last-modified marker of the transcript, used to follow sessions running elsewhere (e.g. the VS Code panel). */
  stamp(sessionId: string): Promise<number>;
  isLive(sessionId: string): boolean;
  send(opts: SendOptions): Promise<string>; // resolves with the session id
  interrupt(sessionId: string): Promise<void>;
  answer(requestId: string, answer: Answer): boolean;
  /** Hand the session over to the official VS Code panel: stop our idle process for it. */
  release(sessionId: string): Promise<void>;
  dispose(): void;
}
