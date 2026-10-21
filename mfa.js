/*
 * Flexo MFA: the second sign-in step shared by every Flexo app (portal, ActionRegister, Flexo Todo).
 * The same file is copied into each app; keep the copies identical.
 *
 *   const result = await FlexoMFA.ensure(sb, { appName: 'Flexo Portal', color: '#1C3F73' });
 *   // 'ok'         → the session has passed the code step (aal2); load the app
 *   // 'signed-out' → the person chose "Sign out" here; show the sign-in screen
 *
 * Everyone must use an authenticator app (Microsoft / Google Authenticator, ...):
 *   - no confirmed authenticator yet → "Set up your authenticator" (QR code + key, confirm with one code)
 *   - otherwise                      → "Enter the 6-digit code"
 * It uses Supabase's built-in MFA (TOTP) and draws its own full-screen panel, so it doesn't depend on the
 * app's own page or styles. The database (flexo-todo-app/supabase/schema.sql, mfa_ok()) is what really
 * enforces the code step; this screen is how people get there.
 * Lost phone: an admin deletes the person's MFA factor in Supabase → Authentication → Users; they set up again.
 */
(function () {
  'use strict';

  let pending = null; // one gate per page, even if several sign-in events arrive at once

  const CSS = `
.fmfa{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:16px;
  background:#EDF0F4;color:#15223B;font:16px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;overflow:auto}
.fmfa *{box-sizing:border-box}
.fmfa-card{width:100%;max-width:420px;background:#fff;border-radius:16px;padding:24px;box-shadow:0 8px 30px rgba(21,34,59,.12);margin:auto}
.fmfa h1{font-size:21px;margin:0 0 4px;line-height:1.25}
.fmfa .fmfa-app{font-size:13px;font-weight:600;color:var(--fmfa-color);margin:0 0 12px;letter-spacing:.02em}
.fmfa p{margin:8px 0}
.fmfa .fmfa-qr{display:block;width:200px;height:200px;margin:12px auto;background:#fff;border:1px solid #D5DBE5;border-radius:8px;padding:6px}
.fmfa .fmfa-key{font:600 15px/1.5 ui-monospace,Consolas,monospace;word-break:normal;overflow-wrap:break-word;background:#F5F7FA;border:1px solid #D5DBE5;
  border-radius:8px;padding:8px 10px;user-select:all}
.fmfa label{display:block;font-weight:600;margin:14px 0 6px}
.fmfa input{width:100%;font:600 24px/1 ui-monospace,Consolas,monospace;letter-spacing:.35em;text-align:center;padding:12px;
  border:1px solid #D5DBE5;border-radius:10px;background:#fff;color:#15223B}
.fmfa input:focus{outline:2px solid var(--fmfa-color);outline-offset:1px}
.fmfa button,.fmfa a.fmfa-btn{display:flex;align-items:center;justify-content:center;width:100%;min-height:46px;margin-top:10px;
  border:0;border-radius:10px;font-family:inherit;font-size:16px;font-weight:600;line-height:1.2;cursor:pointer;text-decoration:none;text-align:center}
.fmfa .fmfa-primary{background:var(--fmfa-color);color:#fff}
.fmfa .fmfa-ghost,.fmfa a.fmfa-ghost{background:#fff;color:#15223B;border:1px solid #D5DBE5}
.fmfa .fmfa-link{background:none;border:0;color:var(--fmfa-color);min-height:36px;font-weight:500;width:auto;margin:6px auto 0}
.fmfa button:disabled{opacity:.6;cursor:default}
.fmfa .fmfa-error{color:#CF4239;min-height:1.4em;font-weight:500}
.fmfa .fmfa-meta{font-size:13px;color:#56627A}
@media (prefers-color-scheme:dark){
  .fmfa{background:#0F1726;color:#E6ECF5}.fmfa-card{background:#172238;box-shadow:none}
  .fmfa .fmfa-key{background:#1D2A43;border-color:#2A3955}.fmfa input{background:#0F1726;color:#E6ECF5;border-color:#2A3955}
  .fmfa .fmfa-ghost,.fmfa a.fmfa-ghost{background:#172238;color:#E6ECF5;border-color:#2A3955}.fmfa .fmfa-meta{color:#9AA7BE}}
`;

  function el(tag, attrs, ...children) {
    const n = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([k, v]) => {
      if (v == null || v === false) return;
      if (k === 'class') n.className = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? '' : v);
    });
    children.flat().forEach((c) => { if (c != null && c !== false) n.append(c.nodeType ? c : String(c)); });
    return n;
  }

  function friendly(error) {
    const msg = (error && error.message) || String(error);
    if (/invalid.*(totp|code)|code.*invalid|expired/i.test(msg)) {
      return 'That code didn\'t work. Type the code your app shows now (it changes every 30 seconds). ' +
        'If it keeps failing, check that your phone\'s time is set automatically.';
    }
    if (/rate limit|too many/i.test(msg)) return 'Too many tries. Wait a minute and try again.';
    if (/Failed to fetch|NetworkError|network|Load failed/i.test(msg)) return 'No internet connection. Please try again.';
    return msg;
  }

  function ensure(sb, opts) {
    if (!pending) pending = run(sb, opts || {}).finally(() => { pending = null; });
    return pending;
  }

  async function run(sb, opts) {
    const aal = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aal.error) throw aal.error;
    if (aal.data && aal.data.currentLevel === 'aal2') return 'ok';

    const list = await sb.auth.mfa.listFactors();
    if (list.error) throw list.error;
    const verified = (list.data.totp || []).find((f) => f.status === 'verified');
    return new Promise((resolve) => {
      const ui = panel(sb, opts, resolve);
      if (verified) ui.challenge(verified.id);
      else ui.enroll((list.data.all || []).filter((f) => f.factor_type === 'totp' && f.status !== 'verified'));
    });
  }

  function panel(sb, opts, resolve) {
    if (!document.getElementById('fmfa-style')) document.head.append(el('style', { id: 'fmfa-style' }, CSS));
    const root = el('div', { class: 'fmfa', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'fmfa-title' });
    root.style.setProperty('--fmfa-color', opts.color || '#1C3F73');
    const card = el('div', { class: 'fmfa-card' });
    root.append(card);
    document.body.append(root);

    const close = (result) => { root.remove(); resolve(result); };
    const signOut = async () => { try { await sb.auth.signOut(); } finally { close('signed-out'); } };

    // A 6-digit code box; submits by itself once six digits are in.
    function codeForm(onCode) {
      const err = el('p', { class: 'fmfa-error', role: 'alert' });
      const input = el('input', {
        id: 'fmfa-code', inputmode: 'numeric', autocomplete: 'one-time-code', pattern: '[0-9]*', maxlength: '6',
        'aria-describedby': 'fmfa-code-help', required: true,
      });
      const btn = el('button', { class: 'fmfa-primary', type: 'submit' }, 'Continue');
      let busy = false;
      const submit = async () => {
        const code = input.value.replace(/\D/g, '');
        if (code.length !== 6) { err.textContent = 'Enter the 6 digits from your authenticator app.'; input.focus(); return; }
        if (busy) return;
        busy = true; btn.disabled = true; input.disabled = true; err.textContent = '';
        try {
          await onCode(code);
          close('ok');
        } catch (e) {
          err.textContent = friendly(e);
          input.value = '';
        } finally {
          busy = false; btn.disabled = false; input.disabled = false;
          if (root.isConnected) input.focus();
        }
      };
      input.addEventListener('input', () => {
        input.value = input.value.replace(/\D/g, '').slice(0, 6);
        if (input.value.length === 6) submit();
      });
      const form = el('form', { onsubmit: (e) => { e.preventDefault(); submit(); } },
        el('label', { for: 'fmfa-code' }, '6-digit code'),
        input,
        el('p', { class: 'fmfa-meta', id: 'fmfa-code-help' }, 'From your authenticator app. It changes every 30 seconds.'),
        err, btn);
      return { form, input };
    }

    function footer() {
      return [
        el('button', { class: 'fmfa-ghost', type: 'button', onclick: signOut }, 'Sign out'),
        el('p', { class: 'fmfa-meta' }, 'Lost or changed your phone? Ask a Flexo admin to reset your authenticator.'),
      ];
    }

    function challenge(factorId) {
      const { form, input } = codeForm(async (code) => {
        const r = await sb.auth.mfa.challengeAndVerify({ factorId, code });
        if (r.error) throw r.error;
      });
      card.replaceChildren(
        el('p', { class: 'fmfa-app' }, opts.appName || 'Flexo'),
        el('h1', { id: 'fmfa-title' }, 'Enter your code'),
        el('p', null, 'Open your authenticator app and type the 6-digit code for Flexo.'),
        form, ...footer());
      input.focus();
    }

    async function enroll(stale) {
      card.replaceChildren(el('p', { class: 'fmfa-app' }, opts.appName || 'Flexo'),
        el('h1', { id: 'fmfa-title' }, 'Set up your authenticator'), el('p', { class: 'fmfa-meta' }, 'Preparing…'));
      let factor;
      try {
        // An earlier set-up that was never confirmed would block a new one; remove it first.
        for (const f of stale) await sb.auth.mfa.unenroll({ factorId: f.id });
        const r = await sb.auth.mfa.enroll({ factorType: 'totp', issuer: 'Flexo', friendlyName: 'Authenticator ' + new Date().toISOString().slice(0, 16) });
        if (r.error) throw r.error;
        factor = r.data;
      } catch (e) {
        card.replaceChildren(el('p', { class: 'fmfa-app' }, opts.appName || 'Flexo'),
          el('h1', { id: 'fmfa-title' }, 'Set up your authenticator'),
          el('p', { class: 'fmfa-error', role: 'alert' }, 'Could not start the set-up: ' + friendly(e)),
          el('button', { class: 'fmfa-primary', type: 'button', onclick: () => enroll([]) }, 'Try again'), ...footer());
        return;
      }
      const secret = factor.totp.secret || '';
      const { form, input } = codeForm(async (code) => {
        const r = await sb.auth.mfa.challengeAndVerify({ factorId: factor.id, code });
        if (r.error) throw r.error;
      });
      card.replaceChildren(
        el('p', { class: 'fmfa-app' }, opts.appName || 'Flexo'),
        el('h1', { id: 'fmfa-title' }, 'Set up your authenticator'),
        el('p', null, 'Flexo apps now need a code from your phone at sign-in. You set this up once; it works for every Flexo app.'),
        el('p', null, '1. Install ', el('b', null, 'Microsoft Authenticator'), ' or ', el('b', null, 'Google Authenticator'), ' on your phone.'),
        el('p', null, '2. In the app, add an account and scan this code:'),
        el('img', { class: 'fmfa-qr', src: factor.totp.qr_code, alt: 'QR code for your authenticator app' }),
        el('p', { class: 'fmfa-meta' }, 'On this phone already? Tap the button, or type the key into the app ("enter a setup key").'),
        el('a', { class: 'fmfa-btn fmfa-ghost', href: factor.totp.uri }, 'Open in authenticator app'),
        el('p', { class: 'fmfa-key', 'aria-label': 'Setup key' }, secret.replace(/(.{4})/g, '$1 ').trim()),
        el('p', null, '3. Type the 6-digit code the app now shows for Flexo:'),
        form, ...footer());
      input.focus();
    }

    return { challenge, enroll };
  }

  window.FlexoMFA = { ensure };
})();
