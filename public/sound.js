/* Champ website sound design: soft, creamy click and hover blips.
   Synthesised with the Web Audio API so the site needs no audio files.
   The choice is stored locally; the floating button toggles it. */
(function () {
  'use strict';

  var KEY = 'champ.ui.sound';
  var enabled = true;
  try { enabled = localStorage.getItem(KEY) !== 'off'; } catch (_) {}
  var ctx = null;
  var master = null;
  var lastHover = 0;

  function ensure() {
    if (!enabled) return null;
    if (!ctx) {
      var AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return null;
      ctx = new AudioCtx();
      master = ctx.createGain();
      master.gain.value = 0.72;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function tone(freq, gainValue, duration, type, cutoff) {
    var audio = ensure();
    if (!audio) return;
    var now = audio.currentTime;
    var osc = audio.createOscillator();
    var gain = audio.createGain();
    var filter = audio.createBiquadFilter();
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(freq, now);
    osc.frequency.exponentialRampToValueAtTime(Math.max(60, freq * 0.82), now + duration);
    filter.type = 'lowpass';
    filter.frequency.value = cutoff || 1200;
    filter.Q.value = 0.5;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(gainValue, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    osc.start(now);
    osc.stop(now + duration + 0.02);
  }

  function click() {
    if (!enabled) return;
    // A warm two-note "thock": low body plus a quiet creamy top.
    tone(196, 0.075, 0.19, 'sine', 900);
    tone(392, 0.032, 0.13, 'triangle', 1600);
    tone(784, 0.012, 0.075, 'sine', 2200);
  }

  function hover() {
    if (!enabled) return;
    var now = Date.now();
    if (now - lastHover < 55) return;
    lastHover = now;
    // Airy, short and much quieter than the click.
    tone(660, 0.018, 0.08, 'sine', 1800);
    tone(990, 0.009, 0.055, 'sine', 2400);
  }

  function interactive(target) {
    if (!(target instanceof Element)) return null;
    return target.closest('a, button, [role="button"], input, select, textarea, .feature-module-card, .plan-card, .faq-question, .config-card, .sidebar-link, .hero-action');
  }

  document.addEventListener('pointerover', function (event) {
    var el = interactive(event.target);
    if (!el || el.disabled || el.getAttribute('aria-disabled') === 'true') return;
    if (el.contains(event.relatedTarget)) return;
    hover();
  }, true);

  document.addEventListener('pointerdown', function (event) {
    var el = interactive(event.target);
    if (!el || el.disabled || el.getAttribute('aria-disabled') === 'true') return;
    click();
  }, true);

  document.addEventListener('keydown', function (event) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    var el = interactive(document.activeElement);
    if (el && !el.disabled) click();
  });

  function makeToggle() {
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'champ-sound-toggle';
    button.setAttribute('aria-label', 'Toggle interface sounds');
    button.dataset.sound = enabled ? 'on' : 'off';
    button.innerHTML = enabled
      ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/></svg>'
      : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4V5z"/><path d="m16 9 5 6"/><path d="m21 9-5 6"/></svg>';
    button.addEventListener('click', function () {
      enabled = !enabled;
      try { localStorage.setItem(KEY, enabled ? 'on' : 'off'); } catch (_) {}
      button.dataset.sound = enabled ? 'on' : 'off';
      button.innerHTML = enabled
        ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/></svg>'
        : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4V5z"/><path d="m16 9 5 6"/><path d="m21 9-5 6"/></svg>';
      if (enabled) click();
    });
    document.body.appendChild(button);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', makeToggle);
  } else {
    makeToggle();
  }
})();
