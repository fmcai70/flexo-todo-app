# Moving Flexo Todo to Hostinger (todo.flexo.com.ph)

**Result:** the app runs at `https://todo.flexo.com.ph` on the Hostinger plan that already hosts the company
WordPress site, and updates go live automatically when the code changes. The GitHub repository can then be made private.

**Who:** whoever manages Hostinger (hPanel) and the `flexo.com.ph` domain at dotPH. **Time:** about 30 minutes,
plus waiting for DNS (15 minutes to a few hours).

Using a different name than `todo`? Replace `todo.flexo.com.ph` everywhere below.

> **Don't touch the WordPress site or the email records.** Everything here is a *new* subdomain in its own folder.

---

## Part 1: Hostinger: create the subdomain

1. Sign in to **hPanel** (https://hpanel.hostinger.com) → **Websites** → **Manage** next to `flexo.com.ph`.
2. Search the left menu for **Subdomains** (under **Domains**).
3. **Create a new subdomain:** `todo`. Keep the suggested folder (usually `public_html/todo`), or tick
   *Custom folder for subdomain* and enter `todo`. Click **Create**.
4. Find the server **IP address**: on the website's **Dashboard**, under *Website details* / *Plan details*
   (or **Advanced → DNS Zone Editor**, the **A** record named `@`). Write it down, e.g. `123.45.67.89`.

## Part 2: dotPH: point todo.flexo.com.ph to Hostinger

First check **where your DNS is really managed**: in your dotPH account, open `flexo.com.ph` and look at
**Nameservers**.
- dotPH nameservers (e.g. `ns1.dot.ph`, `dns.ph`) → continue below at dotPH.
- Hostinger nameservers (e.g. `ns1.dns-parking.com`) → DNS is at Hostinger instead: add the record in hPanel →
  **Advanced → DNS Zone Editor**, and skip to Part 3.
- Anything else (e.g. Cloudflare) → add the record there.

At dotPH:
1. Sign in at https://www.dot.ph → **My Domains** → `flexo.com.ph` → **DNS** / **Manage DNS** / **Zone Records**
   (the name varies).
2. **Add record:**

   | Type | Host / Name | Value / Points to | TTL |
   |---|---|---|---|
   | **A** | `todo` | the Hostinger IP from Part 1 | default (or 3600) |

3. **Save.** Do **not** change existing records: the **MX** and **TXT** records (Microsoft 365 email) and the
   records for `@` / `www` (the WordPress site).
4. Wait. Check on your PC with `nslookup todo.flexo.com.ph`: it should show the Hostinger IP. Usually 15 minutes to a
   few hours.

If you can only change nameservers, not individual records, ask dotPH support:
*"Please add an A record: todo.flexo.com.ph → [Hostinger IP]."*

## Part 3: Hostinger: free SSL (HTTPS)

After `todo.flexo.com.ph` shows the Hostinger IP:
1. hPanel → **Security** → **SSL** → find `todo.flexo.com.ph` → **Install SSL** (free / Lifetime SSL).
2. Wait until it shows **Active** (a few minutes). The app needs HTTPS to install on phones and to work offline.

## Part 4: Hostinger: put the app there (Git, updates automatically)

1. **Empty the folder.** hPanel → **Files** → **File Manager** → `public_html/todo`. Delete anything Hostinger put
   there (e.g. `default.php`, `index.php`). Git deploy needs an empty folder.
2. hPanel → search the menu for **Git** (under **Advanced**).
3. **Private repository key** (needed once the repo is private; do it now): click **Generate SSH key** (or copy the
   key shown under *Private Git Repository*). Then on GitHub: `fmcai70/flexo-todo-app` → **Settings** →
   **Deploy keys** → **Add deploy key** → title `Hostinger`, paste the key, leave **Allow write access** unticked →
   **Add key**.
4. Back in hPanel → **Create a new repository**:

   | Field | Value |
   |---|---|
   | Repository | `git@github.com:fmcai70/flexo-todo-app.git` |
   | Branch | `main` |
   | Install path / Directory | `todo` (the subdomain's folder inside `public_html`) |

   Click **Create**, then **Deploy** (or **Pull**) once.
5. **Automatic updates:** on the repository row click **Auto Deployment** and copy the **Webhook URL**. On GitHub →
   **Settings** → **Webhooks** → **Add webhook** → paste it into *Payload URL*, keep *Just the push event* →
   **Add webhook**. From now on every update goes live within a minute.

**No Git option on your plan?** Use File Manager instead: on GitHub click **Code → Download ZIP**, upload the zip
into `public_html/todo`, **Extract**, and move the files out of the extracted `flexo-todo-app-main` folder so
`index.html` sits directly in `public_html/todo`. Repeat for each update (you'll be told when there is one).

The repository includes a `.htaccess` file that forces HTTPS, makes phones pick up new versions, and keeps the
setup guides, database scripts and Git files from being shown on the website. Keep it.

## Part 5: Supabase: allow the new address

1. **Authentication → URL Configuration**
   - **Site URL:** `https://todo.flexo.com.ph/`
   - **Redirect URLs:** add `https://todo.flexo.com.ph/` and **keep** `https://fmcai70.github.io/flexo-todo-app/`
     for now (people still using the old link).
   - **Save.**
2. **Edge Functions → Secrets:** change `APP_URL` to `https://todo.flexo.com.ph/` (the "Open Flexo Todo" button in
   emails, and where sign-in links return to).

## Part 6: Test (5 minutes)

On a PC and a phone, open `https://todo.flexo.com.ph`:
- [ ] The padlock shows (HTTPS), and the sign-in page appears with the Flexo Todo logo.
- [ ] Sign in with email and password; your projects and tasks are there (same database).
- [ ] **Forgot password?** → the email's button opens `todo.flexo.com.ph` on *Choose a new password*.
- [ ] Assign a task to someone → their notification email's button opens `todo.flexo.com.ph`.
- [ ] Android (Chrome) / iPhone (Safari): install the app from the new address; it opens and works.
- [ ] `https://todo.flexo.com.ph/CLAUDE.md` shows **Forbidden** (guides aren't public).

## Part 7: Switch everyone over

1. Send staff the new link. Anyone who installed the old app removes it and installs from
   `https://todo.flexo.com.ph` (Android: from Chrome). They sign in once; nothing is lost, since all data is in the database.
2. After about a week, make the code private: GitHub → `fmcai70/flexo-todo-app` → **Settings** → **General** →
   **Danger Zone** → **Change visibility** → **Private**. This also switches off the old
   `fmcai70.github.io/flexo-todo-app` address. Hostinger keeps updating through the deploy key from Part 4.
3. Then remove the old address from Supabase **Redirect URLs**.

## Troubleshooting

| Problem | Fix |
|---|---|
| `todo.flexo.com.ph` doesn't open at all | DNS not ready or wrong. `nslookup todo.flexo.com.ph` must show the Hostinger IP. Wait, or check the A record (Host is just `todo`). |
| "Not secure" / certificate error | SSL not installed yet (Part 3); it can only be issued after DNS works. |
| Hostinger default page or "Index of /" | Files are in the wrong folder; `index.html` must be directly in the subdomain's folder. |
| Git deploy fails: "Permission denied (publickey)" | The deploy key (Part 4.3) isn't added to the GitHub repository, or a different key was pasted. |
| Git deploy fails: "directory not empty" | Delete everything in the subdomain's folder first (Part 4.1). |
| Sign-in / reset link goes back to the old address or localhost | Part 5 not done: Site URL, Redirect URLs and the `APP_URL` secret. |
| Phones still show an old version | Close and reopen the app (twice). The `.htaccess` file must be present. |
