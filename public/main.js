/* ============================================================
   Champ Client — main.js
   Frontend and API run on the same domain (Vercel), so all API
   calls are relative (/api/...) and the login cookie just works.
   ============================================================ */
'use strict';

// ---- Helpers ----
async function api(path, options = {}) {
  const res = await fetch(path, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  let data = {};
  try { data = await res.json(); } catch (_) { /* empty body */ }
  return { ok: res.ok, status: res.status, data };
}

function errorText(data, fallback) {
  if (data && typeof data.detail === 'string') return data.detail;
  if (data && Array.isArray(data.detail) && data.detail[0]) {
    const first = data.detail[0];
    const field = Array.isArray(first.loc) ? first.loc[first.loc.length - 1] : '';
    return field === 'email' ? 'Please enter a valid email address.' : (first.msg || fallback);
  }
  return fallback;
}

function showMessage(id, text, isError) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = text;
  el.style.display = text ? 'block' : 'none';
  el.style.color = isError ? '#ff6b6b' : '#4ade80';
}

// ---- Downloads ----
// Two injectors ship: one .exe for Windows and one .tar.gz for Linux. The page asks the browser
// which system it is on, and when that answer is not certain (a phone, an unknown platform) the
// customer picks instead of being handed a file that cannot run. Every download also gets a random
// file name, so two copies never collide and a name says nothing about the build.
const DOWNLOAD_FLAVOURS = {
  windows: { file: 'downloads/champ-client.exe', label: 'Windows', hint: 'Windows 10 or 11 — .exe' },
  linux: { file: 'downloads/champ-client-linux.tar.gz', label: 'Linux', hint: '64-bit Linux met Java 21 — .tar.gz' },
};

function detectClientOS() {
  const ua = navigator.userAgent || '';
  if (/Android|iPhone|iPad|iPod|Windows Phone|Mobile/i.test(ua)) return '';
  const platform = String((navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || '').toLowerCase();
  if (platform.includes('win') || /windows/i.test(ua)) return 'windows';
  if (platform.includes('linux') || platform.includes('x11') || /linux/i.test(ua)) return 'linux';
  return '';
}

function randomDownloadName() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('');
}

function downloadNameFor(os) {
  const extension = DOWNLOAD_FLAVOURS[os].file.split('/').pop().replace(/^[^.]+/, '');
  return `${randomDownloadName()}${extension}`;
}

function startDownload(os) {
  const flavour = DOWNLOAD_FLAVOURS[os];
  if (!flavour) return;
  const link = document.createElement('a');
  link.href = flavour.file;
  link.download = downloadNameFor(os);
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
  closeDownloadChooser();
}

function closeDownloadChooser() {
  const overlay = document.getElementById('downloadChooser');
  if (!overlay) return;
  overlay.classList.remove('open');
  document.body.style.overflow = '';
}

function openDownloadChooser() {
  let overlay = document.getElementById('downloadChooser');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'downloadChooser';
    overlay.className = 'overlay';
    overlay.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="downloadChooserTitle">
        <button class="modal-close" type="button" data-download-close aria-label="Close">&times;</button>
        <p class="hero-eyebrow" style="margin-bottom:8px">One injector per system</p>
        <h2 id="downloadChooserTitle" style="font: 900 clamp(24px,3vw,30px) 'Playfair Display', serif; margin:0 0 10px">Which system is your PC?</h2>
        <p class="no-license-text" style="margin-bottom:20px">Champ runs on Windows and Linux. We could not tell which one this device is, so pick the file you need. On a phone or tablet neither runs &mdash; open this page on the PC you play on.</p>
        <div style="display:flex;flex-direction:column;gap:10px">
          <button class="btn-primary" type="button" data-download-os="windows">Download for Windows (.exe)</button>
          <button class="btn-ghost" type="button" data-download-os="linux">Download for Linux (.tar.gz)</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target) return;
      if (target === overlay || target.closest('[data-download-close]')) closeDownloadChooser();
      const pick = target.closest('[data-download-os]');
      if (pick) startDownload(pick.dataset.downloadOs);
    });
  }
  overlay.classList.add('open');
  document.body.style.overflow = 'hidden';
}

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeDownloadChooser();
});

document.addEventListener('click', (event) => {
  const target = event.target instanceof Element ? event.target : null;
  const link = target ? target.closest('a[data-champ-download]') : null;
  if (!link) return;
  event.preventDefault();
  const os = detectClientOS();
  if (os) startDownload(os);
  else openDownloadChooser();
}, true);

// Only allow redirects to our own pages (after login)
function safeNext(value) {
  return /^[a-z]+\.html(\?[A-Za-z0-9=&_-]*)?$/.test(value || '') ? value : 'dashboard.html';
}

// ---- Mobile menu ----
function toggleMenu() {
  document.getElementById('mobileMenu')?.classList.toggle('open');
}

// ---- Modal helpers ----
function openOverlay(id) {
  const el = document.getElementById(id);
  if (el) {
    el.classList.add('open');
    document.body.style.overflow = 'hidden';
  }
}

function closeOverlay(id) {
  const el = document.getElementById(id);
  if (el) {
    el.classList.remove('open');
    document.body.style.overflow = '';
  }
}

document.querySelectorAll('.overlay').forEach(function (el) {
  el.addEventListener('click', function (e) {
    if (e.target === el) closeOverlay(el.id);
  });
});

document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape') {
    document.querySelectorAll('.overlay.open').forEach(function (el) { closeOverlay(el.id); });
  }
});

window.addEventListener('scroll', function () {
  const nav = document.querySelector('nav');
  if (nav) nav.style.boxShadow = window.scrollY > 10 ? '0 2px 24px rgba(0,0,0,.5)' : '';
});

// ---- Landing page: choose a plan and register ----
let selectedPlanTier = 'monthly';

function openPurchase(plan) {
  if (!['monthly','lifetime'].includes(plan)) return;
  selectedPlanTier = plan;
  window.location.href = `signup.html?plan=${encodeURIComponent(plan)}`;
}

function startPurchase(plan) {
  openPurchase(plan);
}

// ---- Landing page: showcase grid ----
// Zet hier je eigen screenshots/clips neer (bestanden in public/assets/):
//   { src: 'assets/showcase-1.png', caption: 'Killaura in een 1v1' }
// Laat de lijst leeg, dan blijft het mediablok onzichtbaar.
const SHOWCASE_MEDIA = [];

(function renderShowcase() {
  const grid = document.getElementById('showcaseGrid');
  if (!grid) return;
  if (SHOWCASE_MEDIA.length === 0) {
    // Nog geen media: geen "see it in action" beloven die je niet laat zien.
    const title = document.getElementById('showcaseTitle');
    const sub = document.getElementById('showcaseSub');
    if (title) title.innerHTML = 'Built for <em>real fights.</em>';
    if (sub) sub.textContent = 'What ships in every build of the client.';
    return;
  }
  grid.innerHTML = SHOWCASE_MEDIA.map(function (item) {
    const caption = item.caption ? `<figcaption>${item.caption}</figcaption>` : '';
    const alt = item.caption || 'Champ Client showcase';
    return `<figure class="showcase-card"><img src="${item.src}" alt="${alt}" loading="lazy">${caption}</figure>`;
  }).join('');
})();

// Remember referral codes (?ref=CODE) across signup -> verify -> checkout
(function rememberReferral() {
  try {
    const ref = new URLSearchParams(window.location.search).get('ref');
    if (ref && /^[A-Za-z0-9]{4,16}$/.test(ref)) localStorage.setItem('champ_ref', ref.toUpperCase());
  } catch (_) { /* storage unavailable */ }
})();
function storedReferral() {
  try { return localStorage.getItem('champ_ref') || ''; } catch (_) { return ''; }
}

// "Get Started" button: dashboard if logged in, else sign up
async function handleGetStarted(event) {
  event.preventDefault();
  try {
    const { ok } = await api('/api/auth/me');
    window.location.href = ok ? 'dashboard.html' : 'signup.html';
  } catch (_) {
    window.location.href = 'signup.html';
  }
}

// Customer-only navigation. Texture Packs and Base Finds are never part of the
// public nav: they are added after the server confirms a signed-in session.
(async function addCustomerNav() {
  let session;
  try {
    const res = await api('/api/auth/me');
    if (!res.ok || !res.data || !res.data.email) return;
    session = res.data;
  } catch (_) {
    return;
  }
  if (!session) return;

  // A signed-in visitor should not be sent back to the login form from the
  // public navigation; the dashboard is the useful destination on this device.
  document.querySelectorAll('a[href^="login.html"]').forEach(function (a) {
    if (a.closest('.dashboard-sidebar')) return;
    a.textContent = 'Dashboard';
    a.href = 'dashboard.html';
  });

  document.querySelectorAll('.nav-links').forEach(function (list) {
    if (list.querySelector('[data-customer-nav]')) return;
    const pricingLink = Array.from(list.querySelectorAll('a')).find(function (a) {
      return (a.getAttribute('href') || '').indexOf('#pricing') !== -1;
    });
    const packs = document.createElement('li');
    packs.setAttribute('data-customer-nav', 'texture-packs');
    packs.innerHTML = '<a href="dashboard.html#texture-packs">Texture Packs</a>';
    const finds = document.createElement('li');
    finds.setAttribute('data-customer-nav', 'base-finds');
    finds.innerHTML = '<a href="finds.html">Base Finds</a>';
    const pricingItem = pricingLink && pricingLink.parentElement;
    if (pricingItem && pricingItem.parentElement) {
      pricingItem.parentElement.insertBefore(packs, pricingItem);
      pricingItem.parentElement.insertBefore(finds, pricingItem);
    } else {
      list.appendChild(packs);
      list.appendChild(finds);
    }
  });

  document.querySelectorAll('.mobile-menu').forEach(function (menu) {
    if (menu.querySelector('[data-customer-nav]')) return;
    const loginLink = Array.from(menu.querySelectorAll('a')).find(function (a) {
      return (a.getAttribute('href') || '').indexOf('login.html') === 0;
    });
    const packs = document.createElement('a');
    packs.setAttribute('data-customer-nav', 'texture-packs');
    packs.href = 'dashboard.html#texture-packs';
    packs.textContent = 'Texture Packs';
    packs.onclick = toggleMenu;
    const finds = document.createElement('a');
    finds.setAttribute('data-customer-nav', 'base-finds');
    finds.href = 'finds.html';
    finds.textContent = 'Base Finds';
    finds.onclick = toggleMenu;
    if (loginLink) {
      menu.insertBefore(packs, loginLink);
      menu.insertBefore(finds, loginLink);
    } else {
      menu.appendChild(packs);
      menu.appendChild(finds);
    }
  });
})();

// ============================================================
// Sign up
// ============================================================
const registerForm = document.getElementById('registerForm');
if (registerForm) {
  const params = new URLSearchParams(window.location.search);
  const selectedPlan = params.get('plan') || '';

  registerForm.addEventListener('submit', async function (e) {
    e.preventDefault();
    const btn = this.querySelector('button[type="submit"]');
    const email = document.getElementById('regEmail').value.trim();
    const emailConfirm = document.getElementById('regEmailConfirm').value.trim();
    const password = document.getElementById('regPassword').value;
    const passwordConfirm = document.getElementById('regPasswordConfirm').value;

    if (email.toLowerCase() !== emailConfirm.toLowerCase()) {
      showMessage('formMessage', 'The email addresses do not match.', true);
      return;
    }
    if (password !== passwordConfirm) {
      showMessage('formMessage', 'The passwords do not match.', true);
      return;
    }

    showMessage('formMessage', '', false);
    btn.disabled = true;
    try {
      const { ok, data } = await api('/api/auth/signup', {
        method: 'POST',
        body: JSON.stringify({
          username: document.getElementById('regUser').value.trim(),
          email,
          email_confirm: emailConfirm,
          password,
          password_confirm: passwordConfirm,
          plan_type: selectedPlan || null,
          referral_code: storedReferral() || null,
        }),
      });
      if (ok) {
        if (data.verified) {
          window.location.href = data.checkout_url || 'dashboard.html';
        } else {
          window.location.href = `verify.html?email=${encodeURIComponent(email)}&plan=${encodeURIComponent(selectedPlan)}`;
        }
        return;
      }
      showMessage('formMessage', errorText(data, 'Could not create your account.'), true);
    } catch (_) {
      showMessage('formMessage', 'Could not reach the server. Please try again.', true);
    }
    btn.disabled = false;
  });
}

// ============================================================
// Email verification
// ============================================================
const verifyForm = document.getElementById('verifyForm');
if (verifyForm) {
  const params = new URLSearchParams(window.location.search);
  let email = params.get('email') || '';
  const plan = params.get('plan') || '';
  const emailDisplay = document.getElementById('verifyEmail');
  if (emailDisplay) emailDisplay.textContent = email;

  verifyForm.addEventListener('submit', async function (e) {
    e.preventDefault();
    const button = document.getElementById('verifyButton');
    const code = document.getElementById('verifyCode').value.trim();
    if (!/^\d{6}$/.test(code)) {
      showMessage('verifyMessage', 'Enter the 6-digit verification code.', true);
      return;
    }
    button.disabled = true;
    button.textContent = 'Verifying...';
    try {
      const { ok, data } = await api('/api/auth/verify-code', {
        method: 'POST',
        body: JSON.stringify({ email, code, plan_type: plan || null, referral_code: storedReferral() || null }),
      });
      if (!ok) {
        showMessage('verifyMessage', errorText(data, 'Invalid verification code.'), true);
        button.disabled = false;
        button.textContent = 'Verify';
        return;
      }
      showMessage('verifyMessage', (data.message || 'Email verified!') + ' Redirecting...', false);
      setTimeout(() => {
        window.location.href = data.checkout_url || 'dashboard.html';
      }, 500);
    } catch (_) {
      showMessage('verifyMessage', 'Could not reach the server. Please try again.', true);
      button.disabled = false;
      button.textContent = 'Verify';
    }
  });

  document.getElementById('resendCode')?.addEventListener('click', async function () {
    const button = this;
    button.disabled = true;
    button.textContent = 'Sending...';
    try {
      const { ok, data } = await api('/api/auth/resend-verification', {
        method: 'POST', body: JSON.stringify({ email })
      });
      showMessage('verifyMessage', data.message || (ok ? 'A new code was sent.' : 'Could not resend the code.'), !ok);
    } catch (_) {
      showMessage('verifyMessage', 'Could not reach the server.', true);
    }
    setTimeout(() => { button.disabled = false; button.textContent = 'Resend code'; }, 60000);
  });

  document.getElementById('changeEmail')?.addEventListener('click', function () {
    const form = document.getElementById('changeEmailForm');
    if (form) form.style.display = form.style.display === 'none' ? 'block' : 'none';
  });

  document.getElementById('changeEmailForm')?.addEventListener('submit', async function (e) {
    e.preventDefault();
    const btn = this.querySelector('button[type="submit"]');
    const newEmail = document.getElementById('newEmail').value.trim();
    const password = document.getElementById('changeEmailPassword').value;
    btn.disabled = true;
    btn.textContent = 'Sending...';
    try {
      const { ok, data } = await api('/api/auth/change-verification-email', {
        method: 'POST',
        body: JSON.stringify({ email, new_email: newEmail, password }),
      });
      if (!ok) {
        showMessage('verifyMessage', errorText(data, 'Could not change your email.'), true);
      } else {
        email = data.email;
        const next = new URLSearchParams(window.location.search);
        next.set('email', email);
        window.history.replaceState({}, '', `verify.html?${next.toString()}`);
        if (emailDisplay) emailDisplay.textContent = email;
        document.getElementById('verifyCode').value = '';
        document.getElementById('changeEmailPassword').value = '';
        showMessage('verifyMessage', data.message, false);
        this.style.display = 'none';
      }
    } catch (_) {
      showMessage('verifyMessage', 'Could not reach the server. Please try again.', true);
    }
    btn.disabled = false;
    btn.textContent = 'Send code to new email';
  });
}

