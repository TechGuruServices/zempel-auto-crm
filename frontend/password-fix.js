/* PartsCommand — Change Password wiring (2026-10-20)
 *
 * The Admin overlay's password form (rendered by auth.js) was a placeholder:
 * its submit handler validated the fields and then announced that password
 * changes were "not supported by the backend API yet". The backend now has a
 * real endpoint (POST /auth/change-password), and this module wires the form
 * to it. The submit is intercepted in the capture phase on document, before
 * auth.js's own handler runs, and the placeholder handler is suppressed.
 *
 * The request deliberately uses XMLHttpRequest, not fetch: auth.js patches
 * window.fetch and treats ANY 401 from the API as an expired session (clears
 * storage + reopens the login overlay). A wrong current password also returns
 * 401 from this endpoint, and that must surface as a form error, not a logout.
 */
(function () {
  'use strict';
  var API = 'https://parts-command-api.techguruofficial.workers.dev';

  document.addEventListener('submit', function (e) {
    var form = e.target;
    if (!form || form.id !== 'pc-pw-form') return;
    e.preventDefault();
    e.stopPropagation();

    var msg = form.querySelector('#pc-pw-msg');
    function say(text, isErr) {
      if (!msg) return;
      msg.textContent = text;
      msg.hidden = false;
      msg.classList.toggle('err', !!isErr);
    }
    function val(sel) {
      var el = form.querySelector(sel);
      return el ? el.value : '';
    }

    var cur = val('#pc-pw-current');
    var nw = val('#pc-pw-new');
    var cf = val('#pc-pw-confirm');
    if (!cur || !nw || !cf) return say('Fill in all three password fields.', true);
    if (nw !== cf) return say('The new passwords do not match.', true);
    if (nw.length < 8) return say('New password must be at least 8 characters.', true);
    if (nw === cur) return say('New password must be different from the current password.', true);

    var token = '';
    try {
      token = (window.PCAuth && window.PCAuth.getToken && window.PCAuth.getToken()) ||
        localStorage.getItem('partscommand_token') || '';
    } catch (err) { /* storage unavailable */ }
    if (!token) return say('Your session has expired. Please sign in again.', true);

    say('Updating password…', false);
    var xhr = new XMLHttpRequest();
    xhr.open('POST', API + '/auth/change-password', true);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.setRequestHeader('Authorization', 'Bearer ' + token);
    xhr.onload = function () {
      var data = {};
      try { data = JSON.parse(xhr.responseText || '{}'); } catch (err) { /* keep {} */ }
      if (xhr.status >= 200 && xhr.status < 300 && data.success) {
        form.reset();
        say('Password updated. Use the new password the next time you sign in.', false);
      } else {
        say(data.error || 'Password update failed. Please try again.', true);
      }
    };
    xhr.onerror = function () {
      say('Could not reach the server. Check your connection and try again.', true);
    };
    xhr.send(JSON.stringify({ currentPassword: cur, newPassword: nw }));
  }, true);

  console.log('[PasswordFix] Change-password form wired to /auth/change-password');
})();
