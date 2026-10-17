# Flexo Todo: notes for Claude / developers

Todoist-style project and task tracker for Flexo Manufacturing. Plain HTML/CSS/JS (no build step), hosted on
GitHub Pages at https://fmcai70.github.io/flexo-todo-app/ (moving to https://todo.flexo.com.ph on Hostinger), with a Supabase back end.

## Architecture
- `store.js`: data model + permission rules (pure JS, unit-tested by `tests.html`/`tests.js`, 86 tests; the tab title shows `PASS n/n`).
- `app.js`: UI. Two modes: **shared** (Supabase sign-in, default) and **demo** (5 sample users, localStorage).
- `cloud.js`: Supabase client. Loads visible data into the store's state shape; `pushDiff(prev, next)` saves each store change in dependency order; Realtime triggers a reload.
- `supabase/schema.sql`: tables, Row Level Security, triggers (mirrors store.js rules). Re-runnable. Admin emails are in `admin_emails()`.
- `supabase/rls_tests.sql`: 46-check 5-user permission test run in the Supabase SQL Editor.
- `supabase/functions/notify-email/index.ts`: Edge Function that emails notifications via **Microsoft Graph** (Flexo uses Microsoft 365; Supabase blocks SMTP 587).
- `supabase/functions/auth-email/index.ts`: Supabase **Send Email Auth Hook** (password reset, sign-in link, invite) via the same Graph app.
  Verifies the Standard Webhooks signature (`SEND_EMAIL_HOOK_SECRET`). Setup: `supabase/AUTH_EMAIL.md`.
- Shared sign-in: other Flexo apps use this same Supabase project/accounts (see `SHARED_AUTH.md`). So: `auth-email`
  wording is app-neutral ("your Flexo account"); live updates subscribe to Flexo Todo's tables only; never rely on
  other apps' tables. Other apps prefix their tables (e.g. `inv_`) and keep their SQL in their own repo.
- `sw.js`: offline cache. **Bump `CACHE` on every release** so installed phones update.
- `vendor/supabase-js-2.117.3.min.js`: the Supabase library, served from this site (not a CDN) and cached by `sw.js`.
  A CDN copy failed to load on a phone, which broke sign-in. To upgrade: `npm pack @supabase/supabase-js@X`, copy `dist/umd/supabase.js`.

## Roles and rules
Admin sees/manages all projects. Project manager (set at creation; only admin can change it) manages members/sections.
Members see their projects and add/edit/complete tasks. Non-members see nothing of a project. Personal Inbox tasks
and saved filters are private to their owner (not even admin). Subtasks are one level deep and follow the parent.
Comments follow their task's visibility; only the author edits, the author/PM/admin delete. Commenting notifies the task's
creator, assignee and earlier commenters (if still on the project). In shared mode comments stay hidden until the
`comments` table exists (`FlexoCloud.hasComments`).

## People / config
- Supabase project: `https://wlqxdgjxgvnamgiojwge.supabase.co`. The publishable key in `cloud.js` is public by design.
- Admin: `rogerick.aban@flexo.com.ph`. Other user: `fmc.ai@flexo.com.ph`. The owner adds other staff in the Supabase dashboard.
- Never commit the Supabase secret/service_role key, the DB password, or Microsoft client secrets.

## Status (2026-10-11)
Done and live: projects/members/admin access, Inbox, subtasks, recurring tasks, due times, reminders (while the app is open),
sections, board view, labels, saved filters, search, PWA install, Supabase sign-in, live sync, password reset
(fixed: reset link now waits on the new-password screen), change password while signed in (👤 account dialog),
and in-app 🔔 notifications (code done).
Task comments (live, sw v17), in demo and shared mode.

Done by the owner: schema.sql run (re-run 2026-10-14 with notifications + comments), sign-up disabled, URL configuration,
both users created.

**Next steps (owner / IT):**
1. ~~Re-run `supabase/schema.sql`~~ Done 2026-10-14 (notifications + comments tables live).
2. ~~IT follows `supabase/MICROSOFT365.md`~~ Done (Entra app + Exchange scope; emails send).
   Was: IT follows `supabase/MICROSOFT365.md` (shared mailbox `todo@flexo.com.ph`, Entra app, client secret,
   RBAC for Applications scoped to that mailbox; do **not** grant Mail.Send tenant-wide in Entra).
3. ~~Deploy `notify-email` + webhook~~ Done 2026-10-17 (notification emails arrive).
   Was: Deploy the `notify-email` function (Verify JWT off), add secrets `MS_TENANT_ID`, `MS_CLIENT_ID`,
   `MS_CLIENT_SECRET`, `MAIL_FROM`, `WEBHOOK_SECRET`, `APP_URL`, and create a Database Webhook on `notifications`
   (Insert) with header `x-webhook-secret`. See `supabase/SETUP.md` section 7.
4. Optional: run `supabase/rls_tests.sql` (46 checks; owner skipped it so far).
5. ~~Sign-in emails~~ Done 2026-10-17: `auth-email` Send Email hook deployed; password-reset email received.
   Custom SMTP stays ON (unused, but required to keep the email rate limit raised); rate limit raised.
   MS_* secrets and the notifications Database Webhook (pg_net) are in place; notification email confirmed working 2026-10-17.
6. In progress: move hosting to Hostinger at `todo.flexo.com.ph` (DNS at dotPH: A record → Hostinger IP; hPanel Git
   deploy with a read-only GitHub deploy key + auto-deploy webhook), then make the GitHub repo private (it's public;
   no secrets in history). Steps: `HOSTINGER.md`. `.htaccess` (tested on Apache 2.4) forces HTTPS except
   `/.well-known/` (SSL issuance), sets no-cache on html/js/css/sw.js, and 403s `*.md`, `*.sql`, `*.ts`, `supabase/`, dotfiles.
   Icons live in `img/` (not `icons/`: Apache's default `Alias /icons/` would shadow them).

Not yet built (from the Todoist comparison): file attachments on tasks/comments, @mentions, activity history, calendar view,
natural-language quick add, project templates/archiving, push notifications while the app is closed.

## Testing locally
No Node/Python is needed. Serve the folder with any static server (the original laptop used a small PowerShell
HttpListener on port 8765) and open `tests.html` and `index.html`. Shared mode can be exercised against a mocked
`window.supabase` client loaded before `cloud.js`.
The schema and `rls_tests.sql` can be run against a plain local Postgres 16 with a small shim (roles `anon`/`authenticated`,
an `auth.users` table, `auth.uid()` reading `request.jwt.claims`, and a `supabase_realtime` publication).