// ============================================================
// Login
// ============================================================
// The desktop injector opens this page on a loopback port and waits for the session. Only a
// numeric port above 1024 and an unguessable state are accepted, so a random page cannot make a
// signed-in customer hand their session to a local process.
//
// The request is also kept in this tab: signing up or verifying the email leaves this page and
// comes back to login.html without a query string, and the injector is still waiting on that port.
const BROWSER_LOGIN_KEY = 'champ.browserLogin';
const BROWSER_LOGIN_MAX_AGE = 10 * 60 * 1000;   // the injector gives up after five minutes

function clearBrowserLogin() {
  try { sessionStorage.removeItem(BROWSER_LOGIN_KEY); } catch (_) { /* private mode */ }
}

function validBrowserLogin(port, state) {
  return Number.isInteger(port) && port >= 1024 && port <= 65535 &&
    /^[A-Za-z0-9]{8,64}$/.test(state);
}

function browserLoginParams() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('browser') === '1') {
    const port = Number(params.get('port'));
    const state = params.get('state') || '';
    if (!validBrowserLogin(port, state)) return null;
    try {
      sessionStorage.setItem(BROWSER_LOGIN_KEY, JSON.stringify({ port, state, at: Date.now() }));
    } catch (_) { /* the handoff then only works straight from this page */ }
    return { port, state };
  }
  try {
    const saved = JSON.parse(sessionStorage.getItem(BROWSER_LOGIN_KEY) || 'null');
    if (!saved || !validBrowserLogin(saved.port, saved.state)) return null;
    if (Date.now() - saved.at > BROWSER_LOGIN_MAX_AGE) {
      clearBrowserLogin();
      return null;
    }
    return { port: saved.port, state: saved.state };
  } catch (_) {
    return null;
  }
}

async function finishBrowserLogin(target) {
  showMessage('formMessage', 'Signing in to Champ on your PC…', false);
  const res = await api('/api/auth/browser/token', { method: 'POST', body: '{}' });
  if (!res.ok || !res.data || !res.data.token) {
    showMessage('formMessage', errorText(res.data, 'Could not hand the session to the app. Try signing in again.'), true);
    return false;
  }
  clearBrowserLogin();
  window.location.href = `http://127.0.0.1:${target.port}/callback?state=${encodeURIComponent(target.state)}&token=${encodeURIComponent(res.data.token)}`;
  return true;
}

const loginForm = document.getElementById('loginForm');
if (loginForm) {
  const params = new URLSearchParams(window.location.search);
  const browserLogin = browserLoginParams();
  if (browserLogin) {
    showMessage('formMessage', 'Champ on your PC opened this page. Sign in below and the app continues on its own.', false);
  }

  // The form is only for signed-out visitors. Remember-me already keeps the
  // session cookie on this browser; this also skips the form when it is valid.
  if (params.get('switch') !== '1') {
    (async function () {
      try {
        const res = await api('/api/auth/me');
        if (!res.ok || !res.data || !res.data.email) return;
        if (browserLogin) {
          await finishBrowserLogin(browserLogin);
          return;
        }
        const requested = params.get('next');
        const target = requested && !/^(login|signup)\.html/.test(requested)
          ? safeNext(requested)
          : (res.data.is_admin ? 'admin.html' : 'dashboard.html');
        window.location.replace(target);
      } catch (_) { /* show the form */ }
    })();
  }

  if (params.get('verified') === '1') showMessage('formMessage', 'Email verified! You can sign in now.', false);
  if (params.get('verified') === '0') showMessage('formMessage', 'That verification link is invalid or expired. Sign in to request a new one.', true);

  loginForm.addEventListener('submit', async function (e) {
    e.preventDefault();
    const btn = this.querySelector('button[type="submit"]');
    const resendLink = document.getElementById('resendLink');
    showMessage('formMessage', '', false);
    if (resendLink) resendLink.style.display = 'none';
    btn.disabled = true;
    try {
      async function attemptLogin(totpCode) {
        return api('/api/auth/login', {
          method: 'POST',
          body: JSON.stringify({
            identifier: document.getElementById('loginUser').value.trim(),
            password: document.getElementById('loginPassword').value,
            totp_code: totpCode || null,
            remember: Boolean(document.getElementById('loginRemember')?.checked),
          }),
        });
      }
      let { ok, status, data } = await attemptLogin(null);
      if (!ok && status === 403 && data.needs_2fa) {
        const code = window.prompt('Two-factor authentication: enter the 6-digit code from your authenticator app.');
        if (code === null) { btn.disabled = false; return; }
        ({ ok, status, data } = await attemptLogin(code.trim()));
      }
      if (ok) {
        if (browserLogin) {
          await finishBrowserLogin(browserLogin);
          return;
        }
        // Admins land in the admin panel by default; an explicit ?next= still wins.
        const requested = params.get('next');
        window.location.href = requested ? safeNext(requested) : (data.is_admin ? 'admin.html' : 'dashboard.html');
        return;
      }
      if (status === 403 && data.needs_verification && data.email) {
        // Not verified yet: the backend just sent a new code, enter it on the verify page
        window.location.href = `verify.html?email=${encodeURIComponent(data.email)}`;
        return;
      }
      showMessage('formMessage', errorText(data, 'Could not sign in.'), true);
      if (status === 403 && resendLink) resendLink.style.display = 'inline';
    } catch (_) {
      showMessage('formMessage', 'Could not reach the server. Please try again.', true);
    }
    btn.disabled = false;
  });

  document.getElementById('resendLink')?.addEventListener('click', async function (e) {
    e.preventDefault();
    const ident = document.getElementById('loginUser').value.trim();
    if (!ident.includes('@')) {
      showMessage('formMessage', 'Enter your email address in the first field, then click resend.', true);
      return;
    }
    await api('/api/auth/resend-verification', { method: 'POST', body: JSON.stringify({ email: ident }) });
    window.location.href = `verify.html?email=${encodeURIComponent(ident)}`;
  });
}

// ============================================================
// Password reset (reset.html): request link OR set new password
// ============================================================
const resetRequestForm = document.getElementById('resetRequestForm');
const resetPasswordForm = document.getElementById('resetPasswordForm');
if (resetRequestForm && resetPasswordForm) {
  const token = new URLSearchParams(window.location.search).get('token');
  (token ? resetPasswordForm : resetRequestForm).style.display = 'block';

  resetRequestForm.addEventListener('submit', async function (e) {
    e.preventDefault();
    const btn = this.querySelector('button[type="submit"]');
    btn.disabled = true;
    const { data } = await api('/api/auth/forgot', {
      method: 'POST',
      body: JSON.stringify({ email: document.getElementById('resetEmail').value.trim() }),
    });
    showMessage('formMessage', data.message || 'If that account exists, a reset link was sent.', false);
    btn.disabled = false;
  });

  resetPasswordForm.addEventListener('submit', async function (e) {
    e.preventDefault();
    const btn = this.querySelector('button[type="submit"]');
    btn.disabled = true;
    const { ok, data } = await api('/api/auth/reset', {
      method: 'POST',
      body: JSON.stringify({ token, password: document.getElementById('newPassword').value }),
    });
    if (ok) {
      showMessage('formMessage', data.message, false);
      setTimeout(() => { window.location.href = 'login.html'; }, 1500);
    } else {
      showMessage('formMessage', errorText(data, 'Could not reset the password.'), true);
      btn.disabled = false;
    }
  });
}

// ============================================================
// Checkout page (payment.html)
// ============================================================
document.addEventListener('DOMContentLoaded', async () => {
  const checkoutForm = document.getElementById('activeCheckoutForm');
  if (!checkoutForm) return;

  const uid = new URLSearchParams(window.location.search).get('uid');
  const loadingView = document.getElementById('checkout-loading-view');
  const statusText = document.getElementById('validation-status-text');
  const authView = document.getElementById('checkout-auth-view');
  const authMsg = document.getElementById('auth-gate-message');

  const fail = (text) => {
    statusText.innerText = text;
    statusText.style.color = '#ff3333';
  };

  if (!uid) return fail('Access blocked: this checkout link is incomplete.');

  // 1. Is the payment link valid?
  let link;
  try {
    const res = await api(`/api/verify-payment-link/${encodeURIComponent(uid)}`);
    if (!res.ok) return fail(errorText(res.data, 'Invalid checkout link.'));
    link = res.data;
  } catch (_) {
    return fail('Could not reach the server. Please try again.');
  }

  // 2. Are we signed in as the account that owns this email?
  const me = await api('/api/auth/me');
  loadingView.style.display = 'none';

  if (!me.ok || me.data.email !== link.email) {
    const next = encodeURIComponent(`payment.html?uid=${uid}`);
    document.querySelector('#checkout-auth-view a[href^="login.html"]').href = `login.html?next=${next}`;
    authMsg.textContent = me.ok
      ? `This link is for ${link.email}, but you are signed in as ${me.data.email}. Sign in with the right account.`
      : `Sign in (or create an account) with ${link.email} to continue.`;
    authView.style.display = 'block';
    return;
  }

  checkoutForm.style.display = 'block';
  document.getElementById('display-customer-email').innerText = link.email;
  document.getElementById('display-plan-title').innerHTML = `Get <em>${link.plan_type.toUpperCase()}</em> Access`;

  checkoutForm.addEventListener('submit', async function (e) {
    e.preventDefault();
    const btn = document.getElementById('completePurchaseBtn');
    if (!document.getElementById('tos-checkbox').checked) {
      alert('Please accept the Terms of Service to continue.');
      return;
    }
    btn.innerText = 'Redirecting to secure payment…';
    btn.disabled = true;
    try {
      const res = await api('/api/create-stripe-session', { method: 'POST', body: JSON.stringify({ uid }) });
      if (res.ok && res.data.url) {
        window.location.href = res.data.url;
        return;
      }
      alert(errorText(res.data, 'Could not start checkout.'));
    } catch (_) {
      alert('Could not reach the payment server.');
    }
    btn.innerText = 'Complete Purchase';
    btn.disabled = false;
  });
});

