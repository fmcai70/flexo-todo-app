# Sign-in emails through Microsoft 365 (Send Email hook)

**What it fixes:** "Forgot password?", "Email me a sign-in link" and invites. Supabase normally sends these
itself (a few per hour) or through SMTP. With this hook it hands each email to the `auth-email` function, which
sends it from `todo@flexo.com.ph` through Microsoft Graph, using the **same Microsoft 365 app** as the 🔔
notification emails ([`MICROSOFT365.md`](MICROSOFT365.md)).

No SMTP, no mailbox password, no MFA exception, and it's not affected by Microsoft switching off SMTP passwords
at the end of 2026. This replaces [`SMTP_OFFICE365.md`](SMTP_OFFICE365.md).

**Before you start:** the Microsoft 365 part of `MICROSOFT365.md` is done and these Edge Function secrets exist:
`MS_TENANT_ID`, `MS_CLIENT_ID`, `MS_CLIENT_SECRET`, `MAIL_FROM`, `APP_URL`.

## 1. Deploy the function
1. Supabase → **Edge Functions** → **Deploy a new function** → **Via Editor**.
2. Name it exactly `auth-email`.
3. Replace the sample code with everything in [`functions/auth-email/index.ts`](functions/auth-email/index.ts) → **Deploy**.
4. Open the function's **Settings** and turn **off** "Verify JWT" ("Enforce JWT verification") → save.
   The function checks Supabase's signature instead.

## 2. Create the hook
1. Supabase → **Authentication** → **Hooks** (may be called **Auth Hooks**) → **Add hook** → **Send Email hook**.
2. **Hook type:** HTTPS.
3. **URL:** `https://wlqxdgjxgvnamgiojwge.supabase.co/functions/v1/auth-email`
4. Click **Generate secret**. Copy the whole value (it starts with `v1,whsec_`).
5. **Create** (or **Save**), and make sure the hook is **enabled**.

## 3. Give the function the hook secret
Supabase → **Edge Functions** → **Secrets** → add:

| Name | Value |
|---|---|
| `SEND_EMAIL_HOOK_SECRET` | the `v1,whsec_…` value from step 2.4 |

Keep it private: only in Supabase.

## 4. Test
1. In the app, tap **Forgot password?** with your own email, **once**.
2. An email "Reset your Flexo Todo password" should arrive from **Flexo Todo &lt;todo@flexo.com.ph&gt;** within
   a minute. Check Junk the first time.
3. Tap the button: the app opens on **Choose a new password**.

**Leave custom SMTP turned on** (Authentication → Emails → SMTP Settings). The hook does the sending when it's
enabled, but Supabase only lets you raise the email rate limit while custom SMTP is on; turning it off can drop the
limit back to 2 emails per hour. Set **Authentication → Rate Limits → Rate limit for sending emails** to about 30 per hour.

## Troubleshooting
The app shows the error, and so does Supabase → **Edge Functions** → `auth-email` → **Logs** (and **Logs → Auth**).

| Message | Fix |
|---|---|
| `Invalid hook signature (check SEND_EMAIL_HOOK_SECRET)` | The secret in step 3 doesn't match the hook. Copy it again from the hook, including `v1,whsec_` |
| `Microsoft sign-in failed: … AADSTS…` | Wrong or expired Microsoft secret. See the table in `MICROSOFT365.md` |
| `Microsoft 365 refused to send (403) … ErrorAccessDenied` | IT's Exchange step (MICROSOFT365.md Part 4) isn't active yet; it can take up to 2 hours |
| `Microsoft 365 refused to send (404) … ErrorInvalidUser` | `MAIL_FROM` mailbox doesn't exist or has a typo |
| Nothing in the function logs | The hook isn't enabled, or its URL is wrong (step 2) |
| Link opens but says it expired | Links work once and expire after about an hour. Request a new one and use only the newest email |
