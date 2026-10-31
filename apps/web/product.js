const $ = (selector) => document.querySelector(selector);

const fmtMs = (value) => (Number.isFinite(value) ? `${Math.round(value)} мс` : '—');
const fmtCount = (value) => (Number.isFinite(value) ? String(value) : '—');
const fmtUptime = (sec) => {
  if (!Number.isFinite(sec)) return '—';
  const hours = Math.floor(sec / 3600);
  const minutes = Math.floor((sec % 3600) / 60);
  return hours ? `${hours} ч ${minutes} мин` : `${minutes} мин`;
};

function flash(el, text) {
  if (!el) return;
  if (el.textContent === String(text)) return;
  el.textContent = text;
  const card = el.closest('.metric-card');
  if (card) {
    card.classList.remove('is-flash');
    void card.offsetWidth;
    card.classList.add('is-flash');
  }
}

async function loadMetrics() {
  try {
    const response = await fetch('/v1/metrics', { headers: { accept: 'application/json' } });
    if (!response.ok) return;
    const data = await response.json();
    const counters = data.counters || {};
    flash($('#liveHandoffs'), fmtCount(counters.handoffsRedeemed));
    flash($('#liveVop'), fmtCount(counters.vopChecks));
    flash($('#liveSync'), fmtMs(data.syncLatencyMs?.p95));
    flash($('#liveVop'), fmtCount(counters.vopChecks));
    flash($('#liveUptime'), fmtUptime(data.uptimeSec));

    flash($('#mTickets'), fmtCount(counters.ticketsIssued));
    flash($('#mHandoffs'), fmtCount(counters.handoffsRedeemed));
    flash($('#mVop'), fmtCount(counters.vopChecks));
    flash($('#mSync'), fmtMs(data.syncLatencyMs?.p95));
    flash($('#mRedeem'), fmtMs(data.redeemLatencyMs?.p95));
    flash($('#mUptime'), fmtUptime(data.uptimeSec));

    const started = counters.draftsCreated || 0;
    const tickets = counters.ticketsIssued || 0;
    const handoffs = counters.handoffsRedeemed || 0;
    const submitted = counters.submissions || 0;
    const max = Math.max(started, tickets, handoffs, submitted, 1);
    const setRow = (valueId, barId, value) => {
      const valueEl = $(valueId);
      const barEl = $(barId);
      if (valueEl) valueEl.textContent = String(value);
      if (barEl) barEl.style.width = `${Math.round((value / max) * 100)}%`;
    };
    setRow('#fStarted', '#fStartedBar', started);
    setRow('#fTickets', '#fTicketsBar', tickets);
    setRow('#fHandoffs', '#fHandoffsBar', handoffs);
    setRow('#fSubmitted', '#fSubmittedBar', submitted);
  } catch {
    /* демо-страница не должна падать из-за метрик */
  }
}

loadMetrics();
setInterval(() => {
  if (!document.hidden) loadMetrics();
}, 5000);

/* ------------------------------------------------------------------ */
/* Проверка получателя                                                 */
/* ------------------------------------------------------------------ */

const PRESETS = {
  match: { name: 'Иван Петров', bank: 'Вектор Банк', account: '40817810000000001234' },
  close: { name: 'Иван Петровв', bank: 'Вектор Банк', account: '40817810000000001234' },
  mismatch: { name: 'Пётр Сидоров', bank: 'Вектор Банк', account: '40817810000000001234' },
  unknown: { name: 'Иван Петров', bank: 'Вектор Банк', account: '40817810000000000000' },
};

const STATUS_META = {
  match: { class: 'match', symbol: '✓', title: 'Имя совпадает со счётом' },
  close_match: { class: 'close', symbol: '!', title: 'Похожее имя — подтвердите получателя' },
  no_match: { class: 'mismatch', symbol: '×', title: 'Имя не совпадает — перевод заблокирован' },
  no_data: { class: 'unknown', symbol: '?', title: 'Счёт не найден в демо-справочнике' },
};

const els = {
  form: $('#vopForm'),
  name: $('#vopName'),
  bank: $('#vopBank'),
  account: $('#vopAccount'),
  button: $('#vopCheck'),
  empty: $('#vopEmpty'),
  card: $('#vopCard'),
  status: $('#vopStatus'),
  dot: $('#vopDot'),
  statusText: $('#vopStatusText'),
  given: $('#vopGiven'),
  expected: $('#vopExpected'),
  accountOut: $('#vopAccountOut'),
  meta: $('#vopMeta'),
};

function fillPreset(key) {
  const preset = PRESETS[key];
  if (!preset) return;
  els.name.value = preset.name;
  els.bank.value = preset.bank;
  els.account.value = preset.account;
  document.querySelectorAll('.preset').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.preset === key);
  });
}

function renderPayee(result, latencyMs) {
  const meta = STATUS_META[result.status] || STATUS_META.no_data;
  els.empty.style.display = 'none';
  els.card.classList.add('is-visible');
  els.status.className = `result-status ${meta.class}`;
  els.dot.textContent = meta.symbol;
  els.statusText.textContent = meta.title;
  els.given.textContent = result.recipientName || '—';
  els.expected.textContent = result.expectedName || 'нет данных';
  els.accountOut.textContent = (result.account || '').replace(/(\d{4})(?=\d)/g, '$1 ');
  els.meta.textContent = `${result.message || ''}${Number.isFinite(latencyMs) ? ` · ответ за ${Math.round(latencyMs)} мс` : ''}`;
}

async function checkPayee(event) {
  event?.preventDefault?.();
  const payload = {
    account: els.account.value.replace(/\D/g, ''),
    bank: els.bank.value.trim(),
    recipientName: els.name.value.trim(),
  };
  if (payload.account.length < 16 || payload.recipientName.length < 2) {
    els.empty.style.display = 'grid';
    els.empty.innerHTML = '<span class="glyph" aria-hidden="true">!</span><p>Укажите имя и счёт — минимум 16 цифр.</p>';
    els.card.classList.remove('is-visible');
    return;
  }
  els.button.disabled = true;
  els.button.textContent = 'Проверяем…';
  const startedAt = performance.now();
  try {
    const response = await fetch('/v1/payee/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result?.error?.message || 'Не удалось проверить');
    renderPayee(result, performance.now() - startedAt);
  } catch (error) {
    renderPayee(
      {
        status: 'no_data',
        recipientName: payload.recipientName,
        account: payload.account,
        message: error.message || 'Проверка недоступна',
      },
      performance.now() - startedAt,
    );
  } finally {
    els.button.disabled = false;
    els.button.textContent = 'Проверить получателя';
  }
}

els.form?.addEventListener('submit', checkPayee);
document.querySelectorAll('.preset').forEach((button) => {
  button.addEventListener('click', () => {
    fillPreset(button.dataset.preset);
    checkPayee();
  });
});