// ============================================================
// Dashboard (dashboard.html)
// ============================================================
function showDashboardSection(name) {
  let target = document.getElementById(`dash-section-${name}`);
  if (!target) return;
  if (['texture-packs', 'base-finds'].includes(name) && !window.dashboardHasActiveLicense) {
    showMessage('dash-notice', 'An active customer license is required to view this section.', true);
    name = 'overview';
    target = document.getElementById('dash-section-overview');
  }
  document.querySelectorAll('.dashboard-section').forEach(section => section.classList.toggle('active', section === target));
  document.querySelectorAll('.sidebar-link[data-section]').forEach(link => link.classList.toggle('active', link.dataset.section === name));
  window.history.replaceState({}, '', `#${encodeURIComponent(name)}`);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function appendDiscordEscalation(container) {
  if (!container) return;
  const wrap = document.createElement('div');
  wrap.className = 'ai-msg ai-bot';
  const link = document.createElement('a');
  link.href = 'https://discord.gg/6vyQnVjeX';
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.className = 'ai-escalation-link';
  link.textContent = 'Open Discord support';
  wrap.appendChild(link);
  container.appendChild(wrap);
}

function fmtDate(iso) {
  if (!iso) return '';
  // Date-only values are UTC midnight; read them at noon so the day never shifts.
  const value = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T12:00:00` : iso;
  return new Date(value).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function renderLicense(kind, lic) {
  const badge = document.getElementById(`badge-${kind}`);
  const content = document.getElementById(`content-${kind}`);
  if (!badge || !content) return;
  const copyBadge = document.getElementById(`badge-${kind}-copy`);
  const copyContent = document.getElementById(`content-${kind}-copy`);
  const paint = (state, html) => {
    badge.innerText = state.text;
    badge.className = state.className;
    content.innerHTML = html;
    if (copyBadge) { copyBadge.innerText = state.text; copyBadge.className = state.className; }
    if (copyContent) copyContent.innerHTML = html;
  };
  if (!lic) {
    const planName = kind === 'monthly' ? 'Monthly' : 'Lifetime';
    paint({ text: 'No license', className: 'status-badge status-none' }, `<p class="no-license-text">No ${planName.toLowerCase()} license is linked to your account yet.</p><a href="index.html#pricing" class="btn-purchase-direct">Browse plans</a>`);
    return;
  }

  const label = ({monthly:'Monthly', lifetime:'Lifetime'})[kind] || kind;
  if (!lic.active) {
    paint({ text: 'Expired', className: 'status-badge status-none' }, `<p class="no-license-text">Your ${label.toLowerCase()} license is no longer active.</p><a href="index.html#pricing" class="btn-purchase-direct">Renew ${label}</a>`);
    return;
  }

  const state = { text: 'Active', className: 'status-badge status-active' };
  let html = `<div class="license-box">${escapeHtml(lic.key)}</div>`;
  if (kind === 'monthly' && lic.expires_at) html += `<p class="no-license-text" style="margin-bottom:12px">Renews / ends around ${fmtDate(lic.expires_at)}</p>`;
  html += `<a href="downloads/champ-client.exe" class="btn-download" data-champ-download download>Download Champ Client</a>`;
  paint(state, html);

  if (kind === 'monthly' && lic.can_manage) {
    const billingButton = document.getElementById('manageBillingBtn');
    const billing = document.getElementById('billingOverview');
    if (billingButton) billingButton.style.display = 'inline-flex';
    if (billing) billing.innerHTML = `<p class="no-license-text">Your monthly plan is active${lic.expires_at ? ` until ${fmtDate(lic.expires_at)}` : ''}. Manage payment details or cancel your plan in Stripe.</p>`;
  }

  document.getElementById('manageBtn')?.addEventListener('click', openBillingPortal);
  document.getElementById('manageBillingBtn')?.addEventListener('click', openBillingPortal);
}

async function openBillingPortal() {
  const res = await api('/api/billing-portal', { method: 'POST' });
  if (res.ok && res.data.url) window.location.href = res.data.url;
  else alert(errorText(res.data, 'Could not open the billing portal.'));
}

document.addEventListener('DOMContentLoaded', async () => {
  const dashUsername = document.getElementById('dash-username');
  if (!dashUsername) return;

  const signOut = async () => {
    await api('/api/auth/logout', { method: 'POST' });
    window.location.href = 'login.html';
  };
  document.getElementById('logoutBtn')?.addEventListener('click', signOut);
  document.getElementById('sidebarLogout')?.addEventListener('click', signOut);
  document.querySelectorAll('[data-section]').forEach(button => button.addEventListener('click', () => showDashboardSection(button.dataset.section)));
  document.querySelectorAll('[data-section-link]').forEach(button => button.addEventListener('click', () => showDashboardSection(button.dataset.sectionLink)));
  const initialSection = decodeURIComponent(window.location.hash.slice(1));
  if (initialSection) showDashboardSection(initialSection);

  const query = new URLSearchParams(window.location.search);
  const justPaid = query.get('paid') === '1';
  const paidPlan = query.get('plan');
  const notice = document.getElementById('dash-notice');

  // Is the license we are waiting for active yet? (the paid plan if known, else any plan)
  const isActivated = (d) => {
    if (!d) return false;
    if (paidPlan && Object.prototype.hasOwnProperty.call(d.licenses, paidPlan)) {
      return !!(d.licenses[paidPlan] && d.licenses[paidPlan].active);
    }
    return Object.values(d.licenses).some((l) => l && l.active);
  };

  async function load() {
    let res;
    try {
      res = await api('/api/dashboard/user-data');
    } catch (_) {
      res = { ok: false, status: 0, data: {} };
    }
    if (res.status === 401) {
      // An admin can be signed in with an admin session and no customer session: the break-glass
      // login (ADMIN_USERNAME) and an admin cookie that outlived the customer cookie both do this.
      // Bouncing to login.html there is an endless loop, because the login page signs the admin
      // straight back in and lands on this same 401. Say what is going on and keep the shell.
      const admin = await api('/api/admin/me');
      if (admin.ok) {
        const email = document.getElementById('dash-email');
        if (email) email.textContent = 'Signed in as admin, without a customer profile.';
        if (notice) {
          notice.style.display = 'block';
          notice.style.color = '#fbbf24';
          notice.innerHTML = 'This admin session has no customer licenses, so there is nothing to show '
            + 'on the member dashboard. <a href="admin.html" style="color:#a78bfa">Open the admin panel</a>, '
            + 'or <a href="login.html?switch=1" style="color:#a78bfa">sign in with a customer account</a>.';
        }
        return null;
      }
      window.location.href = 'login.html?next=dashboard.html';
      return null;
    }
    if (!res.ok) {
      // Only a real 401 means "not signed in". Bouncing on a 500 or a dropped connection turned
      // one failed request into a login loop, which is what a blank dashboard looked like: say what
      // happened instead and leave the shell in place.
      const email = document.getElementById('dash-email');
      if (email) email.textContent = 'We could not load your account.';
      if (notice) {
        notice.style.display = 'block';
        notice.style.color = '#ff6b6b';
        notice.textContent = res.status
          ? `Your dashboard could not load right now (error ${res.status}). Reload the page to try again.`
          : 'No connection to the Champ server. Check your internet and reload the page.';
      }
      return null;
    }
    const d = res.data;
    dashUsername.innerText = d.username || 'there';
    window.dashboardHasActiveLicense = Object.values(d.licenses || {}).some(license => license && license.active);
    const dashEmail = document.getElementById('dash-email');
    if (dashEmail) dashEmail.innerText = d.email || '';
    const sideName = document.getElementById('sidebar-username');
    const sideEmail = document.getElementById('sidebar-email');
    if (sideName) sideName.textContent = d.username;
    if (sideEmail) sideEmail.textContent = d.email;
    if (d.is_admin) {
      const aside = document.querySelector('.dashboard-sidebar');
      if (aside && !document.getElementById('adminPanelLink')) {
        const link = document.createElement('a');
        link.id = 'adminPanelLink';
        link.className = 'sidebar-link';
        link.href = 'admin.html';
        link.innerHTML = '<span class="sidebar-icon">⚙</span><span>Admin panel</span>';
        aside.insertBefore(link, aside.querySelector('.sidebar-account'));
      }
    }
    renderLicense('monthly', d.licenses.monthly);
    renderLicense('lifetime', d.licenses.lifetime);
    if (!window.dashboardExtrasInitialized) {
      window.dashboardExtrasInitialized = true;
      initDashboardExtras(d);
    }
    loadCustomerContent(d);
    return d;
  }

  let data = await load();
  if (!data) return;
  document.getElementById('manageBillingBtn')?.addEventListener('click', openBillingPortal);

  // After paying, the license appears as soon as Stripe confirms (usually seconds)
  if (justPaid && !isActivated(data) && notice) {
    notice.style.display = 'block';
    notice.textContent = 'Payment received — activating your license…';
    for (let i = 0; i < 12; i++) {
      await new Promise((r) => setTimeout(r, 2500));
      data = await load();
      if (isActivated(data)) break;
    }
    notice.textContent = isActivated(data)
      ? 'Your license is active. Enjoy Champ Client!'
      : 'Still processing. Refresh in a minute, or contact support if it does not appear.';
  }

});

// ============================================================
// Dashboard extras: redeem, referral, Discord, 2FA
// ============================================================
function initDashboardExtras(data) {
  const eur = (c) => `€${(c / 100).toFixed(2)}`;
  const discordLink = 'https://discord.gg/6vyQnVjeX';

  // Device / HWID card: one PC per key, a free reset per week and a paid reset after that.
  (async function initDeviceCard() {
    const box = document.getElementById('deviceContent');
    const msg = document.getElementById('deviceMessage');
    if (!box) return;
    const money = (c) => `€${((Number(c) || 500) / 100).toFixed(2)}`;
    const say = (text, good) => {
      if (!msg) return;
      msg.style.display = 'block';
      msg.style.color = good ? '#4ade80' : '#ff6b6b';
      msg.textContent = text;
    };

    async function render() {
      const res = await api('/api/account/device');
      if (!res.ok) {
        box.innerHTML = '<p class="no-license-text">Could not load your device right now.</p>';
        return;
      }
      const d = res.data || {};
      if (!d.license) {
        box.innerHTML = '<p class="no-license-text">An active license is required to link a device.</p>';
        return;
      }
      const next = d.next_free_reset_at ? new Date(d.next_free_reset_at).toLocaleDateString() : '';
      box.innerHTML = `
        <p class="no-license-text">One PC per key: the injector binds your hardware the first time it runs, so a shared key does not work on a second PC.</p>
        <div class="license-box">${d.device ? escapeHtml(d.device) : 'No device linked yet'}</div>
        <p class="no-license-text">${d.bound_at ? 'Linked on ' + escapeHtml(new Date(d.bound_at).toLocaleString()) : 'Run the injector once to link this PC.'}</p>
        ${d.device ? (d.free_reset
          ? '<button class="btn-ghost" type="button" id="deviceResetFree">Reset device (free)</button>'
          : `<button class="btn-ghost" type="button" id="deviceResetPaid">Reset device (${money(d.reset_price_cents)})</button>
             <p class="no-license-text" style="margin-top:10px">Free reset used${next ? `; available again on ${escapeHtml(next)}` : ''}. A paid reset clears it immediately.</p>`) : ''}

        <p class="no-license-text" style="margin-top:22px">Network: Champ only injects from the network your key is linked to. Resetting is free and unlimited &mdash; a new router, a VPN or a move is never a lockout.</p>
        <div class="license-box">${d.ip_bound ? escapeHtml(d.ip) : 'No network linked yet'}</div>
        <p class="no-license-text">${d.ip_bound_at ? 'Linked on ' + escapeHtml(new Date(d.ip_bound_at).toLocaleString()) : 'Your next check-in links the network you are on.'}</p>
        <p class="no-license-text">This browser is on <b>${escapeHtml(d.current_ip || 'an unknown network')}</b>. Resetting links the key to that network right away.</p>
        <button class="btn-ghost" type="button" id="networkReset">Reset IP to this network (free)</button>
      `;

      document.getElementById('networkReset')?.addEventListener('click', async (e) => {
        e.target.disabled = true;
        const r = await api('/api/account/device/reset/ip', { method: 'POST', body: '{}' });
        if (!r.ok) {
          say(errorText(r.data, 'Could not reset your network.'), false);
          e.target.disabled = false;
          return;
        }
        say(r.data.message || `Network reset${r.data.ip ? ' to ' + r.data.ip : ''}.`, true);
        await render();
        document.getElementById('networkReset')?.blur();
      });

      document.getElementById('deviceResetFree')?.addEventListener('click', async (e) => {
        e.target.disabled = true;
        const r = await api('/api/account/device/reset', { method: 'POST', body: '{}' });
        say(r.ok ? r.data.message : errorText(r.data, 'Could not reset your device.'), r.ok);
        await render();
      });

      document.getElementById('deviceResetPaid')?.addEventListener('click', async (e) => {
        e.target.disabled = true;
        const r = await api('/api/account/device/reset/checkout', { method: 'POST', body: '{}' });
        if (r.ok && r.data.url) window.location.href = r.data.url;
        else {
          say(errorText(r.data, 'Could not start the payment.'), false);
          e.target.disabled = false;
        }
      });
    }

    if (new URLSearchParams(window.location.search).get('device_reset') === 'paid') {
      say('Payment received — your device is being reset…', true);
    }
    await render();
  })();

  // Discord link result (?discord=...)
  const dq = new URLSearchParams(window.location.search).get('discord');
  const discordMsg = document.getElementById('discordMessage');
  if (dq && discordMsg) {
    const texts = {
      linked: 'Discord linked — Champ+ rank assigned!',
      pending: 'Discord linked! Join our Discord server first, then press "Retry Champ+ rank".',
      nolicense: 'Discord linked! The Champ+ rank unlocks as soon as you own a license.',
      error: 'Discord linking failed. Please try again.',
    };
    discordMsg.style.display = 'block';
    discordMsg.style.color = dq === 'error' ? '#ff6b6b' : '#4ade80';
    discordMsg.textContent = texts[dq] || '';
  }

  // Redeem license key
  const redeemForm = document.getElementById('redeemForm');
  if (redeemForm) {
    redeemForm.addEventListener('submit', async function (e) {
      e.preventDefault();
      const btn = this.querySelector('button');
      const msg = document.getElementById('redeemMessage');
      btn.disabled = true;
      try {
        const res = await api('/api/license/redeem', {
          method: 'POST',
          body: JSON.stringify({ key: document.getElementById('redeemKey').value }),
        });
        msg.style.display = 'block';
        msg.style.color = res.ok ? '#4ade80' : '#ff6b6b';
        msg.textContent = res.ok ? res.data.message : errorText(res.data, 'Could not redeem this key.');
        if (res.ok) setTimeout(() => window.location.reload(), 1500);
      } catch (_) {
        msg.style.display = 'block';
        msg.style.color = '#ff6b6b';
        msg.textContent = 'Could not reach the server.';
      }
      btn.disabled = false;
    });
  }

  // Referral link + stats
  (async () => {
    const linkEl = document.getElementById('refLink');
    if (!linkEl) return;
    try {
      const res = await api('/api/referral/mine');
      if (!res.ok) throw new Error('ref');
      const r = res.data;
      linkEl.textContent = r.link;
      document.getElementById('refStats').innerHTML =
        `Sales through your link: <b>${r.sales}</b> &nbsp;•&nbsp; Earned: <b>${eur(r.earnings_cents)}</b>` +
        (r.paid_cents ? ` &nbsp;•&nbsp; Paid out: <b>${eur(r.paid_cents)}</b>` : '');
    } catch (_) {
      linkEl.textContent = 'Unavailable right now.';
    }
  })();
  document.getElementById('refCopyBtn')?.addEventListener('click', async function () {
    const text = document.getElementById('refLink')?.textContent || '';
    try { await navigator.clipboard.writeText(text); this.textContent = 'Copied!'; }
    catch (_) { window.prompt('Copy your referral link:', text); }
    setTimeout(() => { this.textContent = 'Copy link'; }, 2000);
  });

  // Base find upload
  document.getElementById('findUploadForm')?.addEventListener('submit', async function(e) {
    e.preventDefault();
    const form = this;
    const button = form.querySelector('button[type="submit"]');
    const message = document.getElementById('findUploadMessage');
    button.disabled = true;
    message.style.display = 'none';
    try {
      const file = document.getElementById('findImage').files[0];
      let image_base64 = '';
      let filename = '';
      if (file) {
        if (file.size > 4 * 1024 * 1024) throw new Error('Image must be 4 MB or smaller.');
        image_base64 = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = () => reject(new Error('Could not read image.'));
          reader.readAsDataURL(file);
        });
        filename = file.name;
      }
      const response = await api('/api/base-finds', { method:'POST', body:JSON.stringify({ title:document.getElementById('findTitle').value, description:document.getElementById('findDesc').value, image_base64, filename }) });
      message.style.display = 'block';
      message.style.color = response.ok ? '#4ade80' : '#ff6b6b';
      message.textContent = response.ok ? response.data.message : errorText(response.data, 'Could not submit find.');
      if (response.ok) { form.reset(); const fresh = await api('/api/dashboard/user-data'); if (fresh.ok) loadCustomerContent(fresh.data); }
    } catch (error) {
      message.style.display = 'block';
      message.style.color = '#ff6b6b';
      message.textContent = error.message || 'Could not submit find.';
    }
    button.disabled = false;
  });

  // Discord status
  const dStatus = document.getElementById('discordStatus');
  if (dStatus && data) {
    if (data.discord_linked) {
      dStatus.innerHTML = `Linked as <b>${escapeHtml(data.discord_username || 'unknown')}</b>. Own a license? The Champ+ rank is assigned automatically.`;
      const retry = document.getElementById('discordRoleBtn');
      if (retry) retry.style.display = 'inline-flex';
    }
  }
  document.getElementById('discordRoleBtn')?.addEventListener('click', async function () {
    const msg = document.getElementById('discordMessage');
    this.disabled = true;
    try {
      const res = await api('/api/discord/refresh-role', { method: 'POST' });
      msg.style.display = 'block';
      msg.style.color = res.ok ? '#4ade80' : '#ff6b6b';
      msg.textContent = res.ok ? res.data.message : errorText(res.data, 'Could not assign the rank.');
    } catch (_) {
      msg.style.display = 'block';
      msg.style.color = '#ff6b6b';
      msg.textContent = 'Could not reach the server.';
    }
    this.disabled = false;
  });

  // 2FA status + setup
  const twofaStatus = document.getElementById('twofaStatus');
  if (twofaStatus && data) {
    if (data.totp_enabled) {
      twofaStatus.innerHTML = `2FA is <b style="color:#4ade80">ON</b>${data.phone ? ` • Phone: <b>${escapeHtml(data.phone)}</b>` : ''}. You will be asked for a code at every sign in.`;
      document.getElementById('twofaOffBox').style.display = 'none';
      document.getElementById('twofaOnBox').style.display = 'block';
    } else {
      twofaStatus.textContent = 'Protect your account with two-factor authentication (authenticator app) and link your phone number.';
    }
  }
  document.getElementById('twofaSetupBtn')?.addEventListener('click', async function () {
    this.disabled = true;
    try {
      const res = await api('/api/auth/2fa/setup', { method: 'POST' });
      if (!res.ok) throw new Error('2fa');
      document.getElementById('twofaSecret').textContent = res.data.secret;
      document.getElementById('twofaSetupBox').style.display = 'block';
      this.style.display = 'none';
    } catch (_) {
      const msg = document.getElementById('twofaMessage');
      msg.style.display = 'block';
      msg.style.color = '#ff6b6b';
      msg.textContent = 'Could not start 2FA setup.';
      this.disabled = false;
    }
  });
  document.getElementById('twofaEnableForm')?.addEventListener('submit', async function (e) {
    e.preventDefault();
    const msg = document.getElementById('twofaMessage');
    try {
      const res = await api('/api/auth/2fa/enable', {
        method: 'POST',
        body: JSON.stringify({ code: document.getElementById('twofaCode').value, phone: document.getElementById('twofaPhone').value }),
      });
      msg.style.display = 'block';
      msg.style.color = res.ok ? '#4ade80' : '#ff6b6b';
      msg.textContent = res.ok ? res.data.message + ' Reloading…' : errorText(res.data, 'Could not enable 2FA.');
      if (res.ok) setTimeout(() => window.location.reload(), 1200);
    } catch (_) {
      msg.style.display = 'block';
      msg.style.color = '#ff6b6b';
      msg.textContent = 'Could not reach the server.';
    }
  });
  document.getElementById('twofaDisableForm')?.addEventListener('submit', async function (e) {
    e.preventDefault();
    const msg = document.getElementById('twofaMessage');
    try {
      const res = await api('/api/auth/2fa/disable', {
        method: 'POST',
        body: JSON.stringify({ password: document.getElementById('twofaDisablePw').value }),
      });
      msg.style.display = 'block';
      msg.style.color = res.ok ? '#4ade80' : '#ff6b6b';
      msg.textContent = res.ok ? res.data.message + ' Reloading…' : errorText(res.data, 'Could not turn 2FA off.');
      if (res.ok) setTimeout(() => window.location.reload(), 1200);
    } catch (_) {
      msg.style.display = 'block';
      msg.style.color = '#ff6b6b';
      msg.textContent = 'Could not reach the server.';
    }
  });
}

// ============================================================
// Public Features page
// ============================================================
async function loadCustomerContent(data) {
  const packs = document.getElementById('dashboardTexturePacks');
  const finds = document.getElementById('dashboardFindsGrid');
  const hasLicense = Object.values(data.licenses || {}).some(license => license && license.active);
  if (!hasLicense) {
    if (packs) packs.innerHTML = '<article class="dash-card"><p class="no-license-text">Your account does not have an active license yet. Purchase or redeem a key to unlock texture packs.</p><button class="btn-ghost" data-section-link="overview" type="button" onclick="showDashboardSection(\'overview\')">View license options</button></article>';
    if (finds) finds.innerHTML = '<p class="no-license-text">An active license is required to view base finds.</p>';
    return;
  }
  if (packs) {
    try {
      const response = await api('/api/texture-packs');
      if (response.status === 401 || response.status === 403) packs.innerHTML = '<p class="no-license-text">Active customer access is required to view packs.</p>';
      else if (!response.ok) throw new Error('packs');
      else {
        const entries = response.data.packs || [];
        packs.innerHTML = entries.length ? entries.map(pack => `<article class="texture-card"><div class="texture-card-body"><span class="texture-category">${escapeHtml(pack.category || 'Customer Pack')}</span><h2 class="texture-title">${escapeHtml(pack.name)}</h2><p class="texture-desc">${escapeHtml(pack.description)}</p><a href="${escapeAttr(pack.download_url)}" class="btn-download">Download pack</a></div></article>`).join('') : '<article class="dash-card"><p class="no-license-text">No texture packs are available yet.</p></article>';
      }
    } catch (_) { packs.innerHTML = '<p class="no-license-text">Could not load texture packs right now.</p>'; }
  }
  if (finds) {
    try {
      const response = await api('/api/base-finds');
      if (response.status === 403) finds.innerHTML = '<p class="no-license-text">An active license is required to view base finds.</p>';
      else if (!response.ok) throw new Error('finds');
      else {
        const entries = response.data.finds || [];
        finds.innerHTML = entries.length ? entries.map(item => `<article class="find-card">${item.image_url ? `<img class="find-image" src="${escapeAttr(item.image_url)}" alt="${escapeAttr(item.title)}" loading="lazy">` : ''}<div class="find-body"><h2>${escapeHtml(item.title)}</h2><p>${escapeHtml(item.description)}</p><p class="find-meta">by ${escapeHtml(item.username)}</p></div></article>`).join('') : '<p class="no-license-text">No approved finds are available yet.</p>';
      }
    } catch (_) { finds.innerHTML = '<p class="no-license-text">Could not load base finds right now.</p>'; }
  }
}

const FEATURE_CATALOG = window.CHAMP_FEATURES || { categories: [], modules: [] };

function featureCategories() {
  return FEATURE_CATALOG.categories || [];
}

function categoryById(id) {
  return featureCategories().find(category => category.id === id) || null;
}

function featureVideoHtml(url, title) {
  const src = String(url || '').trim();
  if (!src) return '';
  if (/\.(mp4|webm|ogg)(\?|#|$)/i.test(src)) {
    return `<video controls preload="none" playsinline src="${escapeAttr(src)}" title="${escapeAttr(title)} video"></video>`;
  }
  return `<iframe src="${escapeAttr(src)}" title="${escapeAttr(title)} video" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; picture-in-picture" allowfullscreen></iframe>`;
}

// The catalogue is the source of truth; a saved feature row only adds media and text.
async function loadFeaturesPage() {
  const grid = document.getElementById('featureGrid');
  if (!grid) return;

  let overrides = [];
  try {
    const res = await api('/api/features');
    if (res.ok) overrides = res.data.features || [];
  } catch (_) { /* the catalogue still renders without the database */ }

  const bySlug = new Map(overrides.filter(row => row && row.slug).map(row => [row.slug, row]));
  const catalogSlugs = new Set(FEATURE_CATALOG.modules.map(module => module.slug));

  const modules = FEATURE_CATALOG.modules.map(module => {
    const saved = bySlug.get(module.slug) || {};
    return {
      ...module,
      title: module.title,
      description: saved.description?.trim() || module.description,
      image_url: saved.image_url || '',
      video_url: saved.video_url || ''
    };
  });

  // Extra features created in the admin panel that are not part of the catalogue.
  for (const row of overrides) {
    if (!row.slug || catalogSlugs.has(row.slug)) continue;
    const category = categoryById(row.category) ? row.category : '';
    modules.push({
      slug: row.slug,
      category,
      title: row.title || row.slug,
      description: row.description || '',
      image_url: row.image_url || '',
      video_url: row.video_url || ''
    });
  }

  const filters = document.getElementById('featureFilters');
  const note = document.getElementById('featureFilterNote');
  let active = 'all';

  function countFor(id) {
    return id === 'all' ? modules.length : modules.filter(module => module.category === id).length;
  }

  function renderFilters() {
    if (!filters) return;
    const chips = [{ id: 'all', label: 'All', icon: '✦' }, ...featureCategories()];
    filters.innerHTML = chips.map(chip => `
      <button class="feature-filter${chip.id === active ? ' active' : ''}" type="button" role="tab"
        aria-selected="${chip.id === active}" data-category="${escapeAttr(chip.id)}">
        <span class="feature-filter-icon" aria-hidden="true">${escapeHtml(chip.icon || '•')}</span>
        <span>${escapeHtml(chip.label)}</span>
        <span class="feature-filter-count">${countFor(chip.id)}</span>
      </button>
    `).join('');

    filters.querySelectorAll('[data-category]').forEach(button => {
      button.addEventListener('click', () => {
        active = button.dataset.category;
        renderFilters();
        renderCards();
      });
    });
  }

  function renderCards() {
    const visible = active === 'all' ? modules : modules.filter(module => module.category === active);
    if (note) {
      const category = categoryById(active);
      note.textContent = category?.note
        ? category.note
        : `${visible.length} module${visible.length === 1 ? '' : 's'}${category ? ` in ${category.label}` : ` across ${featureCategories().length} categories`} · click a card for screenshots and clips`;
      note.classList.toggle('is-warning', Boolean(category?.note));
    }

    if (!visible.length) {
      grid.innerHTML = '<p class="no-license-text">No modules in this category yet.</p>';
      return;
    }

    const groups = active === 'all'
      ? featureCategories().map(category => ({ category, items: visible.filter(module => module.category === category.id) })).filter(group => group.items.length)
      : [{ category: categoryById(active), items: visible }];

    const loose = active === 'all' ? visible.filter(module => !categoryById(module.category)) : [];

    grid.innerHTML = groups.map(({ category, items }) => `
      <section class="feature-group">
        <h2 class="feature-group-title"><span aria-hidden="true">${escapeHtml(category?.icon || '✦')}</span> ${escapeHtml(category?.label || 'Features')}</h2>
        <div class="feature-group-grid">${items.map(featureCardHtml).join('')}</div>
      </section>
    `).join('') + (loose.length ? `
      <section class="feature-group">
        <h2 class="feature-group-title"><span aria-hidden="true">✦</span> More</h2>
        <div class="feature-group-grid">${loose.map(featureCardHtml).join('')}</div>
      </section>
    ` : '');

    grid.querySelectorAll('[data-feature-toggle]').forEach(button => {
      button.addEventListener('click', () => {
        const card = button.closest('.feature-module-card');
        const media = card?.querySelector('.feature-module-media');
        if (!media) return;
        const open = media.hasAttribute('hidden');
        if (open) {
          const video = media.dataset.video;
          if (video && !media.querySelector('.feature-video')) {
            media.insertAdjacentHTML('afterbegin', `<div class="feature-video">${featureVideoHtml(video, card.dataset.title || 'Feature')}</div>`);
          }
          media.removeAttribute('hidden');
        } else {
          media.setAttribute('hidden', '');
        }
        button.setAttribute('aria-expanded', String(open));
        button.textContent = open ? 'Hide media' : 'Show media';
      });
    });
  }

  function featureCardHtml(module) {
    const category = categoryById(module.category);
    const hasMedia = Boolean(module.image_url || module.video_url);
    return `
      <article class="feature-module-card" data-title="${escapeAttr(module.title)}">
        <div class="feature-module-top">
          <span class="feature-module-icon" aria-hidden="true">${escapeHtml(category?.icon || '✦')}</span>
          <h3>${escapeHtml(module.title)}</h3>
        </div>
        <p>${escapeHtml(module.description)}</p>
        ${module.image_url ? `<img class="feature-module-thumb" src="${escapeAttr(module.image_url)}" alt="${escapeAttr(module.title)} screenshot" loading="lazy">` : ''}
        ${hasMedia ? `<button class="feature-module-toggle" type="button" data-feature-toggle aria-expanded="false">Show media</button>
        <div class="feature-module-media" data-video="${escapeAttr(module.video_url || '')}" hidden>
          ${module.image_url ? `<img class="feature-module-image" src="${escapeAttr(module.image_url)}" alt="${escapeAttr(module.title)} screenshot" loading="lazy">` : ''}
        </div>` : ''}
      </article>
    `;
  }

  renderFilters();
  renderCards();
}

// ============================================================
// Public changelog (no login required)
// ============================================================
function renderChangelogBody(body) {
  const text = String(body || '').trim();
  if (!text) return '';
  return text.split(/\n\s*\n/).map(block => {
    const lines = block.split('\n').map(line => line.trim()).filter(Boolean);
    const bullets = lines.filter(line => /^[-*]\s+/.test(line));
    if (bullets.length && bullets.length === lines.length) {
      return `<ul class="changelog-bullets">${bullets.map(line => `<li>${renderSiteText(line.replace(/^[-*]\s+/, ''))}</li>`).join('')}</ul>`;
    }
    return `<p>${renderSiteText(block).replace(/\n/g, '<br>')}</p>`;
  }).join('');
}

async function loadChangelogPage() {
  const wrap = document.getElementById('changelogList');
  if (!wrap) return;
  try {
    const res = await api('/api/changelog');
    if (!res.ok) throw new Error('changelog');
    const entries = res.data.entries || [];
    if (!entries.length) {
      wrap.innerHTML = '<p class="no-license-text">No releases published yet. Check back soon.</p>';
      return;
    }
    wrap.innerHTML = entries.map(entry => `
      <article class="changelog-entry">
        <div class="changelog-meta">
          <span class="changelog-version">${escapeHtml(entry.version)}</span>
          <time datetime="${escapeAttr(entry.released_at || '')}">${fmtDate(entry.released_at)}</time>
        </div>
        <h2>${escapeHtml(entry.title)}</h2>
        <div class="changelog-body">${renderChangelogBody(entry.body)}</div>
      </article>
    `).join('');
  } catch (_) {
    wrap.innerHTML = '<p class="no-license-text">Could not load the changelog right now.</p>';
  }
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]));
}
function escapeAttr(value) { return escapeHtml(value); }

