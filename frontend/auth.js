/**
 * PartsCommand CRM — JWT authentication layer.
 *
 * 1. Login gate: a full-screen, dark-glassmorphic sign-in screen is shown on
 *    app load whenever no JWT is stored. Submitting POSTs { email, password }
 *    to https://parts-command-api.techguruofficial.workers.dev/auth/login and,
 *    on success, stores the token as localStorage['partscommand_token'] along
 *    with the returned user object, then boots the app.
 * 2. Token handling: window.fetch is wrapped so every request to the
 *    PartsCommand API — including all /sync GET and POST calls — carries
 *    `Authorization: Bearer <token>`. Any API response with status 401 clears
 *    the stored session and returns to the login screen.
 * 3. Logout: "Sign Out" entries are added to the sidebar and the mobile nav
 *    drawer (plus the Admin view). Sign-out calls POST /auth/logout on a
 *    best-effort basis, clears the token and shows the login screen.
 * 4. Admin view: an "Admin" nav entry opens an in-app Admin view showing the
 *    signed-in user's email + role, a Change Password section (placeholder —
 *    the backend exposes no password-change endpoint yet), and a link that
 *    opens the existing Audit Logs view.
 */
(function () {
  'use strict';

  var TOKEN_KEY = 'partscommand_token';
  var USER_KEY = 'partscommand_user';
  var API_BASE = 'https://parts-command-api.techguruofficial.workers.dev';
  var AUTH_PREFIX = API_BASE + '/auth/';

  /* ---------------- Session storage ---------------- */
  function getToken() {
    try { return localStorage.getItem(TOKEN_KEY); } catch (e) { return null; }
  }
  function getUser() {
    try { return JSON.parse(localStorage.getItem(USER_KEY) || 'null'); } catch (e) { return null; }
  }
  function setSession(token, user) {
    try {
      localStorage.setItem(TOKEN_KEY, token);
      localStorage.setItem(USER_KEY, JSON.stringify(user || null));
    } catch (e) { /* storage unavailable — session won't persist */ }
  }
  function clearSession() {
    try {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
    } catch (e) {}
  }
  function isAuthenticated() { return !!getToken(); }

  /* ---------------- fetch wrapper: JWT + 401 handling ---------------- */
  var nativeFetch = window.fetch.bind(window);

  function inputUrl(input) {
    if (typeof input === 'string') return input;
    if (input && typeof input.url === 'string') return input.url;
    try { return String(input); } catch (e) { return ''; }
  }
  function isApiUrl(input) { return inputUrl(input).indexOf(API_BASE) === 0; }
  function isAuthUrl(input) { return inputUrl(input).indexOf(AUTH_PREFIX) === 0; }
  function mergeHeaders(src) {
    var out = {};
    if (!src) return out;
    if (typeof Headers !== 'undefined' && src instanceof Headers) {
      src.forEach(function (v, k) { out[k] = v; });
    } else if (Array.isArray(src)) {
      src.forEach(function (pair) { out[pair[0]] = pair[1]; });
    } else if (typeof src === 'object') {
      for (var k in src) {
        if (Object.prototype.hasOwnProperty.call(src, k)) out[k] = src[k];
      }
    }
    return out;
  }
  function withAuthHeaders(init) {
    init = init || {};
    var headers = mergeHeaders(init.headers);
    var token = getToken();
    if (token && !headers.Authorization && !headers.authorization) {
      headers.Authorization = 'Bearer ' + token;
    }
    init.headers = headers;
    return init;
  }
  function handleUnauthorized() {
    clearSession();
    closeAdmin();
    showLogin('Your session has expired. Please sign in again.');
  }
  window.fetch = function (input, init) {
    if (!isApiUrl(input) || isAuthUrl(input)) return nativeFetch(input, init);
    if (typeof input === 'string') {
      return nativeFetch(input, withAuthHeaders(init)).then(function (res) {
  /* ---------------- Auth API ---------------- */
  function loginRequest(email, password) {
    return nativeFetch(API_BASE + '/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email, password: password })
    }).then(function (res) {
      if (!res.ok) throw new Error('Invalid email or password');
      return res.json();
    }).then(function (data) {
      if (!data || !data.token) throw new Error('Invalid email or password');
      setSession(data.token, data.user);
      return data;
    });
  }
  function logout() {
    var token = getToken();
    if (token) {
      try {
        nativeFetch(API_BASE + '/auth/logout', {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + token }
        }).catch(function () {});
      } catch (e) {}
    }
    clearSession();
    closeAdmin();
    showLogin();
  }

  /* ---------------- Styles: dark glassmorphic ---------------- */
  var CSS = [
  var CSS2 = [
    '#pc-admin{position:fixed;inset:0;z-index:90000;display:flex;align-items:center;justify-content:center;padding:20px;}',
    '#pc-admin[hidden]{display:none!important;}',
    '.pc-admin-backdrop{position:absolute;inset:0;background:rgba(2,6,23,.75);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);}',
    '.pc-admin-panel{position:relative;width:100%;max-width:560px;max-height:88vh;overflow-y:auto;background:rgba(15,23,42,.88);border:1px solid rgba(148,163,184,.18);border-radius:20px;backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);box-shadow:0 30px 70px rgba(0,0,0,.6);padding:28px;color:#e2e8f0;}',
    '.pc-admin-head{display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:20px;}',
    '.pc-admin-head h2{font-size:22px;font-weight:700;color:#f8fafc;margin:0;}',
    '.pc-admin-head p{font-size:13px;color:#94a3b8;margin:4px 0 0;}',
    '.pc-admin-close{background:rgba(148,163,184,.12);border:1px solid rgba(148,163,184,.2);color:#cbd5e1;width:36px;height:36px;border-radius:10px;font-size:20px;line-height:1;cursor:pointer;}',
    '.pc-admin-close:hover{background:rgba(148,163,184,.22);}',
    '.pc-card{background:rgba(2,6,23,.45);border:1px solid rgba(148,163,184,.14);border-radius:14px;padding:18px;margin-bottom:16px;}',
    '.pc-card h3{font-size:13px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#94a3b8;margin:0 0 12px;}',
    '.pc-userrow{display:flex;align-items:center;justify-content:space-between;gap:12px;}',
    '#pc-admin-email{font-size:15px;color:#f1f5f9;word-break:break-all;}',
  /* ---------------- Login screen ---------------- */
  var LOGO_SVG = '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>';
  var EYE_SVG = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
  var loginEl = null, loginForm = null, loginEmail = null,
      loginPass = null, loginBtn = null, loginError = null;
  var lastOverflow = '';
  function lockScroll() {
    lastOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  function unlockScroll() { document.body.style.overflow = lastOverflow || ''; }
  function buildLogin() {
    if (loginEl || !document.body) return;
    var wrap = document.createElement('div');
    wrap.id = 'pc-login';
    wrap.hidden = true;
    wrap.innerHTML =
      '<div class="pc-login-card">' +
      '<div class="pc-login-logo">' + LOGO_SVG + '</div>' +
      '<h1 class="pc-login-title">PartsCommand</h1>' +
      '<p class="pc-login-sub">Sign in to Zempel Auto CRM</p>' +
      '<form id="pc-login-form">' +
      '<label class="pc-field"><span>Email</span>' +
      '<input id="pc-login-email" type="email" required autocomplete="username" placeholder="you@company.com"></label>' +
      '<label class="pc-field"><span>Password</span>' +
      '<span class="pc-passwrap"><input id="pc-login-pass" type="password" required autocomplete="current-password" placeholder="Enter your password">' +
      '<button type="button" class="pc-pass-toggle" id="pc-pass-toggle" aria-label="Show password">' + EYE_SVG + '</button></span></label>' +
      '<div id="pc-login-error" class="pc-error" hidden></div>' +
      '<button type="submit" id="pc-login-btn" class="pc-btn">Sign In</button>' +
      '</form>' +
      '<p class="pc-login-foot">Protected by JWT &middot; session stays on this device</p>' +
      '</div>';
    document.body.appendChild(wrap);
    loginEl = wrap;
    loginForm = wrap.querySelector('#pc-login-form');
    loginEmail = wrap.querySelector('#pc-login-email');
    loginPass = wrap.querySelector('#pc-login-pass');
    loginBtn = wrap.querySelector('#pc-login-btn');
    loginError = wrap.querySelector('#pc-login-error');
    wrap.querySelector('#pc-pass-toggle').addEventListener('click', function () {
      var show = loginPass.type === 'password';
      loginPass.type = show ? 'text' : 'password';
      this.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
    });
    loginForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var email = loginEmail.value.trim();
      var pw = loginPass.value;
      if (!email || !pw) { setLoginError('Enter your email and password.'); return; }
      setLoginError('');
      loginBtn.disabled = true;
      loginBtn.textContent = 'Signing in...';
      loginRequest(email, pw).then(function () {
        hideLogin();
        window.location.reload();
      }).catch(function (err) {
        setLoginError(err && err.message === 'Invalid email or password'
          ? 'Invalid email or password'
          : 'Could not reach the sign-in server. Check your connection and try again.');
        loginBtn.disabled = false;
        loginBtn.textContent = 'Sign In';
      });
  /* ---------------- Admin view ---------------- */
  var adminEl = null;
  function buildAdmin() {
    if (adminEl || !document.body) return;
    var wrap = document.createElement('div');
    wrap.id = 'pc-admin';
    wrap.hidden = true;
    wrap.innerHTML =
      '<div class="pc-admin-backdrop" data-pc-close></div>' +
      '<div class="pc-admin-panel" role="dialog" aria-modal="true" aria-label="Admin">' +
      '<div class="pc-admin-head"><div><h2>Admin</h2><p>Account &amp; security</p></div>' +
      '<button class="pc-admin-close" data-pc-close aria-label="Close">&times;</button></div>' +
      '<div class="pc-card"><h3>Signed in as</h3>' +
      '<div class="pc-userrow"><span id="pc-admin-email">&mdash;</span><span id="pc-admin-role" class="pc-role">&mdash;</span></div></div>' +
      '<div class="pc-card"><h3>Change Password</h3>' +
      '<form id="pc-pw-form">' +
      '<label class="pc-field"><span>Current password</span><input id="pc-pw-current" type="password" autocomplete="current-password" required></label>' +
      '<label class="pc-field"><span>New password</span><input id="pc-pw-new" type="password" autocomplete="new-password" required minlength="8"></label>' +
      '<label class="pc-field"><span>Confirm new password</span><input id="pc-pw-confirm" type="password" autocomplete="new-password" required></label>' +
      '<div id="pc-pw-msg" class="pc-note" hidden></div>' +
      '<button type="submit" class="pc-btn pc-btn-sm">Update Password</button>' +
      '</form></div>' +
      '<div class="pc-card"><h3>Audit Logs</h3>' +
      '<p class="pc-muted">See who changed what, and when.</p>' +
      '<button id="pc-open-audit" class="pc-btn-secondary">Open Audit Logs</button></div>' +
      '<div class="pc-card"><h3>Session</h3>' +
      '<button id="pc-signout" class="pc-btn-danger">Sign Out</button></div>' +
      '</div>';
    document.body.appendChild(wrap);
    adminEl = wrap;
    wrap.addEventListener('click', function (e) {
      if (e.target.closest('[data-pc-close]')) closeAdmin();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && adminEl && !adminEl.hidden) closeAdmin();
    });
    wrap.querySelector('#pc-pw-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var msg = wrap.querySelector('#pc-pw-msg');
      var cur = wrap.querySelector('#pc-pw-current').value;
      var nw = wrap.querySelector('#pc-pw-new').value;
      var cf = wrap.querySelector('#pc-pw-confirm').value;
      msg.classList.remove('err');
      if (!cur || !nw || !cf) {
        msg.textContent = 'Fill in all three password fields.';
        msg.classList.add('err');
        msg.hidden = false;
        return;
      }
      if (nw !== cf) {
        msg.textContent = 'The new passwords do not match.';
        msg.classList.add('err');
        msg.hidden = false;
        return;
      }
      msg.textContent = 'Password changes are not supported by the backend API yet. Please contact your administrator.';
      msg.hidden = false;
    });
    wrap.querySelector('#pc-open-audit').addEventListener('click', function () {
      closeAdmin();
      if (typeof window.navigate === 'function') {
        try { window.navigate('audit'); } catch (e) {}
      }
  /* ---------------- Navigation entries ---------------- */
  var ICON_SHIELD = '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"/></svg>';
  var ICON_LOGOUT = '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"/></svg>';
  function injectNavItems() {
    var anchors = document.querySelectorAll('a[onclick*="navigate(\'settings\')"]');
    Array.prototype.forEach.call(anchors, function (anchor) {
      if (anchor.__pcNavDone) return;
      anchor.__pcNavDone = true;
      var inDrawer = !anchor.classList.contains('nav-item');
      var make = function (navKey, icon, label, onClick) {
        var a = document.createElement('a');
        a.href = '#';
        a.setAttribute('class', anchor.getAttribute('class') || '');
        a.setAttribute('data-nav', navKey);
        a.innerHTML = icon + '<span>' + label + '</span>';
        a.addEventListener('click', function (e) {
          e.preventDefault();
          if (inDrawer && typeof window.toggleMobileNav === 'function') {
            try { window.toggleMobileNav(); } catch (err) {}
          }
          onClick();
        });
        return a;
      };
      var adminLink = make('pc-admin', ICON_SHIELD, 'Admin', openAdmin);
      var outLink = make('pc-logout', ICON_LOGOUT, 'Sign Out', logout);
      anchor.insertAdjacentElement('afterend', adminLink);
      adminLink.insertAdjacentElement('afterend', outLink);
    });
  }

  /* ---------------- Boot ---------------- */
  function boot() {
    injectStyles();
    buildLogin();
    injectNavItems();
    if (!isAuthenticated()) showLogin();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
  window.PCAuth = {
    getToken: getToken,
    getUser: getUser,
    isAuthenticated: isAuthenticated,
    login: loginRequest,
    logout: logout,
    showLogin: showLogin,
    openAdmin: openAdmin,
    closeAdmin: closeAdmin
  };
})();

    });
    wrap.querySelector('#pc-signout').addEventListener('click', logout);
  }
  function openAdmin() {
    buildAdmin();
    if (!adminEl) return;
    var u = getUser() || {};
    adminEl.querySelector('#pc-admin-email').textContent = u.email || 'Unknown';
    adminEl.querySelector('#pc-admin-role').textContent = u.role || 'Unknown';
    var msg = adminEl.querySelector('#pc-pw-msg');
    msg.hidden = true;
    msg.textContent = '';
    msg.classList.remove('err');
    adminEl.querySelector('#pc-pw-form').reset();
    adminEl.hidden = false;
    lockScroll();
  }
  function closeAdmin() {
    if (adminEl) adminEl.hidden = true;
    if (!loginEl || loginEl.hidden) unlockScroll();
  }

    });
  }
  function setLoginError(msg) {
    if (!loginError) return;
    if (msg) { loginError.textContent = msg; loginError.hidden = false; }
    else { loginError.textContent = ''; loginError.hidden = true; }
  }
  function showLogin(message) {
    buildLogin();
    if (!loginEl) return;
    closeAdmin();
    if (message) setLoginError(message);
    loginPass.value = '';
    loginEl.hidden = false;
    lockScroll();
    setTimeout(function () { try { loginEmail.focus(); } catch (e) {} }, 60);
  }
  function hideLogin() {
    if (loginEl) loginEl.hidden = true;
    unlockScroll();
  }

    '.pc-role{font-size:12px;font-weight:600;background:rgba(37,99,235,.18);border:1px solid rgba(59,130,246,.4);color:#93c5fd;border-radius:999px;padding:4px 12px;text-transform:capitalize;white-space:nowrap;}',
    '.pc-muted{font-size:13px;color:#94a3b8;margin:0 0 12px;}',
    '.pc-note{font-size:13px;border-radius:12px;padding:10px 14px;margin-bottom:16px;background:rgba(245,158,11,.10);border:1px solid rgba(245,158,11,.35);color:#fcd34d;}',
    '.pc-note.err{background:rgba(239,68,68,.12);border-color:rgba(239,68,68,.35);color:#fca5a5;}',
    '.pc-btn-sm{width:auto;padding:10px 20px;font-size:14px;}',
    '.pc-btn-secondary{background:rgba(148,163,184,.14);border:1px solid rgba(148,163,184,.25);border-radius:12px;color:#e2e8f0;font-size:14px;font-weight:600;padding:10px 20px;cursor:pointer;}',
    '.pc-btn-secondary:hover{background:rgba(148,163,184,.24);}',
    '.pc-btn-danger{background:rgba(239,68,68,.14);border:1px solid rgba(239,68,68,.4);border-radius:12px;color:#fca5a5;font-size:14px;font-weight:600;padding:10px 20px;cursor:pointer;}',
    '.pc-btn-danger:hover{background:rgba(239,68,68,.24);}',
    'a[data-nav="pc-logout"]{color:#f87171!important;}',
    'a[data-nav="pc-logout"]:hover{background:rgba(239,68,68,.08);}'
  ].join('');
  function injectStyles() {
    if (document.getElementById('pc-auth-styles')) return;
    var head = document.head || document.getElementsByTagName('head')[0];
    if (!head) return;
    var s = document.createElement('style');
    s.id = 'pc-auth-styles';
    s.textContent = CSS + CSS2;
    head.appendChild(s);
  }

    '#pc-login{position:fixed;inset:0;z-index:100000;display:flex;align-items:center;justify-content:center;padding:24px;background:radial-gradient(1100px 550px at 12% 8%,rgba(37,99,235,.20),transparent 60%),radial-gradient(900px 500px at 88% 92%,rgba(14,165,233,.14),transparent 60%),#020617;}',
    '#pc-login[hidden]{display:none!important;}',
    '.pc-login-card{width:100%;max-width:400px;background:rgba(15,23,42,.72);border:1px solid rgba(148,163,184,.18);border-radius:20px;backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);box-shadow:0 30px 70px rgba(0,0,0,.6);padding:36px 32px;color:#e2e8f0;}',
    '.pc-login-logo{width:56px;height:56px;border-radius:16px;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#2563eb,#0ea5e9);box-shadow:0 8px 24px rgba(37,99,235,.45);margin-bottom:20px;}',
    '.pc-login-title{font-size:26px;font-weight:700;color:#f8fafc;letter-spacing:-.02em;margin:0;}',
    '.pc-login-sub{font-size:14px;color:#94a3b8;margin:6px 0 24px;}',
    '.pc-field{display:block;margin-bottom:16px;}',
    '.pc-field>span{display:block;font-size:12px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:#94a3b8;margin-bottom:8px;}',
    '.pc-field input{width:100%;box-sizing:border-box;background:rgba(2,6,23,.6);border:1px solid rgba(148,163,184,.22);border-radius:12px;padding:12px 14px;font-size:15px;color:#f1f5f9;outline:none;transition:border-color .15s,box-shadow .15s;}',
    '.pc-field input:focus{border-color:#3b82f6;box-shadow:0 0 0 3px rgba(59,130,246,.25);}',
    '.pc-field input::placeholder{color:#475569;}',
    '.pc-passwrap{position:relative;}',
    '.pc-passwrap input{padding-right:48px;}',
    '.pc-pass-toggle{position:absolute;right:6px;top:50%;transform:translateY(-50%);background:none;border:none;color:#64748b;cursor:pointer;padding:8px;border-radius:8px;line-height:0;}',
    '.pc-pass-toggle:hover{color:#cbd5e1;}',
    '.pc-error{background:rgba(239,68,68,.12);border:1px solid rgba(239,68,68,.35);color:#fca5a5;font-size:13px;border-radius:12px;padding:10px 14px;margin-bottom:16px;}',
    '.pc-btn{width:100%;background:linear-gradient(135deg,#2563eb,#0ea5e9);border:none;border-radius:12px;color:#fff;font-size:15px;font-weight:600;padding:13px;cursor:pointer;transition:filter .15s;}',
    '.pc-btn:hover{filter:brightness(1.1);}',
    '.pc-btn:disabled{opacity:.6;cursor:wait;}',
    '.pc-login-foot{margin:20px 0 0;text-align:center;font-size:12px;color:#64748b;}'
  ].join('');

        if (res && res.status === 401) handleUnauthorized();
        return res;
      });
    }
    try {
      var req = new Request(inputUrl(input), {
        method: input.method,
        headers: withAuthHeaders({ headers: input.headers }).headers,
        mode: input.mode,
        credentials: input.credentials,
        cache: input.cache,
        redirect: input.redirect,
        referrer: input.referrer,
        integrity: input.integrity
      });
      return nativeFetch(req).then(function (res) {
        if (res && res.status === 401) handleUnauthorized();
        return res;
      });
    } catch (e) {
      return nativeFetch(input, init);
    }
  };
