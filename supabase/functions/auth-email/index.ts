// Flexo Portal: sends sign-in emails (password reset, sign-in link, invite) through Microsoft 365.
// One Supabase project (one account per person) serves Flexo Todo and the other Flexo apps, so the wording
// is about the person's Flexo account, not one app. The link returns to whichever app asked.
//
// Supabase calls this as its "Send Email" Auth Hook instead of sending through SMTP
// (see supabase/AUTH_EMAIL.md). It reuses the Microsoft Graph app from MICROSOFT365.md,
// so no mailbox password, no SMTP and no MFA exception are needed.
//
// Secrets (Supabase → Edge Functions → Secrets):
//   MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET, MAIL_FROM, APP_URL   (same as notify-email)
//   SEND_EMAIL_HOOK_SECRET   the "v1,whsec_…" secret Supabase shows when you create the hook
// SUPABASE_URL is provided by Supabase automatically.

type EmailData = {
  token: string;
  token_hash: string;
  redirect_to: string;
  email_action_type: string;
  site_url: string;
  token_new?: string;
  token_hash_new?: string;
};
type HookPayload = { user: { email: string; new_email?: string }; email_data: EmailData };

const env = (name: string, fallback = "") => Deno.env.get(name) ?? fallback;

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

// ---- Standard Webhooks signature check (how Supabase signs hook requests) ----
function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
function bytesToB64(bytes: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)));
}
function sameText(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
async function verifySignature(body: string, headers: Headers, secret: string): Promise<boolean> {
  const id = headers.get("webhook-id");
  const timestamp = headers.get("webhook-timestamp");
  const signatures = headers.get("webhook-signature");
  if (!id || !timestamp || !signatures || !secret) return false;
  // Reject old or future-dated requests (replays).
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 5 * 60) return false;
  const key = await crypto.subtle.importKey(
    "raw", b64ToBytes(secret.replace(/^v1,/, "").replace(/^whsec_/, "")),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const expected = bytesToB64(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${id}.${timestamp}.${body}`)));
  return signatures.split(" ").some((s) => sameText(s.replace(/^v1,/, ""), expected));
}

// ---- Email content ----
// Branded "Flexo Portal": one account and one password for every Flexo app (Portal, ActionRegister, Todo).
// The link still returns to whichever app the person was using.
const BRAND = "Flexo Portal";
const PORTAL_URL = "https://flexo.com.ph/portal/";
const PORTAL_RED = "#c63a2d"; // the Flexo Portal's colour (flexo-portal/styles.css --accent)
const CODE_NOTE = "You'll then be asked for the code from your authenticator app.";

const COPY: Record<string, { subject: string; intro: string; button: string; note?: string }> = {
  recovery: {
    subject: "Reset your Flexo Portal password",
    intro: "Someone asked to reset the password for your Flexo Portal account. Tap the button to choose a new one. " +
      "It's the same password for every Flexo app (Portal, ActionRegister, Todo).",
    button: "Choose a new password",
    note: CODE_NOTE,
  },
  magiclink: {
    subject: "Your Flexo Portal sign-in link",
    intro: "Tap the button to sign in to your Flexo Portal account.",
    button: "Sign in",
    note: CODE_NOTE,
  },
  invite: {
    subject: "You're invited to the Flexo Portal",
    intro: "A Flexo Portal account has been created for you. Tap the button to accept and set your password. " +
      "You'll use it for every Flexo app (Portal, ActionRegister, Todo).",
    button: "Accept invitation",
    note: "Next you'll set up an authenticator app (Microsoft Authenticator or Google Authenticator) on your phone; " +
      "it gives the code you enter each time you sign in.",
  },
  signup: {
    subject: "Confirm your Flexo Portal account",
    intro: "Tap the button to confirm your email address.",
    button: "Confirm email",
  },
  email_change: {
    subject: "Confirm the new email for your Flexo Portal account",
    intro: "Tap the button to confirm the change of email address on your Flexo Portal account.",
    button: "Confirm email change",
  },
};

// Emails sent from the Supabase dashboard carry the project's Site URL, which defaults to localhost;
// a link back to localhost is useless to staff, so use the app's real address instead.
const isLocal = (url: string) => /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:|\/|$)/i.test(url);

function verifyLink(tokenHash: string, type: string, redirectTo: string): string {
  const base = env("SUPABASE_URL").replace(/\/$/, "");
  const back = redirectTo && !isLocal(redirectTo) ? redirectTo : env("APP_URL", "https://fmcai70.github.io/flexo-todo-app/");
  return `${base}/auth/v1/verify?token=${encodeURIComponent(tokenHash)}&type=${encodeURIComponent(type)}` +
    `&redirect_to=${encodeURIComponent(back)}`;
}

function layout(inner: string): string {
  return `
  <div style="font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;color:#202020">
    <div style="background:${PORTAL_RED};color:#fff;padding:14px 18px;border-radius:8px 8px 0 0;font-weight:700">&#10004; ${BRAND}</div>
    <div style="border:1px solid #e5e8ee;border-top:none;border-radius:0 0 8px 8px;padding:18px">${inner}
      <p style="margin:18px 0 0;font-size:12px;color:#6b6b6b">If you didn't ask for this, you can ignore this email. Your account stays as it is.</p>
    </div>
    <p style="margin:10px 0 0;font-size:11px;color:#8a8a8a;text-align:center">
      Sent by Flexo Manufacturing Corporation's apps &middot; <a href="${PORTAL_URL}" style="color:#8a8a8a">${PORTAL_URL}</a></p>
  </div>`;
}

export function compose(type: string, data: { link?: string; code?: string }) {
  if (type === "reauthentication") {
    return {
      subject: "Your Flexo Portal verification code",
      html: layout(`<p style="margin:0 0 12px">Enter this code in the app to confirm it's you:</p>
        <p style="margin:0;font-size:26px;font-weight:700;letter-spacing:4px">${escapeHtml(data.code || "")}</p>`),
    };
  }
  const c = COPY[type] || { subject: BRAND, intro: "Tap the button to continue.", button: "Continue" };
  const link = escapeHtml(data.link || "");
  return {
    subject: c.subject,
    html: layout(`<p style="margin:0 0 16px">${escapeHtml(c.intro)}</p>
      <p style="margin:0 0 16px"><a href="${link}" style="background:${PORTAL_RED};color:#fff;text-decoration:none;padding:10px 18px;border-radius:6px;display:inline-block;font-weight:600">${escapeHtml(c.button)}</a></p>
      ${c.note ? `<p style="margin:0 0 16px;font-size:13px;color:#404040">${escapeHtml(c.note)}</p>` : ""}
      <p style="margin:0;font-size:12px;color:#6b6b6b">Button not working? Copy this link into your browser. It works once and expires soon:<br><span style="word-break:break-all">${link}</span></p>`),
  };
}

// ---- Microsoft Graph (same app as notify-email) ----
let cachedToken: { value: string; expires: number } | null = null;
async function graphToken(): Promise<string> {
  if (cachedToken && cachedToken.expires > Date.now() + 60_000) return cachedToken.value;
  const res = await fetch(`https://login.microsoftonline.com/${env("MS_TENANT_ID")}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env("MS_CLIENT_ID"),
      client_secret: env("MS_CLIENT_SECRET"),
      scope: "https://graph.microsoft.com/.default",
      grant_type: "client_credentials",
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Microsoft sign-in failed: ${data.error_description || data.error || res.status}`);
  cachedToken = { value: data.access_token, expires: Date.now() + data.expires_in * 1000 };
  return cachedToken.value;
}

async function sendMail(to: string, subject: string, html: string) {
  const from = env("MAIL_FROM");
  const res = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(from)}/sendMail`, {
    method: "POST",
    headers: { Authorization: `Bearer ${await graphToken()}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      message: { subject, body: { contentType: "HTML", content: html }, toRecipients: [{ emailAddress: { address: to } }] },
      saveToSentItems: false,
    }),
  });
  if (res.status !== 202) {
    throw new Error(`Microsoft 365 refused to send (${res.status}): ${(await res.text()).slice(0, 400)}`);
  }
}

// Supabase shows this message in its Auth logs when the hook fails.
const hookError = (status: number, message: string) =>
  new Response(JSON.stringify({ error: { http_code: status, message } }), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  const body = await req.text();
  if (!(await verifySignature(body, req.headers, env("SEND_EMAIL_HOOK_SECRET")))) {
    return hookError(401, "Invalid hook signature (check SEND_EMAIL_HOOK_SECRET)");
  }
  let payload: HookPayload;
  try {
    payload = JSON.parse(body);
  } catch {
    return hookError(400, "Bad request");
  }
  const { user, email_data: d } = payload;
  const type = d.email_action_type;

  // Each message: who gets it and what it says.
  const messages: { to: string; subject: string; html: string }[] = [];
  if (type === "reauthentication") {
    messages.push({ to: user.email, ...compose(type, { code: d.token }) });
  } else if (type === "email_change" && user.new_email) {
    // Supabase's field names are swapped here for backward compatibility:
    // the current address gets token_hash_new, the new address gets token_hash.
    if (d.token_hash_new) messages.push({ to: user.email, ...compose(type, { link: verifyLink(d.token_hash_new, type, d.redirect_to) }) });
    messages.push({ to: user.new_email, ...compose(type, { link: verifyLink(d.token_hash, type, d.redirect_to) }) });
  } else {
    messages.push({ to: user.email, ...compose(type, { link: verifyLink(d.token_hash, type, d.redirect_to) }) });
  }

  try {
    for (const m of messages) await sendMail(m.to, m.subject, m.html);
    return new Response(JSON.stringify({}), { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (err) {
    console.error("Auth email failed:", err);
    return hookError(500, err instanceof Error ? err.message : String(err));
  }
});
