// Central event bus: agents publish, the HTTP/WS server, push notifications and the
// VS Code UI subscribe. Also keeps the live state (status, pending approvals) so a
// client connecting mid-turn gets the full picture.
import { EventEmitter } from 'node:events';
import type { AgentId, HubEvent, PendingRequest, SessionStatus } from './types';

class Hub extends EventEmitter {
  readonly statuses = new Map<string, SessionStatus>(); // key: agent:sessionId
  readonly requests = new Map<string, PendingRequest>();

  publish(ev: HubEvent) {
    if (ev.t === 'status') {
      const key = `${ev.agent}:${ev.sessionId}`;
      if (ev.status === 'idle') this.statuses.delete(key);
      else this.statuses.set(key, ev.status);
    } else if (ev.t === 'request') {
      this.requests.set(ev.request.id, ev.request);
    } else if (ev.t === 'request-resolved') {
      this.requests.delete(ev.id);
    }
    this.emit('event', ev);
  }

  status(agent: AgentId, sessionId: string): SessionStatus {
    return this.statuses.get(`${agent}:${sessionId}`) ?? 'idle';
  }

  onEvent(fn: (ev: HubEvent) => void): () => void {
    this.on('event', fn);
    return () => this.off('event', fn);
  }
}

export const hub = new Hub();
hub.setMaxListeners(100);
