/* ============================================================
   Champ Client — champ-run download channels

The shop ships two injectors: champ-client.exe (the loader with
the splash) and champ-run.exe (feed, verify, inject, exit). They
have separate feeds on purpose, because their version numbers
are unrelated: /downloads/run.json and /downloads/beta/run.json.

This file paints champ-run where it belongs — the second button
in the dashboard steps and the version card in the admin panel —
and fills in both builds from those feeds. Every block is
optional: a page without the anchor renders nothing, and an
anchor that already exists (the static markup) is left alone.
============================================================ */
(function () {
  'use strict';

  var STABLE_FEED = 'downloads/run.json';
  var BETA_FEED = 'downloads/beta/run.json';
  var STABLE_FILE = 'downloads/champ-run.exe';
  var BETA_FILE = 'downloads/beta/champ-run-beta.exe';

  var DASHBOARD_NOTE =
    '<b>Champ Run</b> is the rewritten injector: it verifies the published build, ' +
    'injects and closes &mdash; no splash and no account screen. It loads the same ' +
    'client and every module as the button before it. Windows only.';

  function readFeed(path) {
    return fetch(path + '?t=' + Date.now(), { cache: 'no-store' }).then(function (res) {
      if (!res.ok) throw new Error('http ' + res.status);
      return res.json();
    });
  }

  /* ---------- dashboard: the second download ---------- */

  function dashboardButton() {
    var clientButton = document.querySelector('a[data-champ-download]');
    if (!clientButton) return false;
    if (document.querySelector('a[href="' + STABLE_FILE + '"]')) return true;

    clientButton.insertAdjacentHTML(
      'afterend',
      ' <a class="btn-ghost" href="' + STABLE_FILE + '" download>Download Champ Run (new)</a>' +
      '<p class="no-license-text" style="margin-top:10px">' + DASHBOARD_NOTE + '</p>'
    );
    return true;
  }

  /* ---------- admin: the version card ---------- */

  function adminCard() {
    var betaButton = document.getElementById('adminBetaDownload');
    if (!betaButton) return false;
    if (document.getElementById('adminRunNote')) return true;

    var card = betaButton.closest('.dash-card');
    if (!card) return false;

    card.insertAdjacentHTML('afterend',
      '<article class="dash-card" style="margin-top:18px">' +
        '<div class="admin-section-head">' +
          '<div>' +
            '<h2>Champ Run (new injector)</h2>' +
            '<p class="no-license-text">The rewritten injector: it reads a signed feed, verifies the published build, injects <code>champ-agent.dll</code> and exits. No splash, no account screen and no HWID check in the process that injects. It runs the <em>same</em> client and every module as the loader above. Windows only, ~250&nbsp;KB.</p>' +
          '</div>' +
        '</div>' +
        '<div class="admin-ribbon" style="margin-bottom:0">' +
          '<div class="ribbon-cell"><span>Stable</span><strong id="adminRunStableVersion">&mdash;</strong></div>' +
          '<div class="ribbon-cell"><span>Beta</span><strong id="adminRunBetaVersion">&mdash;</strong></div>' +
          '<div class="ribbon-cell"><span>Update feed</span><strong>run.json</strong></div>' +
        '</div>' +
        '<p style="margin-top:16px;display:flex;gap:12px;flex-wrap:wrap;align-items:center">' +
          '<a class="btn-primary" id="adminRunStableDownload" href="' + STABLE_FILE + '" download>Download champ-run.exe</a>' +
          '<a class="btn-ghost" id="adminRunBetaDownload" href="' + BETA_FILE + '" download style="display:none">Download beta champ-run</a>' +
          '<span class="no-license-text" id="adminRunNote" style="margin:0">Checking both run feeds&hellip;</span>' +
        '</p>' +
      '</article>'
    );
    return true;
  }

  function loadRuns() {
    var stableEl = document.getElementById('adminRunStableVersion');
    var betaEl = document.getElementById('adminRunBetaVersion');
    var betaButton = document.getElementById('adminRunBetaDownload');
    var note = document.getElementById('adminRunNote');
    if (!stableEl && !betaEl) return;

    readFeed(STABLE_FEED).then(function (stable) {
      if (stableEl) stableEl.textContent = stable.version || 'unknown';
      readFeed(BETA_FEED).then(function (beta) {
        if (betaEl) betaEl.textContent = beta.version || 'unknown';
        if (betaButton) betaButton.style.display = '';
        if (note) note.textContent =
          'Both channels live \u2014 stable ' + (stable.version || '?') +
          ', beta ' + (beta.version || '?') + '.';
      }, function () {
        if (betaEl) betaEl.textContent = 'not published';
        if (betaButton) betaButton.style.display = 'none';
        if (note) note.textContent =
          'Stable ' + (stable.version || '?') + ' live; the beta run feed is not published.';
      });
    }, function () {
      if (stableEl) stableEl.textContent = 'not published';
      if (betaEl) betaEl.textContent = 'not published';
      if (betaButton) betaButton.style.display = 'none';
      if (note) note.textContent = 'No run feed is published yet.';
    });
  }

  /* ---------- boot ---------- */

  function start() {
    var painted = false;
    try { if (dashboardButton()) painted = true; } catch (_) { /* markup is optional */ }
    try { if (adminCard()) painted = true; } catch (_) { /* markup is optional */ }
    if (painted) {
      try { loadRuns(); } catch (_) { /* the feeds are optional */ }
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
