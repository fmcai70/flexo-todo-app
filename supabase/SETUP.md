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

You should see **"All 37 permission checks passed ✔"**. If any check fails, you'll get an error listing which ones. Send it to the developer.

## 6. Sign in

Open https://fmcai70.github.io/flexo-todo-app/ and sign in with the email and password from step 4.

- The admin sees every project. Everyone else sees only the projects they're a member of, plus their own Inbox.
- Changes appear for everyone within a second or two.
- **Try the demo** on the sign-in screen still opens the offline sample data with the 5 demo users, which is handy for training.

## 7. Email notifications (like Todoist)

People get an email when someone **assigns them a task**. They can also choose to get one when a task they created is **completed or reopened**. Notifications always show under the 🔔 bell in the app. Each person picks which ones they want by email (🔔 → **Email settings**).

**Your SMTP server must allow port 465 (SSL).** Supabase blocks ports 25 and 587 for sending mail. Most mail servers, including Gmail, support 465. Microsoft 365 (`smtp.office365.com`) only offers 587, so it won't work here.

### 7a. Update the database
Run [`schema.sql`](schema.sql) again in the **SQL Editor**, the same as step 1. It adds the notifications without touching existing data.

### 7b. Create the email function
1. **Edge Functions** (left menu) → **Deploy a new function** → **Via Editor**.
2. Name it exactly `notify-email`.
3. Replace the sample code with everything in [`functions/notify-email/index.ts`](functions/notify-email/index.ts), then click **Deploy**.
4. Open the function's **Details / Settings** and turn **off** "Verify JWT" ("Enforce JWT verification"), then save. The function checks its own secret instead (next step).

### 7c. Add the SMTP settings as secrets
**Edge Functions** → **Secrets** (sometimes under **Manage secrets**). Add each of these:

| Name | Value |
|------|-------|
| `SMTP_HOST` | your SMTP server, e.g. `mail.flexo.com.ph` |
| `SMTP_PORT` | `465` |
| `SMTP_USER` | the mailbox login, e.g. `todo@flexo.com.ph` |
| `SMTP_PASS` | the mailbox password |
| `SMTP_FROM` | `Flexo Todo <todo@flexo.com.ph>` (the address people see) |
| `WEBHOOK_SECRET` | make up a long random text, e.g. 30+ letters and numbers. You'll paste the same value in 7d |
| `APP_URL` | `https://fmcai70.github.io/flexo-todo-app/` |

These stay inside Supabase. **Never** put them in the app, GitHub, or a chat.

### 7d. Send new notifications to the function
**Database** → **Webhooks** (or **Integrations → Database Webhooks**) → enable if asked → **Create a new hook**:

- **Name:** `notify_email`
- **Table:** `notifications`
- **Events:** tick **Insert** only
- **Type:** **Supabase Edge Functions** → choose `notify-email`, method **POST**
- **HTTP Headers:** add `x-webhook-secret` with the **same value** as `WEBHOOK_SECRET`
- Click **Create webhook**.

### 7e. Try it
Sign in as Rogerick and assign a task to fmc.ai. fmc.ai should see 🔔 **1** in the app within seconds, and an email shortly after.

**No email arrives?** Check **Edge Functions → notify-email → Logs**:

| Log says | Fix |
|----------|-----|
| `Unauthorized` | The webhook header and `WEBHOOK_SECRET` don't match |
| `Email failed: … auth …` | Wrong `SMTP_USER` or `SMTP_PASS` |
| `Email failed: … timeout / connection …` | Wrong `SMTP_HOST`, or the server doesn't allow port 465 |
| `Skipped (email not requested)` | That person turned this email off in 🔔 → Email settings |
| Nothing at all | The webhook (7d) isn't set up for the `notifications` table |

Also check the recipient's spam folder the first time.

## Notes

- The **publishable key** is in `cloud.js` on purpose. It's designed to be public. Your data is protected by the rules in `schema.sql`, which the database enforces for every request.
- **Never** put the `service_role`/secret key or the database password in the app or on GitHub.
- The free plan pauses a project after about a week with no activity. Open the dashboard and click **Restore** if that happens.
