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
        }),
      });
      if (ok) {
        window.location.href = `verify.html?email=${encodeURIComponent(email)}&plan=${encodeURIComponent(selectedPlan)}`;
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
const loginForm = document.getElementById('loginForm');
if (loginForm) {
  const params = new URLSearchParams(window.location.search);
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
        window.location.href = safeNext(params.get('next'));
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
      : `Sign in (or create an account) with ${link.email} to continue. Verify your email first if you just signed up.`;
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
function fmtDate(iso) {
  return iso ? new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '';
}

function renderLicense(kind, lic) {
  const badge = document.getElementById(`badge-${kind}`);
  const content = document.getElementById(`content-${kind}`);
  if (!lic) return;

  const label = ({monthly:'Monthly', lifetime:'Lifetime'})[kind] || kind;
  if (!lic.active) {
    badge.innerText = 'Expired';
    badge.className = 'status-badge status-none';
    content.innerHTML = `
      <p class="no-license-text">Your ${label.toLowerCase()} license is no longer active.</p>
      <a href="index.html#pricing" class="btn-purchase-direct">Renew ${label}</a>`;
    return;
  }

  badge.innerText = 'Active';
  badge.className = 'status-badge status-active';
  let html = `<div class="license-box">${lic.key}</div>`;
  if (kind === 'monthly' && lic.expires_at) {
    html += `<p class="no-license-text" style="margin-bottom:12px">Renews / ends around ${fmtDate(lic.expires_at)}</p>`;
  }
  html += `<a href="/api/download/${kind}" class="btn-download">Download ${label} (.JAR)</a>`;
  if (lic.can_manage) {
    html += `<button id="manageBtn" class="btn-ghost" style="margin-top:12px;width:100%">Manage subscription</button>`;
  }
  content.innerHTML = html;

  document.getElementById('manageBtn')?.addEventListener('click', async function () {
    this.disabled = true;
    const res = await api('/api/billing-portal', { method: 'POST' });
    if (res.ok && res.data.url) window.location.href = res.data.url;
    else { alert(errorText(res.data, 'Could not open the billing portal.')); this.disabled = false; }
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  const dashUsername = document.getElementById('dash-username');
  if (!dashUsername) return;

  document.getElementById('logoutBtn')?.addEventListener('click', async () => {
    await api('/api/auth/logout', { method: 'POST' });
    window.location.href = 'login.html';
  });

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
    const res = await api('/api/dashboard/user-data');
    if (!res.ok) {
      window.location.href = 'login.html?next=dashboard.html';
      return null;
    }
    const d = res.data;
    dashUsername.innerText = d.username;
    document.getElementById('dash-email').innerText = d.email;
    renderLicense('monthly', d.licenses.monthly);
    renderLicense('lifetime', d.licenses.lifetime);
    return d;
  }

  let data = await load();
  if (!data) return;

  initDashboardExtras(data);

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
async function loadFeaturesPage() {
  const grid = document.getElementById('featureGrid');
  if (!grid) return;
  try {
    const res = await api('/api/features');
    if (!res.ok) throw new Error('features');
    const features = res.data.features || [];
    if (!features.length) {
      grid.innerHTML = '<p class="no-license-text">No features published yet.</p>';
      return;
    }
    grid.innerHTML = features.map(feature => `
      <article class="feature-content-card">
        <h2>${escapeHtml(feature.title)}</h2>
        <p>${escapeHtml(feature.description)}</p>
        ${feature.video_url ? `<div class="feature-video"><iframe src="${escapeAttr(feature.video_url)}" title="${escapeAttr(feature.title)} video" loading="lazy" allowfullscreen></iframe></div>` : '<div class="feature-video" style="display:flex;align-items:center;justify-content:center;color:var(--muted)">Video coming soon</div>'}
      </article>
    `).join('');
  } catch (_) {
    grid.innerHTML = '<p class="no-license-text">Could not load features right now.</p>';
  }
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]));
}
function escapeAttr(value) { return escapeHtml(value); }

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
        }
      }
      if (s.discord_link) {
        document.querySelectorAll('a[href*="discord.gg"]').forEach(a => { a.href = s.discord_link; });
      }
      if (s.hero_tagline) {
        const eb = document.getElementById('heroEyebrow');
        if (eb) eb.textContent = s.hero_tagline;
      }
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

  // 2. Texture Packs
  const packGrid = document.getElementById('texturePacksGrid');
  if (packGrid) {
    try {
      const res = await api('/api/texture-packs');
      if (res.ok && res.data.packs) {
        const packs = res.data.packs;
        if (!packs.length) {
          packGrid.innerHTML = '<p class="no-license-text">No texture packs available right now.</p>';
        } else {
          packGrid.innerHTML = packs.map(p => `
            <div class="texture-card">
              ${p.image_url ? `<img src="${escapeAttr(p.image_url)}" class="texture-card-img" alt="${escapeAttr(p.name)}" loading="lazy">` : `<div class="texture-card-img" style="display:flex;align-items:center;justify-content:center;color:var(--muted);font-size:12px;">Texture Pack Preview</div>`}
              <div class="texture-card-body">
                <span class="texture-category">${escapeHtml(p.category || 'PvP')}</span>
                <h3 class="texture-title">${escapeHtml(p.name)}</h3>
                <p class="texture-desc">${escapeHtml(p.description)}</p>
                <div class="texture-card-footer">
                  ${p.is_customer_only ? '<span class="badge-vip">&#9733; VIP Customer Pack</span>' : ''}
                  ${p.is_locked ? 
                    `<a href="#pricing" class="btn-texture-locked">&ud83d;&udd12; Unlock with License</a>` : 
                    `<a href="${escapeAttr(p.download_url)}" target="_blank" rel="noopener" class="btn-texture-download">&darr; Download Pack (.zip)</a>`
                  }
                </div>
              </div>
            </div>
          `).join('');
        }
      }
    } catch (_) {
      packGrid.innerHTML = '<p class="no-license-text">Could not load texture packs.</p>';
    }
  }

  // 3. Reviews
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
    const res = await api('/api/ai/chat', { method: 'POST', body: JSON.stringify({ message: text }) });
    if (res.ok && res.data && res.data.reply) {
      botBubble.textContent = res.data.reply;
    } else {
      botBubble.textContent = errorText(res.data, 'Sorry, I could not answer that right now.');
    }
  } catch (_) {
    botBubble.textContent = 'Network error. Please try again.';
  }
  messages.scrollTop = messages.scrollHeight;
}

