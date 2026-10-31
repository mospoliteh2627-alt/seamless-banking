/* global crypto, navigator, location */

const API_PREFIX = '/v1';
const UI_VERSION = '2026.10.31';
document.documentElement.dataset.uiVersion = UI_VERSION;
console.info(`Vector Bank UI ${UI_VERSION}`);

const state = {
  token: sessionStorage.getItem('sb.token') || '',
  user: null,
  session: null,
  draft: null,
  step: 1,
  readOnly: false,
  saving: false,
  queued: false,
  saveTimer: null,
  lastSavedAt: null,
  processes: [],
  recipients: [],
  ws: null,
  wsRetry: null,
  handoff: null,
  handoffTimer: null,
  handoffPoll: null,
  handoffStatusTimer: null,
  handoffStartedAt: 0,
  handoffIssuedAt: 0,
  handoffClosing: false,
  payee: null,
  payeeTimer: null,
  submitKey: null,
  a11y: { fontScale: 1, contrast: false, reduceMotion: false },
  lastFocus: null,
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

const els = {
  viewLogin: $('#view-login'),
  viewLanding: $('#view-landing'),
  viewApp: $('#view-app'),
  loginForm: $('#login-form'),
  loginPhone: $('#login-phone'),
  loginCode: $('#login-code'),
  loginSubmit: $('#login-submit'),
  userName: $('#user-name'),
  userSegment: $('#user-segment'),
  userAvatar: $('#user-avatar'),
  helloName: $('#hello-name'),
  today: $('#today'),
  balanceInt: $('#balance-int'),
  balanceCents: $('#balance-cents'),
  accountMask: $('#account-mask'),
  draftsCount: $('#drafts-count'),
  draftList: $('#draft-list'),
  processTotal: $('#process-total'),
  processTimeline: $('#process-timeline'),
  processRisk: $('#process-risk'),
  processSla: $('#process-sla'),
  processStageLabel: $('#process-stage-label'),
  screenDashboard: $('#screen-dashboard'),
  screenTransfer: $('#screen-transfer'),
  screenSuccess: $('#screen-success'),
  transferForm: $('#transfer-form'),
  steps: $$('#steps .step'),
  panels: $$('.step-panel'),
  saveStatus: $('#save-status'),
  saveTime: $('#save-time'),
  wsBadge: $('#ws-badge'),
  syncDevice: $('#sync-device'),
  btnHandoff: $('#btn-handoff'),
  btnClaim: $('#btn-claim'),
  handoffBanner: $('#handoff-banner'),
  recipientPicks: $('#recipient-picks'),
  recipientChips: $('#recipient-chips'),
  handoffBannerTitle: $('#handoff-banner-title'),
  handoffBannerText: $('#handoff-banner-text'),
  handoffTimeline: $('#handoff-timeline'),
  modal: $('#handoff-modal'),
  qrImage: $('#qr-image'),
  qrExpired: $('#qr-expired'),
  handoffCode: $('#handoff-code'),
  handoffStatus: $('#handoff-status'),
  handoffTimer: $('#handoff-timer'),
  handoffTelemetry: $('#handoff-telemetry'),
  qrBar: $('#qr-progress-bar'),
  btnDemoPhone: $('#btn-demo-phone'),
  a11yModal: $('#a11y-modal'),
  infoModal: $('#info-modal'),
  infoTitle: $('#info-title'),
  infoEyebrow: $('#info-eyebrow'),
  infoBody: $('#info-body'),
  toast: $('#toast'),
  btnGuide: $('#btn-guide'),
  guideModal: $('#guide-modal'),
  guideSteps: $('#guide-steps'),
  payeeCheck: $('#payee-check'),
  payeeIcon: $('#payee-icon'),
  payeeTitle: $('#payee-title'),
  payeeText: $('#payee-text'),
  payeeFix: $('#payee-fix'),
  payeeConfirm: $('#payee-confirm'),
  payeeExpected: $('#payee-expected'),
  payeeAccept: $('#f-payee-accept'),
  payeeName: $('#f-recipientName'),
  payeeAccount: $('#f-recipientAccount'),
  payeeBank: $('#f-recipientBank'),
  hoFields: $('#ho-fields'),
  hoStep: $('#ho-step'),
  hoTotal: $('#ho-total'),
  hoFocus: $('#ho-focus'),
};

/* ------------------------------------------------------------------ */
/* Утилиты                                                             */
/* ------------------------------------------------------------------ */

function deviceId() {
  let id = localStorage.getItem('sb.deviceId');
  if (!id) {
    id = `web_${(crypto.randomUUID?.() || String(Math.random())).slice(0, 8)}`;
    localStorage.setItem('sb.deviceId', id);
  }
  return id;
}

function deviceName() {
  const ua = navigator.userAgent;
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /YaBrowser/.test(ua)
      ? 'Яндекс Браузер'
      : /Firefox\//.test(ua)
        ? 'Firefox'
        : /Chrome\//.test(ua)
          ? 'Chrome'
          : /Safari\//.test(ua)
            ? 'Safari'
            : 'Браузер';
  const os = /Mac OS X/.test(ua)
    ? 'macOS'
    : /Windows/.test(ua)
      ? 'Windows'
      : /Android/.test(ua)
        ? 'Android'
        : /iPhone|iPad/.test(ua)
          ? 'iOS'
          : 'устройство';
  return `${browser} · ${os}`;
}

const money = new Intl.NumberFormat('ru-RU', {
  style: 'currency',
  currency: 'RUB',
  maximumFractionDigits: 2,
});

const timeFormat = new Intl.DateTimeFormat('ru-RU', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

function formatMoney(value) {
  const number = Number(String(value).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(number) ? money.format(number) : money.format(0);
}

function toast(message, kind = 'info') {
  els.toast.textContent = message;
  els.toast.classList.toggle('is-error', kind === 'error');
  els.toast.classList.add('is-visible');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => els.toast.classList.remove('is-visible'), 3600);
}

function loadA11y() {
  try {
    const stored = JSON.parse(localStorage.getItem('sb.a11y') || '{}');
    state.a11y = {
      fontScale: Number(stored.fontScale) || 1,
      contrast: Boolean(stored.contrast),
      reduceMotion: Boolean(stored.reduceMotion),
    };
  } catch {
    state.a11y = { fontScale: 1, contrast: false, reduceMotion: false };
  }
  applyA11y();
}

function applyA11y() {
  const root = document.documentElement;
  const scale = state.a11y.fontScale;
  root.classList.toggle('a11y-font-lg', scale >= 1.1 && scale < 1.25);
  root.classList.toggle('a11y-font-xl', scale >= 1.25);
  root.classList.toggle('a11y-contrast', state.a11y.contrast);
  root.classList.toggle('a11y-reduce-motion', state.a11y.reduceMotion);
  $$('.segmented [data-font]').forEach((button) => {
    button.classList.toggle('is-active', Math.abs(Number(button.dataset.font) - scale) < 0.01);
  });
  const contrast = $('#a11y-contrast');
  const motion = $('#a11y-motion');
  if (contrast) contrast.checked = state.a11y.contrast;
  if (motion) motion.checked = state.a11y.reduceMotion;
}

function saveA11y() {
  localStorage.setItem('sb.a11y', JSON.stringify(state.a11y));
  applyA11y();
  if (state.draft && !state.readOnly) scheduleSave();
}

function focusableItems(root) {
  return $$(
    'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])',
    root,
  ).filter((element) => element.offsetParent !== null || element === document.activeElement);
}

function onModalKeydown(event) {
  const a11yOpen = !els.a11yModal.classList.contains('hidden');
  const handoffOpen = !els.modal.classList.contains('hidden');
  const infoOpen = !els.infoModal.classList.contains('hidden');
  if (!a11yOpen && !handoffOpen && !infoOpen) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    if (infoOpen) closeInfo();
    else if (a11yOpen) closeA11y();
    else closeHandoff();
    return;
  }
  if (event.key !== 'Tab') return;
  const modal = infoOpen ? els.infoModal : a11yOpen ? els.a11yModal : els.modal;
  const items = focusableItems(modal);
  if (!items.length) return;
  const first = items[0];
  const last = items[items.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function openA11y() {
  state.lastFocus = document.activeElement;
  els.a11yModal.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  document.addEventListener('keydown', onModalKeydown);
  requestAnimationFrame(() => $('#a11y-title')?.focus());
}

function closeA11y() {
  els.a11yModal.classList.add('hidden');
  document.body.style.overflow = '';
  document.removeEventListener('keydown', onModalKeydown);
  state.lastFocus?.focus?.();
}

/* ------------------------------------------------------------------ */
/* Гайд «как это работает»                                             */
/* ------------------------------------------------------------------ */

function markGuide(step) {
  if (!state.guideDone) state.guideDone = new Set();
  state.guideDone.add(Number(step));
  renderGuide();
}

function renderGuide() {
  if (!els.guideSteps) return;
  const done = state.guideDone || new Set();
  els.guideSteps.querySelectorAll('li').forEach((item) => {
    const n = Number(item.dataset.guideStep);
    const isDone = done.has(n);
    item.classList.toggle('is-done', isDone);
    const button = item.querySelector('button');
    if (button && isDone) {
      button.textContent = 'Готово';
      button.disabled = true;
    }
  });
}

function openGuide() {
  state.lastFocus = document.activeElement;
  els.guideModal.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  document.addEventListener('keydown', onModalKeydown);
  renderGuide();
  requestAnimationFrame(() => $('#guide-title')?.focus());
}

function closeGuide() {
  els.guideModal.classList.add('hidden');
  document.body.style.overflow = '';
  document.removeEventListener('keydown', onModalKeydown);
  state.lastFocus?.focus?.();
}

function fillDemoTransfer() {
  const demo = {
    recipientName: 'Иван Петров',
    recipientBank: 'Вектор Банк',
    recipientAccount: '40817810000000001234',
    amount: '24 500',
    purpose: 'Перевод личных средств',
  };
  for (const [key, value] of Object.entries(demo)) {
    const field = $(`#f-${key}`);
    if (field) field.value = value;
  }
  state.step = 2;
  renderStep();
  updateSummary();
  scheduleSave();
  schedulePayeeCheck();
}

async function runGuideAction(action) {
  if (action === 'start') {
    if (!els.viewApp || els.viewApp.classList.contains('hidden')) {
      closeGuide();
      showLogin();
      toast('Войдите в демо — и сценарий начнётся с главного экрана');
      return;
    }
    closeGuide();
    await startTransfer();
    fillDemoTransfer();
    return;
  }
  if (action === 'handoff') {
    closeGuide();
    if (!state.draft) {
      await startTransfer();
      fillDemoTransfer();
    }
    await openHandoff();
    return;
  }
  if (action === 'phone') {
    if (!state.handoff) {
      toast('Сначала выпустите QR-билет', 'error');
      return;
    }
    els.btnDemoPhone?.click();
    return;
  }
  if (action === 'claim') {
    closeGuide();
    await claimDraft();
  }
}

function openInfo({ title, eyebrow = 'Сервис', html, after }) {
  state.lastFocus = document.activeElement;
  els.infoTitle.textContent = title;
  els.infoEyebrow.textContent = eyebrow;
  els.infoBody.innerHTML = html;
  els.infoModal.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  document.addEventListener('keydown', onModalKeydown);
  requestAnimationFrame(() => {
    els.infoTitle.focus();
    if (after) after(els.infoBody);
  });
}

function closeInfo() {
  els.infoModal.classList.add('hidden');
  document.body.style.overflow = '';
  document.removeEventListener('keydown', onModalKeydown);
  state.lastFocus?.focus?.();
}

function downloadFile(name, content, type = 'text/csv;charset=utf-8') {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

function processTable(items) {
  if (!items.length) return '<p class="muted">Операций пока нет.</p>';
  return `<table class="info-table">
    <thead><tr><th>Дата</th><th>Получатель</th><th>Сумма</th><th>Стадия</th><th>SLA</th></tr></thead>
    <tbody>${items
      .map(
        (item) => `<tr>
          <td>${new Date(item.updatedAt).toLocaleDateString('ru-RU')}</td>
          <td>${escapeHtml(item.recipientName || 'Новый перевод')}</td>
          <td>${item.amount ? formatMoney(item.amount) : '—'}</td>
          <td>${item.stageLabel}</td>
          <td>${item.slaState === 'breached' ? 'нарушен' : `${Math.max(0, Math.round(item.slaMinutes / 60))} ч`}</td>
        </tr>`,
      )
      .join('')}</tbody>
  </table>`;
}

async function openHistory() {
  await loadDrafts();
  const items = [...state.processes]
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
    .slice(0, 12);
  openInfo({
    eyebrow: 'Операции',
    title: 'История операций',
    html: `${processTable(items)}
      <div class="info-actions">
        <button class="btn btn-secondary" type="button" id="history-csv">Скачать CSV</button>
      </div>
      <p class="info-note">Показаны последние 12 операций, включая завершённые. Полный список — в выписке CSV.</p>`,
    after: (body) => {
      body.querySelector('#history-csv').addEventListener('click', () => exportProcessesCsv(items));
    },
  });
}

function exportProcessesCsv(items) {
  const header = 'id,recipient,amount,currency,stage,status,updated_at';
  const rows = items.map((item) =>
    [item.id, item.recipientName, item.amount, item.currency, item.stageLabel, item.status, item.updatedAt]
      .map((value) => `"${String(value ?? '').replace(/"/g, '""')}"`)
      .join(','),
  );
  downloadFile('operations.csv', `\uFEFF${[header, ...rows].join('\n')}`);
  toast('Выписка сформирована');
}

function openRequisites() {
  const account = state.user?.accounts?.[0];
  if (!account) return;
  openInfo({
    eyebrow: 'Счёт',
    title: 'Реквизиты счёта',
    html: `
      <div class="requisite-row"><span>Владелец</span><strong>${escapeHtml(state.user.name)}</strong></div>
      <div class="requisite-row"><span>Счёт</span><strong>${escapeHtml(account.masked)}</strong></div>
      <div class="requisite-row"><span>Валюта</span><strong>${account.currency}</strong></div>
      <div class="requisite-row"><span>Банк</span><strong>Вектор Банк</strong></div>
      <div class="requisite-row"><span>БИК</span><strong>044525225</strong></div>
      <div class="info-actions"><button class="btn btn-secondary" type="button" id="copy-requisites">Скопировать</button></div>`,
    after: (body) => {
      body.querySelector('#copy-requisites').addEventListener('click', async () => {
        await navigator.clipboard.writeText(`${state.user.name}\n${account.masked}\nВектор Банк`);
        toast('Реквизиты скопированы');
      });
    },
  });
}

function openStatement() {
  openHistory();
}

function openAutopay() {
  openInfo({
    eyebrow: 'Автоплатёж',
    title: 'Настроить автоплатёж',
    html: `<form class="info-form" id="autopay-form">
      <label class="field"><span>Сумма, ₽</span><input name="amount" inputmode="decimal" placeholder="5 000" required /></label>
      <label class="field"><span>Дата первого платежа</span><input name="date" type="date" required /></label>
      <label class="field"><span>Периодичность</span>
        <select name="period"><option>Ежемесячно</option><option>Еженедельно</option><option>Раз в квартал</option></select>
      </label>
      <button class="btn btn-primary" type="submit">Сохранить шаблон</button>
    </form>
    <p class="info-note">Шаблон сохраняется локально в демо-контуре; в пилоте — в сервисе автоплатежей банка.</p>`,
    after: (body) => {
      body.querySelector('#autopay-form').addEventListener('submit', (event) => {
        event.preventDefault();
        const data = Object.fromEntries(new FormData(event.target).entries());
        localStorage.setItem('sb.autopay', JSON.stringify(data));
        closeInfo();
        toast(`Автоплатёж на ${formatMoney(data.amount)} сохранён`);
      });
    },
  });
}

function openInvoice() {
  openInfo({
    eyebrow: 'Счёт',
    title: 'Счёт на оплату',
    html: `<form class="info-form" id="invoice-form">
      <label class="field"><span>Получатель</span><input name="recipient" placeholder="ООО «Ромашка»" required /></label>
      <label class="field"><span>Сумма, ₽</span><input name="amount" inputmode="decimal" placeholder="86 000" required /></label>
      <label class="field"><span>Назначение</span><input name="purpose" placeholder="Оплата услуг" required /></label>
      <button class="btn btn-primary" type="submit">Сформировать счёт</button>
    </form>`,
    after: (body) => {
      body.querySelector('#invoice-form').addEventListener('submit', (event) => {
        event.preventDefault();
        const data = Object.fromEntries(new FormData(event.target).entries());
        const text = `СЧЁТ\nВектор Банк\nПолучатель: ${data.recipient}\nСумма: ${data.amount} ₽\nНазначение: ${data.purpose}\nДата: ${new Date().toLocaleDateString('ru-RU')}`;
        downloadFile('invoice.txt', text, 'text/plain;charset=utf-8');
        closeInfo();
        toast('Счёт сформирован');
      });
    },
  });
}

function openSupport() {
  openInfo({
    eyebrow: 'Помощь',
    title: 'Поддержка',
    html: `<p>Контакт-центр: <strong>8 800 000-00-42</strong>, круглосуточно.</p>
      <p style="margin-top:8px">Почта: <strong>help@vector-bank.example</strong></p>
      <div class="info-note">В демо-контуре обращения не отправляются. В пилоте — интеграция с CRM и очередью обращений.</div>
      <div class="info-actions"><button class="btn btn-secondary" type="button" id="copy-support">Скопировать телефон</button></div>`,
    after: (body) => {
      body.querySelector('#copy-support').addEventListener('click', async () => {
        await navigator.clipboard.writeText('8 800 000-00-42');
        toast('Телефон скопирован');
      });
    },
  });
}

async function api(path, { method = 'GET', body = null, auth = true, headers: extraHeaders = {} } = {}) {
  const headers = { ...extraHeaders };
  if (body) headers['Content-Type'] = 'application/json';
  if (auth && state.token) headers.Authorization = `Bearer ${state.token}`;
  const response = await fetch(`${API_PREFIX}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }
  if (!response.ok) {
    const error = new Error(data?.error?.message || `Ошибка ${response.status}`);
    error.code = data?.error?.code || 'HTTP_ERROR';
    error.status = response.status;
    error.payload = data;
    throw error;
  }
  return data;
}

/* ------------------------------------------------------------------ */
/* Вход и восстановление сессии                                        */
/* ------------------------------------------------------------------ */

async function login(phone) {
  els.loginSubmit.disabled = true;
  els.loginSubmit.textContent = 'Входим…';
  try {
    const data = await api('/auth/demo-login', {
      method: 'POST',
      auth: false,
      body: {
        phone,
        channel: 'web',
        deviceId: deviceId(),
        deviceName: deviceName(),
      },
    });
    state.token = data.token;
    state.user = data.user;
    state.session = data.session;
    sessionStorage.setItem('sb.token', data.token);
    await enterApp();
  } catch (error) {
    toast(error.message, 'error');
  } finally {
    els.loginSubmit.disabled = false;
    els.loginSubmit.textContent = 'Войти';
  }
}

async function restoreSession() {
  if (!state.token) return false;
  try {
    const data = await api('/me');
    state.user = data.user;
    state.session = data.session;
    await enterApp();
    return true;
  } catch {
    state.token = '';
    sessionStorage.removeItem('sb.token');
    return false;
  }
}

async function enterApp() {
  els.viewLogin.classList.add('hidden');
  els.viewLanding.classList.add('hidden');
  els.viewApp.classList.remove('hidden');
  renderUser();
  connectSocket();
  await Promise.all([loadDrafts(), loadRecipients()]);
  showScreen('dashboard');
}

function renderUser() {
  const user = state.user;
  if (!user) return;
  const [first, last] = user.name.split(' ');
  els.userName.textContent = user.name;
  els.userSegment.textContent = user.segment;
  els.userAvatar.textContent = `${first?.[0] || ''}${last?.[0] || ''}`.toUpperCase();
  els.helloName.textContent = first;
  els.today.textContent = new Intl.DateTimeFormat('ru-RU', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date());

  const account = user.accounts?.[0];
  if (account) {
    const [int, cents] = account.balance.toFixed(2).split('.');
    els.balanceInt.textContent = new Intl.NumberFormat('ru-RU').format(Number(int));
    els.balanceCents.textContent = `,${cents} ₽`;
    els.accountMask.textContent = account.masked;
  }
  els.syncDevice.textContent = `Это устройство: ${state.session?.deviceName || deviceName()}`;
}

/* ------------------------------------------------------------------ */
/* Экраны                                                              */
/* ------------------------------------------------------------------ */

function showScreen(name) {
  els.screenDashboard.classList.toggle('hidden', name !== 'dashboard');
  els.screenTransfer.classList.toggle('hidden', name !== 'transfer');
  els.screenSuccess.classList.toggle('hidden', name !== 'success');
  $$('.nav-link').forEach((link) => {
    link.classList.toggle('is-active', link.dataset.go === name);
  });
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function loadRecipients() {
  try {
    const data = await api('/recipients');
    state.recipients = data.items || [];
    renderRecipientPicks();
  } catch (error) {
    if (error.status === 401) logout();
  }
}

function renderRecipientPicks() {
  if (!els.recipientPicks || !els.recipientChips) return;
  const items = state.recipients.slice(0, 6);
  els.recipientPicks.classList.toggle('hidden', items.length === 0);
  els.recipientChips.innerHTML = items
    .map((item) => {
      const initials = String(item.name || '?')
        .split(/\s+/)
        .slice(0, 2)
        .map((part) => part[0] || '')
        .join('')
        .toUpperCase();
      return `<button class="recipient-chip" type="button" data-recipient="${escapeHtml(item.id)}">
        <span class="recipient-chip-avatar">${escapeHtml(initials)}</span>
        <span>${escapeHtml(item.name)}<small>${escapeHtml(item.bank || item.account)}</small></span>
      </button>`;
    })
    .join('');
}

function pickRecipient(id) {
  const recipient = state.recipients.find((item) => item.id === id);
  if (!recipient) return;
  const name = $('#f-recipientName');
  const bank = $('#f-recipientBank');
  const account = $('#f-recipientAccount');
  if (name) name.value = recipient.name || '';
  if (bank) bank.value = recipient.bank || '';
  if (account) account.value = recipient.account || '';
  scheduleSave();
  toast(`Получатель выбран: ${recipient.name}`);
}

async function loadDrafts() {
  try {
    const data = await api('/processes');
    state.processes = data.items || [];
    renderDrafts(state.processes);
    renderProcessMap(state.processes);
  } catch (error) {
    if (error.status === 401) logout();
  }
}

function renderProcessMap(items) {
  els.processTotal.textContent = `${items.length} ${items.length === 1 ? 'операция' : 'операций'}`;
  for (let stage = 0; stage < 5; stage += 1) {
    const count = items.filter((item) => item.stage === stage).length;
    const countEl = document.getElementById(`stage-count-${stage}`);
    if (countEl) countEl.textContent = String(count);
    const stageEl = document.querySelector(`.process-stage[data-stage="${stage}"]`);
    if (stageEl) {
      stageEl.classList.toggle('is-done', count > 0);
      stageEl.classList.remove('is-active');
    }
  }
}

function renderProcess(process) {
  if (!process || !els.processTimeline) return;
  const riskClass = `risk-${process.riskLabel || 'low'}`;
  const riskText = { low: 'низкий риск', medium: 'средний риск', high: 'высокий риск' }[process.riskLabel] || 'риск';
  els.processRisk.className = `risk-chip ${riskClass}`;
  els.processRisk.textContent = riskText;
  els.processStageLabel.textContent = process.stageLabel || '—';

  if (process.slaMinutes < 0) {
    els.processSla.textContent = 'SLA нарушен';
    els.processSla.style.color = 'var(--danger)';
  } else {
    const hours = Math.floor(process.slaMinutes / 60);
    const minutes = process.slaMinutes % 60;
    els.processSla.textContent = `SLA ${hours} ч ${String(minutes).padStart(2, '0')} мин`;
    els.processSla.style.color = process.slaState === 'at-risk' ? 'var(--warning)' : 'var(--muted)';
  }

  els.processTimeline.innerHTML = (process.stages || [])
    .map((stage, index) => {
      const done = stage.done || index < process.stage;
      const active = index === process.stage && process.status !== 'submitted';
      const at = stage.at ? new Date(stage.at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '';
      return `<li class="${done ? 'is-done' : ''} ${active ? 'is-active' : ''}">
        <span class="dot"></span>
        <span>${stage.label}${at ? `<span class="at">${at}</span>` : ''}</span>
      </li>`;
    })
    .join('');
}

function renderDrafts(items) {
  const active = items.filter((item) => item.status === 'draft');
  els.draftsCount.textContent = String(active.length);
  if (!active.length) {
    els.draftList.innerHTML = '<li class="empty">Пока нет незавершённых операций</li>';
    return;
  }
  els.draftList.innerHTML = active
    .map((item) => {
      const risk = item.riskLabel || 'low';
      const riskText = { low: 'низкий', medium: 'средний', high: 'высокий' }[risk] || '—';
      return `
      <li class="process-row" data-open="${item.id}" tabindex="0">
        <div class="process-main">
          <div class="process-title">
            ${escapeHtml(item.recipientName || 'Новый перевод')}
            <span class="risk-chip risk-${risk}">${riskText}</span>
          </div>
          <span class="process-sub">${item.stageLabel} · шаг ${item.step} из ${item.totalSteps} · ${item.amount ? formatMoney(item.amount) : 'сумма не указана'}</span>
        </div>
        <span class="process-sub">${item.slaState === 'breached' ? 'SLA нарушен' : `SLA ${Math.max(0, Math.round(item.slaMinutes / 60))} ч`}</span>
        <div class="process-bar" style="grid-column:1/-1"><span style="width:${item.progress}%"></span></div>
      </li>`;
    })
    .join('');
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[char]);
}

/* ------------------------------------------------------------------ */
/* Работа с переводом                                                  */
/* ------------------------------------------------------------------ */

async function startTransfer(existing = null) {
  try {
    let draft = existing;
    if (!draft) {
      const data = await api('/drafts', { method: 'POST', body: { product: 'transfer' } });
      draft = data.draft;
    }
    const isNew = !existing;
    state.draft = draft;
    state.step = draft.step || 1;
    state.submitKey = null;
    applyDraft(draft, { applyProfile: !isNew });
    applyReadOnly(!draft.canEdit);
    showScreen('transfer');
    if (isNew) {
      scheduleSave();
      markGuide(1);
    }
    await loadDrafts();
    requestAnimationFrame(() => focusFromContext(draft.context));
  } catch (error) {
    if (error.code === 'STEP_UP_REQUIRED') {
      toast('Сначала подтвердите личность', 'error');
    } else {
      toast(error.message, 'error');
    }
  }
}

async function openDraft(id) {
  try {
    const data = await api(`/drafts/${id}`);
    await startTransfer(data.draft);
  } catch (error) {
    toast(error.message, 'error');
  }
}

function applyDraft(draft, { applyProfile = true } = {}) {
  state.draft = draft;
  state.step = draft.step || 1;
  for (const [key, value] of Object.entries(draft.fields || {})) {
    const field = $(`[name="${key}"]`, els.transferForm);
    if (!field) continue;
    if (field.type === 'checkbox') field.checked = Boolean(value);
    else field.value = value;
  }
  if (applyProfile && draft.context?.a11y) {
    state.a11y = {
      fontScale: Number(draft.context.a11y.fontScale) || 1,
      contrast: draft.context.a11y.contrast === 'high',
      reduceMotion: Boolean(draft.context.a11y.reduceMotion),
    };
    applyA11y();
  }
  renderStep();
  updateSummary();
  if (draft.payee) renderPayee(draft.payee);
  else resetPayee();
  if (draft.process) renderProcess(draft.process);
  els.saveTime.textContent = draft.updatedAt
    ? `Обновлено ${timeFormat.format(new Date(draft.updatedAt))}`
    : 'Изменения сохраняются автоматически';
  if (draft.version > 1) setSaveStatus('saved', 'Сохранено');
  applyReadOnly(!draft.canEdit);
}

function renderStep() {
  els.panels.forEach((panel) => {
    panel.classList.toggle('hidden', Number(panel.dataset.panel) !== state.step);
  });
  els.steps.forEach((step) => {
    const index = Number(step.dataset.step);
    step.classList.toggle('is-active', index === state.step);
    step.classList.toggle('is-done', index < state.step);
  });
  updateSummary();
}

function focusFromContext(context) {
  if (!context) return;
  const field = context.focus ? document.getElementById(`f-${context.focus}`) : null;
  if (field) {
    field.focus({ preventScroll: true });
    if (typeof context.caret === 'number' && field.setSelectionRange) {
      try {
        field.setSelectionRange(context.caret, context.caret);
      } catch {
        /* поле может не поддерживать selection */
      }
    }
  }
  if (context.scroll) window.scrollTo({ top: context.scroll, behavior: 'auto' });
}

const PAYEE_TITLES = {
  checking: 'Проверяем получателя…',
  match: 'Получатель подтверждён',
  close_match: 'Похожее имя',
  no_match: 'Имя не совпадает',
  no_data: 'Счёт не найден в справочнике',
};

function resetPayee() {
  state.payee = null;
  if (els.payeeCheck) els.payeeCheck.hidden = true;
  els.payeeConfirm?.classList.add('hidden');
  if (els.payeeAccept) els.payeeAccept.checked = false;
}

function renderPayee(result) {
  if (!els.payeeCheck) return;
  state.payee = result || null;
  const cls = {
    checking: 'is-checking',
    match: 'is-match',
    close_match: 'is-close',
    no_match: 'is-mismatch',
    no_data: 'is-unknown',
  }[result?.status] || 'is-unknown';
  els.payeeCheck.hidden = false;
  els.payeeCheck.className = `payee-check ${cls}`;
  els.payeeTitle.textContent = PAYEE_TITLES[result?.status] || 'Проверка получателя';
  els.payeeText.textContent =
    result?.message ||
    (result?.status === 'checking' ? 'Сверяем имя и счёт в демо-справочнике' : 'Проверьте реквизиты');
  const fixable = result?.status === 'close_match' && result?.expectedName;
  els.payeeFix?.classList.toggle('hidden', !fixable);
  if (result?.status === 'close_match') {
    els.payeeConfirm?.classList.remove('hidden');
    if (els.payeeExpected) els.payeeExpected.textContent = result.expectedName;
  } else {
    els.payeeConfirm?.classList.add('hidden');
    if (els.payeeAccept) els.payeeAccept.checked = false;
  }
}

function schedulePayeeCheck() {
  clearTimeout(state.payeeTimer);
  const account = String(els.payeeAccount?.value || '').replace(/\D/g, '');
  const name = String(els.payeeName?.value || '').trim();
  if (account.length < 16 || name.length < 3) {
    resetPayee();
    return;
  }
  renderPayee({ status: 'checking' });
  state.payeeTimer = setTimeout(checkPayee, 550);
}

async function checkPayee() {
  const account = String(els.payeeAccount?.value || '').replace(/\D/g, '');
  const name = String(els.payeeName?.value || '').trim();
  const bank = String(els.payeeBank?.value || '').trim();
  if (account.length < 16 || name.length < 3) return;
  try {
    const result = await api('/payee/verify', {
      method: 'POST',
      body: {
        account,
        bank,
        recipientName: name,
        ...(state.draft?.id ? { opId: state.draft.id } : {}),
      },
    });
    renderPayee(result);
  } catch (error) {
    renderPayee({
      status: 'no_data',
      message: error.status === 429 ? 'Слишком много проверок — подождите минуту' : 'Проверка недоступна',
    });
  }
}

function acceptExpectedPayee() {
  if (!state.payee?.expectedName || !els.payeeName) return;
  els.payeeName.value = state.payee.expectedName;
  els.payeeName.focus();
  scheduleSave();
  checkPayee();
}

function collectFields() {
  const fields = {};
  for (const [key] of Object.entries({
    recipientName: 1,
    recipientBank: 1,
    recipientAccount: 1,
    amount: 1,
    purpose: 1,
  })) {
    const input = $(`[name="${key}"]`, els.transferForm);
    if (input) fields[key] = input.value;
  }
  fields.currency = 'RUB';
  const recipient = $('[name="saveRecipient"]', els.transferForm);
  if (recipient) fields.saveRecipient = recipient.checked;
  return fields;
}

function emptyField(key) {
  const input = $(`[name="${key}"]`, els.transferForm);
  return input && !String(input.value || '').trim();
}

function validateStep(step) {
  if (step === 1) {
    if (emptyField('recipientName')) {
      toast('Укажите имя получателя', 'error');
      return false;
    }
    if (emptyField('recipientAccount')) {
      toast('Укажите счёт получателя', 'error');
      return false;
    }
  }
  if (step === 2) {
    const amount = Number($('[name="amount"]', els.transferForm).value.replace(/\s/g, '').replace(',', '.'));
    if (!Number.isFinite(amount) || amount <= 0) {
      toast('Введите сумму больше нуля', 'error');
      return false;
    }
  }
  return true;
}

function updateSummary() {
  const fields = collectFields();
  $('#s-recipient').textContent = fields.recipientName || '—';
  $('#s-bank').textContent = fields.recipientBank || '—';
  $('#s-account').textContent = fields.recipientAccount || '—';
  $('#s-purpose').textContent = fields.purpose || '—';
  $('#s-amount').textContent = fields.amount ? formatMoney(fields.amount) : '0 ₽';
}

function collectContext() {
  const active = document.activeElement;
  const context = {
    focus: active?.name || state.draft?.context?.focus || 'recipientName',
    caret: active?.selectionStart ?? 0,
    scroll: window.scrollY,
    locale: 'ru-RU',
    a11y: {
      fontScale: state.a11y.fontScale,
      contrast: state.a11y.contrast ? 'high' : 'normal',
      reduceMotion: state.a11y.reduceMotion,
    },
  };
  return context;
}

function setSaveStatus(kind, text) {
  els.saveStatus.classList.remove('is-saved', 'is-saving', 'is-error');
  if (kind) els.saveStatus.classList.add(`is-${kind}`);
  els.saveStatus.querySelector('.save-text').textContent = text;
}

function scheduleSave() {
  if (state.readOnly || !state.draft) return;
  setSaveStatus('saving', 'Сохраняем…');
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(() => saveDraft(), 450);
}

async function saveDraft() {
  if (!state.draft || state.readOnly) return;
  if (state.saving) {
    state.queued = true;
    return;
  }
  state.saving = true;
  try {
    const data = await api(`/drafts/${state.draft.id}`, {
      method: 'PATCH',
      body: {
        baseVersion: state.draft.version,
        fields: collectFields(),
        step: state.step,
        context: collectContext(),
      },
    });
    state.draft = data.draft;
    state.lastSavedAt = new Date();
    setSaveStatus('saved', 'Сохранено');
    els.saveTime.textContent = `Сохранено в ${timeFormat.format(state.lastSavedAt)}`;
  } catch (error) {
    if (error.code === 'LEASE_HELD' || error.code === 'VERSION_CONFLICT') {
      const remote = error.payload?.error?.draft;
      if (remote) applyDraft(remote);
      applyReadOnly(true);
      setSaveStatus('error', 'Изменено на другом устройстве');
      showHandoffBanner(
        'Черновик изменён на другом устройстве',
        'Продолжение доступно там же. Верните управление, чтобы редактировать здесь.',
      );
      toast('Черновик открыт на другом устройстве', 'error');
    } else if (error.status === 401) {
      logout();
    } else {
      setSaveStatus('error', 'Не сохранено');
      toast(error.message, 'error');
    }
  } finally {
    state.saving = false;
    if (state.queued) {
      state.queued = false;
      saveDraft();
    }
  }
}

function applyReadOnly(flag) {
  state.readOnly = flag;
  $$('input', els.transferForm).forEach((input) => {
    if (input.type === 'checkbox') input.disabled = flag;
    else input.readOnly = flag;
  });
  $$('button', els.transferForm).forEach((button) => {
    button.disabled = flag;
  });
  els.btnHandoff.classList.toggle('hidden', flag);
  els.btnClaim.classList.toggle('hidden', !flag);
  $('#handoff-hint')?.classList.toggle('hidden', flag);
  if (!flag) els.handoffBanner.classList.add('hidden');
}

function setHandoffPhase(phase) {
  const order = ['issued', 'scanned', 'stepup', 'restored'];
  const index = phase === 'complete' ? order.length : order.indexOf(phase);
  if (!els.handoffTimeline || index < 0) return;
  els.handoffTimeline.querySelectorAll('li').forEach((item) => {
    const itemIndex = order.indexOf(item.dataset.phase);
    item.classList.toggle('is-done', itemIndex < index);
    item.classList.toggle('is-active', phase !== 'complete' && itemIndex === index);
  });
}

function resetHandoffPhase() {
  setHandoffPhase('scanned');
}

function showHandoffBanner(title, text) {
  els.handoffBannerTitle.textContent = title;
  els.handoffBannerText.textContent = text;
  els.handoffBanner.classList.remove('hidden');
}

/* ------------------------------------------------------------------ */
/* WebSocket                                                           */
/* ------------------------------------------------------------------ */

function connectSocket() {
  if (!state.token) return;
  if (state.ws && [WebSocket.OPEN, WebSocket.CONNECTING].includes(state.ws.readyState)) return;
  const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
  const socket = new WebSocket(
    `${protocol}://${location.host}/v1/stream?token=${encodeURIComponent(state.token)}`,
  );
  state.ws = socket;

  socket.addEventListener('open', () => {
    els.wsBadge.innerHTML = '<span class="pulse"></span> online';
    clearTimeout(state.wsRetry);
  });

  socket.addEventListener('close', () => {
    els.wsBadge.innerHTML = '<span class="pulse"></span> offline';
    if (state.token) {
      clearTimeout(state.wsRetry);
      state.wsRetry = setTimeout(connectSocket, 2200);
    }
  });

  socket.addEventListener('message', (event) => {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }
    handleEvent(message);
  });
}

function reportClientSync(updatedAt) {
  const timestamp = Date.parse(updatedAt || '');
  if (!Number.isFinite(timestamp)) return;
  const ms = Math.max(0, Date.now() - timestamp);
  if (ms > 60_000) return;
  api('/metrics/client', { method: 'POST', body: { metric: 'sync', ms } }).catch(() => {});
}

function handleEvent(message) {
  const payload = message.payload || {};
  const myDevice = state.session?.deviceId;
  if (message.type === 'draft.updated') {
    if (payload.process) renderProcess(payload.process);
    const draft = payload.draft;
    if (!draft || draft.id !== state.draft?.id) return;
    state.draft = { ...state.draft, ...draft };
    if (draft.updatedBy?.deviceId !== myDevice) {
      reportClientSync(draft.updatedAt);
      applyDraft(draft);
      applyReadOnly(true);
      showHandoffBanner(
        `Операция изменена на ${draft.updatedBy?.deviceName || 'другом устройстве'}`,
        'Форма доступна для просмотра. Верните управление, чтобы продолжить здесь.',
      );
    }
    return;
  }

  if (message.type === 'handoff.redeemed') {
    handoffComplete(payload.deviceName, payload.timing || {});
    if (payload.process) renderProcess(payload.process);
    loadDrafts();
    const draft = payload.draft;
    if (draft && draft.id === state.draft?.id) {
      state.draft = { ...state.draft, ...draft };
      applyDraft(draft);
      applyReadOnly(true);
    } else {
      applyReadOnly(true);
    }
    const elapsed = state.handoffStartedAt
      ? Math.max(0.1, (Date.now() - state.handoffStartedAt) / 1000).toFixed(1).replace('.', ',')
      : null;
    showHandoffBanner(
      `Операция продолжена на ${payload.deviceName || 'телефоне'}`,
      `Черновик, шаг и позиция курсора восстановлены в мобильном приложении.${elapsed ? ` Время перехода: ${elapsed} с.` : ''}`,
    );
    toast(`Бесшовный переход выполнен: ${payload.deviceName || 'телефон'}`);
    return;
  }

  if (message.type === 'lease.claimed') {
    const draft = payload.draft;
    if (!draft || draft.id !== state.draft?.id) return;
    state.draft = { ...state.draft, ...draft };
    const mine = draft.updatedBy?.deviceId === myDevice;
    applyReadOnly(!mine);
    if (mine) {
      els.handoffBanner.classList.add('hidden');
      toast('Управление возвращено на это устройство');
    } else {
      showHandoffBanner(
        `Управление передано на ${draft.updatedBy?.deviceName || 'другое устройство'}`,
        'Форма доступна только для просмотра.',
      );
    }
    return;
  }

  if (message.type === 'draft.submitted') {
    const receipt = payload.receipt;
    if (!receipt) return;
    if (state.draft && payload.draft?.id !== state.draft.id) return;
    showSuccess(receipt);
    toast('Перевод исполнен');
    loadRecipients();
  }
}

/* ------------------------------------------------------------------ */
/* QR-переход                                                          */
/* ------------------------------------------------------------------ */

const FOCUS_LABELS = {
  recipientName: 'получатель',
  recipientBank: 'банк',
  recipientAccount: 'счёт',
  amount: 'сумма',
  purpose: 'назначение',
};

function renderHandoffContext() {
  const draft = state.draft;
  if (!draft) return;
  const fields = Object.entries(draft.fields || {}).filter(
    ([key, value]) => !['currency', 'fee', 'saveRecipient'].includes(key) && String(value || '').trim() !== '',
  );
  if (els.hoFields) els.hoFields.textContent = String(fields.length);
  if (els.hoStep) els.hoStep.textContent = String(draft.step || 1);
  if (els.hoTotal) els.hoTotal.textContent = String(draft.totalSteps || 3);
  if (els.hoFocus) els.hoFocus.textContent = FOCUS_LABELS[draft.context?.focus] || draft.context?.focus || '—';
}

async function openHandoff() {
  if (!state.draft) return;
  clearInterval(state.handoffStatusTimer);
  clearInterval(state.handoffPoll);
  try {
    const data = await api('/handoff/ticket', {
      method: 'POST',
      body: { opId: state.draft.id },
    });
    state.handoff = data;
    state.handoffStartedAt = Date.now();
    state.handoffIssuedAt = Date.now();
    state.handoffClosing = false;
    localStorage.setItem('sb.lastHandoff', data.deeplink);
    localStorage.setItem('sb.lastCode', data.code);
    els.qrImage.src = data.qrSvg;
    els.qrExpired.classList.add('hidden');
    els.handoffCode.textContent = data.code.split('').join(' ');
    els.handoffStatus.textContent = 'Ожидаем сканирование…';
    resetHandoffTimeline();
    renderHandoffContext();
    resetHandoffPhase();
    els.modal.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    state.lastFocus = document.activeElement;
    document.addEventListener('keydown', onModalKeydown);
    $('#handoff-title').focus?.();
    startHandoffCountdown(data.expiresAt, data.ttlSec);
    state.handoffPoll = setInterval(checkHandoffStatus, 1500);
    markGuide(2);
    els.btnHandoff.blur();
  } catch (error) {
    toast(error.message, 'error');
  }
}

function setRingProgress(ratio) {
  if (!els.qrBar) return;
  const clamped = Math.min(1, Math.max(0, ratio));
  els.qrBar.style.width = `${(clamped * 100).toFixed(1)}%`;
  els.qrBar.classList.toggle('is-low', clamped <= 0.22);
}

function phaseTime(phase, text) {
  const node = document.querySelector(`#handoff-timeline .phase-time[data-time="${phase}"]`);
  if (node) node.textContent = text;
}

function resetHandoffTimeline() {
  document.querySelectorAll('#handoff-timeline .phase-time').forEach((node) => {
    node.textContent = node.dataset.time === 'issued' ? '0 мс' : '—';
  });
  if (els.handoffTelemetry) {
    els.handoffTelemetry.classList.remove('is-done');
    els.handoffTelemetry.textContent = 'Билет выпущен · ожидаем подключение';
  }
  if (els.qrBar) {
    els.qrBar.classList.remove('is-low', 'is-done');
    els.qrBar.style.width = '100%';
  }
  els.modal.querySelector('.modal-card')?.classList.remove('is-complete');
}

function handoffComplete(deviceName, timing = {}) {
  if (state.handoffClosing) return;
  state.handoffClosing = true;
  const elapsedMs = state.handoffIssuedAt ? Date.now() - state.handoffIssuedAt : null;
  const elapsedText =
    elapsedMs === null ? '' : elapsedMs < 1000 ? `${Math.round(elapsedMs)} мс` : `${(elapsedMs / 1000).toFixed(2).replace('.', ',')} с`;
  const syncMs = Number.isFinite(timing?.syncMs) ? Math.max(0, Math.round(timing.syncMs)) : null;
  const redeemMs = Number.isFinite(timing?.redeemMs) ? Math.max(0, Math.round(timing.redeemMs)) : null;
  const shortMs = (value) =>
    value < 1 ? '<1 мс' : value < 1000 ? `${value} мс` : `${(value / 1000).toFixed(1).replace('.', ',')} с`;
  markGuide(3);
  setHandoffPhase('complete');
  phaseTime('scanned', syncMs === null ? '✓' : shortMs(syncMs));
  phaseTime('stepup', '✓');
  phaseTime('restored', '✓');
  els.handoffStatus.textContent = deviceName ? `Подключено: ${deviceName}` : 'Телефон подключён';
  if (els.handoffTelemetry) {
    els.handoffTelemetry.classList.add('is-done');
    const parts = [];
    if (redeemMs !== null) parts.push(`сервер: ${shortMs(redeemMs)}`);
    if (syncMs !== null) parts.push(`до подключения: ${shortMs(syncMs)}`);
    if (elapsedText && syncMs === null) parts.push(`полный цикл: ${elapsedText}`);
    els.handoffTelemetry.textContent = parts.length
      ? `Переход выполнен · ${parts.join(' · ')}`
      : 'Переход выполнен · шаг, фокус и позиция курсора восстановлены';
    els.handoffTelemetry.title =
      'Сервер — обработка подхвата и восстановления черновика; до подключения — от выпуска билета до Face ID';
  }
  if (els.qrBar) {
    els.qrBar.classList.remove('is-low');
    els.qrBar.classList.add('is-done');
    els.qrBar.style.width = '100%';
  }
  els.handoffTimer.textContent = '✓';
  els.modal.querySelector('.modal-card')?.classList.add('is-complete');
  clearInterval(state.handoffTimer);
  clearInterval(state.handoffPoll);
  setTimeout(() => closeHandoff(false), 1400);
}

function startHandoffCountdown(expiresAt, ttlSec = 90) {
  clearInterval(state.handoffTimer);
  const deadline = new Date(expiresAt).getTime();
  const totalMs = Math.max(1000, (ttlSec || 90) * 1000);
  const tick = () => {
    const left = Math.max(0, deadline - Date.now());
    const total = Math.ceil(left / 1000);
    const mm = String(Math.floor(total / 60)).padStart(2, '0');
    const ss = String(total % 60).padStart(2, '0');
    els.handoffTimer.textContent = `${mm}:${ss}`;
    setRingProgress(left / totalMs);
    if (left <= 0) {
      clearInterval(state.handoffTimer);
      clearInterval(state.handoffPoll);
      els.qrExpired.classList.remove('hidden');
      els.handoffStatus.textContent = 'Срок действия кода истёк';
      if (els.handoffTelemetry) els.handoffTelemetry.textContent = 'Билет истёк · выпустите новый код';
    }
  };
  tick();
  state.handoffTimer = setInterval(tick, 1000);
}

async function checkHandoffStatus() {
  if (!state.handoff || state.handoffClosing) return;
  try {
    const data = await api(`/handoff/${state.handoff.ticketId}/status`);
    if (data.status === 'redeemed') {
      handoffComplete(data.redeemedBy, {
        syncMs: data.serverSyncMs,
        redeemMs: data.serverRedeemMs,
      });
      toast(`Телефон подключён: ${data.redeemedBy}`);
    }
  } catch {
    /* сетевые сбои не должны ломать опрос */
  }
}

function closeHandoff(focusBack = true) {
  els.modal.classList.add('hidden');
  document.body.style.overflow = '';
  clearInterval(state.handoffTimer);
  clearInterval(state.handoffPoll);
  state.handoffStatusTimer = null;
  document.removeEventListener('keydown', onModalKeydown);
  if (focusBack) (state.lastFocus || els.btnHandoff).focus?.();
}

/* ------------------------------------------------------------------ */
/* Возврат управления и отправка                                       */
/* ------------------------------------------------------------------ */

async function claimDraft() {
  if (!state.draft) return;
  try {
    const data = await api(`/drafts/${state.draft.id}/claim`, { method: 'POST' });
    state.draft = data.draft;
    applyDraft(data.draft);
    applyReadOnly(false);
    setSaveStatus('saved', 'Управление возвращено');
    markGuide(4);
    toast('Управление снова на этом устройстве');
  } catch (error) {
    toast(error.message, 'error');
  }
}

async function submitDraft() {
  if (!state.draft) return;
  if (state.payee?.status === 'no_match') {
    toast(`Имя не совпадает с получателем: ${state.payee.expectedName || 'проверьте реквизиты'}`, 'error');
    els.payeeName?.focus();
    return;
  }
  if (state.payee?.status === 'close_match' && !els.payeeAccept?.checked) {
    toast('Подтвердите получателя с похожим именем', 'error');
    els.payeeAccept?.focus();
    return;
  }
  if (!$('#f-agreement').checked) {
    toast('Подтвердите условия перевода', 'error');
    return;
  }
  const button = $('#btn-submit');
  button.disabled = true;
  button.textContent = 'Отправляем…';
  try {
    clearTimeout(state.saveTimer);
    await saveDraft();
    state.submitKey = state.submitKey || crypto.randomUUID();
    const data = await api(`/drafts/${state.draft.id}/submit`, {
      method: 'POST',
      headers: { 'Idempotency-Key': state.submitKey },
      body: { acceptCloseMatch: els.payeeAccept?.checked === true },
    });
    state.submitKey = null;
    showSuccess(data.receipt);
  } catch (error) {
    if (error.code === 'PAYEE_MISMATCH' || error.code === 'PAYEE_CLOSE_MATCH') {
      toast(error.message, 'error');
    } else if (error.code === 'VALIDATION_FAILED') {
      toast('Проверьте обязательные поля перевода', 'error');
    } else {
      toast(error.message, 'error');
    }
  } finally {
    button.disabled = false;
    button.textContent = 'Перевести';
  }
}

function showSuccess(receipt) {
  if (!receipt) return;
  $('#r-recipient').textContent = receipt.recipientName || '—';
  $('#r-amount').textContent = money.format(receipt.amount || 0);
  $('#r-id').textContent = receipt.id;
  $('#r-date').textContent = new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'long',
    timeStyle: 'short',
  }).format(new Date(receipt.executedAt));
  showScreen('success');
  loadDrafts();
}

/* ------------------------------------------------------------------ */
/* Выход                                                               */
/* ------------------------------------------------------------------ */

function logout() {
  state.token = '';
  state.user = null;
  state.session = null;
  state.draft = null;
  sessionStorage.removeItem('sb.token');
  clearTimeout(state.wsRetry);
  try {
    state.ws?.close();
  } catch {
    /* no-op */
  }
  state.ws = null;
  els.viewApp.classList.add('hidden');
  els.viewLogin.classList.remove('hidden');
  els.loginPhone.focus();
}

/* ------------------------------------------------------------------ */
/* События                                                             */
/* ------------------------------------------------------------------ */

els.loginForm.addEventListener('submit', (event) => {
  event.preventDefault();
  login(els.loginPhone.value.trim());
});

$$('[data-go]').forEach((button) => {
  button.addEventListener('click', () => {
    if (button.dataset.go === 'transfer') startTransfer();
    else if (button.dataset.go === 'history') {
      openHistory();
    } else {
      showScreen('dashboard');
    }
  });
});

$('#btn-new-transfer').addEventListener('click', () => startTransfer());
$('#btn-back').addEventListener('click', async () => {
  clearTimeout(state.saveTimer);
  await saveDraft();
  await loadDrafts();
  showScreen('dashboard');
});
$('#btn-logout').addEventListener('click', logout);
$('#btn-success-home').addEventListener('click', async () => {
  await loadDrafts();
  showScreen('dashboard');
});
$('#btn-success-new').addEventListener('click', () => startTransfer());

$$('[data-quick]').forEach((button) => {
  button.addEventListener('click', () => {
    const action = button.dataset.quick;
    if (action === 'transfer') startTransfer();
    else if (action === 'requisites') openRequisites();
    else if (action === 'statement') openStatement();
    else if (action === 'autopay') openAutopay();
    else if (action === 'invoice') openInvoice();
    else if (action === 'support') openSupport();
  });
});

els.recipientChips?.addEventListener('click', (event) => {
  const recipient = event.target.closest('[data-recipient]');
  if (recipient) pickRecipient(recipient.dataset.recipient);
});

els.draftList.addEventListener('click', (event) => {
  const row = event.target.closest('[data-open]');
  if (row) openDraft(row.dataset.open);
});
els.draftList.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  const row = event.target.closest('[data-open]');
  if (row) {
    event.preventDefault();
    openDraft(row.dataset.open);
  }
});

