import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../apps/api/src/app.js';

async function http(base, path, { method = 'GET', token, body, headers: extraHeaders = {} } = {}) {
  const headers = { ...extraHeaders };
  if (body) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => null);
  return { status: response.status, data };
}

function waitFor(ws, type, timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.removeEventListener('message', onMessage);
      reject(new Error(`timeout waiting for ${type}`));
    }, timeoutMs);
    function onMessage(event) {
      const message = JSON.parse(event.data);
      if (message.type === type) {
        clearTimeout(timer);
        ws.removeEventListener('message', onMessage);
        resolve(message);
      }
    }
    ws.addEventListener('message', onMessage);
  });
}

async function openSocket(url) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  return socket;
}

test('seamless handoff: web → mobile → submit', async (t) => {
  const app = await buildApp({ logger: false });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const port = app.server.address().port;
  const base = `http://127.0.0.1:${port}`;
  t.after(async () => {
    await app.close();
  });

  const webLogin = await http(base, '/v1/auth/demo-login', {
    method: 'POST',
    body: { phone: '+7 900 000-00-42', channel: 'web', deviceId: 'web_test', deviceName: 'Chrome · тест' },
  });
  assert.equal(webLogin.status, 200);
  const webToken = webLogin.data.token;
  assert.equal(webLogin.data.session.authLevel, 2);

  const mobileLogin = await http(base, '/v1/auth/demo-login', {
    method: 'POST',
    body: { phone: '+7 900 000-00-42', channel: 'mobile', deviceId: 'ios_test', deviceName: 'iPhone · тест' },
  });
  assert.equal(mobileLogin.status, 200);
  assert.equal(mobileLogin.data.session.authLevel, 1);
  let mobileToken = mobileLogin.data.token;

  const created = await http(base, '/v1/drafts', { method: 'POST', token: webToken, body: { product: 'transfer' } });
  assert.equal(created.status, 201);
  const draftId = created.data.draft.id;
  assert.equal(created.data.draft.canEdit, true);

  const step1 = await http(base, `/v1/drafts/${draftId}`, {
    method: 'PATCH',
    token: webToken,
    body: {
      baseVersion: created.data.draft.version,
      step: 1,
      fields: { recipientName: 'Иван Петров', recipientBank: 'Вектор Банк', recipientAccount: '40817810000000001234' },
      context: { focus: 'recipientBank', caret: 4, scroll: 120 },
    },
  });
  assert.equal(step1.status, 200);
  assert.equal(step1.data.draft.version, created.data.draft.version + 1);

  const step2 = await http(base, `/v1/drafts/${draftId}`, {
    method: 'PATCH',
    token: webToken,
    body: {
      baseVersion: step1.data.draft.version,
      step: 2,
      fields: { amount: '12500,50', purpose: 'Перевод личных средств', saveRecipient: true },
      context: { focus: 'amount', caret: 5, scroll: 240 },
    },
  });
  assert.equal(step2.status, 200);
  assert.equal(step2.data.draft.step, 2);
  assert.equal(step2.data.draft.fields.amount, '12500,50');

  const socket = await openSocket(`ws://127.0.0.1:${port}/v1/stream?token=${encodeURIComponent(webToken)}`);
  t.after(() => socket.close());
  await waitFor(socket, 'hello');

  const ticketResponse = await http(base, '/v1/handoff/ticket', {
    method: 'POST',
    token: webToken,
    body: { opId: draftId },
  });
  assert.equal(ticketResponse.status, 201);
  const ticket = ticketResponse.data.ticket;
  assert.match(ticketResponse.data.code, /^\d{6}$/);
  assert.ok(ticketResponse.data.qrSvg.startsWith('data:image/svg+xml;base64,'));

  const preview = await http(base, '/v1/handoff/preview', {
    method: 'POST',
    token: mobileToken,
    body: { ticket },
  });
  assert.equal(preview.status, 200);
  assert.equal(preview.data.preview.recipientName, 'Иван Петров');
  assert.equal(preview.data.preview.amount, '12500,50');

  const premature = await http(base, '/v1/handoff/redeem', {
    method: 'POST',
    token: mobileToken,
    body: { ticket, deviceId: 'ios_test', deviceName: 'iPhone · тест' },
  });
  assert.equal(premature.status, 403);
  assert.equal(premature.data.error.code, 'STEP_UP_REQUIRED');

  const stepUp = await http(base, '/v1/auth/step-up', {
    method: 'POST',
    token: mobileToken,
    body: { method: 'biometric', proof: 'demo-faceid' },
  });
  assert.equal(stepUp.status, 200);
  mobileToken = stepUp.data.token;
  assert.equal(stepUp.data.authLevel, 2);

  const redeemedEventPromise = waitFor(socket, 'handoff.redeemed');
  const redeemed = await http(base, '/v1/handoff/redeem', {
    method: 'POST',
    token: mobileToken,
    body: { ticket, deviceId: 'ios_test', deviceName: 'iPhone · тест' },
  });
  assert.equal(redeemed.status, 200);
  const restoredDraft = redeemed.data.draft;
  assert.equal(restoredDraft.fields.recipientName, 'Иван Петров');
  assert.equal(restoredDraft.fields.recipientAccount, '40817810000000001234');
  assert.equal(restoredDraft.fields.amount, '12500,50');
  assert.equal(restoredDraft.fields.purpose, 'Перевод личных средств');
  assert.equal(restoredDraft.step, 2);
  assert.equal(restoredDraft.context.focus, 'amount');
  assert.equal(restoredDraft.context.caret, 5);
  assert.equal(restoredDraft.context.scroll, 240);
  assert.equal(redeemed.data.restored.fields >= 8, true);

  const expectedFields = ['recipientName', 'recipientBank', 'recipientAccount', 'amount', 'purpose', 'currency', 'fee', 'saveTemplate'];
  const retained = expectedFields.filter((key) => key in restoredDraft.fields).length;
  assert.equal(retained, expectedFields.length, 'CRR должен быть равен 100% для переданных полей');

  const event = await redeemedEventPromise;
  assert.equal(event.payload.opId, draftId);
  assert.equal(event.payload.deviceName, 'iPhone · тест');

  const webConflict = await http(base, `/v1/drafts/${draftId}`, {
    method: 'PATCH',
    token: webToken,
    body: { baseVersion: step2.data.draft.version, fields: { purpose: 'Попытка записи с веба' } },
  });
  assert.equal(webConflict.status, 409);
  assert.equal(webConflict.data.error.code, 'LEASE_HELD');

  const claimed = await http(base, `/v1/drafts/${draftId}/claim`, { method: 'POST', token: webToken });
  assert.equal(claimed.status, 200);
  assert.equal(claimed.data.draft.canEdit, true);

  const webEditAfterClaim = await http(base, `/v1/drafts/${draftId}`, {
    method: 'PATCH',
    token: webToken,
    body: { baseVersion: claimed.data.draft.version, fields: { purpose: 'Уточнённое назначение' } },
  });
  assert.equal(webEditAfterClaim.status, 200);
  assert.equal(webEditAfterClaim.data.draft.fields.purpose, 'Уточнённое назначение');

  const submitEventPromise = waitFor(socket, 'draft.submitted');
  const submitted = await http(base, `/v1/drafts/${draftId}/submit`, { method: 'POST', token: mobileToken, headers: { 'Idempotency-Key': 'idem-main-1' } });
  assert.equal(submitted.status, 200);
  assert.ok(submitted.data.receipt.id.startsWith('rcpt_'));
  assert.equal(submitted.data.receipt.amount, 12500.5);
  const duplicateSubmit = await http(base, `/v1/drafts/${draftId}/submit`, {
    method: 'POST',
    token: mobileToken,
    headers: { 'Idempotency-Key': 'idem-main-1' },
  });
  assert.equal(duplicateSubmit.status, 200);
  assert.equal(duplicateSubmit.data.receipt.id, submitted.data.receipt.id);
  const savedAfterSubmit = await http(base, '/v1/recipients', { token: webToken });
  assert.ok(savedAfterSubmit.data.items.some((item) => item.account === '40817810000000001234'));
  const submitEvent = await submitEventPromise;
  assert.equal(submitEvent.payload.receipt.recipientName, 'Иван Петров');

  const replay = await http(base, '/v1/handoff/redeem', {
    method: 'POST',
    token: mobileToken,
    body: { ticket, deviceId: 'ios_test', deviceName: 'iPhone · тест' },
  });
  assert.equal(replay.status, 409);
  assert.equal(replay.data.error.code, 'ALREADY_REDEEMED');

  const metrics = await http(base, '/v1/metrics');
  assert.equal(metrics.status, 200);
  assert.equal(metrics.data.counters.handoffsRedeemed, 1);
  assert.equal(metrics.data.counters.submissions, 1);
  assert.ok(metrics.data.syncLatencyMs.count > 0);
  assert.ok(metrics.data.syncLatencyMs.p95 >= 0);
});