// ============================================================
// Base finds gallery (finds.html)
// ============================================================
async function loadFindsPage() {
  const grid = document.getElementById('findsGrid');
  if (!grid) return;
  try {
    const res = await api('/api/base-finds');
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
  const me = await api('/api/auth/me');
  if (me.ok) {
    document.getElementById('findAuthHint').style.display = 'none';
    form.style.display = 'grid';
  }
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
  const loginCard = document.getElementById('adminLoginCard');
  const logout = document.getElementById('adminLogout');
  if (!panel || !loginCard) return;

  const me = await api('/api/admin/me');
  if (!me.ok) return;

  loginCard.style.display = 'none';
  panel.style.display = 'block';
  if (logout) logout.style.display = 'inline-flex';

  document.querySelectorAll('.admin-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      document.querySelectorAll('.admin-tabpage').forEach(p => { p.style.display = 'none'; });
      document.getElementById(`tab-${tab.dataset.tab}`).style.display = 'block';
    });
  });

  try {
    const stats = await api('/api/admin/stats');
    if (stats.ok) document.getElementById('adminStatsLine').textContent =
      `Users: ${stats.data.users} • Licenses: ${stats.data.licenses_total} (${stats.data.licenses_active} active)`;
  } catch (_) { /* stats optional */ }

  loadAdminOrders('');
  loadAdminReferrals();
  loadAdminFinds();
  loadAdminSettings();
  loadAdminTexturePacks();
  loadAdminReviews();

  const result = await api('/api/admin/features');
  if (!result.ok) {
    showMessage('adminMessage', errorText(result.data, 'Could not load features.'), true);
    return;
  }

  const wrap = document.getElementById('adminFeatures');
  wrap.innerHTML = (result.data.features || []).map(feature => `
    <div class="admin-feature">
      <h2>${escapeHtml(feature.title)}</h2>
      <form class="admin-editor feature-edit-form" data-slug="${escapeAttr(feature.slug)}">
        <label>Title<input name="title" value="${escapeAttr(feature.title)}" required></label>
        <label>Description<textarea name="description" required>${escapeHtml(feature.description)}</textarea></label>
        <label>Video embed URL<input name="video_url" value="${escapeAttr(feature.video_url || '')}" placeholder="https://www.youtube.com/embed/..."></label>
        <button class="btn-primary" type="submit">Save ${escapeHtml(feature.title)}</button>
        <p class="save-message" style="display:none"></p>
      </form>
    </div>
  `).join('');

  wrap.querySelectorAll('.feature-edit-form').forEach(form => {
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const button = form.querySelector('button');
      const msg = form.querySelector('.save-message');
      button.disabled = true;
      const data = Object.fromEntries(new FormData(form).entries());
      const res = await api(`/api/admin/features/${encodeURIComponent(form.dataset.slug)}`, { method:'PUT', body:JSON.stringify(data) });
      msg.style.display = 'block';
      msg.style.color = res.ok ? '#4ade80' : '#ff6b6b';
      msg.textContent = res.ok ? 'Saved.' : errorText(res.data, 'Could not save.');
      button.disabled = false;
    });
  });
}