els.transferForm.addEventListener('input', (event) => {
  if (state.readOnly) return;
  if (event.target.name === 'saveTemplate') return;
  updateSummary();
  scheduleSave();
});

els.transferForm.addEventListener('focusin', () => {
  if (!state.readOnly) scheduleSave();
});

$$('[data-next]').forEach((button) => {
  button.addEventListener('click', async () => {
    const target = Number(button.dataset.next);
    if (!validateStep(state.step)) return;
    state.step = target;
    renderStep();
    await saveDraft();
    const first = els.panels.find((panel) => Number(panel.dataset.panel) === target)?.querySelector('input');
    first?.focus();
  });
});

$$('[data-prev]').forEach((button) => {
  button.addEventListener('click', () => {
    state.step = Number(button.dataset.prev);
    renderStep();
    saveDraft();
  });
});

els.btnHandoff.addEventListener('click', openHandoff);
els.btnClaim.addEventListener('click', claimDraft);
$('#btn-submit').addEventListener('click', submitDraft);
$('#btn-refresh-ticket').addEventListener('click', () => {
  els.qrExpired.classList.add('hidden');
  openHandoff();
});

els.btnDemoPhone?.addEventListener('click', () => {
  if (!state.handoff) return;
  const url = `/m?code=${encodeURIComponent(state.handoff.code)}`;
  window.open(url, '_blank', 'noopener');
  els.handoffStatus.textContent = 'Демо-телефон открыт · подтвердите Face ID';
  if (els.handoffTelemetry) {
    els.handoffTelemetry.textContent = 'Демо-телефон открыт · подтвердите Face ID (PIN 0000)';
  }
  toast('Демо-телефон открыт в новой вкладке: подтвердите Face ID / PIN 0000');
});

