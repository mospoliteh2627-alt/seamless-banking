import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../apps/api/src/app.js';

async function http(base, path, { method = 'GET', token, body } = {}) {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, data: await response.json().catch(() => null) };
}

const FIELDS = {
  recipientName: 'Иван Петров',
  recipientBank: 'Вектор Банк',
  recipientAccount: '40817810000000001234',
  amount: '12500,50',
  purpose: 'Перевод личных средств',
};

test('VoP: совпадение, похожее имя и блокировка', async (t) => {
  const app = await buildApp({ logger: false });
  await app.listen({ port: 0, host: '127.0.0.1' });
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}/v1`;

  const login = await http(base, '/auth/demo-login', {
    method: 'POST',
    body: { phone: '+7 900 000-00-42', channel: 'web', deviceId: 'vop_test', deviceName: 'Test' },
  });
  const token = login.data.token;

  const createDraft = async (fields) => {
    const draft = await http(base, '/drafts', { method: 'POST', token, body: { product: 'transfer' } });
    const id = draft.data.draft.id;
    await http(base, `/drafts/${id}`, { method: 'PATCH', token, body: { step: 3, fields } });
    return id;
  };

  // 1. Точное совпадение: проверка и успешная отправка.
  const matchId = await createDraft(FIELDS);
  const match = await http(base, '/payee/verify', {
    method: 'POST',
    token,
    body: {
      account: FIELDS.recipientAccount,
      bank: FIELDS.recipientBank,
      recipientName: FIELDS.recipientName,
      opId: matchId,
    },
  });
  assert.equal(match.status, 200);
  assert.equal(match.data.status, 'match');
  const sent = await http(base, `/drafts/${matchId}/submit`, {
    method: 'POST',
    token,
    body: {},
    headers: { 'Idempotency-Key': 'vop-match' },
  });
  assert.equal(sent.status, 200, JSON.stringify(sent.data));

  // 2. Похожее имя: без подтверждения — 409, с подтверждением — успех.
  const closeId = await createDraft({ ...FIELDS, recipientName: 'Иван Петровв' });
  const close = await http(base, '/payee/verify', {
    method: 'POST',
    token,
    body: {
      account: FIELDS.recipientAccount,
      bank: FIELDS.recipientBank,
      recipientName: 'Иван Петровв',
      opId: closeId,
    },
  });
  assert.equal(close.data.status, 'close_match');
  const blocked = await http(base, `/drafts/${closeId}/submit`, {
    method: 'POST',
    token,
    body: {},
    headers: { 'Idempotency-Key': 'vop-close-1' },
  });
  assert.equal(blocked.status, 409);
  assert.equal(blocked.data.error.code, 'PAYEE_CLOSE_MATCH');
  const accepted = await http(base, `/drafts/${closeId}/submit`, {
    method: 'POST',
    token,
    body: { acceptCloseMatch: true },
    headers: { 'Idempotency-Key': 'vop-close-2' },
  });
  assert.equal(accepted.status, 200, JSON.stringify(accepted.data));

  // 3. Другое имя: отправка заблокирована на сервере.
  const mismatchId = await createDraft({ ...FIELDS, recipientName: 'Пётр Сидоров' });
  const mismatch = await http(base, '/payee/verify', {
    method: 'POST',
    token,
    body: {
      account: FIELDS.recipientAccount,
      bank: FIELDS.recipientBank,
      recipientName: 'Пётр Сидоров',
      opId: mismatchId,
    },
  });
  assert.equal(mismatch.data.status, 'no_match');
  const rejected = await http(base, `/drafts/${mismatchId}/submit`, {
    method: 'POST',
    token,
    body: {},
    headers: { 'Idempotency-Key': 'vop-mismatch' },
  });
  assert.equal(rejected.status, 409);
  assert.equal(rejected.data.error.code, 'PAYEE_MISMATCH');

  // 4. Неизвестный счёт.
  const unknown = await http(base, '/payee/verify', {
    method: 'POST',
    body: { account: '40817810000000000000', bank: 'Вектор Банк', recipientName: 'Иван Петров' },
  });
  assert.equal(unknown.data.status, 'no_data');
});
