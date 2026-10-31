import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import Redis from 'ioredis';

function now() {
  return Date.now();
}

function auditEvent(previous, input) {
  return {
    id: `evt_${crypto.randomBytes(8).toString('hex')}`,
    at: new Date().toISOString(),
    type: input.type,
    actor: input.actor || null,
    opId: input.opId || null,
    outcome: input.outcome || 'success',
    meta: input.meta || {},
    prevHash: previous?.hash || 'GENESIS',
    hash: '',
  };
}

function sealAudit(event) {
  const payload = JSON.stringify({
    id: event.id,
    at: event.at,
    type: event.type,
    actor: event.actor,
    opId: event.opId,
    outcome: event.outcome,
    meta: event.meta,
    prevHash: event.prevHash,
  });
  event.hash = crypto.createHash('sha256').update(payload).digest('hex');
  return event;
}

function alive(record) {
  return Boolean(record) && (record.exp === 0 || record.exp > now());
}

class MemoryStore {
  constructor({ stateFile = '' } = {}) {
    this.kind = stateFile ? 'memory+disk' : 'memory';
    this.stateFile = stateFile;
    this.persistTimer = null;
    this.sessions = new Map();
    this.drafts = new Map();
    this.tickets = new Map();
    this.codes = new Map();
    this.redeemed = new Map();
    this.userDrafts = new Map();
    this.recipients = new Map();
    this.idempotency = new Map();
    this.audit = [];
    this.auditQueue = Promise.resolve();
    this.research = [];
    this.handlers = new Set();
    this.bus = new EventEmitter();
    this.bus.setMaxListeners(0);
    this.bus.on('event', (envelope) => {
      for (const handler of this.handlers) {
        try {
          handler(envelope);
        } catch {
          /* isolation: один сломанный подписчик не должен ронять доставку */
        }
      }
    });
    if (this.stateFile) {
      this.restoreState();
      this.wrapPersistence();
    }
  }

  /* Демо-персистентность: снимок памяти на диск, чтобы черновики
     переживали перезапуск без Redis/Docker. */
  wrapPersistence() {
    const methods = [
      'setSession',
      'putDraft',
      'putRecipient',
      'deleteRecipient',
      'putIdempotency',
      'putTicket',
      'consumeTicket',
      'putCode',
      'deleteCode',
      'markRedeemed',
      'appendAudit',
      'appendResearch',
    ];
    for (const name of methods) {
      const original = this[name].bind(this);
      this[name] = (...args) => {
        const result = original(...args);
        if (result && typeof result.then === 'function') {
          return result.then((value) => {
            this.persistState();
            return value;
          });
        }
        this.persistState();
        return result;
      };
    }
  }