// ============================================================
// Editable page texts and dashboard icons
// ============================================================
const SITE_TEXT_KEYS = ['hero_title', 'hero_sub', 'pricing_title', 'pricing_sub',
  'features_title', 'features_sub', 'support_title', 'support_sub'];
const DASH_ICON_CHOICES = ['grid', 'download', 'layers', 'pin', 'key', 'card', 'gift',
  'message', 'shield', 'help', 'star', 'sliders', 'user', 'box', 'zap'];
const DASH_ICON_SECTIONS = [
  ['overview', 'Overview'], ['install', 'Install'], ['texture-packs', 'Texture Packs'],
  ['base-finds', 'Base Finds'], ['keys', 'Keys & Licenses'], ['billing', 'Subscriptions'],
  ['referrals', 'Referrals'], ['discord', 'Discord'], ['security', 'Security'],
  ['help', 'Help'], ['whats-new', "What's new"],
];

// *highlight* -> purple emphasis, | -> line break; everything else stays escaped text.
function renderSiteText(value) {
  return escapeHtml(value)
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/\|/g, '<br>');
}

function parseDashboardIcons(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(raw) || {}; } catch (_) { return {}; }
}

function applyDashboardIcons(raw) {
  const icons = parseDashboardIcons(raw);
  document.querySelectorAll('.sidebar-link').forEach(link => {
    const section = link.dataset.section || link.dataset.dashSection;
    const span = link.querySelector('[data-dash-icon]');
    const icon = icons[section];
    if (!span || !icon || !DASH_ICON_CHOICES.includes(icon)) return;
    span.dataset.dashIcon = icon;
    const use = span.querySelector('use');
    if (use) use.setAttribute('href', `#i-${icon}`);
  });
}

// ============================================================
// Public Texture Packs Section & Announcement & Reviews
// ============================================================
async function loadPublicData() {
  // 1. Announcements & Site Links
  try {
    const res = await api('/api/settings');
    if (res.ok && res.data.settings) {
      const s = res.data.settings;
      if (s.announcement_enabled === 'true' && s.announcement_text) {
        const banner = document.getElementById('siteAnnouncementBanner');
        const text = document.getElementById('siteAnnouncementText');
        if (banner && text && localStorage.getItem('dismissed_announcement') !== s.announcement_text) {
          text.textContent = s.announcement_text;
          banner.style.display = 'flex';
          document.body.classList.add('has-announcement');
          // The banner wraps to more lines on narrow screens, so keep the fixed
          // navigation offset in sync with its real height instead of measuring once.
          const syncAnnouncementHeight = () => {
            if (banner.style.display === 'none') return;
            document.documentElement.style.setProperty('--announcement-h', `${banner.offsetHeight}px`);
          };
          syncAnnouncementHeight();
          if (!banner.dataset.heightTracked) {
            banner.dataset.heightTracked = 'true';
            if ('ResizeObserver' in window) new ResizeObserver(syncAnnouncementHeight).observe(banner);
            window.addEventListener('resize', syncAnnouncementHeight);
          }
        }
      }
      if (s.discord_link) {
        document.querySelectorAll('a[href*="discord.gg"]').forEach(a => { a.href = s.discord_link; });
      }
      if (s.hero_tagline) {
        const eb = document.getElementById('heroEyebrow');
        if (eb) eb.textContent = s.hero_tagline;
      }
      SITE_TEXT_KEYS.forEach(key => {
        const value = s[key];
        if (typeof value !== 'string' || !value) return;
        document.querySelectorAll(`[data-site-text="${key}"]`).forEach(el => {
          el.innerHTML = renderSiteText(value);
        });
      });
      applyDashboardIcons(s.dashboard_icons);
      if (s.youtube_video_url) {
        const wrap = document.getElementById('heroVideoEmbedWrap');
        const iframe = document.getElementById('heroVideoIframe');
        if (wrap && iframe) {
          iframe.src = s.youtube_video_url;
          wrap.style.display = 'block';
        }
      }
    }
  } catch (_) { /* settings optional */ }

  // Reviews
  const reviewsGrid = document.getElementById('reviewsGrid');
  if (reviewsGrid) {
    try {
      const res = await api('/api/reviews');
      if (res.ok && res.data.reviews && res.data.reviews.length) {
        reviewsGrid.innerHTML = res.data.reviews.map(r => `
          <figure class="review-card">
            <div class="review-stars" role="img" aria-label="${r.rating} stars">${'&#9733;'.repeat(r.rating || 5)}</div>
            <blockquote class="review-text">&ldquo;${escapeHtml(r.text)}&rdquo;</blockquote>
            <figcaption class="review-author">${escapeHtml(r.author)} &bull; ${escapeHtml(r.tag || 'Verified Member')}</figcaption>
          </figure>
        `).join('');
      }
    } catch (_) { /* keep defaults */ }
  }
}