test('handoff via 6-digit code and access control', async (t) => {
  const app = await buildApp({ logger: false });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const port = app.server.address().port;
  const base = `http://127.0.0.1:${port}`;
  t.after(async () => {
    await app.close();
  });

  const web = await http(base, '/v1/auth/demo-login', {
    method: 'POST',
    body: { channel: 'web', deviceId: 'web_code', deviceName: 'Chrome · код' },
  });
  const mobile = await http(base, '/v1/auth/demo-login', {
    method: 'POST',
    body: { channel: 'mobile', deviceId: 'ios_code', deviceName: 'iPhone · код' },
  });

  const draft = await http(base, '/v1/drafts', {
    method: 'POST',
    token: web.data.token,
    body: { product: 'transfer' },
  });
  await http(base, `/v1/drafts/${draft.data.draft.id}`, {
    method: 'PATCH',
    token: web.data.token,
    body: {
      baseVersion: draft.data.draft.version,
      step: 2,
      fields: { recipientName: 'Мария Орлова', recipientAccount: '40817810000000009999', amount: '7000' },
    },
  });

  const ticket = await http(base, '/v1/handoff/ticket', {
    method: 'POST',
    token: web.data.token,
    body: { opId: draft.data.draft.id },
  });
  assert.equal(ticket.status, 201);

  const unauthorized = await http(base, '/v1/handoff/redeem', {
    method: 'POST',
    body: { code: ticket.data.code },
  });
  assert.equal(unauthorized.status, 401);

  const stepUp = await http(base, '/v1/auth/step-up', {
    method: 'POST',
    token: mobile.data.token,
    body: { method: 'pin', proof: '0000' },
  });
  assert.equal(stepUp.status, 200);

  const preview = await http(base, '/v1/handoff/preview', {
    method: 'POST',
    token: stepUp.data.token,
    body: { code: ticket.data.code },
  });
  assert.equal(preview.status, 200);
  assert.equal(preview.data.preview.recipientName, 'Мария Орлова');

  const redeemed = await http(base, '/v1/handoff/redeem', {
    method: 'POST',
    token: stepUp.data.token,
    body: { code: ticket.data.code, deviceId: 'ios_code', deviceName: 'iPhone · код' },
  });
  assert.equal(redeemed.status, 200);
  assert.equal(redeemed.data.draft.fields.recipientName, 'Мария Орлова');

  const replay = await http(base, '/v1/handoff/redeem', {
    method: 'POST',
    token: stepUp.data.token,
    body: { code: ticket.data.code, deviceId: 'ios_code', deviceName: 'iPhone · код' },
  });
  assert.equal(replay.status, 404);
  assert.equal(replay.data.error.code, 'CODE_NOT_FOUND');
});

