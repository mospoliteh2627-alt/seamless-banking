/**
 * Кнопка «Наверх»: появляется после прокрутки, показывает прогресс страницы.
 * Самодостаточный модуль — подключается на публичные страницы.
 */
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const style = document.createElement('style');
style.textContent = `
  .to-top {
    position: fixed;
    right: max(20px, env(safe-area-inset-right));
    bottom: max(20px, env(safe-area-inset-bottom));
    z-index: 80;
    width: 50px;
    height: 50px;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: conic-gradient(#1f57e0 calc(var(--p, 0) * 1%), #e2e8f2 0);
    cursor: pointer;
    opacity: 0;
    transform: translateY(14px) scale(0.96);
    pointer-events: none;
    transition: opacity 0.25s cubic-bezier(0.22, 0.61, 0.36, 1),
      transform 0.25s cubic-bezier(0.22, 0.61, 0.36, 1);
  }
  .to-top.is-visible {
    opacity: 1;
    transform: none;
    pointer-events: auto;
  }
  .to-top:hover { transform: translateY(-2px); }
  .to-top:active { transform: translateY(0) scale(0.97); }
  .to-top:focus-visible {
    outline: 2px solid #1f57e0;
    outline-offset: 3px;
  }
  .to-top-inner {
    display: grid;
    place-items: center;
    width: 100%;
    height: 100%;
    border-radius: 50%;
    background: #fff;
    color: #0b1f3a;
    box-shadow: 0 12px 28px -14px rgba(11, 31, 58, 0.55);
  }
  .to-top:hover .to-top-inner { color: #1f57e0; }
  @media (prefers-reduced-motion: reduce) {
    .to-top { transition: none; }
  }
  @media (max-width: 560px) {
    .to-top { width: 46px; height: 46px; right: 16px; bottom: 16px; }
  }
`;
document.head.appendChild(style);

const button = document.createElement('button');
button.type = 'button';
button.className = 'to-top';
button.setAttribute('aria-label', 'Наверх');
button.title = 'Наверх';
button.innerHTML = `
  <span class="to-top-inner">
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M12 19V5" />
      <path d="M5 12l7-7 7 7" />
    </svg>
  </span>
`;
document.body.appendChild(button);

let frame = 0;

function update() {
  frame = 0;
  const doc = document.documentElement;
  const max = Math.max(0, doc.scrollHeight - window.innerHeight);
  const top = window.scrollY || doc.scrollTop || 0;
  const progress = max > 0 ? Math.min(100, Math.max(0, (top / max) * 100)) : 0;
  button.style.setProperty('--p', progress.toFixed(1));
  button.classList.toggle('is-visible', top > Math.min(420, max * 0.25));
}

function onScroll() {
  if (frame) return;
  frame = requestAnimationFrame(update);
}

button.addEventListener('click', () => {
  window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
  const target = document.querySelector('main h1, h1, [role="main"]');
  if (target && typeof target.focus === 'function') {
    target.setAttribute('tabindex', '-1');
    target.focus({ preventScroll: true });
  }
});

window.addEventListener('scroll', onScroll, { passive: true });
window.addEventListener('resize', onScroll, { passive: true });
window.addEventListener('load', update, { once: true });
update();