function dismissAnnouncement() {
  const banner = document.getElementById('siteAnnouncementBanner');
  const text = document.getElementById('siteAnnouncementText');
  if (banner) banner.style.display = 'none';
  if (text) localStorage.setItem('dismissed_announcement', text.textContent);
  document.body.classList.remove('has-announcement');
  document.documentElement.style.removeProperty('--announcement-h');
}

// ============================================================
// AI Assistant Widget
// ============================================================
function toggleAIChat() {
  const win = document.getElementById('aiChatWindow');
  if (!win) return;
  const isHidden = win.style.display === 'none';
  win.style.display = isHidden ? 'flex' : 'none';
  if (isHidden) {
    setTimeout(() => document.getElementById('aiChatInput')?.focus(), 50);
  }
}

const supportChatHistory = [];
let supportChatSessionId = null;

try {
  supportChatSessionId = sessionStorage.getItem('champ_support_session');
} catch (_) { /* session storage is optional */ }


// Turn assistant replies into readable text with clickable links.
function renderAIMessage(target, text) {
  const html = escapeHtml(text)
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '$1 ($2)')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^-{3,}\s*$/gm, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/(https?:\/\/[^\s<>"']+)/g, (raw) => {
      const url = raw.replace(/[.,;:!?)]+$/, '');
      const trailing = raw.slice(url.length);
      return `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>${trailing}`;
    })
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .split(String.fromCharCode(10)).join('<br>');
  target.innerHTML = html;
}
async function handleAIChatSubmit(e) {
  e.preventDefault();
  const input = document.getElementById('aiChatInput');
  const messages = document.getElementById('aiChatMessages');
  if (!input || !messages) return;

  const text = input.value.trim();
  if (!text) return;
  input.value = '';

  const userBubble = document.createElement('div');
  userBubble.className = 'ai-msg ai-user';
  userBubble.textContent = text;
  messages.appendChild(userBubble);

  const botBubble = document.createElement('div');
  botBubble.className = 'ai-msg ai-bot';
  botBubble.innerHTML = '<em>Thinking…</em>';
  messages.appendChild(botBubble);
  messages.scrollTop = messages.scrollHeight;

  try {
    const res = await api('/api/ai/chat', { method: 'POST', body: JSON.stringify({ message: text, history: supportChatHistory.slice(-8), channel: 'website', session_id: supportChatSessionId }) });
    if (res.ok && res.data && res.data.reply) {
      renderAIMessage(botBubble, res.data.reply);
      if (res.data.session_id) {
        supportChatSessionId = res.data.session_id;
        try { sessionStorage.setItem('champ_support_session', supportChatSessionId); } catch (_) { /* session storage is optional */ }
      }
      supportChatHistory.push({ role: 'user', content: text }, { role: 'assistant', content: res.data.reply });
      if (res.data.needs_escalation) {
        const link = document.createElement('a');
        link.href = res.data.escalation_url || 'https://discord.gg/6vyQnVjeX';
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.className = 'ai-escalation-link';
        link.textContent = 'Open Discord support';
        const wrap = document.createElement('div');
        wrap.className = 'ai-msg ai-bot';
        wrap.appendChild(link);
        messages.appendChild(wrap);
      }
    } else {
      botBubble.textContent = errorText(res.data, 'I could not reach the support assistant. Please try again, or contact our team on Discord.');
      appendDiscordEscalation(messages);
    }
  } catch (_) {
    botBubble.textContent = 'I could not reach the support assistant. Please try again.';
    appendDiscordEscalation(messages);
  }
  messages.scrollTop = messages.scrollHeight;
}

// ============================================================
// Base finds gallery (finds.html)
// ============================================================
async function loadFindsPage() {
  const grid = document.getElementById('findsGrid');
  if (!grid) return;
  const loginHint = '<p class="no-license-text">Base Finds are reserved for active Champ Client customers. <a href="login.html?next=finds.html" style="color:#a78bfa">Sign in</a> to continue.</p>';
  const licenseHint = '<p class="no-license-text">An active Champ Client license is required to browse Base Finds. <a href="index.html#pricing" style="color:#a78bfa">View plans</a>.</p>';
  const me = await api('/api/auth/me');
  if (!me.ok) {
    grid.innerHTML = loginHint;
    const form = document.getElementById('findUploadForm');
    if (form) form.remove();
    return;
  }
  const access = await api('/api/dashboard/user-data');
  const activeCustomer = access.ok && Object.values(access.data.licenses || {}).some(license => license && license.active);
  if (!activeCustomer) {
    grid.innerHTML = licenseHint;
    const form = document.getElementById('findUploadForm');
    if (form) form.remove();
    return;
  }
  try {
    const res = await api('/api/base-finds');
    if (res.status === 403) {
      grid.innerHTML = licenseHint;
      const form = document.getElementById('findUploadForm');
      if (form) form.remove();
      return;
    }
    if (!res.ok) throw new Error('finds');
    const finds = res.data.finds || [];
    if (!finds.length) {
      grid.innerHTML = '<p class="no-license-text">No finds yet — be the first to upload one!</p>';
    } else {
      grid.innerHTML = finds.map(f => `
        <article class="find-card">
          ${f.image_url ? `<img class="find-image" src="${escapeAttr(f.image_url)}" alt="${escapeAttr(f.title)}" loading="lazy">` : ''}
          <div class="find-body">
            <h2>${escapeHtml(f.title)}</h2>
            <p>${escapeHtml(f.description)}</p>
            <p class="find-meta">by ${escapeHtml(f.username)}</p>
          </div>
        </article>`).join('');
    }
  } catch (_) {
    grid.innerHTML = '<p class="no-license-text">Could not load finds right now.</p>';
  }

  // Upload form (only for signed-in users)
  const form = document.getElementById('findUploadForm');
  if (!form) return;
  const findAuthHint = document.getElementById('findAuthHint');
  if (findAuthHint) findAuthHint.style.display = 'none';
  form.style.display = 'grid';
  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    const btn = form.querySelector('button');
    const msg = document.getElementById('findUploadMessage');
    btn.disabled = true;
    msg.style.display = 'none';
    try {
      const file = document.getElementById('findImage').files[0];
      let image_base64 = '';
      let filename = '';
      if (file) {
        if (file.size > 4 * 1024 * 1024) throw new Error('Image is too large (max 4 MB).');
        image_base64 = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = () => reject(new Error('read'));
          reader.readAsDataURL(file);
        });
        filename = file.name;
      }
      const res = await api('/api/base-finds', {
        method: 'POST',
        body: JSON.stringify({ title: document.getElementById('findTitle').value, description: document.getElementById('findDesc').value, image_base64, filename }),
      });
      msg.style.display = 'block';
      msg.style.color = res.ok ? '#4ade80' : '#ff6b6b';
      msg.textContent = res.ok ? res.data.message : errorText(res.data, 'Could not upload.');
      if (res.ok) form.reset();
    } catch (err) {
      msg.style.display = 'block';
      msg.style.color = '#ff6b6b';
      msg.textContent = err.message || 'Could not upload.';
    }
    btn.disabled = false;
  });
}

// ============================================================
// Admin panel
// ============================================================
async function loadAdminPanel() {
  const panel = document.getElementById('adminPanel');
  const denied = document.getElementById('adminDenied');
  const logout = document.getElementById('adminLogout');
  if (!panel) return;

  const me = await api('/api/admin/me');
  if (!me.ok) {
    const session = await api('/api/auth/me');
    if (!session.ok) {
      // No session at all: the normal login page is the only way in now.
      window.location.href = 'login.html?next=admin.html';
      return;
    }
    if (denied) {
      denied.style.display = 'block';
      const text = document.getElementById('adminDeniedText');
      if (text) text.textContent = `${session.data.username || 'This account'} is signed in, but it does not have admin access. Ask an owner to enable admin on this account.`;
    }
    return;
  }

  panel.style.display = 'flex';
  if (logout) logout.style.display = 'inline-flex';
  const badge = document.getElementById('adminSessionBadge');
  if (badge) badge.textContent = me.data.email ? `Admin: ${me.data.username}` : `Admin: ${me.data.username} (environment)`;
  loadAdminMyAccount(me.data);

  document.querySelectorAll('.admin-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      document.querySelectorAll('.admin-tabpage').forEach(p => { p.style.display = 'none'; });
      document.getElementById(`tab-${tab.dataset.tab}`).style.display = 'block';
      // Discount codes live in Stripe, so they are fetched when the tab is opened (not on page load).
      if (tab.dataset.tab === 'discounts') loadDiscounts();
      if (tab.dataset.tab === 'accounts') loadAdminUsers(document.getElementById('adminUserSearch')?.value.trim() || '');
    });
  });

  try {
    const stats = await api('/api/admin/stats');
    if (stats.ok) document.getElementById('adminStatsLine').textContent =
      `Users: ${stats.data.users} • Licenses: ${stats.data.licenses_total} (${stats.data.licenses_active} active)`;
  } catch (_) { /* stats optional */ }

  loadAdminOrders('');
  loadAdminUsers('');
  loadAdminReferrals();
  loadAdminFinds();
  loadAdminSettings();
  loadAdminTexturePacks();
  loadAdminReviews();
  loadAdminAIKnowledge();
  loadAdminChangelog();
  loadAdminFeatures();
  loadAdminLoaderChannels();
}

