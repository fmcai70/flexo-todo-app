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

You should see **"All 31 permission checks passed ✔"**. If any check fails, you'll get an error listing which ones. Send it to the developer.

## 6. Sign in

Open https://fmcai70.github.io/flexo-todo-app/ and sign in with the email and password from step 4.

- The admin sees every project. Everyone else sees only the projects they're a member of, plus their own Inbox.
- Changes appear for everyone within a second or two.
- **Try the demo** on the sign-in screen still opens the offline sample data with the 5 demo users, which is handy for training.

## Notes

- The **publishable key** is in `cloud.js` on purpose. It's designed to be public. Your data is protected by the rules in `schema.sql`, which the database enforces for every request.
- **Never** put the `service_role`/secret key or the database password in the app or on GitHub.
- The free plan pauses a project after about a week with no activity. Open the dashboard and click **Restore** if that happens.