const adminLoginForm = document.getElementById('adminLoginForm');
if (adminLoginForm) {
  loadAdminPanel();
  adminLoginForm.addEventListener('submit', async e => {
    e.preventDefault();
    const button = adminLoginForm.querySelector('button');
    button.disabled = true;
    const res = await api('/api/admin/login', { method:'POST', body:JSON.stringify({
      username: document.getElementById('adminUsername').value,
      password: document.getElementById('adminPassword').value
    })});
    if (!res.ok) showMessage('adminMessage', errorText(res.data, 'Invalid admin credentials.'), true);
    else window.location.reload();
    button.disabled = false;
  });
}

async function loadAdminOrders(search) {
  const wrap = document.getElementById('adminOrders');
  if (!wrap) return;
  try {
    const res = await api(`/api/admin/licenses?search=${encodeURIComponent(search)}&limit=50`);
    if (!res.ok) throw new Error('orders');
    const rows = res.data.licenses || [];
    if (!rows.length) { wrap.innerHTML = '<p class="no-license-text">No orders found.</p>'; return; }
    wrap.innerHTML = `<table class="admin-table"><thead><tr><th>Email</th><th>Plan</th><th>Key</th><th>Status</th><th>Created</th><th></th></tr></thead><tbody>` +
      rows.map(r => `<tr><td>${escapeHtml(r.email)}</td><td>${escapeHtml(r.plan_type)}</td><td><code>${escapeHtml(r.license_key)}</code></td><td>${escapeHtml(r.status)}</td><td>${fmtDate(r.created_at)}</td><td><select data-lic="${r.id}" class="admin-status-select"><option value="">set…</option><option value="active">active</option><option value="inactive">inactive</option><option value="revoked">revoked</option></select></td></tr>`).join('') +
      `</tbody></table>`;
    wrap.querySelectorAll('.admin-status-select').forEach(sel => {
      sel.addEventListener('change', async () => {
        if (!sel.value) return;
        const res = await api(`/api/admin/licenses/${sel.dataset.lic}`, { method: 'POST', body: JSON.stringify({ status: sel.value }) });
        if (res.ok) loadAdminOrders(document.getElementById('adminSearch').value);
        else alert(errorText(res.data, 'Could not update.'));
      });
    });
  } catch (_) {
    wrap.innerHTML = '<p class="no-license-text">Could not load orders.</p>';
  }
}

document.getElementById('adminSearchForm')?.addEventListener('submit', function (e) {
  e.preventDefault();
  loadAdminOrders(document.getElementById('adminSearch').value.trim());
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

    const res = await api('/api/admin/settings', { method: 'POST', body: JSON.stringify(payload) });
    msg.style.display = 'block';
    msg.style.color = res.ok ? '#4ade80' : '#ff6b6b';
    msg.textContent = res.ok ? 'Settings saved successfully!' : errorText(res.data, 'Could not save settings.');
    btn.disabled = false;
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
          <td><a href="${escapeAttr(p.download_url)}" target="_blank" style="color:#38bdf8">Link</a></td>
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
  btn.disabled = true;

  const data = {
    name: this.elements['name'].value,
    description: this.elements['description'].value,
    download_url: this.elements['download_url'].value,
    category: this.elements['category'].value,
    is_customer_only: this.elements['is_customer_only'].checked,
    image_url: this.elements['image_url'].value,
    sort_order: parseInt(this.elements['sort_order'].value || '1', 10),
  };

  const res = await api('/api/admin/texture-packs', { method: 'POST', body: JSON.stringify(data) });
  msg.style.display = 'block';
  msg.style.color = res.ok ? '#4ade80' : '#ff6b6b';
  msg.textContent = res.ok ? 'Texture pack created!' : errorText(res.data, 'Could not create pack.');
  if (res.ok) {
    this.reset();
    loadAdminTexturePacks();
    setTimeout(() => { document.getElementById('addTexturePackContainer').style.display = 'none'; }, 800);
  }
  btn.disabled = false;
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
loadFindsPage();
loadPublicData();

