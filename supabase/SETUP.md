# Supabase setup (about 10 minutes, one time)

Project: `https://wlqxdgjxgvnamgiojwge.supabase.co`

Do these steps in the Supabase dashboard at https://supabase.com/dashboard while signed in.

## 1. Create the database

1. Open your project and go to **SQL Editor** (left menu), then **New query**.
2. Open [`schema.sql`](schema.sql) in this folder, copy **everything**, paste it into the editor and click **Run**.
3. You should see one row: **"Flexo Todo database is ready ✔"**.

You can run it again later, for example after an update. It doesn't delete any data.

## 2. Only invited people can have accounts

**Authentication** → **Sign In / Providers** (on some dashboards it's under **Providers → Email**):

- Keep **Email** enabled.
- Turn **off** "Allow new users to sign up".

This stops strangers from creating accounts. You add people yourself in step 4.

## 3. Tell Supabase where the app lives

**Authentication** → **URL Configuration**:

- **Site URL**: `https://fmcai70.github.io/flexo-todo-app/`
- **Redirect URLs**: add `https://fmcai70.github.io/flexo-todo-app/`

This is needed for the "Email me a sign-in link" and "Forgot password?" emails.

## 4. Add people

**Authentication** → **Users** → **Add user** → **Create new user**:

| Email | Role |
|-------|------|
| `rogerick.aban@flexo.com.ph` | **Admin** (automatic, set in `schema.sql`) |
| `fmc.ai@flexo.com.ph` | User |
| … everyone else | User |

For each person, enter a temporary password and tick **Auto Confirm User**. Give them the password. They can change it with **Forgot password?** on the sign-in screen.

- Their display name comes from the email (`rogerick.aban` → "Rogerick Aban"). They can change it by tapping their name in the top bar.
- **More admins:** add the email to `admin_emails()` at the top of `schema.sql` and run it again. You can also open **Table Editor → profiles** and change their `role` to `admin`.
- **Someone leaves:** in **Authentication → Users**, use **Ban user** rather than deleting them, so the tasks they created stay. Reassign their projects to a new manager first.

## 5. (Optional) Check the permission rules

In **SQL Editor**, run [`rls_tests.sql`](rls_tests.sql). It creates 5 temporary test users, checks what each one can see and do against the real database rules, then removes them again.

You should see **"All 58 permission checks passed ✔"**. If any check fails, you'll get an error listing which ones. Send it to the developer.

## 6. Sign in

Open https://fmcai70.github.io/flexo-todo-app/ and sign in with the email and password from step 4.

- The admin sees every project. Everyone else sees only the projects they're a member of, plus their own Inbox.
- Changes appear for everyone within a second or two.
- **Try the demo** on the sign-in screen still opens the offline sample data with the 5 demo users, which is handy for training.

## 6b. Sign-in emails without the hourly limit

Supabase's built-in email service only sends a few emails per hour, so password resets and sign-in links soon
fail with "email rate limit exceeded". Send them through Microsoft 365 instead: see
[`AUTH_EMAIL.md`](AUTH_EMAIL.md) (recommended; uses the same Microsoft 365 app as section 7).
The older SMTP route, [`SMTP_OFFICE365.md`](SMTP_OFFICE365.md), stops working when Microsoft disables SMTP passwords.

## 7. Email notifications (like Todoist)

People get an email when someone **assigns them a task** or **comments** on a task they created, are assigned to, or commented on. They can also choose to get one when a task they created is **completed or reopened**. Notifications always show under the 🔔 bell in the app. Each person picks which ones they want by email (🔔 → **Email settings**).

Emails are sent from your **Microsoft 365** mailbox through Microsoft's Graph API, not SMTP: Supabase blocks port 587, the only SMTP port Microsoft 365 offers.

### 7a. Update the database
Run [`schema.sql`](schema.sql) again in the **SQL Editor**, the same as step 1. It adds notifications and task comments without touching existing data.

### 7b. Microsoft 365 side (your IT admin, once)
Follow [`MICROSOFT365.md`](MICROSOFT365.md). It creates a `todo@flexo.com.ph` mailbox and an app that can send email **only from that mailbox**, and lists the secrets to add to Supabase.

### 7c. Create the email function
1. **Edge Functions** (left menu) → **Deploy a new function** → **Via Editor**.
2. Name it exactly `notify-email`.
3. Replace the sample code with everything in [`functions/notify-email/index.ts`](functions/notify-email/index.ts), then click **Deploy**.
4. Open the function's **Details / Settings** and turn **off** "Verify JWT" ("Enforce JWT verification"), then save. The function checks its own secret instead.
5. Add the secrets listed in [`MICROSOFT365.md` Part 5](MICROSOFT365.md#part-5-give-the-values-to-supabase): `MS_TENANT_ID`, `MS_CLIENT_ID`, `MS_CLIENT_SECRET`, `MAIL_FROM`, `WEBHOOK_SECRET`, `APP_URL`.

### 7d. Send new notifications to the function
**Database** → **Webhooks** (or **Integrations → Database Webhooks**) → enable if asked → **Create a new hook**:

- **Name:** `notify_email`
- **Table:** `notifications`
- **Events:** tick **Insert** only
- **Type:** **Supabase Edge Functions** → choose `notify-email`, method **POST**
- **HTTP Headers:** add `x-webhook-secret` with the **same value** as `WEBHOOK_SECRET`
- Click **Create webhook**.

### 7e. Try it
Sign in as Rogerick and assign a task to fmc.ai. fmc.ai should see 🔔 **1** in the app within seconds, and an email shortly after. Right after IT finishes Part 4, Microsoft can take **up to 2 hours** to allow the first email.

**No email arrives?** Check **Edge Functions → notify-email → Logs** and see the troubleshooting table in [`MICROSOFT365.md`](MICROSOFT365.md#troubleshooting). If nothing appears in the logs at all, the webhook (7d) isn't set up for the `notifications` table. Also check the recipient's Junk folder the first time.

## Notes

- The **publishable key** is in `cloud.js` on purpose. It's designed to be public. Your data is protected by the rules in `schema.sql`, which the database enforces for every request.
- **Never** put the `service_role`/secret key or the database password in the app or on GitHub.
- The free plan pauses a project after about a week with no activity. Open the dashboard and click **Restore** if that happens.