$$('[data-close-modal]').forEach((element) => {
  element.addEventListener('click', () => closeHandoff());
});

$('#btn-a11y').addEventListener('click', openA11y);
els.btnGuide?.addEventListener('click', openGuide);
[els.payeeName, els.payeeAccount, els.payeeBank].forEach((field) => {
  field?.addEventListener('input', schedulePayeeCheck);
});
els.payeeFix?.addEventListener('click', acceptExpectedPayee);
$$('[data-close-guide]').forEach((element) => {
  element.addEventListener('click', () => closeGuide());
});
$$('[data-guide-action]').forEach((button) => {
  button.addEventListener('click', () => runGuideAction(button.dataset.guideAction));
});
$$('[data-close-a11y]').forEach((element) => {
  element.addEventListener('click', () => closeA11y());
});
$$('[data-close-info]').forEach((element) => {
  element.addEventListener('click', () => closeInfo());
});
$$('.segmented [data-font]').forEach((button) => {
  button.addEventListener('click', () => {
    state.a11y.fontScale = Number(button.dataset.font);
    saveA11y();
  });
});
$('#a11y-contrast').addEventListener('change', (event) => {
  state.a11y.contrast = event.target.checked;
  saveA11y();
});
$('#a11y-motion').addEventListener('change', (event) => {
  state.a11y.reduceMotion = event.target.checked;
  saveA11y();
});



