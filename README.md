# Flexo Todo App

A project and task tracker in the style of Todoist, with role-based project access.

- **Projects**, each with a **Project Manager** and **members** chosen when the project is created
- **Admins** can see and manage every project
- **Non-members can't see** a project or its tasks, either in the sidebar or by id
- **Personal tasks**: every user has a private **Inbox** for their own to-dos. Only they can see it, not even the admin
- Tasks have a due date, a priority (P1–P4), an assignee and a description, and can be marked complete
- **Subtasks**: open a task to add a checklist of subtasks. They show indented under it with a progress count (e.g. 2/4) and can be collapsed
- **Comments**: open a task to discuss it with the team. Web links are clickable, and the task row shows 💬 with the count. Comments on Inbox tasks stay private
- **Today**, **Upcoming** and **Assigned to me** views cover all the projects you can see
- **Repeating tasks** (daily, weekdays, weekly, every 2 weeks, monthly, yearly), **due times** and **reminders**
- **Sections** inside projects, and a **Board view** (columns you can drag cards between)
- **Labels** (`@urgent`), **saved filters** with Todoist-style queries (`p1 & @urgent | overdue`) and **search**
- **Notifications** (🔔) when someone assigns you a task, completes a task you created, or comments on your task, with optional **email** from your Microsoft 365 mailbox

## Run it

No install or build step is needed. It's plain HTML, CSS and JavaScript, plus a [Supabase](https://supabase.com) database.

The app has two modes:

| Mode | How | Data |
|------|-----|------|
| **Shared** (default) | Sign in with your Flexo email and password | Stored in Supabase and synced live between everyone. Access rules are enforced by the database |
| **Demo** | **Try the demo** on the sign-in screen | 5 sample users with a **Demo user** switcher. Kept only in that browser |

- **First-time setup** (admin, once): follow [supabase/SETUP.md](supabase/SETUP.md). It creates the database, adds users and makes `rogerick.aban@flexo.com.ph` the admin.
- **Tests:** open `tests.html` to run the 91 app-logic tests. Run `supabase/rls_tests.sql` in the Supabase SQL Editor to check the same 5-user permission rules against the real database.

> If your browser blocks scripts on `file://`, serve the folder with any static server,
> or use the GitHub Pages link below.

## Install on Android / iPhone

The app is a Progressive Web App (PWA). Once it's published on GitHub Pages you can install it from the browser, with no app store involved.

**Live link:** https://fmcai70.github.io/flexo-todo-app/

| Phone | Steps |
|-------|-------|
| **Android** (Chrome) | Open the link → tap **Install app** in the top bar, or go to menu ⋮ → **Install app** / **Add to Home screen** |
| **iPhone / iPad** (Safari) | Open the link → tap **Share** → **Add to Home Screen** → **Add** |

After installing, it opens full screen from its own icon. Shared mode needs an internet connection; the demo also works offline.
In shared mode, everyone sees the same live data on every device. Demo mode keeps its data only on that device.

**Reminders** pop up while the app is open (or was recently opened). Tap **🔔 Enable reminders** to get them as phone notifications on Android and desktop. On iPhone they show inside the app. Reminders while the app is fully closed would need push notifications from a server (a possible next step).

When you change the app, bump `CACHE` in `sw.js` (e.g. `flexo-todo-v2`) so installed phones load the new version.

## Files

| File | Purpose |
|------|---------|
| `store.js` | Data model and permission rules used by the app (no DOM, unit-testable) |
| `app.js` | UI rendering, sign-in screen, demo mode and saving changes |
| `index.html`, `styles.css` | App shell and styling |
| `tests.html`, `tests.js` | 91 automated tests covering the 5-user scenario |
| `TEST_SCENARIO.md` | User/role matrix, permission table and manual test steps |
| `manifest.webmanifest`, `sw.js`, `img/` | Makes it installable on phones and usable offline |
| `cloud.js` | Sign-in, loading and saving to Supabase, live updates |
| `supabase/schema.sql` | Database tables and the **server-side access rules** (Row Level Security) |
| `supabase/rls_tests.sql` | 5-user permission test against the real database |
| `supabase/functions/notify-email/` | Supabase function that sends notification emails through Microsoft 365 (Graph API) |
| `supabase/MICROSOFT365.md` | Microsoft 365 / Entra setup for the IT admin |
| `supabase/SETUP.md` | Step-by-step setup for the admin |

## Note on security

In shared mode, people sign in with Supabase Auth and **the database enforces every access rule** (see `supabase/schema.sql`). Even someone who edits the app in their browser can only read or change what their role allows.