// The loader jars are not on the shop: the beta is only offered here, and the stable jar shows up
// once it is published. These are the same version files the loaders poll on launch, so this panel
// shows exactly what a start would see.
async function loadAdminLoaderChannels() {
  const channel = async (versionPath, jarPath, downloadId, versionId, noteId, name) => {
    const button = document.getElementById(downloadId);
    const versionEl = document.getElementById(versionId);
    const note = document.getElementById(noteId);
    if (!button || !versionEl) return;
    try {
      const res = await fetch(`${versionPath}?t=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`http ${res.status}`);
      const version = (await res.text()).trim();
      versionEl.textContent = version || 'unknown';
      button.href = jarPath;
      button.style.display = '';
      if (note) note.textContent = `${name} is live \u2014 this is the jar a launch would download.`;
    } catch (_) {
      versionEl.textContent = 'not published';
      button.style.display = 'none';
      if (note) note.textContent = `${name} has no published jar yet.`;
    }
  };

  await Promise.all([
    channel('downloads/beta/champ-beta.version', 'downloads/beta/champ-beta.jar',
      'adminBetaDownload', 'adminBetaVersion', 'adminBetaNote', 'The beta channel'),
    channel('downloads/champ-loader.version', 'downloads/champ-loader.jar',
      'adminStableDownload', 'adminStableVersion', 'adminStableNote', 'The stable loader'),
  ]);
}

if (document.getElementById('adminPanel')) loadAdminPanel();

// Admins are customers too: show their own licenses here, not only the shop orders.
async function loadAdminMyAccount(admin) {
  const wrap = document.getElementById('adminMyKeys');
  const name = document.getElementById('adminMyName');
  const email = document.getElementById('adminMyEmail');
  if (!wrap) return;
  if (name) name.textContent = admin.username || 'admin';
  if (email && admin.email) email.textContent = `(${admin.email})`;

  const res = await api('/api/dashboard/user-data');
  if (!res.ok) {
    wrap.innerHTML = '<p class="no-license-text">This admin login has no customer account, so there are no personal keys to show. Use a normal account with admin access to see your own licenses here.</p>';
    return;
  }

  const d = res.data;
  if (name) name.textContent = d.username;
  if (email) email.textContent = `(${d.email})`;
  const rows = Object.entries(d.licenses || {}).filter(([, lic]) => lic);
  if (!rows.length) {
    wrap.innerHTML = '<p class="no-license-text">You do not have a license on this account yet.</p>';
    return;
  }

  wrap.innerHTML = `<table class="admin-table"><thead><tr><th>Plan</th><th>Key</th><th>Status</th><th>Expires</th></tr></thead><tbody>` +
    rows.map(([plan, lic]) => `<tr><td>${escapeHtml(plan)}</td><td><code>${escapeHtml(lic.key)}</code></td><td>${lic.active ? '<span class="status-badge status-active">Active</span>' : '<span class="status-badge status-none">Inactive</span>'}</td><td>${lic.expires_at ? fmtDate(lic.expires_at) : '—'}</td></tr>`).join('') +
    `</tbody></table>`;
}

async function loadAdminOrders(search) {
  const wrap = document.getElementById('adminOrders');
  if (!wrap) return;
  try {
    const res = await api(`/api/admin/licenses?search=${encodeURIComponent(search)}&limit=50`);
    if (!res.ok) throw new Error('orders');
    const rows = res.data.licenses || [];
    if (!rows.length) { wrap.innerHTML = '<p class="no-license-text">No orders found.</p>'; return; }
    wrap.innerHTML = `<table class="admin-table"><thead><tr><th>Email</th><th>Plan</th><th>Key</th><th>Status</th><th>Expires</th><th>Device</th><th>Created</th><th></th></tr></thead><tbody>` +
      rows.map(r => `<tr><td>${r.unassigned ? '<span class="status-badge status-none" title="No owner yet — the first account that redeems this key gets it">Unclaimed</span>' : escapeHtml(r.email)}</td><td>${escapeHtml(r.plan_type)}</td><td><code>${escapeHtml(r.license_key)}</code></td><td><span class="status-badge ${r.status === 'active' ? 'status-active' : 'status-none'}">${escapeHtml(r.status)}</span></td><td>${r.expires_at ? fmtDate(r.expires_at) : 'never'}</td><td>${r.hwid ? 'linked' : '—'}</td><td>${fmtDate(r.created_at)}</td><td style="white-space:nowrap"><button class="btn-ghost" type="button" data-edit="${r.id}">Edit</button></td></tr>`).join('') +
      `</tbody></table>`;
    wrap.querySelectorAll('[data-edit]').forEach(btn => {
      btn.addEventListener('click', () => openLicenseEditor(rows.find(r => String(r.id) === btn.dataset.edit)));
    });
  } catch (_) {
    wrap.innerHTML = '<p class="no-license-text">Could not load orders.</p>';
  }
}

// ------------------------------------------------------------
// One key, every field: owner, plan, status, expiry and the key itself.
// ------------------------------------------------------------
let licEditorId = null;

function licEditorMessage(text, ok) {
  const el = document.getElementById('licEditorMsg');
  if (!el) return;
  el.textContent = text;
  el.style.display = 'block';
  el.style.color = ok ? 'var(--ok, #4ade80)' : 'var(--danger, #f87171)';
}

function openLicenseEditor(lic) {
  if (!lic) return;
  const panel = document.getElementById('adminLicenseEditor');
  const form = document.getElementById('adminLicenseEditForm');
  if (!panel || !form) return;
  licEditorId = lic.id;
  form.elements.email.value = lic.unassigned ? '' : (lic.email || '');
  form.elements.plan_type.value = lic.plan_type || 'lifetime';
  form.elements.status.value = lic.status || 'active';
  form.elements.expires_at.value = lic.expires_at ? String(lic.expires_at).slice(0, 10) : '';
  form.elements.license_key.value = lic.license_key || '';
  form.elements.email.placeholder = 'empty = unclaimed';
  document.getElementById('licEditorKeyLabel').textContent = lic.license_key || '';
  const info = [`Created ${fmtDate(lic.created_at)}`];
  if (lic.redeemed_at) info.push(`redeemed ${fmtDate(lic.redeemed_at)}`);
  if (lic.hwid) info.push(`device ${lic.hwid} linked ${fmtDate(lic.hwid_bound_at)}`);
  if (lic.hwid_reset_at) info.push(`device reset ${fmtDate(lic.hwid_reset_at)}`);
  if (lic.last_seen_at) info.push(`last seen ${fmtDate(lic.last_seen_at)}`);
  if (lic.stripe_customer_id) info.push(`stripe customer ${lic.stripe_customer_id}`);
  if (lic.stripe_subscription_id) info.push(`subscription ${lic.stripe_subscription_id}`);
  document.getElementById('licEditorInfo').textContent = info.join(' • ');
  const msg = document.getElementById('licEditorMsg');
  if (msg) { msg.style.display = 'none'; msg.textContent = ''; }
  panel.style.display = 'block';
}

document.getElementById('adminLicenseEditForm')?.addEventListener('submit', async function (e) {
  e.preventDefault();
  if (licEditorId === null) return;
  const f = e.target.elements;
  const body = {
    email: f.email.value.trim(),
    plan_type: f.plan_type.value,
    status: f.status.value,
    expires_at: f.expires_at.value.trim(),
    license_key: f.license_key.value.trim(),
  };
  const res = await api(`/api/admin/licenses/${licEditorId}`, { method: 'POST', body: JSON.stringify(body) });
  if (!res.ok) { licEditorMessage(errorText(res.data, 'Could not save the key.'), false); return; }
  loadAdminOrders(document.getElementById('adminSearch')?.value.trim() || '');
  openLicenseEditor(res.data);
  licEditorMessage('Saved.', true);
});

['licEditorClose', 'licEditorCloseTop'].forEach(id => {
  document.getElementById(id)?.addEventListener('click', () => {
    document.getElementById('adminLicenseEditor').style.display = 'none';
    licEditorId = null;
  });
});

document.getElementById('licEditorResetDevice')?.addEventListener('click', async () => {
  if (licEditorId === null) return;
  const res = await api(`/api/admin/licenses/${licEditorId}/reset-hwid`, { method: 'POST' });
  if (!res.ok) { licEditorMessage(errorText(res.data, 'Could not reset the device.'), false); return; }
  licEditorMessage(res.data.message || 'Device reset.', true);
  loadAdminOrders(document.getElementById('adminSearch')?.value.trim() || '');
});

document.getElementById('licEditorCopy')?.addEventListener('click', async () => {
  const key = document.getElementById('adminLicenseEditForm')?.elements.license_key.value;
  if (!key) return;
  try { await navigator.clipboard.writeText(key); licEditorMessage('Key copied.', true); }
  catch (_) { licEditorMessage('Could not copy — select the key field instead.', false); }
});

document.getElementById('licEditorDelete')?.addEventListener('click', async () => {
  if (licEditorId === null) return;
  if (!confirm('Delete this key for good? The customer loses access immediately.')) return;
  const res = await api(`/api/admin/licenses/${licEditorId}`, { method: 'DELETE' });
  if (!res.ok) { licEditorMessage(errorText(res.data, 'Could not delete the key.'), false); return; }
  document.getElementById('adminLicenseEditor').style.display = 'none';
  licEditorId = null;
  loadAdminOrders(document.getElementById('adminSearch')?.value.trim() || '');
});

document.getElementById('adminSearchForm')?.addEventListener('submit', function (e) {
  e.preventDefault();
  loadAdminOrders(document.getElementById('adminSearch').value.trim());
});

// ============================================================
// Admin: accounts (username, e-mail, subscription, delete)
// ============================================================
let userEditorId = null;

function userEditorMessage(text, ok) {
  const el = document.getElementById('userEditorMsg');
  if (!el) return;
  el.textContent = text;
  el.style.display = 'block';
  el.style.color = ok ? 'var(--ok, #4ade80)' : 'var(--danger, #f87171)';
}

function userGrantMessage(text, ok) {
  const el = document.getElementById('userGrantMsg');
  if (!el) return;
  el.textContent = text;
  el.style.display = 'block';
  el.style.color = ok ? 'var(--ok, #4ade80)' : 'var(--danger, #f87171)';
}

function openUserEditor(user) {
  if (!user) return;
  const panel = document.getElementById('adminUserEditor');
  const form = document.getElementById('adminUserEditForm');
  if (!panel || !form) return;
  userEditorId = user.id;
  form.elements.username.value = user.username || '';
  form.elements.email.value = user.email || '';
  document.getElementById('userEditorLabel').textContent = user.username || '';
  const keys = (user.licenses || []).map(lic =>
    `${lic.plan_type}${lic.active ? '' : ' (inactive)'}${lic.expires_at ? ' until ' + fmtDate(lic.expires_at) : ' — never expires'}`
  );
  document.getElementById('userEditorInfo').textContent =
    `Account #${user.id} • created ${fmtDate(user.created_at)}${user.email_verified ? ' • e-mail verified' : ' • e-mail not verified'} • ` +
    (keys.length ? `keys: ${keys.join(' | ')}` : 'no keys yet');
  ['userEditorMsg', 'userGrantMsg'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.style.display = 'none'; el.textContent = ''; }
  });
  panel.style.display = 'block';
}

async function loadAdminUsers(search) {
  const wrap = document.getElementById('adminUsers');
  if (!wrap) return;
  try {
    const res = await api(`/api/admin/users?search=${encodeURIComponent(search || '')}&limit=50`);
    if (!res.ok) throw new Error('accounts');
    const rows = res.data.users || [];
    if (!rows.length) { wrap.innerHTML = '<p class="no-license-text">No accounts found.</p>'; return; }
    wrap.innerHTML = `<table class="admin-table"><thead><tr><th>Username</th><th>E-mail</th><th>Access</th><th>Keys</th><th>Created</th><th></th></tr></thead><tbody>` +
      rows.map(u => `<tr><td>${escapeHtml(u.username)}${u.is_admin ? ' <span class="status-badge status-active">admin</span>' : ''}</td><td>${escapeHtml(u.email)}</td><td>${u.active_plans && u.active_plans.length ? escapeHtml(u.active_plans.join(' + ')) : '—'}</td><td>${(u.licenses || []).length}</td><td>${fmtDate(u.created_at)}</td><td style="white-space:nowrap"><button class="btn-ghost" type="button" data-user-edit="${u.id}">Manage</button></td></tr>`).join('') +
      `</tbody></table>`;
    wrap.querySelectorAll('[data-user-edit]').forEach(btn => {
      btn.addEventListener('click', () => openUserEditor(rows.find(u => String(u.id) === btn.dataset.userEdit)));
    });
  } catch (_) {
    wrap.innerHTML = '<p class="no-license-text">Could not load the accounts.</p>';
  }
}

document.getElementById('adminUserSearchForm')?.addEventListener('submit', function (e) {
  e.preventDefault();
  loadAdminUsers(document.getElementById('adminUserSearch').value.trim());
});

document.getElementById('adminUserEditForm')?.addEventListener('submit', async function (e) {
  e.preventDefault();
  if (userEditorId === null) return;
  const f = e.target.elements;
  const res = await api(`/api/admin/users/${userEditorId}`, {
    method: 'POST',
    body: JSON.stringify({ username: f.username.value.trim(), email: f.email.value.trim() }),
  });
  if (!res.ok) { userEditorMessage(errorText(res.data, 'Could not save the account.'), false); return; }
  userEditorMessage('Saved.', true);
  openUserEditor(res.data);
  loadAdminUsers(document.getElementById('adminUserSearch')?.value.trim() || '');
});

document.getElementById('userGrantBtn')?.addEventListener('click', async () => {
  if (userEditorId === null) return;
  const plan = document.getElementById('userGrantPlan').value;
  const days = Number(document.getElementById('userGrantDays').value) || 30;
  const res = await api(`/api/admin/users/${userEditorId}/grant`, {
    method: 'POST', body: JSON.stringify({ plan_type: plan, days }),
  });
  if (!res.ok) { userGrantMessage(errorText(res.data, 'Could not give access.'), false); return; }
  userGrantMessage(res.data.message || 'Access granted.', true);
  loadAdminUsers(document.getElementById('adminUserSearch')?.value.trim() || '');
});

document.getElementById('userEditorDelete')?.addEventListener('click', async () => {
  if (userEditorId === null) return;
  const label = document.getElementById('userEditorLabel').textContent || 'this account';
  if (!confirm(`Delete ${label} and every key it owns? This cannot be undone.`)) return;
  const res = await api(`/api/admin/users/${userEditorId}`, { method: 'DELETE' });
  if (!res.ok) { userEditorMessage(errorText(res.data, 'Could not delete the account.'), false); return; }
  document.getElementById('adminUserEditor').style.display = 'none';
  userEditorId = null;
  loadAdminUsers(document.getElementById('adminUserSearch')?.value.trim() || '');
});

['userEditorClose', 'userEditorCloseTop'].forEach(id => {
  document.getElementById(id)?.addEventListener('click', () => {
    document.getElementById('adminUserEditor').style.display = 'none';
    userEditorId = null;
  });
});

// Extra time on a single key, from the licence editor.
document.getElementById('licEditorExtend')?.addEventListener('click', async () => {
  if (licEditorId === null) return;
  const raw = document.getElementById('adminLicenseEditForm')?.elements.extend_days.value;
  const days = Number(raw);
  if (!days || days < 1) { licEditorMessage('Fill in a number of days first.', false); return; }
  const res = await api(`/api/admin/licenses/${licEditorId}/extend`, {
    method: 'POST', body: JSON.stringify({ days }),
  });
  if (!res.ok) { licEditorMessage(errorText(res.data, 'Could not add time.'), false); return; }
  licEditorMessage(res.data.message || 'Time added.', true);
  if (res.data.license) openLicenseEditor(res.data.license);
  loadAdminOrders(document.getElementById('adminSearch')?.value.trim() || '');
});

// Extra time for every key at once.
document.getElementById('bulkExtendBtn')?.addEventListener('click', async () => {
  const days = Number(document.getElementById('bulkExtendDays').value);
  const plan = document.getElementById('bulkExtendPlan').value;
  const msg = document.getElementById('bulkExtendMsg');
  if (!days || days < 1) {
    if (msg) { msg.textContent = 'Fill in a number of days first.'; msg.style.display = 'block'; msg.style.color = 'var(--danger, #f87171)'; }
    return;
  }
  if (!confirm(`Add ${days} day(s) to every active ${plan || ''} key?`.replace('  ', ' '))) return;
  const res = await api('/api/admin/extend-licenses', {
    method: 'POST', body: JSON.stringify({ days, plan_type: plan || null }),
  });
  if (msg) {
    msg.textContent = res.ok ? (res.data.message || 'Time added.') : errorText(res.data, 'Could not extend the keys.');
    msg.style.display = 'block';
    msg.style.color = res.ok ? 'var(--ok, #4ade80)' : 'var(--danger, #f87171)';
  }
  if (res.ok) loadAdminOrders(document.getElementById('adminSearch')?.value.trim() || '');
});

// ============================================================
// Admin: discount codes (Stripe coupons + promotion codes)
// ============================================================
function showAddDiscountForm() {
  const box = document.getElementById('addDiscountContainer');
  if (!box) return;
  box.style.display = box.style.display === 'none' ? 'block' : 'none';
}

async function loadDiscounts() {
  const wrap = document.getElementById('adminDiscounts');
  if (!wrap) return;
  try {
    const res = await api('/api/admin/discounts');
    if (!res.ok) {
      wrap.innerHTML = `<p class="no-license-text">${escapeHtml(errorText(res.data, 'Could not load discount codes.'))}</p>`;
      return;
    }
    const rows = res.data.discounts || [];
    if (!rows.length) {
      wrap.innerHTML = '<p class="no-license-text">No discount codes yet — create one with “+ New code”.</p>';
      return;
    }
    wrap.innerHTML = `<table class="admin-table"><thead><tr><th>Code</th><th>Discount</th><th>Used</th><th>Expires</th><th>Status</th><th></th></tr></thead><tbody>` +
      rows.map(d => {
        const off = d.percent_off ? `${d.percent_off}% off` : (d.amount_off != null ? `€${Number(d.amount_off).toFixed(2)} off` : '—');
        const used = `${d.uses || 0}${d.max_uses ? ' / ' + d.max_uses : ''}`;
        return `<tr><td><code>${escapeHtml(d.code)}</code></td><td>${escapeHtml(off)}</td><td>${escapeHtml(used)}</td><td>${d.expires_at ? fmtDate(d.expires_at) : 'never'}</td><td>${d.active ? '<span class="status-badge status-active">active</span>' : '<span class="status-badge status-none">paused</span>'}</td><td><button class="btn-ghost" type="button" data-promo="${escapeHtml(d.id)}" data-active="${d.active ? '1' : '0'}">${d.active ? 'Pause' : 'Resume'}</button></td></tr>`;
      }).join('') + `</tbody></table>`;
    wrap.querySelectorAll('[data-promo]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const active = btn.dataset.active !== '1';
        const res = await api(`/api/admin/discounts/${btn.dataset.promo}`, { method: 'POST', body: JSON.stringify({ active }) });
        if (!res.ok) { alert(errorText(res.data, 'Could not update the code.')); return; }
        loadDiscounts();
      });
    });
  } catch (_) {
    wrap.innerHTML = '<p class="no-license-text">Could not load discount codes.</p>';
  }
}

document.getElementById('adminCreateDiscountForm')?.addEventListener('submit', async function (e) {
  e.preventDefault();
  const f = e.target.elements;
  const msg = document.getElementById('adminCreateDiscountMsg');
  const body = {
    code: f.code.value.trim().toUpperCase(),
    kind: f.kind.value,
    value: Number(f.value.value),
    max_uses: Number(f.max_uses.value || 0),
    expires_at: f.expires_at.value.trim(),
  };
  if (msg) { msg.style.display = 'block'; msg.textContent = 'Creating…'; msg.style.color = 'inherit'; }
  const res = await api('/api/admin/discounts', { method: 'POST', body: JSON.stringify(body) });
  if (!res.ok) {
    if (msg) { msg.textContent = errorText(res.data, 'Could not create the code.'); msg.style.color = 'var(--danger, #f87171)'; }
    return;
  }
  if (msg) { msg.textContent = `Code ${res.data.code} is live on the checkout page.`; msg.style.color = 'var(--ok, #4ade80)'; }
  e.target.reset();
  loadDiscounts();
});

