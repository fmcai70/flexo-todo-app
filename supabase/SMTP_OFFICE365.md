# Sign-in emails through Microsoft 365 (custom SMTP)

> **Superseded:** use [`AUTH_EMAIL.md`](AUTH_EMAIL.md) instead. It sends the same emails through the Microsoft
> Graph app from `MICROSOFT365.md`, with no SMTP password and no end-of-2026 deadline. Keep this page only as a fallback.

Supabase's built-in email service only sends a few emails per hour, so "Forgot password?" and
"Email me a sign-in link" soon fail with **"email rate limit exceeded"**. This guide makes Supabase send
those emails through Flexo's Microsoft 365 instead, from `todo@flexo.com.ph`, and raises the limit.

> **Deadline: read this first.** Supabase's SMTP option signs in to Microsoft 365 with a **username and
> password** ("Basic authentication for SMTP AUTH"). Microsoft is turning that **off by default at the end of
> December 2026**. After that, IT can switch it back on for the tenant, until Microsoft announces a final
> removal date in the second half of 2027. When it stops working, the emails fail with
> `550 5.7.30 Basic authentication is not supported for Client Submission`.
> The lasting fix is to send these emails through the Microsoft Graph API (like the 🔔 notification emails),
> using a Supabase "Send Email" hook. Ask the developer to build that before then.

This only covers **sign-in emails** (password reset, sign-in link, invites). The 🔔 **notification** emails
use the separate Microsoft Graph setup in [`MICROSOFT365.md`](MICROSOFT365.md).

## Part 1: The account that signs in (IT, Microsoft 365 admin center)

SMTP needs an account with a password. The shared mailbox `todo@flexo.com.ph` (from `MICROSOFT365.md`)
**can't sign in**, so use a separate account that is allowed to send *as* it.

1. **Create a user** at https://admin.microsoft.com → **Users** → **Active users** → **Add a user**,
   e.g. `todo-mailer@flexo.com.ph`. Give it a **long random password** and a license that includes Exchange Online.
   Nobody signs in to it day to day; it only sends these emails.
2. **Let it send as the shared mailbox:** Exchange admin center (https://admin.exchange.microsoft.com) →
   **Recipients** → **Mailboxes** → `todo@flexo.com.ph` → **Delegation** → **Send as** → add `todo-mailer`.
   (If you don't have the shared mailbox yet, create it as in `MICROSOFT365.md` Part 1.)
3. **Turn on SMTP sign-in for that one account** (Exchange Online PowerShell):
   ```powershell
   Connect-ExchangeOnline
   Set-CASMailbox -Identity todo-mailer@flexo.com.ph -SmtpClientAuthenticationDisabled $false
   Get-CASMailbox -Identity todo-mailer@flexo.com.ph | Format-List SmtpClientAuthenticationDisabled   # should be False
   ```
4. **Allow password-only sign-in for this account.** SMTP can't answer an MFA prompt.
   - If the tenant uses **Security defaults**, SMTP AUTH is blocked for everyone. The usual approach is to use
     **Conditional Access** instead and exclude only `todo-mailer` from the MFA policy.
   - Keep the exclusion narrow: block this account from interactive sign-in, or limit it to Exchange, if your
     licensing allows.
   - Because this account is password-only, keep the password long and random, store it only in Supabase, and
     change it if it may have leaked.

## Part 2: Supabase (owner)

1. Supabase dashboard → **Authentication** → **Emails** → **SMTP Settings** → turn on **Enable custom SMTP**.
2. Fill in:

   | Field | Value |
   |---|---|
   | Sender email | `todo@flexo.com.ph` |
   | Sender name | `Flexo Todo` |
   | Host | `smtp.office365.com` |
   | Port | `587` |
   | Minimum interval between emails | `10` seconds (or leave the default) |
   | Username | `todo-mailer@flexo.com.ph` |
   | Password | the `todo-mailer` password. Type it here only; don't email or chat it to anyone |

3. **Save**.
4. **Raise the limit:** **Authentication** → **Rate Limits** → *Rate limit for sending emails* → e.g. `30` per hour → **Save**.
   (This setting only becomes editable once custom SMTP is on.)

Port 587 is fine here. It's the 🔔 notification function that Supabase blocks from using 587, not the sign-in service.

## Part 3: Test

1. Open the app → **Forgot password?** with your own email.
2. The email should arrive from **Flexo Todo &lt;todo@flexo.com.ph&gt;** within a minute. Check Junk the first time.
3. Tap the link: the app opens on **Choose a new password**.

## Troubleshooting

Errors show up in Supabase → **Logs** → **Auth** (search for `smtp` or `535`).

| Error | Meaning and fix |
|---|---|
| `535 5.7.139 Authentication unsuccessful, SmtpClientAuthentication is disabled` | Part 1 step 3 not done (or not yet applied: wait up to an hour). |
| `535 5.7.139 ... user is locked by security defaults` / `... basic authentication is disabled` | Security defaults or a Conditional Access policy blocks it. See Part 1 step 4. |
| `535 5.7.3 Authentication unsuccessful` | Wrong username or password, or the account has no Exchange license. |
| `554 5.2.252 SendAsDenied` / `5.7.60` | `todo-mailer` lacks **Send as** on `todo@flexo.com.ph` (Part 1 step 2), or the sender email has a typo. |
| `550 5.7.30 Basic authentication is not supported for Client Submission` | Microsoft has switched off password SMTP for the tenant (see the deadline above). IT can re-enable it for now; the lasting fix is the Graph "Send Email" hook. |
| Still "email rate limit exceeded" | Custom SMTP isn't saved, or the rate limit (Part 2 step 4) is still low. |
