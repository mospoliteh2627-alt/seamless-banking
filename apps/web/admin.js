const state = {
  token: sessionStorage.getItem('sb.admin.token') || '',
  role: sessionStorage.getItem('sb.admin.role') || 'admin',
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

function deviceId() {
  let id = localStorage.getItem('sb.deviceId');
  if (!id) {
    id = `web_${(crypto.randomUUID?.() || String(Math.random())).slice(0, 8)}`;
    localStorage.setItem('sb.deviceId', id);
  }
  return id;
}

function toast(message, error = false) {
  const element = $('#admin-toast');
  element.textContent = message;
  element.classList.toggle('is-error', error);
  element.classList.add('is-visible');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => element.classList.remove('is-visible'), 3200);
}

async function api(path, options = {}) {
  const headers = {};
  if (options.body) headers['Content-Type'] = 'application/json';
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  const response = await fetch(`/v1${path}`, {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(data?.error?.message || `Ошибка ${response.status}`);
  }
  return data;
}

async function login() {
  const role = $('#admin-role').value;
  const button = $('#admin-submit');
  button.disabled = true;
  try {
    const data = await api('/auth/demo-login', {
      method: 'POST',
      body: {
        channel: 'web',
        role,
        adminCode: $('#admin-code').value,
        deviceId: deviceId(),
        deviceName: 'Админ-контур · браузер',
      },
    });
    state.token = data.token;
    state.role = data.session.role;
    sessionStorage.setItem('sb.admin.token', state.token);
    sessionStorage.setItem('sb.admin.role', state.role);
    showApp();
    await refresh();
  } catch (error) {
    toast(error.message, true);
  } finally {
    button.disabled = false;
  }
}

function showApp() {
  $('#admin-login').classList.add('hidden');
  $('#admin-app').classList.remove('hidden');
  $('#admin-role-label').textContent = state.role;
  if (state.role === 'support') {
    document.querySelector('.admin-exports')?.classList.add('hidden');
  }
}

function logout() {
  state.token = '';
  sessionStorage.removeItem('sb.admin.token');
  $('#admin-app').classList.add('hidden');
  $('#admin-login').classList.remove('hidden');
}

function metric(label, value, note = '') {
  return `<article class="metric-card"><span>${label}</span><strong>${value}</strong><small>${note}</small></article>`;
}

function renderAnalytics(data) {
  const latency = data.latency?.sync?.p95 ?? '—';
  $('#admin-cards').innerHTML = [
    metric('Операции', data.operations.total, `${data.operations.draft} черновиков`),
    metric('Билеты', data.counters.ticketsIssued, `${data.funnel.handoffRate}% переходов`),
    metric('Handoff', data.counters.handoffsRedeemed, `${data.funnel.conversion}% конверсия`),
    metric('Отправлено', data.counters.submissions, 'завершённые'),
    metric('p95 синхронизации', `${latency} мс`, 'серверная обработка'),
    metric('Событий аудита', data.audit.events, data.audit.valid ? 'цепочка цела' : 'цепочка нарушена'),
  ].join('');

  const stages = [
    ['Начато', data.funnel.started],
    ['Билет', data.funnel.tickets],
    ['Handoff', data.funnel.redeemed],
    ['Отправлено', data.funnel.submitted],
  ];
  const max = Math.max(1, ...stages.map(([, value]) => value));
  $('#funnel').innerHTML = stages
    .map(
      ([label, value]) => `
      <div class="funnel-row">
        <span>${label}</span>
        <div class="funnel-bar"><span style="width:${Math.round((value / max) * 100)}%"></span></div>
        <strong>${value}</strong>
      </div>`,
    )
    .join('');
  $('#funnel-rate').textContent = `${data.funnel.handoffRate}% handoff`;
  $('#chain-badge').textContent = data.audit.valid ? 'valid' : 'broken';
  $('#chain-badge').className = `badge ${data.audit.valid ? 'badge-live' : ''}`;
  $('#chain-text').textContent = data.audit.valid
    ? `Проверено событий: ${data.audit.events}`
    : 'Обнаружен разрыв hash chain';
  $('#chain-hash').textContent = data.audit.lastHash || '—';
}

function renderProcesses(data) {
  const labels = ['Создана', 'Заполнение', 'Подтверждение', 'Переход', 'Исполнена'];
  $('#process-summary').textContent = `${data.stats.total} операций · ${data.stats.atRisk} в зоне риска`;
  $('#kanban').innerHTML = labels
    .map((label, stage) => {
      const cards = data.items.filter((item) => item.stage === stage);
      const body = cards.length
        ? cards
            .map(
              (item) => `
          <div class="kanban-card">
            <strong>${item.recipientName || 'Новый перевод'}</strong>
            <div>${item.amount ? `${item.amount} ₽` : 'сумма не указана'}</div>
            <div class="meta">
              <span class="risk-chip risk-${item.riskLabel}">${item.riskLabel}</span>
              <span>${item.slaState === 'breached' ? 'SLA нарушен' : `${Math.round(item.slaMinutes / 60)} ч`}</span>
            </div>
          </div>`,
            )
            .join('')
        : '<div class="kanban-empty">Нет операций</div>';
      return `<div class="kanban-col"><h3><span>${label}</span><span>${cards.length}</span></h3>${body}</div>`;
    })
    .join('');
}

function renderAudit(data) {
  $('#audit-count').textContent = String(data.items.length);
  $('#audit-body').innerHTML = data.items
    .map(
      (item) => `
      <tr>
        <td>${new Date(item.at).toLocaleString('ru-RU')}</td>
        <td>${item.type}</td>
        <td>${item.actor?.role || '—'}</td>
        <td>${item.opId || '—'}</td>
        <td>${item.outcome || '—'}</td>
        <td class="hash" title="${item.hash}">${String(item.hash).slice(0, 12)}…</td>
      </tr>`,
    )
    .join('');
  if (!data.verification?.valid) toast('Целостность аудита нарушена', true);
}

async function refresh() {
  try {
    const [analytics, audit, processes] = await Promise.all([
      api('/admin/analytics'),
      api('/admin/audit?limit=30'),
      api('/admin/processes'),
    ]);
    renderAnalytics(analytics);
    renderProcesses(processes);
    renderAudit(audit);
  } catch (error) {
    if (String(error.message).includes('прав')) {
      toast('Недостаточно прав для раздела', true);
    } else {
      toast(error.message, true);
    }
  }
}

async function exportData(type, format) {
  try {
    const response = await fetch(`/v1/admin/export?type=${type}&format=${format}`, {
      headers: { Authorization: `Bearer ${state.token}` },
    });
    if (!response.ok) throw new Error(`Экспорт: ${response.status}`);
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${type}.${format}`;
    link.click();
    URL.revokeObjectURL(url);
    toast(`Экспорт ${type}.${format} готов`);
    await refresh();
  } catch (error) {
    toast(error.message, true);
  }
}

$('#admin-form').addEventListener('submit', (event) => {
  event.preventDefault();
  login();
});
$('#admin-refresh').addEventListener('click', refresh);
$('#admin-logout').addEventListener('click', logout);
$$('[data-export]').forEach((button) => {
  button.addEventListener('click', () => exportData(button.dataset.export, button.dataset.format));
});

if (state.token) {
  showApp();
  refresh();
}
