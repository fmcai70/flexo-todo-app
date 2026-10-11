# Microsoft 365 setup for Flexo Todo email notifications

**Who does this:** a Microsoft 365 admin (Exchange Administrator, or Global Administrator).
**Time:** about 15 minutes, once.
**Result:** Flexo Todo can send notification emails from **one mailbox only**, e.g. `todo@flexo.com.ph`, and cannot read mail or send as anyone else.

### How it works
When someone is assigned a task, a small Supabase function signs in to Microsoft 365 as an app and calls the Microsoft Graph `sendMail` API over HTTPS. It doesn't use SMTP; Supabase blocks port 587, and Microsoft recommends this method anyway. The emails come from the chosen mailbox and are saved in its **Sent Items**.

You'll end up with **4 values** to put into Supabase (Part 5):

| Value | Where it comes from |
|-------|---------------------|
| Directory (tenant) ID | Part 2 |
| Application (client) ID | Part 2 |
| Client secret **value** | Part 3 |
| Sender mailbox address | Part 1 |

---

## Part 1: The sender mailbox (Exchange admin center)

Use a **shared mailbox**. It's free (no license) and nobody needs its password.

1. Go to https://admin.exchange.microsoft.com → **Recipients** → **Mailboxes** → **Add a shared mailbox**.
2. **Display name:** `Flexo Todo`. **Email address:** `todo@flexo.com.ph` (or any address you prefer).
3. Click **Create**.

The display name is what people see as the sender ("Flexo Todo"). You can use an existing mailbox instead; just use its address everywhere below.

---

## Part 2: Register the app (Microsoft Entra admin center)

1. Go to https://entra.microsoft.com → **Identity** → **Applications** → **App registrations** → **New registration**.
2. **Name:** `Flexo Todo Mailer`
3. **Supported account types:** *Accounts in this organizational directory only (single tenant)*.
4. **Redirect URI:** leave empty.
5. Click **Register**.
6. On the app's **Overview** page, copy and keep:
   - **Application (client) ID**
   - **Directory (tenant) ID**

> ⚠️ **Do NOT add "Mail.Send" under API permissions.** Granting it in Entra lets the app send as **every** mailbox in the company. Part 4 grants it for the one mailbox only.

---

## Part 3: Create the client secret

1. Still in the app → **Certificates & secrets** → **Client secrets** → **New client secret**.
2. **Description:** `Supabase notify-email`. **Expires:** 24 months (or your company policy).
3. Click **Add**, then **immediately copy the `Value` column**. It's shown only once. (The *Secret ID* is not what you need.)
4. **Put a calendar reminder** a few weeks before the expiry date. When it expires, emails stop until you create a new secret and update Supabase (Part 5).

---

## Part 4: Allow sending from that one mailbox only (Exchange Online PowerShell)

This uses Microsoft's **RBAC for Applications**. You need two more IDs from the app's **Enterprise application** (not the App registration, which shows different values):

1. https://entra.microsoft.com → **Identity** → **Applications** → **Enterprise applications** → search `Flexo Todo Mailer` → open it.
2. Copy **Application ID** (same as the client ID) and **Object ID** (this one is different from the App registration's object ID).

Then open **PowerShell** on your PC and run these one at a time. Replace the three placeholders.

```powershell
# One-time: install the Exchange Online module (skip if you already have it)
Install-Module ExchangeOnlineManagement -Scope CurrentUser

# Sign in with your admin account (a Microsoft sign-in window opens)
Connect-ExchangeOnline

# 1. Tell Exchange about the app
New-ServicePrincipal -AppId "<APPLICATION-ID>" -ObjectId "<ENTERPRISE-APP-OBJECT-ID>" -DisplayName "Flexo Todo Mailer"

# 2. A scope containing only the sender mailbox
New-ManagementScope -Name "Flexo Todo mailbox" -RecipientRestrictionFilter "PrimarySmtpAddress -eq 'todo@flexo.com.ph'"

# 3. Let the app send mail, but only within that scope
New-ManagementRoleAssignment -App "<APPLICATION-ID>" -Role "Application Mail.Send" -CustomResourceScope "Flexo Todo mailbox"
```

**Check it.** Both commands should show `Application Mail.Send`:

```powershell
# Should say InScope = True
Test-ServicePrincipalAuthorization -Identity "<APPLICATION-ID>" -Resource "todo@flexo.com.ph"

# Any other mailbox should say InScope = False
Test-ServicePrincipalAuthorization -Identity "<APPLICATION-ID>" -Resource "someone.else@flexo.com.ph"
```

> Microsoft caches these permissions, so the first email can take **30 minutes to 2 hours** to work after this step. That's normal.

---

## Part 5: Give the values to Supabase

Supabase dashboard → your project → **Edge Functions** → **Secrets**
(direct link: https://supabase.com/dashboard/project/wlqxdgjxgvnamgiojwge/functions/secrets)

Add these, using **Add another** for each row, then **Save**:

| Name | Value |
|------|-------|
| `MS_TENANT_ID` | Directory (tenant) ID from Part 2 |
| `MS_CLIENT_ID` | Application (client) ID from Part 2 |
| `MS_CLIENT_SECRET` | Client secret **Value** from Part 3 |
| `MAIL_FROM` | `todo@flexo.com.ph` (the mailbox from Part 1) |
| `WEBHOOK_SECRET` | A long random text you make up. You'll paste the same value into the webhook (SETUP.md step 7d) |
| `APP_URL` | `https://fmcai70.github.io/flexo-todo-app/` |

If you added `SMTP_…` secrets earlier, delete them. They're no longer used.

**Keep the client secret private.** It goes only into Supabase. Not email, chat, GitHub, or the app.

---

## Troubleshooting

Look in Supabase → **Edge Functions** → `notify-email` → **Logs**:

| Log message | Cause / fix |
|-------------|-------------|
| `Microsoft sign-in failed: … AADSTS7000215` | Wrong client secret. Use the secret **Value**, not the Secret ID |
| `Microsoft sign-in failed: … AADSTS7000222` | The client secret expired. Create a new one (Part 3) and update `MS_CLIENT_SECRET` |
| `Microsoft sign-in failed: … AADSTS700016` | Wrong `MS_CLIENT_ID` or `MS_TENANT_ID` |
| `refused to send (403) … ErrorAccessDenied` | Part 4 isn't active yet (wait up to 2 hours), or `MAIL_FROM` isn't the mailbox in the scope |
| `refused to send (404) … ErrorInvalidUser` | `MAIL_FROM` mailbox doesn't exist, or there's a typo |
| `Unauthorized` | The webhook's `x-webhook-secret` header doesn't match `WEBHOOK_SECRET` |
| `Skipped (email not requested)` | That person turned this email off (🔔 → Email settings) |

**To remove access later:** delete the app in Entra (App registrations → Flexo Todo Mailer → Delete). Emails stop immediately.