async function loadAdminReferrals() {
  const wrap = document.getElementById('adminReferrals');
  if (!wrap) return;
  try {
    const res = await api('/api/admin/referrals');
    if (!res.ok) throw new Error('refs');
    const refs = res.data.referrals || [];
    wrap.innerHTML = refs.length
      ? `<table class="admin-table"><thead><tr><th>Owner</th><th>Code</th><th>Earned</th><th>Paid</th></tr></thead><tbody>` +
        refs.map(r => `<tr><td>${escapeHtml(r.owner_email)}</td><td><code>${escapeHtml(r.code)}</code></td><td>€${((r.earnings_cents || 0) / 100).toFixed(2)}</td><td>€${((r.paid_cents || 0) / 100).toFixed(2)}</td></tr>`).join('') +
        `</tbody></table>`
      : '<p class="no-license-text">No referrals yet.</p>';
  } catch (_) {
    wrap.innerHTML = '<p class="no-license-text">Could not load referrals.</p>';
  }
}

async function loadAdminFinds() {
  const wrap = document.getElementById('adminFinds');
  if (!wrap) return;
  try {
    const res = await api('/api/admin/base-finds?status=pending');
    if (!res.ok) throw new Error('finds');
    const rows = res.data.finds || [];
    if (!rows.length) { wrap.innerHTML = '<p class="no-license-text">Nothing waiting for approval.</p>'; return; }
    wrap.innerHTML = rows.map(f => `
      <div class="admin-feature">
        <h2>${escapeHtml(f.title)} <small style="color:var(--muted)">by ${escapeHtml(f.username)}</small></h2>
        <p class="no-license-text">${escapeHtml(f.description)}</p>
        ${f.image_url ? `<img src="${escapeAttr(f.image_url)}" alt="" style="max-width:100%;border-radius:8px;margin:10px 0">` : ''}
        <div style="display:flex;gap:10px">
          <button class="btn-primary" data-find="${f.id}" data-status="approved" type="button">Approve</button>
          <button class="btn-ghost" data-find="${f.id}" data-status="rejected" type="button">Reject</button>
        </div>
      </div>`).join('');
    wrap.querySelectorAll('button[data-find]').forEach(btn => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        const res = await api(`/api/admin/base-finds/${btn.dataset.find}`, { method: 'POST', body: JSON.stringify({ status: btn.dataset.status }) });
        if (res.ok) loadAdminFinds();
        else { alert(errorText(res.data, 'Could not update.')); btn.disabled = false; }
      });
    });
  } catch (_) {
    wrap.innerHTML = '<p class="no-license-text">Could not load finds.</p>';
  }
}

document.getElementById('adminLogout')?.addEventListener('click', async () => {
  await api('/api/admin/logout', { method:'POST' });
  window.location.reload();
});

// Admin: Settings Form
async function loadAdminSettings() {
  const form = document.getElementById('adminSettingsForm');
  if (!form) return;
  try {
    const res = await api('/api/settings');
    if (res.ok && res.data.settings) {
      const s = res.data.settings;
      if (document.getElementById('settingAnnouncementText')) document.getElementById('settingAnnouncementText').value = s.announcement_text || '';
      if (document.getElementById('settingAnnouncementEnabled')) document.getElementById('settingAnnouncementEnabled').checked = s.announcement_enabled === 'true';
      if (document.getElementById('settingDiscordLink')) document.getElementById('settingDiscordLink').value = s.discord_link || '';
      if (document.getElementById('settingYoutubeUrl')) document.getElementById('settingYoutubeUrl').value = s.youtube_video_url || '';
      if (document.getElementById('settingHeroTagline')) document.getElementById('settingHeroTagline').value = s.hero_tagline || '';
      SITE_TEXT_KEYS.forEach(key => {
        const input = document.getElementById(`setting${key.replace(/(^|_)([a-z])/g, (_, __, c) => c.toUpperCase())}`);
        if (!input) return;
        input.value = typeof s[key] === 'string' ? s[key] : '';
      });
      renderAdminDashboardIcons(s.dashboard_icons);
    }
  } catch (_) {}

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const btn = form.querySelector('button[type="submit"]');
    const msg = document.getElementById('settingsSaveMsg');
    btn.disabled = true;
    msg.style.display = 'none';

    const payload = {
      announcement_text: document.getElementById('settingAnnouncementText').value,
      announcement_enabled: document.getElementById('settingAnnouncementEnabled').checked,
      discord_link: document.getElementById('settingDiscordLink').value,
      youtube_video_url: document.getElementById('settingYoutubeUrl').value,
      hero_tagline: document.getElementById('settingHeroTagline').value,
    };
    SITE_TEXT_KEYS.forEach(key => {
      const input = document.getElementById(`setting${key.replace(/(^|_)([a-z])/g, (_, __, c) => c.toUpperCase())}`);
      if (input) payload[key] = input.value;
    });
    const iconPayload = {};
    document.querySelectorAll('#adminDashboardIcons select[data-icon-section]').forEach(sel => {
      iconPayload[sel.dataset.iconSection] = sel.value;
    });
    payload.dashboard_icons = JSON.stringify(iconPayload);

    const res = await api('/api/admin/settings', { method: 'POST', body: JSON.stringify(payload) });
    msg.style.display = 'block';
    msg.style.color = res.ok ? '#4ade80' : '#ff6b6b';
    msg.textContent = res.ok ? 'Settings saved successfully!' : errorText(res.data, 'Could not save settings.');
    btn.disabled = false;
  });
}

function renderAdminDashboardIcons(raw) {
  const wrap = document.getElementById('adminDashboardIcons');
  if (!wrap) return;
  const icons = parseDashboardIcons(raw);
  wrap.innerHTML = DASH_ICON_SECTIONS.map(([section, label]) => {
    const current = icons[section] || 'grid';
    const options = DASH_ICON_CHOICES.map(name =>
      `<option value="${name}"${name === current ? ' selected' : ''}>${name}</option>`).join('');
    return `<label>${label}<select data-icon-section="${section}">${options}</select></label>`;
  }).join('');
}

// ============================================================
// Admin: changelog
// ============================================================
function showAddChangelogForm() {
  const container = document.getElementById('addChangelogContainer');
  if (container) container.style.display = 'block';
}

async function loadAdminChangelog() {
  const wrap = document.getElementById('adminChangelogList');
  if (!wrap) return;
  let res;
  try {
    res = await api('/api/admin/changelog');
  } catch (_) {
    wrap.innerHTML = '<p class="no-license-text">Could not load the changelog.</p>';
    return;
  }
  if (!res.ok) {
    wrap.innerHTML = `<p class="no-license-text">${escapeHtml(errorText(res.data, 'Could not load the changelog.'))}</p>`;
    return;
  }
  const entries = res.data.entries || [];
  if (!entries.length) {
    wrap.innerHTML = '<p class="no-license-text">No releases yet. Add the first one above.</p>';
    return;
  }
  wrap.innerHTML = entries.map(entry => `
    <div class="admin-feature">
      <form class="admin-editor changelog-edit-form" data-id="${entry.id}">
        <div class="admin-grid-2">
          <label>Version<input name="version" value="${escapeAttr(entry.version)}" required maxlength="40"></label>
          <label>Release date<input type="date" name="released_at" value="${escapeAttr(entry.released_at || '')}"></label>
        </div>
        <label>Title<input name="title" value="${escapeAttr(entry.title)}" required maxlength="160"></label>
        <label>Changes<textarea name="body" rows="6">${escapeHtml(entry.body || '')}</textarea></label>
        <label style="display:flex; align-items:center; gap:10px; cursor:pointer;"><input type="checkbox" name="published" style="width:auto; margin:0;"${entry.published ? ' checked' : ''}><span>Published on the public changelog</span></label>
        <div style="display:flex; gap:10px; flex-wrap:wrap">
          <button class="btn-primary" type="submit">Save release</button>
          <button class="btn-ghost" type="button" data-delete-entry="${entry.id}">Delete</button>
        </div>
        <p class="save-message" style="display:none"></p>
      </form>
    </div>
  `).join('');

  wrap.querySelectorAll('.changelog-edit-form').forEach(form => {
    form.addEventListener('submit', async event => {
      event.preventDefault();
      const button = form.querySelector('button[type="submit"]');
      const msg = form.querySelector('.save-message');
      button.disabled = true;
      const payload = {
        version: form.elements.version.value,
        title: form.elements.title.value,
        released_at: form.elements.released_at.value || null,
        body: form.elements.body.value,
        published: form.elements.published.checked,
      };
      const saved = await api(`/api/admin/changelog/${form.dataset.id}`, { method: 'PUT', body: JSON.stringify(payload) });
      msg.style.display = 'block';
      msg.style.color = saved.ok ? '#4ade80' : '#ff6b6b';
      msg.textContent = saved.ok ? 'Saved.' : errorText(saved.data, 'Could not save.');
      button.disabled = false;
    });
  });

  wrap.querySelectorAll('[data-delete-entry]').forEach(button => {
    button.addEventListener('click', async () => {
      if (!confirm('Delete this changelog entry?')) return;
      const res = await api(`/api/admin/changelog/${button.dataset.deleteEntry}`, { method: 'DELETE' });
      if (res.ok) loadAdminChangelog();
      else alert(errorText(res.data, 'Could not delete the entry.'));
    });
  });
}

const createChangelogForm = document.getElementById('createChangelogForm');
if (createChangelogForm) {
  createChangelogForm.addEventListener('submit', async event => {
    event.preventDefault();
    const button = createChangelogForm.querySelector('button[type="submit"]');
    button.disabled = true;
    const payload = {
      version: createChangelogForm.elements.version.value,
      title: createChangelogForm.elements.title.value,
      released_at: createChangelogForm.elements.released_at.value || null,
      body: createChangelogForm.elements.body.value,
      published: createChangelogForm.elements.published.checked,
    };
    const res = await api('/api/admin/changelog', { method: 'POST', body: JSON.stringify(payload) });
    showMessage('createChangelogMsg', res.ok ? 'Release added.' : errorText(res.data, 'Could not add the release.'), !res.ok);
    if (res.ok) {
      createChangelogForm.reset();
      loadAdminChangelog();
    }
    button.disabled = false;
  });
}

// ============================================================
// Admin: features (module catalogue + screenshots and clips)
// ============================================================
const ADMIN_FEATURE_CATEGORIES = (window.CHAMP_FEATURES && window.CHAMP_FEATURES.categories) || [];
let adminFeatureCategory = ADMIN_FEATURE_CATEGORIES[0] ? ADMIN_FEATURE_CATEGORIES[0].id : 'all';

function showAddFeatureForm() {
  const container = document.getElementById('addFeatureContainer');
  if (container) container.style.display = 'block';
}

// Reads a picked file and uploads it to the public site-media bucket.
async function uploadSiteImage(kind, file) {
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('read'));
    reader.readAsDataURL(file);
  });
  const res = await api('/api/admin/media/image', {
    method: 'POST',
    body: JSON.stringify({ kind, filename: file.name, image_base64: dataUrl }),
  });
  if (!res.ok) throw new Error(errorText(res.data, 'Could not upload the image.'));
  return res.data.url;
}

function adminFeatureBadge(module) {
  const badges = [];
  if (module.image_url) badges.push('image');
  if (module.video_url) badges.push('video');
  if (module.isCustom) badges.push('custom');
  return badges.map(badge => `<span class="admin-module-badge">${badge}</span>`).join('');
}

function adminFeatureForm(module) {
  const category = ADMIN_FEATURE_CATEGORIES.find(entry => entry.id === module.category);
  return `
    <details class="admin-feature admin-module">
      <summary>
        <span class="admin-module-icon" aria-hidden="true">${escapeHtml(category ? category.icon : '✦')}</span>
        <span class="admin-module-name">${escapeHtml(module.title)}</span>
        ${adminFeatureBadge(module)}
      </summary>
      <form class="admin-editor admin-feature-form" data-slug="${escapeAttr(module.slug)}"
        data-title="${escapeAttr(module.title)}" data-category="${escapeAttr(module.category)}"
        data-custom="${module.isCustom ? '1' : '0'}">
        ${module.isCustom ? `<label>Title<input name="title" value="${escapeAttr(module.title)}" required maxlength="150"></label>` : ''}
        <label>Description<textarea name="description" rows="3">${escapeHtml(module.description)}</textarea></label>
        <div class="admin-media-block">
          <div class="admin-media-preview" data-preview>
            ${module.image_url
              ? `<img src="${escapeAttr(module.image_url)}" alt="${escapeAttr(module.title)} preview">`
              : '<span class="no-license-text">No screenshot yet</span>'}
          </div>
          <div class="admin-media-fields">
            <label>Upload screenshot (PNG, JPG, WEBP or GIF, max 3 MB)
              <input type="file" name="image_file" accept="image/png,image/jpeg,image/webp,image/gif">
            </label>
            <label>or paste an image URL<input name="image_url" value="${escapeAttr(module.image_url || '')}" placeholder="https://..."></label>
          </div>
        </div>
        <label>Video (YouTube embed URL or a direct .mp4 link)<input name="video_url" value="${escapeAttr(module.video_url || '')}" placeholder="https://www.youtube.com/embed/VIDEO_ID"></label>
        <label>Sort order<input type="number" name="sort_order" value="${Number(module.sort_order) || 0}"></label>
        <div class="admin-feature-actions">
          <button class="btn-primary" type="submit">Save</button>
          <button class="btn-ghost" type="button" data-clear-image>Remove image</button>
          <button class="btn-ghost" type="button" data-reset-feature>${module.isCustom ? 'Delete feature' : 'Reset to default'}</button>
        </div>
        <p class="save-message" style="display:none"></p>
      </form>
    </details>
  `;
}

