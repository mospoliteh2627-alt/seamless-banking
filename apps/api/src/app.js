import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import QRCode from 'qrcode';
import { createStore } from './store.js';
import { config as baseConfig } from './config.js';
import { signJwt, verifyJwt, randomId, randomCode } from './crypto.js';

/* ------------------------------------------------------------------ */
/* Демонстрационные данные. В промышленном контуре — доменный сервис.  */
/* ------------------------------------------------------------------ */

const DEMO_USER = {
  id: 'user_42',
  name: 'Анна Смирнова',
  phone: '+7 900 000-00-42',
  email: 'anna.smirnova@example.ru',
  segment: 'Premium',
  accounts: [
    { id: 'acc_main', title: 'Текущий счёт', masked: '•• 4417', balance: 128450.75, currency: 'RUB' },
    { id: 'acc_save', title: 'Накопительный счёт', masked: '•• 9082', balance: 412000.0, currency: 'RUB' },
  ],
  cards: [{ id: 'card_1', masked: '•• 7712', brand: 'МИР', expires: '09/28' }],
};

const RESEARCH = {
  simulation: {
    observations: 17280,
    profiles: 48,
    replicates: 120,
    conditions: { A: 276.5, B: 445.8, C: 257.5 },
    savingPct: 38.0,
    ci95: [37.8, 38.2],
    cohenDz: 2.92,
    pValue: '< 0,001',
  },
  hypotheses: [
    { id: 'H1', title: 'Сокращение времени операции', criterion: 'ΔTCT ≥ 30 %', result: '38,0 %, ДИ [37,8; 38,2], d_z = 2,92', status: 'confirmed', kind: 'simulation' },
    { id: 'H2', title: 'Полнота переноса контекста', criterion: 'CRR = 100 %', result: '100 % на 24 проверках', status: 'confirmed', kind: 'test' },
    { id: 'H3', title: 'Субъективная юзабилити', criterion: 'SUS ≥ 80', result: 'не измерялась', status: 'not_tested', kind: 'field' },
    { id: 'H4', title: 'Воспринимаемое усилие', criterion: 'CES ≤ 2,5', result: 'не измерялась', status: 'not_tested', kind: 'field' },
    { id: 'H5', title: 'Задержка синхронизации', criterion: 'p95 ≤ 150 мс', result: 'p95 = 15 мс, p99 = 21 мс', status: 'confirmed', kind: 'load' },
    { id: 'H6', title: 'Снижение TAR и NPV', criterion: 'ΔTAR ≥ 3 п.п., NPV > 0', result: 'ΔTAR 3 п.п.; NPV 12,7 млн ₽', status: 'scenario', kind: 'model' },
  ],
  metrics: [
    { id: 'M1', name: 'TCT, handoff', value: '276,5 с', target: '−30 %', status: 'ok' },
    { id: 'M2', name: 'TCT, повторный ввод', value: '445,8 с', target: 'база', status: 'base' },
    { id: 'M3', name: 'TCT, только web', value: '257,5 с', target: 'контроль', status: 'base' },
    { id: 'M10', name: 'Sync p95', value: '15 мс', target: '≤ 150 мс', status: 'ok' },
    { id: 'M12', name: 'CRR', value: '100 %', target: '100 %', status: 'ok' },
    { id: 'M33', name: 'WCAG 2.2 AA', value: '0 нарушений', target: '0', status: 'ok' },
    { id: 'M23', name: 'Conversion', value: '100 % демо', target: '+3 п.п.', status: 'model' },
    { id: 'SI', name: 'Индекс бесшовности', value: 'не рассчитан', target: '≥ 0,75', status: 'pending' },
  ],
};

function aggregateResearch(sessions) {
  const groups = {};
  for (const session of sessions) {
    const key = session.condition;
    if (!groups[key]) groups[key] = { condition: key, count: 0, tct: [], errors: [], completed: 0, sus: [], ces: [] };
    const group = groups[key];
    group.count += 1;
    group.tct.push(Number(session.tctSec) || 0);
    group.errors.push(Number(session.errors) || 0);
    if (session.completed) group.completed += 1;
    if (Number.isFinite(Number(session.sus))) group.sus.push(Number(session.sus));
    if (Number.isFinite(Number(session.ces))) group.ces.push(Number(session.ces));
  }
  const mean = (values) => (values.length ? Number((values.reduce((a, b) => a + b, 0) / values.length).toFixed(2)) : null);
  return Object.values(groups).map((group) => ({
    condition: group.condition,
    count: group.count,
    meanTct: mean(group.tct),
    meanErrors: mean(group.errors),
    completionRate: group.count ? Number(((group.completed / group.count) * 100).toFixed(1)) : 0,
    meanSus: mean(group.sus),
    meanCes: mean(group.ces),
  }));
}

const EMPTY_FIELDS = {
  recipientName: '',
  recipientBank: '',
  recipientAccount: '',
  amount: '',
  currency: 'RUB',
  purpose: '',
  fee: '0',
  saveTemplate: false,
  saveRecipient: false,
};

const FIELD_LIMITS = {
  recipientName: 120,
  recipientBank: 120,
  recipientAccount: 34,
  amount: 18,
  currency: 3,
  purpose: 180,
  fee: 12,
};

const REQUIRED_FIELDS = ['recipientName', 'recipientAccount', 'amount'];

/* ------------------------------------------------------------------ */
/* Ошибки и утилиты                                                    */
/* ------------------------------------------------------------------ */

class HttpError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const iso = (ts = Date.now()) => new Date(ts).toISOString();

function deviceOf(auth) {
  return {
    deviceId: auth.deviceId,
    deviceName: auth.deviceName || 'Неизвестное устройство',
    channel: auth.channel,
  };
}

const DEMO_NAMES = ['Энеджан', 'Эмине'];

function randomDemoName() {
  return DEMO_NAMES[Math.floor(Math.random() * DEMO_NAMES.length)];
}

function publicUser() {
  return { ...DEMO_USER, name: randomDemoName() };
}

function cleanString(value, max) {
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .trim()
    .slice(0, max);
}

function sanitizeFields(input) {
  if (!input || typeof input !== 'object') return {};
  const result = {};
  for (const [key, limit] of Object.entries(FIELD_LIMITS)) {
    if (key in input) result[key] = cleanString(input[key], limit);
  }
  if ('saveTemplate' in input) result.saveTemplate = Boolean(input.saveTemplate);
  if ('saveRecipient' in input) result.saveRecipient = Boolean(input.saveRecipient);
  return result;
}

