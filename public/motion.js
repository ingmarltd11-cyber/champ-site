/* ============================================================
   Champ Client — motion.js
   GSAP layer on top of the plain HTML pages.

   Everything here is progressive enhancement: each animation is a
   "from" tween started at runtime, so if the browser blocks the
   script, GSAP fails to load, or the visitor asks for reduced
   motion, the site looks exactly like it did before.
   ============================================================ */
(function () {
  'use strict';

  var gsap = window.gsap;
  if (!gsap) return;

  var reduce = false;
  try {
    reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch (_) { /* older browsers: animate normally */ }
  if (reduce) return;

  var ST = window.ScrollTrigger || null;
  if (ST) {
    gsap.registerPlugin(ST);
    ST.config({ ignoreMobileResize: true });
  }

  var EASE = 'power3.out';
  var SOFT = 'power2.out';

  /* ---------- helpers ---------- */

  function all(selector, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(selector));
  }

  function visible(el) {
    if (!el || !el.getBoundingClientRect) return false;
    var style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
    var rect = el.getBoundingClientRect();
    return rect.width > 0 || rect.height > 0;
  }

  // Headline blocks that "arrive" with the page.
  var INTRO_BLOCKS = '.hero, .features-hero, .dash-hero, .dash-heading, .checkout-header, .page-wrap';
  // Things that fade up as they scroll into view.
  var REVEAL = [
    '.feature-item', '.review-card', '.plan-card', '.faq-item', '.discord-card',
    '.proof-item', '.feature-stat', '.feature-module', '.find-card', '.changelog-entry',
    '.dash-card', '.features-cta', '.showcase-title', '.showcase-sub', '.reviews-title',
    '.reviews-sub', '.pricing-title', '.pricing-sub', '.faq-title', '.admin-card',
    '.shop-title'
  ].join(', ');
  // Content that pages render after their API calls.
  var LIVE = [
    '.find-card', '.review-card', '.changelog-entry', '.feature-module', '.admin-card',
    '.finds-grid > *', '.dashboard-list > *', '.feature-module-grid > *', '.admin-table tbody tr'
  ].join(', ');
  var BUTTONS = '.btn-primary, .btn-hero, .btn-ghost, .plan-cta, .btn-download, .btn-discord, .btn-purchase-direct';
  /* ---------- scroll progress bar ---------- */

  function progressBar() {
    var bar = document.createElement('div');
    bar.className = 'motion-progress';
    bar.setAttribute('aria-hidden', 'true');
    bar.style.cssText = 'position:fixed;top:0;left:0;right:0;height:2px;z-index:2147483000;' +
      'pointer-events:none;transform:scaleX(0);transform-origin:0 50%;' +
      'background:linear-gradient(90deg,#5b3ae0,#7c5cff 55%,#c4b5fd);' +
      'box-shadow:0 0 14px rgba(124,92,255,.55)';
    document.body.appendChild(bar);

    if (ST) {
      gsap.fromTo(bar, { scaleX: 0 }, {
        scaleX: 1,
        ease: 'none',
        scrollTrigger: { start: 0, end: 'max', scrub: 0.3 }
      });
      return;
    }
    var update = function () {
      var max = document.documentElement.scrollHeight - window.innerHeight;
      bar.style.transform = 'scaleX(' + (max > 0 ? Math.min(1, window.scrollY / max) : 0) + ')';
    };
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    update();
  }

  /* ---------- page intro ---------- */

  function intro() {
    var nav = document.querySelector('nav');
    if (nav) {
      gsap.from(nav, {
        y: -18, opacity: 0, duration: 0.55, ease: SOFT, clearProps: 'transform,opacity'
      });
    }

    all(INTRO_BLOCKS).forEach(function (block) {
      if (!visible(block)) return;
      var kids = Array.prototype.slice.call(block.children).filter(visible);
      if (!kids.length) return;
      gsap.from(kids, {
        y: 26, opacity: 0, duration: 0.8, ease: EASE, stagger: 0.07,
        delay: 0.06, clearProps: 'transform,opacity',
        onComplete: function () { gsap.set(kids, { clearProps: 'transform,opacity' }); }
      });
    });

    // The logo floats a little and breathes a soft violet glow, which keeps the hero alive
    // without moving the text.
    var logo = document.querySelector('.hero-logo');
    if (logo && visible(logo)) {
      gsap.to(logo, { y: -9, duration: 3.6, ease: 'sine.inOut', yoyo: true, repeat: -1 });
      gsap.fromTo(logo,
        { filter: 'drop-shadow(0 0 10px rgba(124,92,255,.18))' },
        {
          filter: 'drop-shadow(0 0 26px rgba(124,92,255,.5))',
          duration: 2.8, ease: 'sine.inOut', yoyo: true, repeat: -1, repeatDelay: 0.4
        });
    }
    var mark = document.querySelector('.dash-hero-mark');
    if (mark && visible(mark)) {
      gsap.to(mark, { y: -6, duration: 4.2, ease: 'sine.inOut', yoyo: true, repeat: -1 });
    }
  }

  /* ---------- scroll reveals ---------- */

  function reveals() {
    var targets = all(REVEAL).filter(visible);
    if (!targets.length) return;

    if (ST) {
      ST.batch(targets, {
        start: 'top 88%',
        once: true,
        interval: 0.1,
        batchMax: 8,
        onEnter: function (batch) {
          gsap.from(batch, {
            y: 28, opacity: 0, duration: 0.7, ease: EASE, stagger: 0.06,
            clearProps: 'transform,opacity'
          });
        }
      });
      return;
    }

    // No ScrollTrigger: a plain IntersectionObserver keeps the same effect.
    var io = new IntersectionObserver(function (entries) {
      var shown = [];
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          shown.push(entry.target);
          io.unobserve(entry.target);
        }
      });
      if (shown.length) {
        gsap.from(shown, { y: 28, opacity: 0, duration: 0.7, ease: EASE, stagger: 0.06, clearProps: 'transform,opacity' });
      }
    }, { rootMargin: '0px 0px -12% 0px' });
    targets.forEach(function (el) { io.observe(el); });
  }

  /* ---------- nav depth on scroll ---------- */

  function navShadow() {
    if (!ST || !document.querySelector('nav')) return;
    ST.create({
      start: 'top -12',
      end: 99999,
      onToggle: function (self) {
        gsap.to('nav', {
          boxShadow: self.isActive ? '0 16px 40px rgba(0,0,0,.55)' : '0 0 0 rgba(0,0,0,0)',
          duration: 0.3, ease: SOFT, overwrite: 'auto'
        });
      }
    });
  }

  /* ---------- hover polish ---------- */

  function hovers() {
    all(BUTTONS).forEach(function (el) {
      if (el.dataset.motionHover === '1') return;
      el.dataset.motionHover = '1';
      el.addEventListener('pointerenter', function () {
        gsap.to(el, { scale: 1.035, duration: 0.22, ease: SOFT, overwrite: 'auto' });
      });
      el.addEventListener('pointerleave', function () {
        gsap.to(el, { scale: 1, duration: 0.35, ease: 'power2.out', overwrite: 'auto' });
      });
    });
  }

  /* ---------- content that arrives after load ---------- */

  function watchLiveContent() {
    var seen = new WeakSet();

    function collect(node) {
      var items = [];
      if (!(node instanceof Element)) return items;
      if (node.matches(LIVE)) items.push(node);
      all(LIVE, node).forEach(function (el) { items.push(el); });
      return items.filter(function (el) {
        if (seen.has(el) || !visible(el)) return false;
        seen.add(el);
        return true;
      });
    }

    function pop(items) {
      if (!items.length) return;
      gsap.from(items, {
        y: 18, opacity: 0, duration: 0.5, ease: EASE,
        stagger: items.length > 12 ? 0.02 : 0.045,
        clearProps: 'transform,opacity'
      });
    }

    var pending = [];
    var queued = false;
    var observer = new MutationObserver(function (mutations) {
      mutations.forEach(function (mutation) {
        Array.prototype.slice.call(mutation.addedNodes).forEach(function (node) {
          collect(node).forEach(function (el) { pending.push(el); });
        });
      });
      if (!pending.length || queued) return;
      queued = true;
      requestAnimationFrame(function () {
        queued = false;
        var batch = pending;
        pending = [];
        pop(batch);
        hovers();
      });
    });
    observer.observe(document.body, { childList: true, subtree: true });

    // A page that renders before this script runs (cached fetch) still gets its entrance.
    var initial = all(LIVE).filter(function (el) {
      if (seen.has(el) || !visible(el)) return false;
      seen.add(el);
      return true;
    });
    if (initial.length && ST) {
      ST.batch(initial, {
        start: 'top 92%', once: true, batchMax: 8,
        onEnter: function (batch) { pop(batch); },
        onEnterBack: function (batch) { pop(batch); }
      });
    } else {
      pop(initial);
    }
  }

  /* ---------- tab / section switches ---------- */

  function watchTabs() {
    var panels = all('.dashboard-section, .admin-tabpage');
    if (!panels.length) return;

    var observer = new MutationObserver(function (mutations) {
      mutations.forEach(function (mutation) {
        if (mutation.attributeName !== 'class') return;
        var panel = mutation.target;
        if (!panel.classList || !panel.classList.contains('active')) return;
        if (!visible(panel)) return;
        var kids = Array.prototype.slice.call(panel.children).filter(visible);
        if (!kids.length) return;
        gsap.from(kids, {
          y: 16, opacity: 0, duration: 0.45, ease: EASE, stagger: 0.035,
          clearProps: 'transform,opacity'
        });
      });
    });
    panels.forEach(function (panel) {
      observer.observe(panel, { attributes: true, attributeFilter: ['class'] });
    });
  }

  /* ---------- counters ---------- */

  function counters() {
    all('.proof-num').forEach(function (el) {
      var raw = (el.textContent || '').trim();
      if (!/^\d{2,}$/.test(raw)) return;
      var end = Number(raw);
      if (!end) return;
      var box = { value: 0 };
      var render = function () { el.textContent = String(Math.round(box.value)); };
      if (!ST) { return; }
      gsap.to(box, {
        value: end,
        duration: 1.4,
        ease: 'power2.out',
        onUpdate: render,
        scrollTrigger: { trigger: el, start: 'top 92%', once: true }
      });
    });
  }

  /* ---------- boot ---------- */

  function start() {
    try { progressBar(); } catch (_) { /* cosmetic only */ }
    try { intro(); } catch (_) { /* the page is already usable */ }
    try { reveals(); } catch (_) { /* ditto */ }
    try { navShadow(); } catch (_) { /* ditto */ }
    try { hovers(); } catch (_) { /* ditto */ }
    try { watchLiveContent(); } catch (_) { /* ditto */ }
    try { watchTabs(); } catch (_) { /* ditto */ }
    try { counters(); } catch (_) { /* ditto */ }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
