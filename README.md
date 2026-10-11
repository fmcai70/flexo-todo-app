# Flexo Todo App

A project and task tracker in the style of Todoist, with role-based project access.

- **Projects**, each with a **Project Manager** and **members** chosen when the project is created
- **Admins** can see and manage every project
- **Non-members can't see** a project or its tasks, either in the sidebar or by id
- **Personal tasks**: every user has a private **Inbox** for their own to-dos. Only they can see it, not even the admin
- Tasks have a due date, a priority (P1–P4), an assignee and a description, and can be marked complete
- **Subtasks**: open a task to add a checklist of subtasks. They show indented under it with a progress count (e.g. 2/4) and can be collapsed
- **Today**, **Upcoming** and **Assigned to me** views cover all the projects you can see

## Run it

No install or build step is needed. It's plain HTML, CSS and JavaScript.

1. Open `index.html` in Chrome, Edge or Firefox. Data is saved in the browser's localStorage.
2. Use the **Signed in as** dropdown to switch between the 5 demo users.
3. Open `tests.html` to run the automated 5-user permission tests.

> If your browser blocks scripts on `file://`, serve the folder with any static server,
> or use the GitHub Pages link below.

## Install on Android / iPhone

The app is a Progressive Web App (PWA). Once it's published on GitHub Pages you can install it from the browser, with no app store involved.

**Live link:** https://fmcai70.github.io/flexo-todo-app/

| Phone | Steps |
|-------|-------|
| **Android** (Chrome) | Open the link → tap **Install app** in the top bar, or go to menu ⋮ → **Install app** / **Add to Home screen** |
| **iPhone / iPad** (Safari) | Open the link → tap **Share** → **Add to Home Screen** → **Add** |

After installing, it opens full screen from its own icon and works offline.
Each phone keeps **its own copy of the data** (there's no shared server yet).

When you change the app, bump `CACHE` in `sw.js` (e.g. `flexo-todo-v2`) so installed phones load the new version.

## Files

| File | Purpose |
|------|---------|
| `store.js` | Data model and **all permission rules** (no DOM, unit-testable) |
| `app.js` | UI rendering and localStorage persistence |
| `index.html`, `styles.css` | App shell and styling |
| `tests.html`, `tests.js` | 53 automated tests covering the 5-user scenario |
| `TEST_SCENARIO.md` | User/role matrix, permission table and manual test steps |
| `manifest.webmanifest`, `sw.js`, `icons/` | Makes it installable on phones and usable offline |

## Note on security

This is a client-side demo. The user switcher stands in for a login, and all checks run in the browser.
For production, put the same rules from `store.js` behind a server API with real authentication and a database,
so the server enforces them instead of the browser.
