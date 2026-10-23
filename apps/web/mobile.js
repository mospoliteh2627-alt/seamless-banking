const state = {
  token: sessionStorage.getItem('sb.mobile.token') || '',
  user: null,
  session: null,
  ticket: '',
  code: '',
  preview: null,
  draft: null,
  saving: false,
  saveTimer: null,
  ws: null,
  wsRetry: null,
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

const money = new Intl.NumberFormat('ru-RU', {
  style: 'currency',
  currency: 'RUB',
  maximumFractionDigits: 2,
});

function formatMoney(value) {
  const number = Number(String(value).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(number) ? money.format(number) : money.format(0);
}

function toast(message, kind = 'info') {
  const element = $('#m-toast');
  element.textContent = message;
  element.classList.toggle('is-error', kind === 'error');
  element.classList.add('is-visible');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => element.classList.remove('is-visible'), 3200);
}

function deviceId() {
  let id = localStorage.getItem('sb.mobile.deviceId');
  if (!id) {
    id = `ios_${(crypto.randomUUID?.() || String(Math.random())).slice(0, 8)}`;
    localStorage.setItem('sb.mobile.deviceId', id);
  }
  return id;
}

const deviceName = 'iPhone 15 · iOS';

async function api(path, { method = 'GET', body = null, auth = true } = {}) {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (auth && state.token) headers.Authorization = `Bearer ${state.token}`;
  const response = await fetch(`/v1${path}`, {
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

function show(id) {
  ['m-login', 'm-home', 'm-confirm', 'm-draft', 'm-success'].forEach((screen) => {
    $(`#${screen}`).classList.toggle('hidden', screen !== id);
  });
  $('.m-main').scrollTop = 0;
}

/* ------------------------------------------------------------------ */
/* Вход                                                                */
/* ------------------------------------------------------------------ */

async function login() {
  const button = $('#m-login-btn');
  button.disabled = true;
  try {
    const data = await api('/auth/demo-login', {
      method: 'POST',
      auth: false,
      body: {
        phone: $('#m-phone').value.trim(),
        channel: 'mobile',
        deviceId: deviceId(),
        deviceName,
      },
    });
    state.token = data.token;
    state.user = data.user;
    state.session = data.session;
    sessionStorage.setItem('sb.mobile.token', data.token);
    $('#m-user-name').textContent = data.user.name.split(' ')[0];
    $('#m-device-label').textContent = `${deviceName} · уровень ${data.session.authLevel}`;
    show('m-home');
    connectSocket();
    prefillLast();
  } catch (error) {
    toast(error.message, 'error');
  } finally {
    button.disabled = false;
  }
}

async function restore() {
  if (!state.token) {
    show('m-login');
    return;
  }
  try {
    const data = await api('/me');
    state.user = data.user;
    state.session = data.session;
    $('#m-user-name').textContent = data.user.name.split(' ')[0];
    $('#m-device-label').textContent = `${deviceName} · уровень ${data.session.authLevel}`;
    show('m-home');
    connectSocket();
    prefillLast();
  } catch {
    state.token = '';
    sessionStorage.removeItem('sb.mobile.token');
    show('m-login');
  }
}

function prefillLast() {
  const last = localStorage.getItem('sb.lastHandoff');
  const code = localStorage.getItem('sb.lastCode');
  if (last && !$('#m-ticket').value) $('#m-ticket').value = last;
  if (code && !$('#m-code').value) $('#m-code').value = code;
}

/* ------------------------------------------------------------------ */
/* Предпросмотр и подхват                                              */
/* ------------------------------------------------------------------ */

function extractTicket(raw) {
  const value = raw.trim();
  if (!value) return '';
  if (value.startsWith('seamlessbank://')) {
    try {
      return new URL(value).searchParams.get('t') || '';
    } catch {
      return '';
    }
  }
  if (value.startsWith('http://') || value.startsWith('https://')) {
    try {
      return new URL(value).searchParams.get('t') || value;
    } catch {
      return value;
    }
  }
  return value;
}

async function preview() {
  const ticket = extractTicket($('#m-ticket').value);
  const code = $('#m-code').value.replace(/\D/g, '').slice(0, 6);
  if (!ticket && code.length !== 6) {
    toast('Вставьте ссылку из QR или шестизначный код', 'error');
    return;
  }
  state.ticket = ticket;
  state.code = code;
  const button = $('#m-preview-btn');
  button.disabled = true;
  button.textContent = 'Ищем операцию…';
  try {
    const data = await api('/handoff/preview', {
      method: 'POST',
      body: ticket ? { ticket } : { code },
    });
    state.preview = data.preview;
    $('#p-recipient').textContent = data.preview.recipientName || 'Новый перевод';
    $('#p-bank').textContent = data.preview.recipientBank || '—';
    $('#p-amount').textContent = data.preview.amount ? formatMoney(data.preview.amount) : 'не указана';
    $('#p-step').textContent = `${data.preview.step} из ${data.preview.totalSteps}`;
    show('m-confirm');
  } catch (error) {
    toast(error.message, 'error');
  } finally {
    button.disabled = false;
    button.textContent = 'Продолжить';
  }
}

async function confirmHandoff() {
  const button = $('#m-faceid-btn');
  button.disabled = true;
  button.textContent = 'Подтверждаем…';
  try {
    if ((state.session?.authLevel || 1) < 2) {
      const stepped = await api('/auth/step-up', {
        method: 'POST',
        body: { method: 'biometric', proof: 'demo-faceid' },
      });
      state.token = stepped.token;
      state.session = { ...state.session, authLevel: 2 };
      sessionStorage.setItem('sb.mobile.token', stepped.token);
    }
    const data = await api('/handoff/redeem', {
      method: 'POST',
      body: {
        ...(state.ticket ? { ticket: state.ticket } : {}),
        ...(state.code ? { code: state.code } : {}),
        deviceId: deviceId(),
        deviceName,
      },
    });
    state.draft = data.draft;
    applyDraft(data.draft);
    $('#m-restored-text').textContent = [
      `Шаг ${data.restored.step}`,
      data.restored.focus ? `фокус на «${fieldTitle(data.restored.focus)}»` : '',
      `версия ${data.restored.version}`,
    ]
      .filter(Boolean)
      .join(' · ');
    applyA11yProfile(data.draft.context?.a11y);
    const steps = document.querySelectorAll('#m-process span');
    steps.forEach((step, index) => {
      step.classList.toggle('is-done', index < 3);
      step.classList.toggle('is-active', index === 2);
    });
    show('m-draft');
    connectSocket();
    toast('Черновик восстановлен');
  } catch (error) {
    if (error.code === 'STEP_UP_REQUIRED') toast('Требуется подтверждение Face ID', 'error');
    else toast(error.message, 'error');
  } finally {
    button.disabled = false;
    button.textContent = 'Подтвердить и продолжить';
  }
}

function applyA11yProfile(profile) {
  if (!profile) return;
  const scale = Number(profile.fontScale) || 1;
  document.body.classList.toggle('a11y-contrast', profile.contrast === 'high');
  document.body.classList.toggle('a11y-reduce-motion', Boolean(profile.reduceMotion));
  document.body.classList.toggle('a11y-font-lg', scale >= 1.1 && scale < 1.25);
  document.body.classList.toggle('a11y-font-xl', scale >= 1.25);
  const label = $('#m-restored-text');
  if (label && scale > 1) label.textContent += ` · доступность ${Math.round(scale * 100)}%`;
}

function fieldTitle(name) {
  const map = {
    recipientName: 'Получатель',
    recipientBank: 'Банк',
    recipientAccount: 'Счёт',
    amount: 'Сумма',
    purpose: 'Назначение',
  };
  return map[name] || name;
}

function applyDraft(draft) {
  state.draft = draft;
  for (const key of ['recipientName', 'recipientBank', 'recipientAccount', 'amount', 'purpose']) {
    const input = $(`#mf-${key}`);
    if (input) input.value = draft.fields?.[key] || '';
  }
  $('#m-save-state').textContent = `Синхронизировано · версия ${draft.version}`;
}

function collectFields() {
  const fields = {};
  for (const key of ['recipientName', 'recipientBank', 'recipientAccount', 'amount', 'purpose']) {
    fields[key] = $(`#mf-${key}`).value;
  }
  fields.currency = 'RUB';
  return fields;
}

function scheduleSave() {
  if (!state.draft) return;
  $('#m-save-state').textContent = 'Сохраняем…';
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(saveDraft, 450);
}

async function saveDraft() {
  if (!state.draft || state.saving) return;
  state.saving = true;
  try {
    const data = await api(`/drafts/${state.draft.id}`, {
      method: 'PATCH',
      body: {
        baseVersion: state.draft.version,
        fields: collectFields(),
        step: state.draft.step,
        context: { focus: 'amount', caret: $('#mf-amount').selectionStart || 0, locale: 'ru-RU' },
      },
    });
    state.draft = data.draft;
    $('#m-save-state').textContent = `Сохранено · версия ${data.draft.version}`;
  } catch (error) {
    if (error.code === 'LEASE_HELD' || error.code === 'VERSION_CONFLICT') {
      const remote = error.payload?.error?.draft;
      if (remote) applyDraft(remote);
      $('#m-save-state').textContent = 'Изменено на компьютере';
      toast('Черновик изменён на другом устройстве', 'error');
    } else {
      $('#m-save-state').textContent = 'Не сохранено';
      toast(error.message, 'error');
    }
  } finally {
    state.saving = false;
  }
}

async function submit() {
  if (!state.draft) return;
  const button = $('#m-submit-btn');
  button.disabled = true;
  button.textContent = 'Отправляем…';
  try {
    await saveDraft();
    const data = await api(`/drafts/${state.draft.id}/submit`, { method: 'POST' });
    state.draft = data.draft;
    $('#m-r-recipient').textContent = data.receipt.recipientName;
    $('#m-r-amount').textContent = formatMoney(data.receipt.amount);
    $('#m-r-id').textContent = data.receipt.id;
    const steps = document.querySelectorAll('#m-process span');
    steps.forEach((step) => {
      step.classList.remove('is-active');
      step.classList.add('is-done');
    });
    show('m-success');
  } catch (error) {
    if (error.code === 'VALIDATION_FAILED') toast('Заполните все обязательные поля', 'error');
    else toast(error.message, 'error');
  } finally {
    button.disabled = false;
    button.textContent = 'Отправить перевод';
  }
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
  socket.addEventListener('close', () => {
    if (state.token) {
      clearTimeout(state.wsRetry);
      state.wsRetry = setTimeout(connectSocket, 2500);
    }
  });
  socket.addEventListener('message', (event) => {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }
    const payload = message.payload || {};
    if (message.type === 'draft.updated' && payload.draft?.id === state.draft?.id) {
      if (payload.draft.updatedBy?.deviceId !== deviceId()) {
        const updatedAt = Date.parse(payload.draft.updatedAt || '');
        if (Number.isFinite(updatedAt)) {
          const ms = Math.max(0, Date.now() - updatedAt);
          if (ms <= 60_000) {
            api('/metrics/client', { method: 'POST', body: { metric: 'sync', ms } }).catch(() => {});
          }
        }
        applyDraft(payload.draft);
        toast(`Изменено на ${payload.draft.updatedBy?.deviceName || 'компьютере'}`);
      }
    }
    if (message.type === 'draft.submitted' && payload.receipt && payload.draft?.id === state.draft?.id) {
      $('#m-r-recipient').textContent = payload.receipt.recipientName;
      $('#m-r-amount').textContent = formatMoney(payload.receipt.amount);
      $('#m-r-id').textContent = payload.receipt.id;
      show('m-success');
    }
    if (message.type === 'lease.claimed' && payload.draft?.id === state.draft?.id) {
      if (payload.draft.updatedBy?.deviceId !== deviceId()) {
        applyDraft(payload.draft);
        toast('Управление возвращено на компьютер');
      }
    }
  });
}

/* ------------------------------------------------------------------ */
/* События                                                             */
/* ------------------------------------------------------------------ */

$('#m-login-btn').addEventListener('click', login);
$('#m-preview-btn').addEventListener('click', preview);
$('#m-faceid-btn').addEventListener('click', confirmHandoff);
$('#m-cancel-btn').addEventListener('click', () => show('m-home'));
$('#m-submit-btn').addEventListener('click', submit);
$('#m-back-home').addEventListener('click', async () => {
  await saveDraft();
  show('m-home');
});
$('#m-done').addEventListener('click', () => {
  state.draft = null;
  show('m-home');
});
$('#m-last').addEventListener('click', () => {
  prefillLast();
  toast('Подставлен последний QR-код');
});

$$('#m-draft input').forEach((input) => {
  input.addEventListener('input', scheduleSave);
});

$('#clock').textContent = new Intl.DateTimeFormat('ru-RU', {
  hour: '2-digit',
  minute: '2-digit',
}).format(new Date());

restore();
