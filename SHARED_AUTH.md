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

Flexo Todo's database script is `supabase/schema.sql` in the `flexo-todo-app` repository. Its email setup guides
are `supabase/AUTH_EMAIL.md` and `supabase/MICROSOFT365.md`.

## 1. Supabase settings for the new app (once)
1. **Authentication → URL Configuration → Redirect URLs:** add the new app's address, e.g. `https://inventory.flexo.com.ph/`.
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

1. **Prefix every table, function and policy** with the app's name, e.g. `inv_items`, `inv_can_edit()`.
   Never change or drop Flexo Todo's tables (`projects`, `project_members`, `sections`, `tasks`, `filters`,
   `notifications`, `comments`) or its functions. Keep the new app's SQL in **its own file** in its own repository.
2. **Turn on Row Level Security on every new table** and write policies with `auth.uid()`. A table without RLS can
   be read by anyone who has the public key.
   ```sql
   alter table public.inv_items enable row level security;
   create policy "inv_items_select" on public.inv_items for select to authenticated using (<who may read>);
   ```
3. **Decide who may use the new app.** Every Flexo account can sign in to it, so control access in the data: e.g. an
   `inv_members (user_id, role)` table and policies that check it. Don't reuse Flexo Todo's project membership.
4. Read people's names from `public.profiles` (all signed-in users can read it). Admin check:
   `exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')`.
5. **Live updates:** only add the new tables to the `supabase_realtime` publication if the new app needs live updates.
   Flexo Todo listens only to its own tables, so it isn't affected either way.
6. Grants: `grant select, insert, update, delete on public.inv_items to authenticated;` and nothing for `anon`.

## 4. Adding people
Supabase → **Authentication → Users → Invite user**: they get an invite email and set one password for all Flexo
apps. People who already use Flexo Todo need nothing new: they sign in to the new app with the same account
(and get access once you add them to that app's members table).

## Shared limits (free plan)
Both apps share the project's limits: database size, the email rate limit (Authentication → Rate Limits), and the
free plan's pause after about a week without activity. If both apps are used daily, consider Supabase Pro for
automatic backups and no pausing.