async function loadAdminFeatures() {
  const wrap = document.getElementById('adminFeatures');
  if (!wrap) return;

  let rows = [];
  try {
    const result = await api('/api/admin/features');
    if (!result.ok) {
      wrap.innerHTML = `<p class="no-license-text">${escapeHtml(errorText(result.data, 'Could not load features.'))}</p>`;
      return;
    }
    rows = result.data.features || [];
  } catch (_) {
    wrap.innerHTML = '<p class="no-license-text">Could not load features.</p>';
    return;
  }

  const bySlug = new Map(rows.filter(row => row && row.slug).map(row => [row.slug, row]));
  const catalogSlugs = new Set(FEATURE_CATALOG.modules.map(module => module.slug));

  const modules = FEATURE_CATALOG.modules.map(module => {
    const saved = bySlug.get(module.slug) || {};
    return {
      ...module,
      description: (saved.description || '').trim() || module.description,
      image_url: saved.image_url || '',
      video_url: saved.video_url || '',
      sort_order: Number(saved.sort_order) || 0,
      isCustom: false
    };
  });

  // Features an admin added on top of the catalogue.
  for (const row of rows) {
    if (!row.slug || catalogSlugs.has(row.slug)) continue;
    modules.push({
      slug: row.slug,
      category: row.category || '',
      title: row.title || row.slug,
      description: row.description || '',
      image_url: row.image_url || '',
      video_url: row.video_url || '',
      sort_order: Number(row.sort_order) || 0,
      isCustom: true
    });
  }

  function renderAdminFeatures() {
    const chips = [{ id: 'all', label: 'All', icon: '✦' }, ...ADMIN_FEATURE_CATEGORIES];
    const visible = adminFeatureCategory === 'all'
      ? modules
      : modules.filter(module => module.category === adminFeatureCategory);
    const count = id => id === 'all' ? modules.length : modules.filter(module => module.category === id).length;

    wrap.innerHTML = `
      <div class="feature-filters admin-feature-filters">
        ${chips.map(chip => `
          <button class="feature-filter${chip.id === adminFeatureCategory ? ' active' : ''}" type="button"
            data-admin-category="${escapeAttr(chip.id)}">
            <span class="feature-filter-icon" aria-hidden="true">${escapeHtml(chip.icon || '✦')}</span>
            <span>${escapeHtml(chip.label)}</span>
            <span class="feature-filter-count">${count(chip.id)}</span>
          </button>
        `).join('')}
      </div>
      ${visible.length ? visible.map(adminFeatureForm).join('') : '<p class="no-license-text">No modules in this category.</p>'}
    `;

    wrap.querySelectorAll('[data-admin-category]').forEach(button => {
      button.addEventListener('click', () => {
        adminFeatureCategory = button.dataset.adminCategory;
        renderAdminFeatures();
      });
    });

    wrap.querySelectorAll('.admin-feature-form').forEach(bindAdminFeatureForm);
  }

  renderAdminFeatures();
}

function bindAdminFeatureForm(form) {
  const msg = form.querySelector('.save-message');
  const preview = form.querySelector('[data-preview]');
  const imageInput = form.querySelector('input[name="image_url"]');

  function setMessage(text, ok) {
    msg.style.display = 'block';
    msg.style.color = ok ? '#4ade80' : '#ff6b6b';
    msg.textContent = text;
  }

  function setPreview(url) {
    preview.innerHTML = url
      ? `<img src="${escapeAttr(url)}" alt="Feature preview">`
      : '<span class="no-license-text">No screenshot yet</span>';
  }

  form.querySelector('input[name="image_file"]')?.addEventListener('change', async event => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 3 * 1024 * 1024) return setMessage('The image must be 3 MB or smaller.', false);
    setMessage('Uploading image…', true);
    try {
      const url = await uploadSiteImage('feature', file);
      imageInput.value = url;
      setPreview(url);
      setMessage('Image uploaded. Press Save to keep it on this module.', true);
    } catch (err) {
      setMessage(String(err.message || 'Could not upload the image.'), false);
    }
  });

  form.querySelector('[data-clear-image]')?.addEventListener('click', () => {
    imageInput.value = '';
    setPreview('');
    setMessage('Image removed. Press Save to apply it.', true);
  });

  form.querySelector('[data-reset-feature]')?.addEventListener('click', async () => {
    const custom = form.dataset.custom === '1';
    const question = custom
      ? 'Delete this feature? It disappears from the public page.'
      : 'Reset this module to its default text and remove its screenshot and video?';
    if (!confirm(question)) return;
    const res = await api(`/api/admin/features/${encodeURIComponent(form.dataset.slug)}`, { method: 'DELETE' });
    if (res.ok) loadAdminFeatures();
    else alert(errorText(res.data, 'Could not reset the feature.'));
  });

  form.addEventListener('submit', async event => {
    event.preventDefault();
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    setMessage('Saving…', true);

    const titleInput = form.querySelector('input[name="title"]');
    const payload = {
      title: titleInput ? titleInput.value.trim() : form.dataset.title,
      description: form.querySelector('textarea[name="description"]').value,
      image_url: imageInput.value.trim(),
      video_url: form.querySelector('input[name="video_url"]').value.trim(),
      category: form.dataset.category,
      sort_order: Number(form.querySelector('input[name="sort_order"]').value) || 0,
    };

    const res = await api(`/api/admin/features/${encodeURIComponent(form.dataset.slug)}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
    setMessage(res.ok ? 'Saved.' : errorText(res.data, 'Could not save.'), res.ok);
    if (res.ok) loadAdminFeatures();
    button.disabled = false;
  });
}

const createFeatureForm = document.getElementById('createFeatureForm');
if (createFeatureForm) {
  createFeatureForm.addEventListener('submit', async event => {
    event.preventDefault();
    const button = createFeatureForm.querySelector('button[type="submit"]');
    button.disabled = true;
    const payload = Object.fromEntries(new FormData(createFeatureForm).entries());
    payload.sort_order = Number(payload.sort_order) || 0;
    const imageFile = createFeatureForm.elements['image_file']?.files?.[0];
    delete payload.image_file;
    if (imageFile) {
      try {
        payload.image_url = await uploadSiteImage('feature', imageFile);
      } catch (err) {
        showMessage('createFeatureMsg', String(err.message || 'Could not upload the image.'), true);
        button.disabled = false;
        return;
      }
    }
    const res = await api('/api/admin/features', { method: 'POST', body: JSON.stringify(payload) });
    showMessage('createFeatureMsg', res.ok ? 'Feature added.' : errorText(res.data, 'Could not add the feature.'), !res.ok);
    if (res.ok) {
      createFeatureForm.reset();
      loadAdminFeatures();
    }
    button.disabled = false;
  });
}

// Admin: Texture Packs
function showAddTexturePackForm() {
  const c = document.getElementById('addTexturePackContainer');
  if (c) c.style.display = 'block';
}

async function loadAdminTexturePacks() {
  const list = document.getElementById('adminTexturePacksList');
  if (!list) return;
  try {
    const res = await api('/api/admin/texture-packs');
    if (!res.ok) throw new Error('packs');
    const packs = res.data.packs || [];
    if (!packs.length) {
      list.innerHTML = '<p class="no-license-text">No texture packs added yet.</p>';
      return;
    }
    list.innerHTML = `<table class="admin-table"><thead><tr><th>Name</th><th>Category</th><th>Access</th><th>URL</th><th></th></tr></thead><tbody>` +
      packs.map(p => `
        <tr>
          <td><b>${escapeHtml(p.name)}</b></td>
          <td>${escapeHtml(p.category)}</td>
          <td>${p.is_customer_only ? '<span class="badge-vip">VIP Customers</span>' : '<span style="color:#4ade80">Public Free</span>'}</td>
          <td>${p.download_url ? `<a href="${escapeAttr(p.download_url)}" target="_blank" style="color:#38bdf8">Link</a>` : '<span style="color:#a78bfa">Hosted file</span>'}</td>
          <td><button class="btn-ghost" onclick="deleteAdminTexturePack(${p.id})" style="padding:4px 8px;font-size:12px;">Delete</button></td>
        </tr>
      `).join('') + `</tbody></table>`;
  } catch (_) {
    list.innerHTML = '<p class="no-license-text">Could not load texture packs.</p>';
  }
}

async function deleteAdminTexturePack(id) {
  if (!confirm('Are you sure you want to delete this texture pack?')) return;
  const res = await api(`/api/admin/texture-packs/${id}`, { method: 'DELETE' });
  if (res.ok) loadAdminTexturePacks();
  else alert(errorText(res.data, 'Could not delete texture pack.'));
}

document.getElementById('createTexturePackForm')?.addEventListener('submit', async function(e) {
  e.preventDefault();
  const btn = this.querySelector('button[type="submit"]');
  const msg = document.getElementById('createPackMsg');
  const file = this.elements['pack_file']?.files?.[0];
  const url = this.elements['download_url'].value.trim();
  btn.disabled = true;
  msg.style.display = 'none';

  const fail = (text) => {
    msg.style.display = 'block';
    msg.style.color = '#ff6b6b';
    msg.textContent = text;
    btn.disabled = false;
  };

  const data = {
    name: this.elements['name'].value.trim(),
    description: this.elements['description'].value.trim(),
    category: this.elements['category'].value.trim() || 'PvP',
    is_customer_only: this.elements['is_customer_only'].checked,
    image_url: this.elements['image_url'].value.trim(),
    sort_order: parseInt(this.elements['sort_order'].value || '1', 10),
  };

  const previewFile = this.elements['preview_image']?.files?.[0];
  if (previewFile) {
    if (previewFile.size > 3 * 1024 * 1024) return fail('The preview image must be 3 MB or smaller.');
    try {
      data.image_url = await uploadSiteImage('texture-pack', previewFile);
    } catch (err) {
      return fail(String(err.message || 'Could not upload the preview image.'));
    }
  }

  let res;
  if (file) {
    if (!/\.zip$/i.test(file.name)) return fail('Choose a .zip texture pack.');
    if (file.size > 32 * 1024 * 1024) return fail('The ZIP must be 32 MB or smaller.');
    let base64;
    try {
      base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || '').split(',', 2)[1] || '');
        reader.onerror = () => reject(new Error('read'));
        reader.readAsDataURL(file);
      });
    } catch (_) {
      return fail('Could not read that file. Please try again.');
    }
    if (!base64) return fail('Could not read that file. Please try again.');
    res = await api('/api/admin/texture-packs/upload', {
      method: 'POST',
      body: JSON.stringify({ ...data, filename: file.name, file_base64: base64 }),
    });
  } else {
    if (!url.startsWith('https://')) return fail('Enter an HTTPS download URL or choose a ZIP to upload.');
    res = await api('/api/admin/texture-packs', {
      method: 'POST',
      body: JSON.stringify({ ...data, download_url: url }),
    });
  }

  msg.style.display = 'block';
  msg.style.color = res.ok ? '#4ade80' : '#ff6b6b';
  msg.textContent = res.ok
    ? (file ? 'Texture pack uploaded!' : 'Texture pack created!')
    : errorText(res.data, 'Could not create pack.');
  if (res.ok) {
    this.reset();
    loadAdminTexturePacks();
    setTimeout(() => { document.getElementById('addTexturePackContainer').style.display = 'none'; }, 800);
  }
  btn.disabled = false;
});

// Live preview for a picked texture pack image.
document.getElementById('packPreviewImage')?.addEventListener('change', event => {
  const file = event.target.files?.[0];
  const preview = document.getElementById('packPreviewPreview');
  if (!preview) return;
  if (!file) {
    preview.innerHTML = '<span class="no-license-text">No preview yet</span>';
    return;
  }
  const img = document.createElement('img');
  img.alt = 'Texture pack preview';
  img.src = URL.createObjectURL(file);
  preview.replaceChildren(img);
});

// Admin: Reviews
function showAddReviewForm() {
  const c = document.getElementById('addReviewContainer');
  if (c) c.style.display = 'block';
}

async function loadAdminReviews() {
  const list = document.getElementById('adminReviewsList');
  if (!list) return;
  try {
    const res = await api('/api/admin/reviews');
    if (!res.ok) throw new Error('reviews');
    const reviews = res.data.reviews || [];
    if (!reviews.length) {
      list.innerHTML = '<p class="no-license-text">No reviews found.</p>';
      return;
    }
    list.innerHTML = `<table class="admin-table"><thead><tr><th>Author</th><th>Rating</th><th>Text</th><th>Tag</th><th></th></tr></thead><tbody>` +
      reviews.map(r => `
        <tr>
          <td><b>${escapeHtml(r.author)}</b></td>
          <td>${r.rating} &starf;</td>
          <td>${escapeHtml(r.text)}</td>
          <td>${escapeHtml(r.tag)}</td>
          <td><button class="btn-ghost" onclick="deleteAdminReview(${r.id})" style="padding:4px 8px;font-size:12px;">Delete</button></td>
        </tr>
      `).join('') + `</tbody></table>`;
  } catch (_) {
    list.innerHTML = '<p class="no-license-text">Could not load reviews.</p>';
  }
}

function showAddAIKnowledgeForm() {
  const container = document.getElementById('addAIKnowledgeContainer');
  if (container) container.style.display = 'block';
}

async function loadAdminAIKnowledge() {
  const list = document.getElementById('adminAIKnowledgeList');
  if (!list) return;
  try {
    const res = await api('/api/admin/ai-knowledge');
    if (!res.ok) throw new Error('knowledge');
    const entries = res.data.knowledge || [];
    list.innerHTML = entries.length
      ? `<table class="admin-table"><thead><tr><th>Title</th><th>Verified facts</th><th>Updated</th><th></th></tr></thead><tbody>${entries.map(item => `<tr><td><b>${escapeHtml(item.title)}</b></td><td>${escapeHtml(item.body)}</td><td>${fmtDate(item.updated_at)}</td><td><button class="btn-ghost" type="button" onclick="deleteAdminAIKnowledge(${item.id})">Delete</button></td></tr>`).join('')}</tbody></table>`
      : '<p class="no-license-text">No custom knowledge entries.</p>';
  } catch (_) {
    list.innerHTML = '<p class="no-license-text">Could not load AI knowledge. Apply the latest Supabase schema first.</p>';
  }
}

async function deleteAdminAIKnowledge(id) {
  if (!confirm('Delete this AI knowledge entry?')) return;
  const res = await api(`/api/admin/ai-knowledge/${id}`, { method: 'DELETE' });
  if (res.ok) loadAdminAIKnowledge();
  else alert(errorText(res.data, 'Could not delete knowledge.'));
}

document.getElementById('createAIKnowledgeForm')?.addEventListener('submit', async function(e) {
  e.preventDefault();
  const btn = this.querySelector('button[type="submit"]');
  const msg = document.getElementById('createAIKnowledgeMsg');
  btn.disabled = true;
  const res = await api('/api/admin/ai-knowledge', { method: 'POST', body: JSON.stringify({ title: this.elements.title.value, body: this.elements.body.value }) });
  msg.style.display = 'block';
  msg.style.color = res.ok ? '#4ade80' : '#ff6b6b';
  msg.textContent = res.ok ? 'Knowledge saved.' : errorText(res.data, 'Could not save knowledge.');
  if (res.ok) {
    this.reset();
    loadAdminAIKnowledge();
    setTimeout(() => { document.getElementById('addAIKnowledgeContainer').style.display = 'none'; }, 800);
  }
  btn.disabled = false;
});

async function deleteAdminReview(id) {
  if (!confirm('Are you sure you want to delete this review?')) return;
  const res = await api(`/api/admin/reviews/${id}`, { method: 'DELETE' });
  if (res.ok) loadAdminReviews();
  else alert(errorText(res.data, 'Could not delete review.'));
}

document.getElementById('createReviewForm')?.addEventListener('submit', async function(e) {
  e.preventDefault();
  const btn = this.querySelector('button[type="submit"]');
  const msg = document.getElementById('createReviewMsg');
  btn.disabled = true;

  const data = {
    author: this.elements['author'].value,
    rating: parseInt(this.elements['rating'].value || '5', 10),
    text: this.elements['text'].value,
    tag: this.elements['tag'].value,
    status: 'approved',
    sort_order: 1,
  };

  const res = await api('/api/admin/reviews', { method: 'POST', body: JSON.stringify(data) });
  msg.style.display = 'block';
  msg.style.color = res.ok ? '#4ade80' : '#ff6b6b';
  msg.textContent = res.ok ? 'Review created!' : errorText(res.data, 'Could not create review.');
  if (res.ok) {
    this.reset();
    loadAdminReviews();
    setTimeout(() => { document.getElementById('addReviewContainer').style.display = 'none'; }, 800);
  }
  btn.disabled = false;
});

loadFeaturesPage();
loadChangelogPage();
loadFindsPage();
loadPublicData();
