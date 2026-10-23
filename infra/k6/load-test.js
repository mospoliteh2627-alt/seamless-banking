import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE = __ENV.BASE_URL || 'http://127.0.0.1:8787';
const VUS = Number(__ENV.VUS || 50);

export const options = {
  scenarios: {
    sync: {
      executor: 'constant-vus',
      vus: VUS,
      duration: __ENV.DURATION || '30s',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    'http_req_duration{name:patch}': ['p(95)<150', 'p(99)<300'],
    'http_req_duration{name:ticket}': ['p(95)<200'],
  },
};

function jsonHeaders(token) {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
}

export function setup() {
  const login = http.post(
    `${BASE}/v1/auth/demo-login`,
    JSON.stringify({
      channel: 'web',
      deviceId: 'k6-web',
      deviceName: 'k6 · load',
    }),
    { headers: { 'Content-Type': 'application/json' } },
  );
  check(login, { 'login ok': (r) => r.status === 200 });
  const token = login.json('token');
  const ids = [];
  for (let i = 0; i < VUS; i += 1) {
    const created = http.post(`${BASE}/v1/drafts`, JSON.stringify({ product: 'transfer' }), {
      headers: jsonHeaders(token),
    });
    ids.push(created.json('draft.id'));
  }
  return { token, ids };
}

export default function (data) {
  const id = data.ids[(__VU - 1) % data.ids.length];
  const headers = jsonHeaders(data.token);

  const patch = http.patch(
    `${BASE}/v1/drafts/${id}`,
    JSON.stringify({
      step: 2,
      fields: {
        recipientName: `Получатель ${__VU}`,
        recipientBank: 'Вектор Банк',
        recipientAccount: '40817810000000001234',
        amount: '12500,50',
        purpose: `Нагрузочный сценарий ${__ITER}`,
      },
      context: { focus: 'amount', caret: 5, scroll: 0, locale: 'ru-RU' },
    }),
    { headers, tags: { name: 'patch' } },
  );
  check(patch, { 'patch ok': (r) => r.status === 200 || r.status === 409 });

  if (__ITER % 5 === 0) {
    const ticket = http.post(
      `${BASE}/v1/handoff/ticket`,
      JSON.stringify({ opId: id }),
      { headers, tags: { name: 'ticket' } },
    );
    check(ticket, { 'ticket ok': (r) => r.status === 201 });
  }

  sleep(0.2);
}
