const BASE = process.env.BASE_URL || 'http://127.0.0.1:8787';
const TOTAL = Number(process.env.TOTAL || 1500);
const CONCURRENCY = Number(process.env.CONCURRENCY || 50);

const login = await fetch(`${BASE}/v1/auth/demo-login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ channel: 'web', deviceId: 'load-web', deviceName: 'load · node' }),
}).then((response) => response.json());

const token = login.token;
const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

const created = await fetch(`${BASE}/v1/drafts`, {
  method: 'POST',
  headers,
  body: JSON.stringify({ product: 'transfer' }),
}).then((response) => response.json());
const draftId = created.draft.id;

let cursor = 0;
let errors = 0;
const samples = [];

async function worker() {
  while (cursor < TOTAL) {
    const index = cursor;
    cursor += 1;
    const started = performance.now();
    const response = await fetch(`${BASE}/v1/drafts/${draftId}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({
        fields: { purpose: `Нагрузка ${index}`, amount: '12500,50' },
        step: 2,
        context: { focus: 'amount', caret: 5, scroll: 0, locale: 'ru-RU' },
      }),
    });
    const elapsed = performance.now() - started;
    if (response.ok) samples.push(elapsed);
    else errors += 1;
  }
}

const startedAt = performance.now();
await Promise.all(Array.from({ length: CONCURRENCY }, worker));
const wall = performance.now() - startedAt;

samples.sort((a, b) => a - b);
const percentile = (p) => samples[Math.min(samples.length - 1, Math.ceil((p / 100) * samples.length) - 1)];

console.log(
  JSON.stringify(
    {
      total: TOTAL,
      concurrency: CONCURRENCY,
      ok: samples.length,
      errors,
      wallMs: Math.round(wall),
      rps: Math.round((TOTAL / wall) * 1000),
      p50: Number(percentile(50).toFixed(1)),
      p95: Number(percentile(95).toFixed(1)),
      p99: Number(percentile(99).toFixed(1)),
      max: Number(samples[samples.length - 1].toFixed(1)),
    },
    null,
    2,
  ),
);