function sanitizeContext(input) {
  if (!input || typeof input !== 'object') return {};
  const result = {};
  if (typeof input.focus === 'string') result.focus = cleanString(input.focus, 64);
  if (Number.isFinite(input.caret)) result.caret = Math.max(0, Math.min(10000, Math.trunc(input.caret)));
  if (Number.isFinite(input.scroll)) result.scroll = Math.max(0, Math.min(100000, Math.trunc(input.scroll)));
  if (input.validation && typeof input.validation === 'object') {
    const validation = {};
    for (const [key, value] of Object.entries(input.validation).slice(0, 20)) {
      validation[cleanString(key, 40)] = cleanString(value, 160);
    }
    result.validation = validation;
  }
  if (input.a11y && typeof input.a11y === 'object') {
    result.a11y = {
      fontScale: Number(input.a11y.fontScale) || 1,
      contrast: input.a11y.contrast === 'high' ? 'high' : 'normal',
      reduceMotion: Boolean(input.a11y.reduceMotion),
    };
  }
  if (typeof input.locale === 'string') result.locale = cleanString(input.locale, 10);
  return result;
}

function parseAmount(value) {
  const normalized = String(value ?? '').replace(/\s/g, '').replace(',', '.');
  const amount = Number(normalized);
  return Number.isFinite(amount) ? amount : 0;
}

function leaseIsActive(lease) {
  return Boolean(lease && Number(lease.expiresAt) > Date.now());
}

function processView(draft) {
  const now = Date.now();
  const created = Date.parse(draft.createdAt) || now;
  const updated = Date.parse(draft.updatedAt) || now;
  const redeemed = draft.handoff?.redeemedAt ? Date.parse(draft.handoff.redeemedAt) : null;
  const submitted = draft.submittedAt ? Date.parse(draft.submittedAt) : null;

  const stages = [
    { key: 'created', label: 'Создана', at: new Date(created).toISOString(), done: true },
    { key: 'filling', label: 'Заполнение', at: updated > created ? new Date(updated).toISOString() : null, done: draft.step >= 2 },
    { key: 'confirm', label: 'Подтверждение', at: draft.step >= 3 ? new Date(updated).toISOString() : null, done: draft.step >= 3 },
    { key: 'handoff', label: 'Переход', at: redeemed ? new Date(redeemed).toISOString() : null, done: Boolean(redeemed) },
    { key: 'done', label: 'Исполнена', at: submitted ? new Date(submitted).toISOString() : null, done: draft.status === 'submitted' },
  ];

  const hasInput = Object.entries(draft.fields || {}).some(
    ([key, value]) => key !== 'currency' && key !== 'fee' && String(value || '').trim() !== '',
  );
  let stage = 0;
  if (hasInput) stage = 1;
  if (draft.step >= 2) stage = 1;
  if (draft.step >= 3) stage = 2;
  if (draft.handoff) stage = 3;
  if (draft.status === 'submitted') stage = 4;

  const slaDeadline = updated + 24 * 60 * 60 * 1000;
  const slaMinutes = Math.round((slaDeadline - now) / 60000);
  const amount = Number(String(draft.fields?.amount || '').replace(/\s/g, '').replace(',', '.')) || 0;
  let risk = 10;
  if (amount > 50_000) risk += 15;
  if (amount > 100_000) risk += 20;
  if (draft.step >= 3) risk += 10;
  if (draft.handoff) risk += 10;
  if (slaMinutes < 180) risk += 20;
  risk = Math.min(95, risk);

  return {
    id: draft.id,
    status: draft.status,
    ownerId: draft.userId,
    recipientName: draft.fields?.recipientName || '',
    amount: draft.fields?.amount || '',
    currency: draft.fields?.currency || 'RUB',
    step: draft.step,
    totalSteps: draft.totalSteps,
    stage,
    stageLabel: stages[stage].label,
    progress: Math.round((stage / (stages.length - 1)) * 100),
    stages,
    slaMinutes,
    slaState: slaMinutes < 0 ? 'breached' : slaMinutes < 180 ? 'at-risk' : 'ok',
    risk,
    riskLabel: risk >= 60 ? 'high' : risk >= 35 ? 'medium' : 'low',
    updatedAt: draft.updatedAt,
    handoff: draft.handoff,
    canEdit: draft.canEdit,
  };
}

function draftView(draft, auth) {
  const active = leaseIsActive(draft.lease);
  return {
    ...draft,
    canEdit: draft.status === 'draft' && (!active || draft.lease.deviceId === auth.deviceId),
    leaseActive: active,
    process: processView(draft),
  };
}

/* ------------------------------------------------------------------ */
/* Метрики                                                             */
/* ------------------------------------------------------------------ */

class Metrics {
  constructor() {
    this.startedAt = Date.now();
    this.counters = {
      logins: 0,
      stepUps: 0,
      draftsCreated: 0,
      patches: 0,
      conflicts: 0,
      leasesClaimed: 0,
      ticketsIssued: 0,
      handoffsRedeemed: 0,
      handoffFailures: 0,
      submissions: 0,
      wsConnections: 0,
    };
    this.syncSamples = [];
    this.handoffSamples = [];
    this.clientSyncSamples = [];
    this.redeemSamples = [];
  }

  inc(name, by = 1) {
    this.counters[name] = (this.counters[name] || 0) + by;
  }

  observeSync(ms) {
    this.syncSamples.push(Number(ms.toFixed(3)));
    if (this.syncSamples.length > 2000) this.syncSamples.shift();
  }

  observeHandoff(ms) {
    this.handoffSamples.push(Number(ms.toFixed(3)));
    if (this.handoffSamples.length > 2000) this.handoffSamples.shift();
  }

  observeClientSync(ms) {
    this.clientSyncSamples.push(Number(ms.toFixed(3)));
    if (this.clientSyncSamples.length > 2000) this.clientSyncSamples.shift();
  }

  observeRedeem(ms) {
    this.redeemSamples.push(Number(ms.toFixed(3)));
    if (this.redeemSamples.length > 2000) this.redeemSamples.shift();
  }

  static percentile(values, p) {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
    return sorted[index];
  }

  summary(samples) {
    if (!samples.length) return { count: 0, p50: null, p95: null, p99: null, max: null };
    return {
      count: samples.length,
      p50: Metrics.percentile(samples, 50),
      p95: Metrics.percentile(samples, 95),
      p99: Metrics.percentile(samples, 99),
      max: Math.max(...samples),
    };
  }