  persistState() {
    if (!this.stateFile || this.persistTimer) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      this.writeState();
    }, 250);
    this.persistTimer.unref?.();
  }

  writeState() {
    if (!this.stateFile) return;
    const snapshot = {
      v: 1,
      at: new Date().toISOString(),
      sessions: [...this.sessions],
      drafts: [...this.drafts],
      tickets: [...this.tickets],
      codes: [...this.codes],
      redeemed: [...this.redeemed],
      recipients: [...this.recipients],
      idempotency: [...this.idempotency],
      audit: this.audit,
      research: this.research,
    };
    try {
      fs.mkdirSync(path.dirname(this.stateFile), { recursive: true });
      const tmp = `${this.stateFile}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(snapshot));
      fs.renameSync(tmp, this.stateFile);
    } catch {
      /* диск недоступен — демо продолжает работать в памяти */
    }
  }

  restoreState() {
    try {
      if (!fs.existsSync(this.stateFile)) return;
      const data = JSON.parse(fs.readFileSync(this.stateFile, 'utf8'));
      const restore = (key, target) => {
        const entries = Array.isArray(data[key]) ? data[key] : [];
        for (const [id, record] of entries) {
          if (record && (record.exp === 0 || record.exp > now())) target.set(id, record);
        }
      };
      restore('sessions', this.sessions);
      restore('drafts', this.drafts);
      restore('tickets', this.tickets);
      restore('codes', this.codes);
      restore('redeemed', this.redeemed);
      restore('recipients', this.recipients);
      restore('idempotency', this.idempotency);
      this.audit = Array.isArray(data.audit) ? data.audit : [];
      this.research = Array.isArray(data.research) ? data.research : [];
      this.userDrafts = new Map();
      for (const [id, record] of this.drafts) {
        const draft = record?.v;
        if (!draft?.userId) continue;
        if (!this.userDrafts.has(draft.userId)) this.userDrafts.set(draft.userId, new Set());
        this.userDrafts.get(draft.userId).add(id);
      }
    } catch {
      /* повреждённый снимок игнорируем — стартуем с чистого состояния */
    }
  }

  async connect() {
    return this;
  }

  async close() {
    this.handlers.clear();
    this.bus.removeAllListeners();
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    this.writeState();
  }

  subscribe(handler) {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  async setSession(sid, session, ttlSec) {
    this.sessions.set(sid, { v: session, exp: now() + ttlSec * 1000 });
  }

  async getSession(sid) {
    const record = this.sessions.get(sid);
    if (!alive(record)) {
      this.sessions.delete(sid);
      return null;
    }
    return record.v;
  }

  async putDraft(draft, ttlSec) {
    this.drafts.set(draft.id, { v: draft, exp: now() + ttlSec * 1000 });
    if (!this.userDrafts.has(draft.userId)) this.userDrafts.set(draft.userId, new Set());
    this.userDrafts.get(draft.userId).add(draft.id);
    return draft;
  }

  async getDraft(id) {
    const record = this.drafts.get(id);
    if (!alive(record)) {
      this.drafts.delete(id);
      return null;
    }
    return record.v;
  }

  async updateDraft(id, mutator, ttlSec) {
    const draft = await this.getDraft(id);
    if (!draft) return { error: { status: 404, code: 'DRAFT_NOT_FOUND' } };
    const outcome = mutator(structuredClone(draft));
    if (!outcome || outcome.error) return outcome || { error: { status: 500, code: 'EMPTY_MUTATION' } };
    await this.putDraft(outcome.draft, ttlSec);
    return outcome;
  }

  async listDrafts(userId) {
    const ids = this.userDrafts.get(userId);
    if (!ids) return [];
    const result = [];
    for (const id of ids) {
      const draft = await this.getDraft(id);
      if (draft) result.push(draft);
    }
    return result.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  }

  async listRecipients(userId) {
    const map = this.recipients.get(userId);
    if (!map) return [];
    return [...map.values()].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  }

  async putRecipient(userId, recipient) {
    if (!this.recipients.has(userId)) this.recipients.set(userId, new Map());
    this.recipients.get(userId).set(recipient.id, recipient);
    return recipient;
  }

  async deleteRecipient(userId, id) {
    const map = this.recipients.get(userId);
    if (!map || !map.has(id)) return false;
    map.delete(id);
    return true;
  }

  async getIdempotency(userId, key) {
    const record = this.idempotency.get(`${userId}:${key}`);
    if (!alive(record)) {
      this.idempotency.delete(`${userId}:${key}`);
      return null;
    }
    return record.v;
  }

  async putIdempotency(userId, key, value, ttlSec) {
    this.idempotency.set(`${userId}:${key}`, { v: value, exp: now() + ttlSec * 1000 });
    return value;
  }

  async putTicket(jti, data, ttlSec) {
    if (alive(this.tickets.get(jti))) return false;
    this.tickets.set(jti, { v: data, exp: now() + ttlSec * 1000 });
    return true;
  }

  async getTicket(jti) {
    const record = this.tickets.get(jti);
    if (!alive(record)) return null;
    return record.v;
  }

  async consumeTicket(jti) {
    const data = await this.getTicket(jti);
    if (!data) return null;
    this.tickets.delete(jti);
    return data;
  }

  async putCode(code, jti, ttlSec) {
    if (alive(this.codes.get(code))) return false;
    this.codes.set(code, { v: jti, exp: now() + ttlSec * 1000 });
    return true;
  }

  async getCode(code) {
    const record = this.codes.get(code);
    if (!alive(record)) {
      this.codes.delete(code);
      return null;
    }
    return record.v;
  }

  async deleteCode(code) {
    this.codes.delete(code);
  }

  async markRedeemed(jti, info) {
    this.redeemed.set(jti, { v: info, exp: now() + 10 * 60 * 1000 });
  }

  async getRedeemed(jti) {
    const record = this.redeemed.get(jti);
    if (!alive(record)) return null;
    return record.v;
  }

  async appendAudit(input) {
    this.auditQueue = this.auditQueue.then(() => {
      const previous = this.audit[this.audit.length - 1] || null;
      const event = sealAudit(auditEvent(previous, input));
      this.audit.push(event);
      if (this.audit.length > 10000) this.audit.shift();
      return event;
    });
    return this.auditQueue;
  }

  async listAudit(limit = 100) {
    return this.audit.slice(-Math.max(1, Math.min(limit, 10000)));
  }

  async verifyAudit() {
    let previous = 'GENESIS';
    for (const event of this.audit) {
      if (event.prevHash !== previous) return { valid: false, brokenAt: event.id };
      const copy = sealAudit({ ...event, hash: '' });
      if (copy.hash !== event.hash) return { valid: false, brokenAt: event.id };
      previous = event.hash;
    }
    return { valid: true, events: this.audit.length, lastHash: previous };
  }

  async appendResearch(record) {
    this.research.push(record);
    if (this.research.length > 2000) this.research.shift();
    return record;
  }

  async listResearch(limit = 500) {
    return this.research.slice(-Math.max(1, Math.min(limit, 2000)));
  }

  async listAllDrafts() {
    return [...this.drafts.values()].map((record) => record.v);
  }

  async publish(userId, type, payload) {
    const envelope = { userId, type, payload, at: new Date().toISOString() };
    setImmediate(() => this.bus.emit('event', envelope));
    return envelope;
  }
}

class RedisStore {
  constructor(url) {
    this.kind = 'redis';
    this.url = url;
    this.client = null;
    this.publisher = null;
    this.subscriber = null;
    this.handlers = new Set();
    this.auditQueue = Promise.resolve();
  }

  async connect() {
    const options = {
      maxRetriesPerRequest: 2,
      enableOfflineQueue: false,
      lazyConnect: true,
      retryStrategy: () => null,
      reconnectOnError: () => false,
    };
    this.client = new Redis(this.url, options);
    this.publisher = new Redis(this.url, options);
    this.subscriber = new Redis(this.url, options);
    this.client.on('error', () => {});
    this.publisher.on('error', () => {});
    this.subscriber.on('error', () => {});
    await Promise.all([this.client.connect(), this.publisher.connect(), this.subscriber.connect()]);
    await this.client.ping();
    this.subscriber.on('message', (_channel, message) => {
      let envelope;
      try {
        envelope = JSON.parse(message);
      } catch {
        return;
      }
      for (const handler of this.handlers) {
        try {
          handler(envelope);
        } catch {
          /* no-op */
        }
      }
    });
    await this.subscriber.subscribe('sb:events');
    return this;
  }

  async close() {
    this.handlers.clear();
    await Promise.allSettled([
      this.client?.quit(),
      this.publisher?.quit(),
      this.subscriber?.quit(),
    ]);
    for (const client of [this.client, this.publisher, this.subscriber]) {
      if (!client) continue;
      client.removeAllListeners();
      client.disconnect();
      client.stream?.destroy();
    }
    this.client = null;
    this.publisher = null;
    this.subscriber = null;
  }

  subscribe(handler) {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  async setSession(sid, session, ttlSec) {
    await this.client.set(`sess:${sid}`, JSON.stringify(session), 'EX', ttlSec);
  }

  async getSession(sid) {
    const raw = await this.client.get(`sess:${sid}`);
    return raw ? JSON.parse(raw) : null;
  }

  async putDraft(draft, ttlSec) {
    const key = `draft:${draft.id}`;
    await this.client
      .multi()
      .set(key, JSON.stringify(draft), 'EX', ttlSec)
      .sadd(`user:${draft.userId}:drafts`, draft.id)
      .expire(`user:${draft.userId}:drafts`, ttlSec)
      .exec();
    return draft;
  }

  async getDraft(id) {
    const raw = await this.client.get(`draft:${id}`);
    return raw ? JSON.parse(raw) : null;
  }

  async updateDraft(id, mutator, ttlSec) {
    const key = `draft:${id}`;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      await this.client.watch(key);
      const raw = await this.client.get(key);
      if (!raw) {
        await this.client.unwatch();
        return { error: { status: 404, code: 'DRAFT_NOT_FOUND' } };
      }
      const outcome = mutator(JSON.parse(raw));
      if (!outcome || outcome.error) {
        await this.client.unwatch();
        return outcome || { error: { status: 500, code: 'EMPTY_MUTATION' } };
      }
      const tx = this.client.multi();
      tx.set(key, JSON.stringify(outcome.draft), 'EX', ttlSec);
      tx.sadd(`user:${outcome.draft.userId}:drafts`, id);
      const result = await tx.exec();
      if (result) return outcome;
    }
    return { error: { status: 503, code: 'WRITE_CONTENTION' } };
  }

  async listDrafts(userId) {
    const ids = await this.client.smembers(`user:${userId}:drafts`);
    if (!ids.length) return [];
    const raws = await this.client.mget(ids.map((id) => `draft:${id}`));
    return raws
      .filter(Boolean)
      .map((raw) => JSON.parse(raw))
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  }

  async listRecipients(userId) {
    const raw = await this.client.hgetall(`user:${userId}:recipients`);
    return Object.values(raw)
      .map((value) => JSON.parse(value))
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  }

  async putRecipient(userId, recipient) {
    const key = `user:${userId}:recipients`;
    await this.client
      .multi()
      .hset(key, recipient.id, JSON.stringify(recipient))
      .expire(key, 90 * 24 * 60 * 60)
      .exec();
    return recipient;
  }

  async deleteRecipient(userId, id) {
    const removed = await this.client.hdel(`user:${userId}:recipients`, id);
    return removed > 0;
  }

  async getIdempotency(userId, key) {
    const raw = await this.client.get(`idem:${userId}:${key}`);
    return raw ? JSON.parse(raw) : null;
  }

  async putIdempotency(userId, key, value, ttlSec) {
    await this.client.set(`idem:${userId}:${key}`, JSON.stringify(value), 'EX', ttlSec);
  }

  async putTicket(jti, data, ttlSec) {
    const result = await this.client.set(`ticket:${jti}`, JSON.stringify(data), 'EX', ttlSec, 'NX');
    return result === 'OK';
  }

  async getTicket(jti) {
    const raw = await this.client.get(`ticket:${jti}`);
    return raw ? JSON.parse(raw) : null;
  }

  async consumeTicket(jti) {
    const raw = await this.client.getdel(`ticket:${jti}`);
    return raw ? JSON.parse(raw) : null;
  }

  async putCode(code, jti, ttlSec) {
    const result = await this.client.set(`code:${code}`, jti, 'EX', ttlSec, 'NX');
    return result === 'OK';
  }

  async getCode(code) {
    return this.client.get(`code:${code}`);
  }

  async deleteCode(code) {
    await this.client.del(`code:${code}`);
  }

  async markRedeemed(jti, info) {
    await this.client.set(`redeemed:${jti}`, JSON.stringify(info), 'EX', 600);
  }

  async getRedeemed(jti) {
    const raw = await this.client.get(`redeemed:${jti}`);
    return raw ? JSON.parse(raw) : null;
  }

  async appendAudit(input) {
    this.auditQueue = this.auditQueue.then(async () => {
      const raw = await this.client.lindex('audit:events', -1);
      const previous = raw ? JSON.parse(raw) : null;
      const event = sealAudit(auditEvent(previous, input));
      await this.client.rpush('audit:events', JSON.stringify(event));
      await this.client.ltrim('audit:events', -10000, -1);
      return event;
    });
    return this.auditQueue;
  }

  async listAudit(limit = 100) {
    const count = Math.max(1, Math.min(limit, 10000));
    const raws = await this.client.lrange('audit:events', -count, -1);
    return raws.map((raw) => JSON.parse(raw));
  }

  async verifyAudit() {
    const raws = await this.client.lrange('audit:events', 0, -1);
    let previous = 'GENESIS';
    for (const raw of raws) {
      const event = JSON.parse(raw);
      if (event.prevHash !== previous) return { valid: false, brokenAt: event.id };
      const copy = sealAudit({ ...event, hash: '' });
      if (copy.hash !== event.hash) return { valid: false, brokenAt: event.id };
      previous = event.hash;
    }
    return { valid: true, events: raws.length, lastHash: previous };
  }

  async appendResearch(record) {
    await this.client.rpush('research:sessions', JSON.stringify(record));
    await this.client.ltrim('research:sessions', -2000, -1);
    return record;
  }

  async listResearch(limit = 500) {
    const count = Math.max(1, Math.min(limit, 2000));
    const raws = await this.client.lrange('research:sessions', -count, -1);
    return raws.map((raw) => JSON.parse(raw));
  }

  async listAllDrafts() {
    const keys = await this.client.keys('draft:*');
    if (!keys.length) return [];
    const raws = await this.client.mget(keys);
    return raws.filter(Boolean).map((raw) => JSON.parse(raw));
  }

  async publish(userId, type, payload) {
    const envelope = { userId, type, payload, at: new Date().toISOString() };
    await this.publisher.publish('sb:events', JSON.stringify(envelope));
    return envelope;
  }
}

export async function createStore({ redisUrl, stateFile = '', logger } = {}) {
  if (redisUrl) {
    try {
      const store = await new RedisStore(redisUrl).connect();
      logger?.info('state store: redis');
      return store;
    } catch (error) {
      logger?.warn({ err: error.message }, 'redis unavailable, falling back to in-memory store');
    }
  }
  if (stateFile) logger?.info({ stateFile }, 'state store: in-memory + disk snapshot');
  else logger?.info('state store: in-memory (demo mode)');
  return new MemoryStore({ stateFile }).connect();
}
