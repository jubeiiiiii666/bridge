// Web Push (VAPID) so the phone is notified when an agent needs an answer or finishes,
// even with the screen off. Delivery goes through the browser vendor's push service.
import webpush, { type PushSubscription } from 'web-push';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export interface PushPayload {
  title: string;
  body: string;
  url: string;
  tag: string;
  requireInteraction?: boolean;
}

export class Push {
  private subs: PushSubscription[] = [];
  publicKey = '';

  constructor(private readonly dir: string, private readonly log: (s: string) => void) {}

  async init() {
    const keyFile = path.join(this.dir, 'vapid.json');
    let keys: { publicKey: string; privateKey: string };
    if (existsSync(keyFile)) keys = JSON.parse(await readFile(keyFile, 'utf8'));
    else {
      keys = webpush.generateVAPIDKeys();
      await writeFile(keyFile, JSON.stringify(keys));
    }
    webpush.setVapidDetails('mailto:pocket-bridge@localhost', keys.publicKey, keys.privateKey);
    this.publicKey = keys.publicKey;
    const subFile = path.join(this.dir, 'push-subscriptions.json');
    if (existsSync(subFile)) this.subs = JSON.parse(await readFile(subFile, 'utf8'));
  }

  private save() {
    return writeFile(path.join(this.dir, 'push-subscriptions.json'), JSON.stringify(this.subs));
  }

  async subscribe(sub: PushSubscription) {
    this.subs = this.subs.filter((s) => s.endpoint !== sub.endpoint);
    this.subs.push(sub);
    await this.save();
  }

  async unsubscribe(endpoint: string) {
    this.subs = this.subs.filter((s) => s.endpoint !== endpoint);
    await this.save();
  }

  get count() {
    return this.subs.length;
  }

  async clear() {
    this.subs = [];
    await this.save();
  }

  async send(payload: PushPayload) {
    const dead: string[] = [];
    await Promise.all(this.subs.map(async (s) => {
      try {
        await webpush.sendNotification(s, JSON.stringify(payload), { TTL: 600, urgency: 'high' });
      } catch (e: any) {
        if (e?.statusCode === 404 || e?.statusCode === 410) dead.push(s.endpoint);
        else this.log(`[push] ${e?.statusCode ?? ''} ${e?.body ?? e}`);
      }
    }));
    if (dead.length) {
      this.subs = this.subs.filter((s) => !dead.includes(s.endpoint));
      await this.save();
    }
  }
}