  snapshot(storeKind) {
    return {
      uptimeSec: Math.round((Date.now() - this.startedAt) / 1000),
      store: storeKind,
      counters: { ...this.counters },
      syncLatencyMs: this.summary(this.syncSamples),
      clientSyncLatencyMs: this.summary(this.clientSyncSamples),
      handoffLatencyMs: this.summary(this.handoffSamples),
      redeemLatencyMs: this.summary(this.redeemSamples),
    };
  }
}

/* ------------------------------------------------------------------ */
/* Приложение                                                          */
/* ------------------------------------------------------------------ */

export async function buildApp(options = {}) {
  const cfg = { ...baseConfig, ...(options.config || {}) };
  const app = Fastify({
    logger: options.logger ?? { level: cfg.logLevel },
    bodyLimit: 512 * 1024,
    trustProxy: true,
  });

  app.decorate('config', cfg);
  const store = await createStore({
    redisUrl: options.redisUrl ?? cfg.redisUrl,
    stateFile: options.stateFile ?? cfg.stateFile,
    logger: app.log,
  });
  app.decorate('store', store);
  const metrics = new Metrics();
  app.decorate('metrics', metrics);

  await app.register(cors, { origin: true, credentials: false });
  await app.register(websocket, { options: { maxPayload: 1024 * 1024 } });
  await app.register(fastifyStatic, {
    root: cfg.webRoot,
    prefix: '/',
    index: ['index.html'],
    cacheControl: false,
  });

  /* ------------------------- аутентификация ------------------------ */

  async function authenticate(request) {
    const header = request.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) throw new HttpError(401, 'UNAUTHORIZED', 'Требуется токен доступа');
    let payload;
    try {
      payload = verifyJwt(token, cfg.jwtSecret, { aud: 'api', typ: 'access' });
    } catch {
      throw new HttpError(401, 'TOKEN_INVALID', 'Токен недействителен или истёк');
    }
    const session = await store.getSession(payload.sid);
    if (!session) throw new HttpError(401, 'SESSION_EXPIRED', 'Сессия завершена');
    return {
      ...payload,
      authLevel: session.authLevel,
      role: session.role || 'client',
      session,
      deviceId: session.deviceId,
      deviceName: session.deviceName,
      channel: session.channel,
    };
  }

  function issueAccess(auth) {
    return signJwt(
      {
        sub: auth.sub,
        sid: auth.sid,
        deviceId: auth.deviceId,
        deviceName: auth.deviceName,
        channel: auth.channel,
        role: auth.role || 'client',
        lvl: auth.authLevel,
        typ: 'access',
        aud: 'api',
      },
      cfg.jwtSecret,
      cfg.accessTtlSec,
    );
  }

  const buckets = new Map();
  function rateLimit(key, max, windowMs) {
    const now = Date.now();
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt < now) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    if (bucket.count > max) throw new HttpError(429, 'RATE_LIMITED', 'Слишком много запросов, повторите позже');
  }

  function requireRole(auth, ...roles) {
    if (!roles.includes(auth.role || 'client')) {
      throw new HttpError(403, 'FORBIDDEN', 'Недостаточно прав для операции');
    }
  }

  async function audit(type, auth, data = {}) {
    try {
      await store.appendAudit({
        type,
        actor: auth
          ? { userId: auth.sub, role: auth.role || 'client', deviceId: auth.deviceId }
          : null,
        opId: data.opId || null,
        outcome: data.outcome || 'success',
        meta: data.meta || {},
      });
    } catch (error) {
      app.log.warn({ err: error.message, type }, 'audit write failed');
    }
  }

  function csvCell(value) {
    const text = String(value ?? '');
    return /[",\n;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }

  async function getOwnedDraft(id, auth) {
    const draft = await store.getDraft(id);
    if (!draft) throw new HttpError(404, 'DRAFT_NOT_FOUND', 'Черновик не найден');
    if (draft.userId !== auth.sub) throw new HttpError(403, 'FORBIDDEN', 'Нет доступа к операции');
    return draft;
  }

  /* ----------------------------- здоровье -------------------------- */

  app.get('/v1/health', async () => ({
    status: 'ok',
    service: 'seamless-banking-api',
    store: store.kind,
    time: iso(),
  }));

  app.get('/v1/metrics', async () => metrics.snapshot(store.kind));

  app.post('/v1/metrics/client', async (request, reply) => {
    await authenticate(request);
    const body = request.body || {};
    const value = Number(body.ms);
    if (!Number.isFinite(value) || value < 0 || value > 60_000) {
      throw new HttpError(400, 'BAD_METRIC', 'Некорректное значение задержки');
    }
    if (body.metric === 'redeem') metrics.observeRedeem(value);
    else metrics.observeClientSync(value);
    return reply.code(202).send({ accepted: true });
  });

  /* ------------------------------- вход ---------------------------- */

  app.post('/v1/auth/demo-login', async (request, reply) => {
    rateLimit(`${request.ip}:login`, 30, 60_000);
    const body = request.body || {};
    const channel = body.channel === 'mobile' ? 'mobile' : 'web';
    const deviceId = cleanString(body.deviceId, 64) || `dev_${randomId(6)}`;
    const deviceName =
      cleanString(body.deviceName, 64) || (channel === 'mobile' ? 'Мобильное устройство' : 'Браузер');
    const privileged = ['support', 'analyst', 'admin'].includes(body.role);
    const role = privileged ? body.role : 'client';
    if (privileged && body.adminCode !== cfg.adminCode) {
      throw new HttpError(403, 'ADMIN_CODE_REQUIRED', 'Неверный код демонстрационной роли');
    }
    const sid = `sid_${randomId(12)}`;
    const session = {
      sid,
      userId: DEMO_USER.id,
      deviceId,
      deviceName,
      channel,
      role,
      authLevel: channel === 'web' ? 2 : 1,
      createdAt: iso(),
    };
    await store.setSession(sid, session, cfg.sessionTtlSec);
    metrics.inc('logins');
    await audit('auth.login', { sub: DEMO_USER.id, role, deviceId }, { meta: { channel } });
    const token = issueAccess({
      sub: DEMO_USER.id,
      sid,
      deviceId,
      deviceName,
      channel,
      role,
      authLevel: session.authLevel,
    });
    return reply.code(200).send({
      token,
      expiresIn: cfg.accessTtlSec,
      user: publicUser(),
      session: {
        sid,
        channel,
        deviceId,
        deviceName,
        role,
        authLevel: session.authLevel,
      },
    });
  });

  app.get('/v1/me', async (request) => {
    const auth = await authenticate(request);
    const drafts = await store.listDrafts(auth.sub);
    return {
      user: publicUser(),
      session: {
        sid: auth.sid,
        channel: auth.channel,
        deviceId: auth.deviceId,
        deviceName: auth.deviceName,
        authLevel: auth.authLevel,
      },
      stats: { drafts: drafts.filter((d) => d.status === 'draft').length, total: drafts.length },
    };
  });

  app.post('/v1/auth/step-up', async (request) => {
    const auth = await authenticate(request);
    const body = request.body || {};
    const method = body.method === 'pin' ? 'pin' : body.method === 'biometric' ? 'biometric' : null;
    if (!method) throw new HttpError(400, 'BAD_METHOD', 'Допустимые методы: biometric, pin');
    if (typeof body.proof !== 'string' || body.proof.length < 4) {
      throw new HttpError(400, 'PROOF_REQUIRED', 'Требуется подтверждение владельца устройства');
    }
    const session = await store.getSession(auth.sid);
    if (!session) throw new HttpError(401, 'SESSION_EXPIRED', 'Сессия завершена');
    session.authLevel = 2;
    session.stepUpAt = iso();
    session.stepUpMethod = method;
    await store.setSession(auth.sid, session, cfg.sessionTtlSec);
    metrics.inc('stepUps');
    const token = issueAccess({ ...auth, authLevel: 2, session });
    return { ok: true, authLevel: 2, method, token, at: iso() };
  });

  /* ----------------------------- черновики ------------------------- */

  app.post('/v1/drafts', async (request, reply) => {
    const auth = await authenticate(request);
    if (auth.channel === 'mobile' && auth.authLevel < 2) {
      throw new HttpError(403, 'STEP_UP_REQUIRED', 'Повысьте уровень аутентификации');
    }
    const ts = iso();
    const draft = {
      id: `op_${randomId(8)}`,
      userId: auth.sub,
      product: 'transfer',
      status: 'draft',
      version: 1,
      step: 1,
      totalSteps: 3,
      fields: { ...EMPTY_FIELDS },
      context: {
        focus: 'recipientName',
        caret: 0,
        scroll: 0,
        validation: {},
        a11y: { fontScale: 1, contrast: 'normal', reduceMotion: false },
        locale: 'ru-RU',
      },
      createdAt: ts,
      updatedAt: ts,
      updatedBy: deviceOf(auth),
      lease: { ...deviceOf(auth), expiresAt: Date.now() + cfg.leaseTtlMs },
      handoff: null,
      submittedAt: null,
      receipt: null,
    };
    await store.putDraft(draft, cfg.draftTtlSec);
    metrics.inc('draftsCreated');
    return reply.code(201).send({ draft: draftView(draft, auth) });
  });

  app.get('/v1/drafts', async (request) => {
    const auth = await authenticate(request);
    const drafts = await store.listDrafts(auth.sub);
    return {
      items: drafts.map((draft) => ({
        id: draft.id,
        status: draft.status,
        step: draft.step,
        version: draft.version,
        product: draft.product,
        recipientName: draft.fields.recipientName,
        amount: draft.fields.amount,
        currency: draft.fields.currency,
        updatedAt: draft.updatedAt,
        handoff: draft.handoff,
      })),
    };
  });

  app.get('/v1/research/overview', async (request) => {
    const auth = await authenticate(request);
    const sessions = await store.listResearch(2000);
    return {
      ...RESEARCH,
      sessions: {
        total: sessions.length,
        own: sessions.filter((item) => item.userId === auth.sub).length,
        aggregate: aggregateResearch(sessions),
      },
    };
  });

  app.get('/v1/research/sessions', async (request) => {
    const auth = await authenticate(request);
    const sessions = (await store.listResearch(2000))
      .filter((item) => item.userId === auth.sub)
      .reverse();
    return { items: sessions };
  });

  app.post('/v1/research/sessions', async (request, reply) => {
    const auth = await authenticate(request);
    const body = request.body || {};
    const condition = ['A', 'B', 'C'].includes(body.condition) ? body.condition : null;
    const tctSec = Number(body.tctSec);
    const errors = Number(body.errors ?? 0);
    if (!condition) throw new HttpError(422, 'BAD_CONDITION', 'Условие: A, B или C');
    if (!Number.isFinite(tctSec) || tctSec < 1 || tctSec > 3600) {
      throw new HttpError(422, 'BAD_TCT', 'Время должно быть от 1 до 3600 секунд');
    }
    if (!Number.isFinite(errors) || errors < 0 || errors > 50) {
      throw new HttpError(422, 'BAD_ERRORS', 'Число ошибок: 0–50');
    }
    const record = {
      id: `rs_${randomId(6)}`,
      at: iso(),
      userId: auth.sub,
      condition,
      tctSec: Math.round(tctSec * 10) / 10,
      errors: Math.trunc(errors),
      completed: Boolean(body.completed),
      sus: Number.isFinite(Number(body.sus)) ? Math.max(0, Math.min(100, Number(body.sus))) : null,
      ces: Number.isFinite(Number(body.ces)) ? Math.max(1, Math.min(7, Number(body.ces))) : null,
      participant: cleanString(body.participant, 40) || `P-${String((await store.listResearch(2000)).length + 1).padStart(3, '0')}`,
      device: deviceOf(auth),
    };
    await store.appendResearch(record);
    await audit('research.session_saved', auth, { meta: { condition, tctSec: record.tctSec } });
    return reply.code(201).send({ session: record });
  });

  app.get('/v1/processes', async (request) => {
    const auth = await authenticate(request);
    const drafts = await store.listDrafts(auth.sub);
    return { items: drafts.map(processView) };
  });

  app.get('/v1/recipients', async (request) => {
    const auth = await authenticate(request);
    return { items: await store.listRecipients(auth.sub) };
  });

  app.post('/v1/recipients', async (request, reply) => {
    const auth = await authenticate(request);
    const body = request.body || {};
    const name = cleanString(body.name, 120);
    const account = cleanString(body.account, 34);
    const bank = cleanString(body.bank, 120);
    if (!name || !account) {
      throw new HttpError(422, 'RECIPIENT_INVALID', 'Укажите имя и счёт получателя');
    }
    const existing = (await store.listRecipients(auth.sub)).find((item) => item.account === account);
    const recipient = {
      id: existing?.id || `rcp_${randomId(6)}`,
      name,
      account,
      bank,
      createdAt: existing?.createdAt || iso(),
      updatedAt: iso(),
    };
    await store.putRecipient(auth.sub, recipient);
    await audit('recipient.saved', auth, { meta: { recipientId: recipient.id } });
    return reply.code(existing ? 200 : 201).send({ recipient });
  });

  app.delete('/v1/recipients/:id', async (request, reply) => {
    const auth = await authenticate(request);
    const removed = await store.deleteRecipient(auth.sub, request.params.id);
    if (!removed) throw new HttpError(404, 'RECIPIENT_NOT_FOUND', 'Получатель не найден');
    await audit('recipient.deleted', auth, { meta: { recipientId: request.params.id } });
    return reply.code(204).send();
  });

  app.get('/v1/drafts/:id', async (request) => {
    const auth = await authenticate(request);
    const draft = await getOwnedDraft(request.params.id, auth);
    return { draft: draftView(draft, auth) };
  });

  app.patch('/v1/drafts/:id', async (request, reply) => {
    const auth = await authenticate(request);
    const startedAt = Date.now();
    const body = request.body || {};
    const baseVersion = Number(body.baseVersion);
    const outcome = await store.updateDraft(
      request.params.id,
      (draft) => {
        if (draft.userId !== auth.sub) return { error: { status: 403, code: 'FORBIDDEN' } };
        if (draft.status !== 'draft') {
          return { error: { status: 409, code: 'DRAFT_LOCKED', draft } };
        }
        const active = leaseIsActive(draft.lease);
        if (active && draft.lease.deviceId !== auth.deviceId) {
          return {
            error: { status: 409, code: 'LEASE_HELD', lease: draft.lease, draft },
          };
        }
        if (Number.isFinite(baseVersion) && baseVersion !== draft.version) {
          metrics.inc('conflicts');
          return { error: { status: 409, code: 'VERSION_CONFLICT', draft } };
        }
        draft.fields = { ...draft.fields, ...sanitizeFields(body.fields) };
        draft.context = { ...draft.context, ...sanitizeContext(body.context) };
        if (Number.isFinite(body.step)) {
          draft.step = Math.max(1, Math.min(draft.totalSteps, Math.trunc(body.step)));
        }
        draft.version += 1;
        draft.updatedAt = iso();
        draft.updatedBy = deviceOf(auth);
        draft.lease = { ...deviceOf(auth), expiresAt: Date.now() + cfg.leaseTtlMs };
        return { draft };
      },
      cfg.draftTtlSec,
    );
    if (outcome.error) {
      if (outcome.error.code === 'LEASE_HELD') metrics.inc('conflicts');
      return reply.code(outcome.error.status).send({ error: outcome.error });
    }
    await store.publish(auth.sub, 'draft.updated', {
      draft: outcome.draft,
      updatedBy: deviceOf(auth),
      process: processView(outcome.draft),
    });
    metrics.inc('patches');
    metrics.observeSync(Date.now() - startedAt);
    return { draft: draftView(outcome.draft, auth) };
  });

  app.post('/v1/drafts/:id/claim', async (request, reply) => {
    const auth = await authenticate(request);
    if (auth.authLevel < 2) throw new HttpError(403, 'STEP_UP_REQUIRED', 'Повысьте уровень аутентификации');
    const outcome = await store.updateDraft(
      request.params.id,
      (draft) => {
        if (draft.userId !== auth.sub) return { error: { status: 403, code: 'FORBIDDEN' } };
        if (draft.status !== 'draft') return { error: { status: 409, code: 'DRAFT_LOCKED', draft } };
        draft.lease = { ...deviceOf(auth), expiresAt: Date.now() + cfg.leaseTtlMs };
        draft.version += 1;
        draft.updatedAt = iso();
        draft.updatedBy = deviceOf(auth);
        return { draft };
      },
      cfg.draftTtlSec,
    );
    if (outcome.error) return reply.code(outcome.error.status).send({ error: outcome.error });
    metrics.inc('leasesClaimed');
    await audit('lease.claimed', auth, { opId: request.params.id });
    await store.publish(auth.sub, 'lease.claimed', {
      draft: outcome.draft,
      claimedBy: deviceOf(auth),
    });
    return { draft: draftView(outcome.draft, auth) };
  });

  app.post('/v1/drafts/:id/submit', async (request, reply) => {
    const auth = await authenticate(request);
    const idemKey = cleanString(request.headers['idempotency-key'], 80);
    if (idemKey) {
      const cached = await store.getIdempotency(auth.sub, idemKey);
      if (cached) return cached;
    }
    const missing = [];
    let receipt = null;

    const current = await getOwnedDraft(request.params.id, auth);
    const today = iso().slice(0, 10);
    const submittedToday = (await store.listDrafts(auth.sub))
      .filter((draft) => draft.status === 'submitted' && String(draft.submittedAt || '').startsWith(today))
      .reduce((sum, draft) => sum + parseAmount(draft.fields?.amount), 0);
    const requested = parseAmount(current.fields?.amount);
    if (requested > 0 && submittedToday + requested > cfg.dailyLimitRub) {
      throw new HttpError(
        422,
        'DAILY_LIMIT_EXCEEDED',
        `Дневной лимит ${cfg.dailyLimitRub.toLocaleString('ru-RU')} ₽ превышен`,
      );
    }
    const outcome = await store.updateDraft(
      request.params.id,
      (draft) => {
        if (draft.userId !== auth.sub) return { error: { status: 403, code: 'FORBIDDEN' } };
        if (draft.status !== 'draft') return { error: { status: 409, code: 'DRAFT_LOCKED', draft } };
        for (const key of REQUIRED_FIELDS) {
          if (!String(draft.fields[key] ?? '').trim()) missing.push(key);
        }
        if (parseAmount(draft.fields.amount) <= 0) missing.push('amount:positive');
        if (missing.length) {
          return {
            error: {
              status: 422,
              code: 'VALIDATION_FAILED',
              message: 'Заполните обязательные поля',
              fields: missing,
              draft,
            },
          };
        }
        const ts = iso();
        draft.status = 'submitted';
        draft.submittedAt = ts;
        draft.version += 1;
        draft.updatedAt = ts;
        draft.receipt = {
          id: `rcpt_${randomId(6)}`,
          executedAt: ts,
          amount: parseAmount(draft.fields.amount),
          currency: draft.fields.currency || 'RUB',
          recipientName: draft.fields.recipientName,
          recipientAccount: draft.fields.recipientAccount,
        };
        receipt = draft.receipt;
        return { draft };
      },
      cfg.draftTtlSec,
    );
    if (outcome.error) {
      return reply.code(outcome.error.status).send({ error: outcome.error });
    }
    metrics.inc('submissions');
    if (outcome.draft.fields.saveRecipient) {
      const fields = outcome.draft.fields;
      const existing = (await store.listRecipients(auth.sub)).find((item) => item.account === fields.recipientAccount);
      await store.putRecipient(auth.sub, {
        id: existing?.id || `rcp_${randomId(6)}`,
        name: fields.recipientName,
        account: fields.recipientAccount,
        bank: fields.recipientBank || '',
        createdAt: existing?.createdAt || iso(),
        updatedAt: iso(),
      });
    }
    await audit('operation.submitted', auth, { opId: request.params.id, meta: { receiptId: receipt?.id } });
    await store.publish(auth.sub, 'draft.submitted', {
      draft: outcome.draft,
      receipt,
      submittedBy: deviceOf(auth),
    });
    const response = { draft: draftView(outcome.draft, auth), receipt };
    if (idemKey) await store.putIdempotency(auth.sub, idemKey, response, 86_400);
    return response;
  });

  /* ------------------------------- handoff ------------------------- */

  app.post('/v1/handoff/ticket', async (request, reply) => {
    const auth = await authenticate(request);
    const body = request.body || {};
    const opId = cleanString(body.opId, 64);
    if (!opId) throw new HttpError(400, 'OP_ID_REQUIRED', 'Укажите операцию');
    rateLimit(`${auth.sub}:ticket`, 30, 60_000);
    const draft = await getOwnedDraft(opId, auth);
    if (draft.status !== 'draft') throw new HttpError(409, 'DRAFT_LOCKED', 'Операция уже завершена');

    let jti = '';
    let code = '';
    let stored = false;
    for (let attempt = 0; attempt < 5 && !stored; attempt += 1) {
      jti = randomId(12);
      code = randomCode();
      stored = await store.putTicket(
        jti,
        {
          userId: auth.sub,
          sid: auth.sid,
          opId,
          code,
          createdAt: Date.now(),
          deviceId: auth.deviceId,
        },
        cfg.ticketTtlSec,
      );
      if (stored) await store.putCode(code, jti, cfg.ticketTtlSec);
    }
    if (!stored) throw new HttpError(503, 'TICKET_UNAVAILABLE', 'Не удалось выпустить билет');

    const ticket = signJwt(
      {
        sub: auth.sub,
        sid: auth.sid,
        opId,
        jti,
        code,
        typ: 'handoff',
        aud: 'handoff',
      },
      cfg.jwtSecret,
      cfg.ticketTtlSec,
    );
    const deeplink = `seamlessbank://handoff?t=${encodeURIComponent(ticket)}`;
    const qrSvg = await QRCode.toString(deeplink, {
      type: 'svg',
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 360,
      color: { dark: '#0B1F3A', light: '#FFFFFF' },
    });
    const expiresAt = iso(Date.now() + cfg.ticketTtlSec * 1000);
    metrics.inc('ticketsIssued');
    await audit('handoff.ticket_issued', auth, { opId, meta: { jti, code } });

    return reply.code(201).send({
      ticket,
      ticketId: jti,
      code,
      expiresAt,
      ttlSec: cfg.ticketTtlSec,
      deeplink,
      qrSvg: `data:image/svg+xml;base64,${Buffer.from(qrSvg).toString('base64')}`,
    });
  });

  async function resolveTicket(body, { allowConsumed = false } = {}) {
    if (typeof body.ticket === 'string' && body.ticket.length > 20) {
      let payload;
      try {
        payload = verifyJwt(body.ticket, cfg.jwtSecret, { aud: 'handoff', typ: 'handoff' });
      } catch {
        throw new HttpError(400, 'TICKET_INVALID', 'Билет недействителен или истёк');
      }
      const data = await store.getTicket(payload.jti);
      if (!data) {
        if (allowConsumed && (await store.getRedeemed(payload.jti))) {
          return { jti: payload.jti, data: null };
        }
        throw new HttpError(409, 'TICKET_EXPIRED', 'Срок действия билета истёк');
      }
      return { jti: payload.jti, data };
    }
    const code = cleanString(body.code, 6);
    if (/^\d{6}$/.test(code)) {
      const jti = await store.getCode(code);
      if (!jti) throw new HttpError(404, 'CODE_NOT_FOUND', 'Код не найден или истёк');
      const data = await store.getTicket(jti);
      if (!data) throw new HttpError(409, 'TICKET_EXPIRED', 'Срок действия кода истёк');
      return { jti, data };
    }
    throw new HttpError(400, 'TICKET_REQUIRED', 'Передайте QR-билет или шестизначный код');
  }

  app.post('/v1/handoff/preview', async (request) => {
    const auth = await authenticate(request);
    const { jti, data } = await resolveTicket(request.body || {});
    if (data.userId !== auth.sub) throw new HttpError(403, 'FOREIGN_TICKET', 'Билет принадлежит другому клиенту');
    if (await store.getRedeemed(jti)) throw new HttpError(409, 'ALREADY_REDEEMED', 'Билет уже использован');
    const draft = await store.getDraft(data.opId);
    if (!draft) throw new HttpError(404, 'DRAFT_NOT_FOUND', 'Операция не найдена');
    return {
      preview: {
        opId: draft.id,
        ownerName: randomDemoName(),
        product: draft.product,
        step: draft.step,
        totalSteps: draft.totalSteps,
        recipientName: draft.fields.recipientName || 'Новый перевод',
        recipientBank: draft.fields.recipientBank,
        amount: draft.fields.amount,
        currency: draft.fields.currency,
        updatedAt: draft.updatedAt,
        expiresAt: iso(data.createdAt + cfg.ticketTtlSec * 1000),
      },
    };
  });

  app.post('/v1/handoff/redeem', async (request, reply) => {
    const startedAt = Date.now();
    const auth = await authenticate(request);
    if (auth.channel !== 'mobile') {
      throw new HttpError(403, 'WRONG_CHANNEL', 'Подхват доступен только мобильному клиенту');
    }
    if (auth.authLevel < 2) {
      throw new HttpError(403, 'STEP_UP_REQUIRED', 'Подтвердите личность на устройстве');
    }
    rateLimit(`${auth.sub}:redeem`, 20, 60_000);
    const body = request.body || {};
    const { jti, data } = await resolveTicket(body, { allowConsumed: true });
    if (!data) {
      metrics.inc('handoffFailures');
      throw new HttpError(409, 'ALREADY_REDEEMED', 'Билет уже использован');
    }
    if (data.userId !== auth.sub) {
      metrics.inc('handoffFailures');
      throw new HttpError(403, 'FOREIGN_TICKET', 'Билет принадлежит другому клиенту');
    }
    if (await store.getRedeemed(jti)) {
      metrics.inc('handoffFailures');
      throw new HttpError(409, 'ALREADY_REDEEMED', 'Билет уже использован');
    }
    const consumed = await store.consumeTicket(jti);
    if (!consumed) {
      metrics.inc('handoffFailures');
      throw new HttpError(409, 'TICKET_EXPIRED', 'Срок действия билета истёк');
    }
    if (body.code) await store.deleteCode(String(body.code));

    const redeemedAtMs = Date.now();
    const at = iso(redeemedAtMs);
    const outcome = await store.updateDraft(
      data.opId,
      (draft) => {
        if (draft.userId !== auth.sub) return { error: { status: 403, code: 'FORBIDDEN' } };
        if (draft.status !== 'draft') return { error: { status: 409, code: 'DRAFT_LOCKED', draft } };
        draft.lease = { ...deviceOf(auth), expiresAt: Date.now() + cfg.leaseTtlMs };
        draft.handoff = {
          jti,
          createdAt: iso(data.createdAt),
          redeemedAt: at,
          redeemedBy: deviceOf(auth),
        };
        draft.version += 1;
        draft.updatedAt = at;
        draft.updatedBy = deviceOf(auth);
        return { draft };
      },
      cfg.draftTtlSec,
    );
    if (outcome.error) {
      metrics.inc('handoffFailures');
      return reply.code(outcome.error.status).send({ error: outcome.error });
    }

    await store.markRedeemed(jti, {
      userId: auth.sub,
      opId: data.opId,
      deviceName: auth.deviceName,
      channel: auth.channel,
      at,
      issuedAt: data.createdAt,
      syncMs: redeemedAtMs - data.createdAt,
      redeemMs: redeemedAtMs - startedAt,
    });
    metrics.inc('handoffsRedeemed');
    metrics.observeHandoff(Date.now() - data.createdAt);
    metrics.observeRedeem(Date.now() - startedAt);
    await audit('handoff.redeemed', auth, { opId: data.opId, meta: { jti, deviceName: auth.deviceName } });
    await store.publish(auth.sub, 'handoff.redeemed', {
      opId: data.opId,
      deviceName: auth.deviceName,
      deviceId: auth.deviceId,
      at,
      draft: outcome.draft,
      process: processView(outcome.draft),
      timing: { syncMs: redeemedAtMs - data.createdAt, redeemMs: redeemedAtMs - startedAt },
    });
    return {
      draft: draftView(outcome.draft, auth),
      handoff: outcome.draft.handoff,
      restored: {
        fields: Object.keys(outcome.draft.fields).length,
        step: outcome.draft.step,
        focus: outcome.draft.context.focus,
        version: outcome.draft.version,
      },
    };
  });

  app.get('/v1/handoff/:jti/status', async (request) => {
    const auth = await authenticate(request);
    const jti = cleanString(request.params.jti, 64);
    const redeemed = await store.getRedeemed(jti);
    if (redeemed) {
      if (redeemed.userId !== auth.sub) throw new HttpError(403, 'FORBIDDEN', 'Нет доступа');
      return {
        status: 'redeemed',
        redeemedBy: redeemed.deviceName,
        at: redeemed.at,
        opId: redeemed.opId,
        issuedAt: redeemed.issuedAt ? iso(redeemed.issuedAt) : null,
        serverSyncMs: Number.isFinite(redeemed.syncMs) ? redeemed.syncMs : null,
        serverRedeemMs: Number.isFinite(redeemed.redeemMs) ? redeemed.redeemMs : null,
      };
    }
    const ticket = await store.getTicket(jti);
    if (ticket) {
      if (ticket.userId !== auth.sub) throw new HttpError(403, 'FORBIDDEN', 'Нет доступа');
      return { status: 'pending', expiresAt: iso(ticket.createdAt + cfg.ticketTtlSec * 1000) };
    }
    return { status: 'expired' };
  });

  /* --------------------------- админ-контур ------------------------ */

  app.get('/v1/admin/analytics', async (request) => {
    const auth = await authenticate(request);
    requireRole(auth, 'admin', 'analyst', 'support');
    const snapshot = metrics.snapshot(store.kind);
    const drafts = await store.listAllDrafts();
    const verification = await store.verifyAudit();
    const counters = snapshot.counters;

    return {
      generatedAt: iso(),
      store: store.kind,
      counters,
      latency: {
        sync: snapshot.syncLatencyMs,
        clientSync: snapshot.clientSyncLatencyMs,
        redeem: snapshot.redeemLatencyMs,
      },
      funnel: {
        started: counters.draftsCreated || 0,
        tickets: counters.ticketsIssued || 0,
        redeemed: counters.handoffsRedeemed || 0,
        submitted: counters.submissions || 0,
        handoffRate: counters.ticketsIssued
          ? Number(((counters.handoffsRedeemed || 0) / counters.ticketsIssued * 100).toFixed(1))
          : 0,
        conversion: counters.handoffsRedeemed
          ? Number(((counters.submissions || 0) / counters.handoffsRedeemed * 100).toFixed(1))
          : 0,
      },
      operations: {
        total: drafts.length,
        draft: drafts.filter((item) => item.status === 'draft').length,
        submitted: drafts.filter((item) => item.status === 'submitted').length,
      },
      audit: {
        events: verification.events,
        valid: verification.valid,
        lastHash: verification.lastHash,
      },
    };
  });

  app.get('/v1/admin/processes', async (request) => {
    const auth = await authenticate(request);
    requireRole(auth, 'admin', 'analyst', 'support');
    const drafts = await store.listAllDrafts();
    const items = drafts.map(processView).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    const byStage = [0, 1, 2, 3, 4].map(
      (index) => items.filter((item) => item.stage === index).length,
    );
    return {
      items,
      stats: {
        total: items.length,
        byStage,
        atRisk: items.filter((item) => item.slaState === 'at-risk').length,
        breached: items.filter((item) => item.slaState === 'breached').length,
        highRisk: items.filter((item) => item.riskLabel === 'high').length,
      },
    };
  });

  app.get('/v1/admin/research', async (request) => {
    const auth = await authenticate(request);
    requireRole(auth, 'admin', 'analyst', 'support');
    const sessions = (await store.listResearch(2000)).reverse();
    return { items: sessions, aggregate: aggregateResearch(sessions), hypotheses: RESEARCH.hypotheses };
  });

  app.get('/v1/admin/audit', async (request) => {
    const auth = await authenticate(request);
    requireRole(auth, 'admin', 'analyst', 'support');
    const limit = Math.max(1, Math.min(Number(request.query.limit) || 50, 500));
    const items = (await store.listAudit(limit)).reverse();
    const verification = await store.verifyAudit();
    return { items, verification };
  });

  app.get('/v1/admin/audit/verify', async (request) => {
    const auth = await authenticate(request);
    requireRole(auth, 'admin', 'analyst');
    return store.verifyAudit();
  });

  app.get('/v1/admin/export', async (request, reply) => {
    const auth = await authenticate(request);
    requireRole(auth, 'admin', 'analyst');
    const type = ['operations', 'research'].includes(request.query.type) ? request.query.type : 'audit';
    const format = request.query.format === 'json' ? 'json' : 'csv';
    await audit('admin.export', auth, { meta: { type, format } });

    const rows =
      type === 'audit'
        ? await store.listAudit(10000)
        : type === 'research'
          ? await store.listResearch(2000)
          : await store.listAllDrafts();
    const stamp = new Date().toISOString().slice(0, 10);
    reply.header('Content-Disposition', `attachment; filename="${type}-${stamp}.${format}"`);

    if (format === 'json') {
      return reply.send({ generatedAt: iso(), type, count: rows.length, items: rows });
    }

    const columns =
      type === 'audit'
        ? ['id', 'at', 'type', 'outcome', 'actorRole', 'actorUserId', 'opId', 'prevHash', 'hash']
        : type === 'research'
          ? ['id', 'at', 'condition', 'tctSec', 'errors', 'completed', 'sus', 'ces', 'participant', 'userId']
          : ['id', 'status', 'userId', 'recipientName', 'amount', 'currency', 'version', 'updatedAt'];
    const lines = [columns.join(',')];
    for (const row of rows) {
      const values =
        type === 'audit'
          ? [
              row.id,
              row.at,
              row.type,
              row.outcome,
              row.actor?.role,
              row.actor?.userId,
              row.opId,
              row.prevHash,
              row.hash,
            ]
          : type === 'research'
            ? [
                row.id,
                row.at,
                row.condition,
                row.tctSec,
                row.errors,
                row.completed,
                row.sus,
                row.ces,
                row.participant,
                row.userId,
              ]
            : [
                row.id,
                row.status,
                row.userId,
                row.fields?.recipientName,
                row.fields?.amount,
                row.fields?.currency,
                row.version,
                row.updatedAt,
              ];
      lines.push(values.map(csvCell).join(','));
    }
    reply.type('text/csv; charset=utf-8');
    return reply.send(`\uFEFF${lines.join('\n')}`);
  });

  app.get('/admin', async (_request, reply) => reply.sendFile('admin.html'));

  app.get('/research', async (_request, reply) => reply.sendFile('research.html'));

  /* ----------------------------- WebSocket ------------------------- */

  const clients = new Map();
  const unsubscribe = store.subscribe((envelope) => {
    const sockets = clients.get(envelope.userId);
    if (!sockets || !sockets.size) return;
    const message = JSON.stringify({ type: envelope.type, payload: envelope.payload, at: envelope.at });
    for (const socket of sockets) {
      if (socket.readyState === 1) {
        try {
          socket.send(message);
        } catch {
          /* разрыв соединения обрабатывается событием close */
        }
      }
    }
  });
  app.addHook('onClose', async () => {
    unsubscribe();
    await store.close();
    for (const sockets of clients.values()) {
      for (const socket of sockets) {
        try {
          socket.close();
        } catch {
          /* no-op */
        }
      }
    }
    clients.clear();
  });

  app.get('/v1/stream', { websocket: true }, (socket, request) => {
    let auth;
    try {
      const url = new URL(request.url, 'http://localhost');
      const token = url.searchParams.get('token') || '';
      auth = verifyJwt(token, cfg.jwtSecret, { aud: 'api', typ: 'access' });
    } catch {
      socket.close(4401, 'unauthorized');
      return;
    }
    if (!clients.has(auth.sub)) clients.set(auth.sub, new Set());
    clients.get(auth.sub).add(socket);
    metrics.inc('wsConnections');

    socket.send(
      JSON.stringify({
        type: 'hello',
        payload: { userId: auth.sub, deviceId: auth.deviceId, serverTime: iso() },
        at: iso(),
      }),
    );

    const timer = setInterval(() => {
      try {
        socket.ping();
      } catch {
        clearInterval(timer);
      }
    }, 25_000);

    socket.on('close', () => {
      clearInterval(timer);
      clients.get(auth.sub)?.delete(socket);
    });
    socket.on('error', () => {
      clearInterval(timer);
      clients.get(auth.sub)?.delete(socket);
    });
  });

  /* ------------------------- статические страницы ------------------ */

  app.get('/m', async (_request, reply) => reply.sendFile('mobile.html'));

  app.setNotFoundHandler((request, reply) => {
    if (request.method === 'GET' && !request.url.startsWith('/v1/')) {
      return reply.sendFile('index.html');
    }
    return reply.code(404).send({
      error: { code: 'NOT_FOUND', message: `Маршрут ${request.method} ${request.url} не найден` },
    });
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof HttpError) {
      return reply.code(error.status).send({
        error: { code: error.code, message: error.message, details: error.details },
      });
    }
    if (error.statusCode === 400) {
      return reply.code(400).send({ error: { code: 'BAD_REQUEST', message: 'Некорректный запрос' } });
    }
    request.log.error({ err: error }, 'unhandled error');
    return reply.code(500).send({
      error: { code: 'INTERNAL', message: 'Внутренняя ошибка сервиса' },
    });
  });

  return app;
}
