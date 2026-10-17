# Sign-in for other Flexo apps (shared with Flexo Todo)

Copy this file into the new app's repository. It explains how a new Flexo app uses the **same accounts** as
Flexo Todo: one Supabase project, one email + password per person, managed in one place.

## What's already set up (don't redo)

| Part | Where |
|---|---|
| Supabase project | `https://wlqxdgjxgvnamgiojwge.supabase.co` |
| Publishable (public) key | `sb_publishable_8gUb_7V26fIWP1GyXt7NZQ_uPsR1IoC`. Safe in app code; data is protected by Row Level Security |
| Sign-in method | Email + password (also emailed sign-in links). Public sign-up is **off**; admins invite people |
| Sign-in emails | "Send Email" Auth Hook → `auth-email` Edge Function → Microsoft 365 (`todo@flexo.com.ph`). Wording says "your Flexo account", and links return to whichever app asked |
| People | `auth.users` (Supabase) + `public.profiles` (`id`, `email`, `name`, `role`), created automatically for every account |
| Admins | Emails in `public.admin_emails()` get `profiles.role = 'admin'`. This is company-wide |
| Who may use which app | `public.app_access (user_id, app)`. App names: `todo` (Flexo Todo), `actionregister` (ActionRegister). Admins manage it in Flexo Todo → 👥 **People & access**; admins can always use every app. Helper: `public.has_app_access('actionregister')` |

Flexo Todo's database script is `supabase/schema.sql` in the `flexo-todo-app` repository. Its email setup guides
are `supabase/AUTH_EMAIL.md` and `supabase/MICROSOFT365.md`.

## 1. Supabase settings for the new app (once)
1. **Authentication → URL Configuration → Redirect URLs:** add the new app's address, e.g. `https://actionregister.flexo.com.ph/`.
   Keep the Site URL as Flexo Todo's address. (The Site URL is only used for emails sent from the dashboard.)
2. Nothing else: the users, email hook and rate limits are shared.

## 2. Connecting from the app

Use **supabase-js v2** with the same options as Flexo Todo, so password-reset and sign-in links work the same way:

```js
const sb = supabase.createClient('https://wlqxdgjxgvnamgiojwge.supabase.co', 'sb_publishable_8gUb_7V26fIWP1GyXt7NZQ_uPsR1IoC', {
  auth: { flowType: 'implicit', detectSessionInUrl: true, persistSession: true, autoRefreshToken: true },
});
const appUrl = location.origin + location.pathname;

await sb.auth.signInWithPassword({ email, password });                                    // sign in
await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: false, emailRedirectTo: appUrl } }); // emailed link
await sb.auth.resetPasswordForEmail(email, { redirectTo: appUrl });                      // "Forgot password?"
await sb.auth.updateUser({ password: newPassword });                                     // set / change password
await sb.auth.signOut();
```

- **Password reset:** the reset link opens the app with `#...type=recovery` in the address. Read that **before**
  creating the client, and show a "Choose a new password" screen instead of the app (see `cloud.js` and the
  `recovering` logic in `app.js` of Flexo Todo; that bug cost a day once).
- **Load supabase-js from your own site, not a CDN** (a CDN failed on a staff phone). Flexo Todo keeps a copy
  in `vendor/`.
- **Sessions are per website.** Signing in to Flexo Todo doesn't sign you in to the new app (different address);
  people use the same email and password in both.
- Always pass `shouldCreateUser: false` and keep sign-up disabled, so only invited people get accounts.

## 3. Database rules for the new app's data

The new app's tables live in the **same database** as Flexo Todo's. To keep both safe:

1. **Prefix every table, function and policy** with the app's name, e.g. `ar_actions`, `ar_can_edit()`.
   Never change or drop Flexo Todo's tables (`projects`, `project_members`, `sections`, `tasks`, `filters`,
   `notifications`, `comments`) or its functions. Keep the new app's SQL in **its own file** in its own repository.
2. **Turn on Row Level Security on every new table** and write policies with `auth.uid()`. A table without RLS can
   be read by anyone who has the public key.
   ```sql
   alter table public.ar_actions enable row level security;
   create policy "ar_actions_select" on public.ar_actions for select to authenticated
     using (public.has_app_access('actionregister') and <who may read>);
   ```
3. **Only people with ActionRegister access.** Every Flexo account can sign in, so every ActionRegister policy must
   include `public.has_app_access('actionregister')`, e.g.
   `using (public.has_app_access('actionregister') and <who may read>)`. After sign-in, the app should also check
   `select 1 from public.app_access where user_id = auth.uid() and app = 'actionregister'` (or `profiles.role = 'admin'`)
   and, if missing, sign the person out with "You don't have access to ActionRegister. Ask an admin." Roles *inside*
   ActionRegister (e.g. who approves) belong in its own prefixed tables. Don't reuse Flexo Todo's project membership.
   Don't create or alter `app_access` itself; it's defined in Flexo Todo's `schema.sql`.
4. Read people's names from `public.profiles` (all signed-in users can read it). Admin check:
   `exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')`.
5. **Live updates:** only add the new tables to the `supabase_realtime` publication if the new app needs live updates.
   Flexo Todo listens only to its own tables, so it isn't affected either way.
6. Grants: `grant select, insert, update, delete on public.ar_actions to authenticated;` and nothing for `anon`.

## 4. Adding people
Supabase → **Authentication → Users → Invite user**: they get an invite email and set one password for all Flexo
apps. People who already use Flexo Todo need nothing new: they sign in to the new app with the same account
(and get access once an admin ticks ActionRegister for them in 👥 People & access).

## Shared limits (free plan)
Both apps share the project's limits: database size, the email rate limit (Authentication → Rate Limits), and the
free plan's pause after about a week without activity. If both apps are used daily, consider Supabase Pro for
automatic backups and no pausing.
