/**
 * Лендинг: живой сценарий бесшовного перехода.
 * Самодостаточный модуль — не зависит от app.js и работает, пока виден hero.
 */
const scene = document.getElementById('handoffScene');
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const NOTES = {
  0: 'Черновик создан в браузере',
  1: 'Клиент нажимает «Продолжить на телефоне»',
  2: 'Билет выпущен · одноразовый код на 90 секунд',
  3: 'Face ID подтверждает переход',
  4: 'Тот же шаг, фокус и курсор — уже на телефоне',
};

if (scene) {
  const rail = document.getElementById('sceneRail');
  const note = document.getElementById('sceneNote');
  const badge = document.getElementById('sceneBadge');
  const replay = document.getElementById('sceneReplay');

  let timers = [];
  let playing = false;
  let visible = false;

  const stageDurations = [1900, 2600, 2400, 2100, 3600];

  function clearTimers() {
    timers.forEach((id) => clearTimeout(id));
    timers = [];
  }

  function setStage(stage) {
    scene.dataset.stage = String(stage);
    if (note) note.textContent = NOTES[stage] || NOTES[0];
    if (badge) {
      const onPhone = stage >= 3;
      badge.textContent = onPhone ? 'телефон' : 'веб';
      badge.classList.toggle('is-phone', onPhone);
      badge.classList.toggle('is-handoff', stage === 2);
    }
    if (rail) {
      rail.querySelectorAll('li').forEach((item) => {
        const n = Number(item.dataset.stage);
        item.classList.toggle('is-done', n < stage);
        item.classList.toggle('is-active', n === stage);
      });
    }
  }

  function stop() {
    clearTimers();
    playing = false;
  }

  function play() {
    if (reduceMotion) {
      setStage(4);
      return;
    }
    stop();
    playing = true;
    let stage = 0;
    setStage(0);
    const schedule = () => {
      timers.push(
        setTimeout(() => {
          stage += 1;
          setStage(stage);
          if (stage < 4) {
            schedule();
          } else {
            timers.push(setTimeout(() => { if (visible && playing) play(); }, stageDurations[4]));
          }
        }, stageDurations[stage]),
      );
    };
    schedule();
  }

  function pause() {
    stop();
  }

  if (reduceMotion) {
    setStage(4);
  } else if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          visible = entry.isIntersecting;
          if (visible) play();
          else pause();
        });
      },
      { threshold: 0.35 },
    );
    observer.observe(scene);
  } else {
    play();
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) pause();
    else if (visible) play();
  });

  replay?.addEventListener('click', () => {
    play();
    scene.classList.add('is-replayed');
    setTimeout(() => scene.classList.remove('is-replayed'), 600);
  });

  // Скролл-ревил для секций лендинга.
  const sections = document.querySelectorAll('.l-section, .landing-footer');
  if ('IntersectionObserver' in window && !reduceMotion) {
    const revealObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-inview');
            revealObserver.unobserve(entry.target);
          }
        });
      },
      { rootMargin: '0px 0px -12% 0px', threshold: 0.12 },
    );
    sections.forEach((section) => {
      section.classList.add('will-reveal');
      revealObserver.observe(section);
    });
  }
}
