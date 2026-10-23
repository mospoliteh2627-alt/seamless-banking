const state = {
  token: sessionStorage.getItem('sb.token') || '',
  overview: null,
  sessions: [],
  timer: null,
  startedAt: 0,
  elapsed: 0,
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

function toast(message, error = false) {
  const element = $('#toast');
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
  if (!response.ok) throw new Error(data?.error?.message || `Ошибка ${response.status}`);
  return data;
}

async function ensureToken() {
  if (state.token) {
    try {
      await api('/me');
      return;
    } catch {
      state.token = '';
    }
  }
  const deviceId = localStorage.getItem('sb.deviceId') || `web_${Math.random().toString(16).slice(2, 10)}`;
  localStorage.setItem('sb.deviceId', deviceId);
  const data = await api('/auth/demo-login', {
    method: 'POST',
    body: { channel: 'web', deviceId, deviceName: 'Research · браузер' },
  });
  state.token = data.token;
  sessionStorage.setItem('sb.token', data.token);
}

function renderKpis(data) {
  const simulation = data.simulation;
  $('#kpis').innerHTML = `
    <article class="r-kpi"><span>Бесшовный переход (A)</span><strong>${simulation.conditions.A.toFixed(1)} с</strong><small>среднее TCT</small></article>
    <article class="r-kpi"><span>Повторный ввод (B)</span><strong>${simulation.conditions.B.toFixed(1)} с</strong><small>базовый сценарий</small></article>
    <article class="r-kpi is-mint"><span>Эффект A к B</span><strong>−${simulation.savingPct.toFixed(1)} %</strong><small>ДИ [${simulation.ci95.join('; ')}]</small></article>
    <article class="r-kpi is-accent"><span>Размер эффекта</span><strong>d<sub>z</sub> = ${simulation.cohenDz}</strong><small>p ${simulation.pValue}</small></article>`;
}

function renderBars(data) {
  const values = data.simulation.conditions;
  const max = Math.max(values.A, values.B, values.C);
  const rows = [
    ['A', 'Бесшовный', values.A, 'r-bar-a'],
    ['B', 'Повторный', values.B, 'r-bar-b'],
    ['C', 'Только web', values.C, 'r-bar-c'],
  ];
  $('#tct-bars').innerHTML = rows
    .map(
      ([id, label, value, cls]) => `
      <div class="r-bar-row">
        <b>${id}</b>
        <div class="r-bar ${cls}"><i data-width="${Math.round((value / max) * 100)}"></i></div>
        <em>${value.toFixed(1)} с</em>
      </div>`,
    )
    .join('');
  requestAnimationFrame(() => {
    $$('#tct-bars .r-bar i').forEach((bar) => {
      bar.style.width = `${bar.dataset.width}%`;
    });
  });
  $('#effect').textContent = `−${data.simulation.savingPct.toFixed(1)} %`;
  $('#effect-ci').textContent = `95 % ДИ [${data.simulation.ci95.join('; ')}] · p ${data.simulation.pValue}`;
  $('#effect-metrics').innerHTML = `
    <div class="r-metric"><span>Наблюдений</span><strong>${data.simulation.observations.toLocaleString('ru-RU')}</strong></div>
    <div class="r-metric"><span>Профилей</span><strong>${data.simulation.profiles}</strong></div>
    <div class="r-metric"><span>Повторов</span><strong>${data.simulation.replicates}</strong></div>
    <div class="r-metric"><span>Условий</span><strong>3</strong></div>`;
}

function renderHypotheses(data) {
  const labels = { confirmed: 'подтверждена', not_tested: 'не проверена', scenario: 'сценарно' };
  $('#hypotheses').innerHTML = data.hypotheses
    .map(
      (item) => `
      <article class="r-hyp">
        <div class="r-hyp-top">
          <span class="r-hyp-id">${item.id}</span>
          <span class="r-status ${item.status}">${labels[item.status]}</span>
        </div>
        <strong>${item.title}</strong>
        <p>${item.criterion}. ${item.result}.</p>
      </article>`,
    )
    .join('');
}

function renderMetrics(data) {
  $('#metrics').innerHTML = data.metrics
    .map(
      (item) => `
      <article class="r-metric-card">
        <span>${item.id} · ${item.name}</span>
        <strong>${item.value}</strong>
        <small>цель: ${item.target}</small>
      </article>`,
    )
    .join('');
}

function renderSessions(data) {
  const groups = data.sessions?.aggregate || [];
  const total = data.sessions?.total || 0;
  const word = total % 10 === 1 && total % 100 !== 11 ? 'сессия' : total % 10 >= 2 && total % 10 <= 4 && !(total % 100 >= 12 && total % 100 <= 14) ? 'сессии' : 'сессий';
  $('#session-count').textContent = `${total} ${word}`;
  $('#aggregate').innerHTML = groups.length
    ? groups
        .map(
          (group) => `<div class="r-agg-row"><span>Условие ${group.condition} · ${group.count}</span><strong>${group.meanTct ?? '—'} с · SUS ${group.meanSus ?? '—'}</strong></div>`,
        )
        .join('')
    : '<div class="r-agg-row"><span>Пока нет сессий</span><strong>—</strong></div>';
}

function renderRecent(sessions) {
  $('#sessions').innerHTML = sessions.length
    ? sessions
        .slice(0, 12)
        .map(
          (item) => `<tr>
            <td>${item.participant}</td>
            <td>${item.condition}</td>
            <td>${item.tctSec} с</td>
            <td>${item.sus ?? '—'}</td>
            <td>${item.ces ?? '—'}</td>
          </tr>`,
        )
        .join('')
    : '<tr><td colspan="5">Нет сохранённых сессий</td></tr>';
}

async function load() {
  const [overview, sessions] = await Promise.all([
    api('/research/overview'),
    api('/research/sessions'),
  ]);
  state.overview = overview;
  state.sessions = sessions.items || [];
  renderKpis(overview);
  renderBars(overview);
  renderHypotheses(overview);
  renderMetrics(overview);
  renderSessions(overview);
  renderRecent(state.sessions);
}

function formatTime(ms) {
  const total = Math.max(0, ms);
  const minutes = Math.floor(total / 60000);
  const seconds = Math.floor((total % 60000) / 1000);
  const tenths = Math.floor((total % 1000) / 100);
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${tenths}`;
}

function startTimer() {
  state.startedAt = performance.now() - state.elapsed;
  state.timer = setInterval(() => {
    state.elapsed = performance.now() - state.startedAt;
    $('#timer').textContent = formatTime(state.elapsed);
  }, 100);
  $('#timer-toggle').textContent = 'Стоп';
}

function stopTimer() {
  clearInterval(state.timer);
  state.timer = null;
  $('#timer-toggle').textContent = 'Старт';
}

async function saveSession(event) {
  event.preventDefault();
  if (state.elapsed < 1000) {
    toast('Сначала запустите таймер и выполните сценарий', true);
    return;
  }
  const button = $('#save-session');
  button.disabled = true;
  try {
    await api('/research/sessions', {
      method: 'POST',
      body: {
        condition: $('#condition').value,
        tctSec: Number((state.elapsed / 1000).toFixed(1)),
        errors: Number($('#errors').value) || 0,
        completed: $('#completed').checked,
        sus: $('#sus').value ? Number($('#sus').value) : null,
        ces: $('#ces').value ? Number($('#ces').value) : null,
        participant: $('#participant').value,
      },
    });
    toast('Результат сохранён');
    state.elapsed = 0;
    $('#timer').textContent = '00:00.0';
    $('#participant').value = '';
    await load();
  } catch (error) {
    toast(error.message, true);
  } finally {
    button.disabled = false;
  }
}

function exportCsv() {
  const header = 'id,at,condition,tctSec,errors,completed,sus,ces,participant';
  const rows = state.sessions.map((item) =>
    [item.id, item.at, item.condition, item.tctSec, item.errors, item.completed, item.sus, item.ces, item.participant]
      .map((value) => `"${String(value ?? '').replace(/"/g, '""')}"`)
      .join(','),
  );
  const blob = new Blob([`\uFEFF${[header, ...rows].join('\n')}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'research-sessions.csv';
  link.click();
  URL.revokeObjectURL(url);
  toast('CSV сформирован');
}

$('#timer-toggle').addEventListener('click', () => {
  if (state.timer) stopTimer();
  else startTimer();
});
$('#experiment-form').addEventListener('submit', saveSession);
$('#export-research').addEventListener('click', exportCsv);
$('#scroll-experiment').addEventListener('click', () => {
  $('#experiment').scrollIntoView({ behavior: 'smooth', block: 'start' });
});

(async () => {
  try {
    await ensureToken();
    await load();
  } catch (error) {
    toast(error.message, true);
  }
})();