$('#btn-copy-link').addEventListener('click', async () => {
  if (!state.handoff) return;
  try {
    await navigator.clipboard.writeText(state.handoff.deeplink);
    toast('Ссылка скопирована');
  } catch {
    toast('Не удалось скопировать ссылку', 'error');
  }
});

window.addEventListener('online', () => connectSocket());

/* ------------------------------------------------------------------ */
/* Запуск                                                              */
/* ------------------------------------------------------------------ */

if ('serviceWorker' in navigator) {
  const hadController = Boolean(navigator.serviceWorker.controller);
  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || refreshing) return;
    refreshing = true;
    window.location.reload();
  });
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js', { updateViaCache: 'none' })
      .then((registration) => registration.update())
      .catch(() => {});
  });
}

loadA11y();

function showLanding() {
  els.viewLogin.classList.add('hidden');
  els.viewLanding.classList.remove('hidden');
}
function showLogin() {
  els.viewLanding.classList.add('hidden');
  els.viewLogin.classList.remove('hidden');
  els.loginPhone.focus();
}
(function wireLanding() {
  const goLogin = $('#btn-go-login');
  const backLanding = $('#btn-back-landing');
  if (goLogin) goLogin.addEventListener('click', showLogin);
  if (backLanding) backLanding.addEventListener('click', showLanding);
})();

(async function boot() {
  const restored = await restoreSession();
  if (!restored) showLanding();
})();