test('B2B minimum: RBAC, audit chain and export', async (t) => {
  const app = await buildApp({ logger: false });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const port = app.server.address().port;
  const base = `http://127.0.0.1:${port}`;
  t.after(async () => {
    await app.close();
  });

  const denied = await http(base, '/v1/auth/demo-login', {
    method: 'POST',
    body: { channel: 'web', role: 'admin', adminCode: 'WRONG', deviceId: 'admin_1', deviceName: 'Admin' },
  });
  assert.equal(denied.status, 403);

  const admin = await http(base, '/v1/auth/demo-login', {
    method: 'POST',
    body: { channel: 'web', role: 'admin', adminCode: 'ADMIN-2026', deviceId: 'admin_1', deviceName: 'Admin' },
  });
  assert.equal(admin.status, 200);
  assert.equal(admin.data.session.role, 'admin');

  const client = await http(base, '/v1/auth/demo-login', {
    method: 'POST',
    body: { channel: 'web', role: 'client', deviceId: 'client_1', deviceName: 'Client' },
  });
  assert.equal(client.status, 200);
  assert.equal(client.data.session.role, 'client');

  const forbidden = await http(base, '/v1/admin/analytics', { token: client.data.token });
  assert.equal(forbidden.status, 403);

  const created = await http(base, '/v1/drafts', {
    method: 'POST',
    token: client.data.token,
    body: { product: 'transfer' },
  });
  assert.equal(created.status, 201);

  const processes = await http(base, '/v1/processes', { token: client.data.token });
  assert.equal(processes.status, 200);
  assert.ok(processes.data.items.length >= 1);
  assert.ok('stageLabel' in processes.data.items[0]);
  assert.ok('slaState' in processes.data.items[0]);
  assert.equal(processes.data.items[0].stage, 0);
  assert.equal(processes.data.items[0].stageLabel, 'Создана');
  assert.equal(processes.data.items[0].progress, 0);
  assert.equal(processes.data.items[0].stages.length, 5);

  // Двусторонний сценарий: черновик, созданный мобильным клиентом, виден вебу.
  const mobile = await http(base, '/v1/auth/demo-login', {
    method: 'POST',
    body: { phone: '+7 900 000-00-42', channel: 'mobile', deviceId: 'mobile_client_1', deviceName: 'Pixel · тест' },
  });
  assert.equal(mobile.status, 200);
  const mobileStepUp = await http(base, '/v1/auth/step-up', {
    method: 'POST',
    token: mobile.data.token,
    body: { method: 'biometric', proof: 'local-biometric' },
  });
  assert.equal(mobileStepUp.status, 200);
  const mobileDraft = await http(base, '/v1/drafts', {
    method: 'POST',
    token: mobileStepUp.data.token,
    body: { product: 'transfer' },
  });
  assert.equal(mobileDraft.status, 201);
  const webDrafts = await http(base, '/v1/drafts', { token: client.data.token });
  assert.equal(webDrafts.status, 200);
  assert.ok(webDrafts.data.items.some((item) => item.id === mobileDraft.data.draft.id));

  const savedRecipient = await http(base, '/v1/recipients', {
    method: 'POST',
    token: client.data.token,
    body: { name: 'Иван Петров', bank: 'Вектор Банк', account: '40817810000000001234' },
  });
  assert.equal(savedRecipient.status, 201);
  const recipients = await http(base, '/v1/recipients', { token: client.data.token });
  assert.equal(recipients.status, 200);
  assert.ok(recipients.data.items.some((item) => item.account === '40817810000000001234'));
  const duplicateRecipient = await http(base, '/v1/recipients', {
    method: 'POST',
    token: client.data.token,
    body: { name: 'Иван Петров', bank: 'Вектор Банк', account: '40817810000000001234' },
  });
  assert.equal(duplicateRecipient.status, 200);
  const deletedRecipient = await http(base, `/v1/recipients/${savedRecipient.data.recipient.id}`, {
    method: 'DELETE',
    token: client.data.token,
  });
  assert.equal(deletedRecipient.status, 204);

  const limitDraft = await http(base, '/v1/drafts', {
    method: 'POST',
    token: client.data.token,
    body: { product: 'transfer' },
  });
  await http(base, `/v1/drafts/${limitDraft.data.draft.id}`, {
    method: 'PATCH',
    token: client.data.token,
    body: {
      baseVersion: limitDraft.data.draft.version,
      fields: { recipientName: 'Лимит', recipientAccount: '40817810000000009999', amount: '600000,00' },
      step: 2,
    },
  });
  const overLimit = await http(base, `/v1/drafts/${limitDraft.data.draft.id}/submit`, {
    method: 'POST',
    token: client.data.token,
  });
  assert.equal(overLimit.status, 422);
  assert.equal(overLimit.data.error.code, 'DAILY_LIMIT_EXCEEDED');

  const adminProcesses = await http(base, '/v1/admin/processes', { token: admin.data.token });
  assert.equal(adminProcesses.status, 200);
  assert.ok(adminProcesses.data.stats.total >= 1);
  assert.equal(adminProcesses.data.stats.byStage.length, 5);

  const researchSession = await http(base, '/v1/research/sessions', {
    method: 'POST',
    token: client.data.token,
    body: { condition: 'A', tctSec: 12.5, errors: 1, completed: true, sus: 82, ces: 2.2, participant: 'P-TEST' },
  });
  assert.equal(researchSession.status, 201);
  const researchOverview = await http(base, '/v1/research/overview', { token: client.data.token });
  assert.equal(researchOverview.status, 200);
  assert.ok(researchOverview.data.sessions.total >= 1);
  assert.equal(researchOverview.data.hypotheses.length, 6);

  const analytics = await http(base, '/v1/admin/analytics', { token: admin.data.token });
  assert.equal(analytics.status, 200);
  assert.ok('funnel' in analytics.data);
  assert.ok('audit' in analytics.data);
  assert.equal(analytics.data.audit.valid, true);

  const audit = await http(base, '/v1/admin/audit?limit=20', { token: admin.data.token });
  assert.equal(audit.status, 200);
  assert.ok(audit.data.items.length > 0);
  assert.equal(audit.data.verification.valid, true);
  assert.ok(audit.data.items.some((item) => item.type === 'auth.login'));

  const csv = await fetch(`${base}/v1/admin/export?type=audit&format=csv`, {
    headers: { Authorization: `Bearer ${admin.data.token}` },
  });
  assert.equal(csv.status, 200);
  assert.match(csv.headers.get('content-type') || '', /text\/csv/);
  const csvText = await csv.text();
  assert.ok(csvText.includes('id,at,type'));
  assert.ok(csvText.includes('auth.login'));

  const json = await http(base, '/v1/admin/export?type=operations&format=json', {
    token: admin.data.token,
  });
  assert.equal(json.status, 200);
  assert.ok(Array.isArray(json.data.items));

  const verify = await http(base, '/v1/admin/audit/verify', { token: admin.data.token });
  assert.equal(verify.status, 200);
  assert.equal(verify.data.valid, true);
});
