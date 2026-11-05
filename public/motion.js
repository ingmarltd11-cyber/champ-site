/* ============================================================
   Champ Client — motion.js
   All animation on the public site and the member app.

   Progressive enhancement only: every effect is either a CSS
   transition we trigger by class or a Web Animations call made
   after the element is already visible. If this file fails to
   load, the only loss is the [data-reveal] entrance, which the
   no-motion fallback below clears on the next paint.
   ============================================================ */
(function () {
  'use strict';

  var root = document.documentElement;
  var STORAGE_KEY = 'champ-motion';
  var EASE = 'cubic-bezier(0.16, 1, 0.3, 1)';

  var media = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;

  var stored = null;
  try { stored = window.localStorage.getItem(STORAGE_KEY); } catch (_) { /* private mode */ }

  // An explicit choice wins over the system preference.
  var motion = stored === 'on' ? true
    : stored === 'off' ? false
    : !(media && media.matches);

  function setMotion(next) {
    motion = !!next;
    root.classList.toggle('no-motion', !motion);
    syncToggle();
    if (!motion) markAllReveals();
    else observeReveals();
  }

  root.classList.toggle('no-motion', !motion);

  /* ---------- helpers ---------- */

  function list(selector, scope) {
    return Array.prototype.slice.call((scope || document).querySelectorAll(selector));
  }

  function visible(el) {
    if (!el || !el.getBoundingClientRect) return false;
    var rect = el.getBoundingClientRect();
    if (!rect.width && !rect.height) return false;
    var style = window.getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden';
  }

  function canAnimate() {
    return motion && !!(window.Element && Element.prototype.animate);
  }

  function animateIn(el, delay) {
    if (!canAnimate() || !visible(el)) return;
    el.animate(
      [
        { opacity: 0, transform: 'translateY(16px)' },
        { opacity: 1, transform: 'translateY(0)' }
      ],
      { duration: 650, delay: delay || 0, easing: EASE }
    );
  }

  /* ---------- reveal on scroll (CSS-driven) ---------- */

  var revealObserver = null;

  function markAllReveals() {
    list('[data-reveal]').forEach(function (el) { el.classList.add('is-revealed'); });
  }

  function observeReveals() {
    var targets = list('[data-reveal]').filter(function (el) {
      return !el.classList.contains('is-revealed');
    });
    if (!targets.length) return;
    if (!motion || !('IntersectionObserver' in window)) {
      markAllReveals();
      return;
    }
    if (!revealObserver) {
      revealObserver = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          entry.target.classList.add('is-revealed');
          revealObserver.unobserve(entry.target);
        });
      }, { rootMargin: '0px 0px -8% 0px', threshold: 0.06 });
    }
    targets.forEach(function (el) { revealObserver.observe(el); });
  }

  /* ---------- soft entrance for the blocks without data-reveal ---------- */

  var SOFT_BLOCKS = [
    '.page-hero', '.section-head', '.features-hero', '.checkout-header',
    '.pillar', '.plan-card', '.review-card', '.feature-item', '.feature-module',
    '.faq-item', '.discord-card', '.support-block', '.legal-box', '.auth-card',
    '.logout-card', '.config-card', '.find-card', '.changelog-entry', '.proof-item',
    '.static-email-box', '.pay-methods-list'
  ].join(', ');

  function softReveals() {
    if (!('IntersectionObserver' in window)) return;
    var targets = list(SOFT_BLOCKS).filter(function (el) {
      if (el.hasAttribute('data-reveal') || el.closest('.hero-copy')) return false;
      return visible(el) && !el.dataset.motionDone;
    });
    if (!targets.length) return;

    var io = new IntersectionObserver(function (entries) {
      var shown = entries.filter(function (entry) { return entry.isIntersecting; });
      shown.forEach(function (entry, index) {
        var el = entry.target;
        if (el.dataset.motionDone) return;
        el.dataset.motionDone = '1';
        io.unobserve(el);
        animateIn(el, Math.min(index * 55, 220));
      });
    }, { rootMargin: '0px 0px -6% 0px', threshold: 0.05 });

    targets.forEach(function (el) { io.observe(el); });
  }

  /* ---------- counters ---------- */

  function counters() {
    list('[data-count]').forEach(function (el) {
      var end = parseInt(el.getAttribute('data-count'), 10);
      if (!end || end < 2) return;

      var run = function () {
        if (!motion || !window.requestAnimationFrame) {
          el.textContent = String(end);
          return;
        }
        var started = null;
        var duration = 1400;
        var tick = function (now) {
          if (started === null) started = now;
          var progress = Math.min(1, (now - started) / duration);
          var eased = 1 - Math.pow(1 - progress, 3);
          el.textContent = String(Math.round(end * eased));
          if (progress < 1) window.requestAnimationFrame(tick);
        };
        window.requestAnimationFrame(tick);
      };

      if (!('IntersectionObserver' in window)) { run(); return; }
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          io.disconnect();
          run();
        });
      }, { threshold: 0.35 });
      io.observe(el);
    });
  }

  /* ---------- nav depth ---------- */

  function navDepth() {
    var nav = document.querySelector('nav');
    if (!nav) return;
    var ticking = false;
    var update = function () {
      nav.classList.toggle('is-scrolled', window.scrollY > 12);
      ticking = false;
    };
    window.addEventListener('scroll', function () {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(update);
    }, { passive: true });
    update();
  }

  /* ---------- content rendered after load ---------- */

  var LIVE_ITEMS = [
    '.find-card', '.review-card', '.changelog-entry', '.config-card',
    '.feature-module', '.feature-item', '.texture-card', '.dash-card',
    '.admin-table tbody tr', '.dashboard-section .dash-group'
  ].join(', ');

  function liveContent() {
    if (!('MutationObserver' in window)) return;

    var seen = new WeakSet();
    var pending = [];
    var queued = false;

    var collect = function (node) {
      if (!(node instanceof Element)) return;
      if (node.matches(LIVE_ITEMS)) pending.push(node);
      list(LIVE_ITEMS, node).forEach(function (el) { pending.push(el); });
    };

    var observer = new MutationObserver(function (mutations) {
      mutations.forEach(function (mutation) {
        Array.prototype.slice.call(mutation.addedNodes).forEach(collect);
      });
      if (!pending.length || queued) return;
      queued = true;
      window.requestAnimationFrame(function () {
        queued = false;
        var batch = pending;
        pending = [];
        batch.forEach(function (el, index) {
          if (seen.has(el)) return;
          seen.add(el);
          animateIn(el, Math.min(index * 35, 210));
        });
      });
    });

    observer.observe(document.body, { childList: true, subtree: true });
  }

  /* ---------- assistant widget ---------- */

  function assistant() {
    var win = document.getElementById('aiChatWindow');
    var messages = document.getElementById('aiChatMessages');

    if (win && 'MutationObserver' in window) {
      var wasOpen = win.style.display !== 'none';
      new MutationObserver(function () {
        var open = win.style.display !== 'none';
        if (open === wasOpen) return;
        wasOpen = open;
        if (!open || !motion || !win.animate) return;
        win.animate(
          [
            { opacity: 0, transform: 'translateY(12px) scale(0.985)' },
            { opacity: 1, transform: 'none' }
          ],
          { duration: 260, easing: EASE }
        );
      }).observe(win, { attributes: true, attributeFilter: ['style', 'class'] });
    }

    if (messages && 'MutationObserver' in window) {
      new MutationObserver(function (mutations) {
        mutations.forEach(function (mutation) {
          Array.prototype.slice.call(mutation.addedNodes).forEach(function (node) {
            if (node instanceof Element && node.classList.contains('ai-msg')) animateIn(node, 0);
          });
        });
      }).observe(messages, { childList: true });
    }
  }

  /* ---------- motion toggle in the nav ---------- */

  var toggle = null;

  function syncToggle() {
    if (!toggle) return;
    toggle.setAttribute('aria-pressed', motion ? 'true' : 'false');
    toggle.setAttribute('aria-label', motion ? 'Turn animations off' : 'Turn animations on');
    toggle.setAttribute('title', motion ? 'Animations: on' : 'Animations: off');
  }

  function motionToggle() {
    var actions = document.querySelector('nav .nav-actions');
    if (!actions || document.querySelector('.motion-toggle')) return;

    toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'motion-toggle';
    toggle.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true">' +
        '<path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1"/>' +
        '<circle cx="12" cy="12" r="3.2"/>' +
      '</svg>';
    syncToggle();

    toggle.addEventListener('click', function () {
      try { window.localStorage.setItem(STORAGE_KEY, motion ? 'off' : 'on'); } catch (_) { /* private mode */ }
      setMotion(!motion);
    });

    var hamburger = actions.querySelector('.hamburger');
    if (hamburger) actions.insertBefore(toggle, hamburger);
    else actions.appendChild(toggle);
  }

  /* ---------- boot ---------- */

  function start() {
    try { motionToggle(); } catch (_) { /* optional control */ }
    try { navDepth(); } catch (_) { /* cosmetic */ }
    try { observeReveals(); } catch (_) { markAllReveals(); }
    try { softReveals(); } catch (_) { /* cosmetic */ }
    try { counters(); } catch (_) { /* cosmetic */ }
    try { liveContent(); } catch (_) { /* cosmetic */ }
    try { assistant(); } catch (_) { /* cosmetic */ }
  }

  // A stored "off" or a reduced-motion visitor should never wait on the observer.
  if (!motion) markAllReveals();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }

  if (media && media.addEventListener && !stored) {
    media.addEventListener('change', function (event) { setMotion(!event.matches); });
  }
})();

/* ============================================================
   Champ Run's download channels

   Loaded on demand: dashboard.html paints the second download and
   admin.html paints the version card from run-channels.js, so the
   two injector feeds stay in one file instead of a script tag on
   every page.
   ============================================================ */
(function () {
  'use strict';

  if (!document.querySelector('a[data-champ-download], #adminBetaDownload')) return;

  var script = document.createElement('script');
  script.src = 'run-channels.js';
  script.async = true;
  document.head.appendChild(script);
})();
