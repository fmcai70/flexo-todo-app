# Test Scenario: 5 Users

## Demo users

| # | User | Global role | Website Redesign | Mobile App Launch | Finance Audit 2026 |
|---|------|-------------|------------------|-------------------|--------------------|
| 1 | **Alice Santos** | Admin | admin access | admin access | **Project Manager** |
| 2 | **Bob Reyes** | User | **Project Manager** | — | — |
| 3 | **Carol Cruz** | User | Member | **Project Manager** | — |
| 4 | **Dave Lim** | User | — | Member | — |
| 5 | **Eve Garcia** | User | — | — | — |

"—" means the user **cannot see** the project or any of its tasks.

## Permission rules

| Action | Admin | Project Manager | Member | Non-member |
|--------|:-----:|:---------------:|:------:|:----------:|
| See the project and its tasks | ✅ | ✅ | ✅ | ❌ |
| Add, edit, complete tasks | ✅ | ✅ | ✅ | ❌ |
| Delete own task | ✅ | ✅ | ✅ | ❌ |
| Delete anyone's task | ✅ | ✅ | ❌ | ❌ |
| Rename or delete the project | ✅ | ✅ | ❌ | ❌ |
| Add or remove members | ✅ | ✅ | ❌ | ❌ |
| Change the Project Manager | ✅ | ❌ | ❌ | ❌ |
| Create a project (becomes its PM) | ✅ | ✅ | ✅ | ✅ |
| Create a project with someone else as PM | ✅ | ❌ | ❌ | ❌ |

| Create **personal tasks** in own Inbox | ✅ | ✅ | ✅ | ✅ |
| See someone else's personal tasks | ❌ | ❌ | ❌ | ❌ |

Other rules:
- **Sections**: any member can add or rename a section. Only the PM or admin can delete one, and its tasks move to "No section". Subtasks and Inbox tasks are not put in sections.
- **Labels, filters and search** only ever show tasks you can already see. **Saved filters are private** to the person who made them.
- **Repeating tasks** are never marked done. Completing one moves it to its next date and reopens its subtasks. Repeat, time and reminder all need a due date.
- **Reminders** go to the task's assignee only.
- **Subtasks** follow their parent: same project, same visibility. Completing a task completes its subtasks, reopening a subtask reopens the parent, and deleting a task deletes its subtasks. They go one level deep.
- **Personal tasks** sit in each user's private **Inbox** and also show in their Today, Upcoming and Assigned to me views. Only the creator can see them, **not even the admin**, and they can't be assigned to anyone else.
- Tasks can only be assigned to the project's PM or members.
- When a member is removed, their tasks in that project go back to *Unassigned*.
- The PM can't be removed. An admin has to assign a new PM first, and the old PM then stays on as a member.

## Automated tests

Open `tests.html` in a browser. It runs 78 checks in 11 groups and shows **PASS/FAIL** in the tab title:

1. Project visibility per user
2. Non-members are blocked from direct access (by id, task edits, cross-project views)
3. Project creation: manager and members
4. Managing members (add, remove, change PM, delete project)
5. Tasks (assignment rules, complete/reopen, delete rights, Today/Upcoming views)
6. Personal tasks (private Inbox)
7. Subtasks
8. Recurring tasks, due times and reminders
9. Sections and board columns
10. Labels, filters and search
11. An end-to-end story across all 5 users

## Manual walkthrough

On the sign-in screen, tap **Try the demo**, then use the **Demo user** dropdown to switch users. **Reset demo** restores the starting data. (To check the same rules on the real database, run `supabase/rls_tests.sql`. See [supabase/SETUP.md](supabase/SETUP.md).)

| Step | Sign in as | Do this | Expected result |
|------|-----------|---------|-----------------|
| 1 | Alice | Look at *My Projects* | All 3 projects listed. Website/Mobile show an **Admin** tag, Finance shows **PM** |
| 2 | Bob | Look at *My Projects* | Only **Website Redesign** (PM tag) |
| 3 | Carol | Look at *My Projects* | **Website Redesign** + **Mobile App Launch** (PM) |
| 4 | Dave | Look at *My Projects* | Only **Mobile App Launch** |
| 5 | Eve | Look at *My Projects* | Empty, with the hint "You are not a member of any project yet" |
| 6 | Dave | Open Mobile App → **Project info** | Read-only dialog with no Save button |
| 7 | Dave | Add task "Update privacy policy" assigned to Carol | Task appears. Carol sees it under *Assigned to me* |
| 8 | Bob | Open Website Redesign → **Manage project** → tick Eve → Save | Eve added as member |
| 9 | Eve | Look at *My Projects* | **Website Redesign** now visible with its tasks |
| 10 | Eve | Click **＋** next to My Projects → create "Office Move" | Eve is PM. The PM dropdown is locked to her |
| 11 | Bob / Carol / Dave | Look at *My Projects* | "Office Move" **not** visible |
| 12 | Alice | Look at *My Projects* | "Office Move" visible with an **Admin** tag |
| 13 | Alice | Open Website Redesign → Manage → change PM to Carol → Save | Carol becomes PM. Bob stays a member |
| 14 | Bob | Open a task he didn't create in Website Redesign | No Delete button (he is now only a member) |
| 15 | Carol | Manage Website Redesign → untick Eve → Save | Eve loses access. Her assigned tasks become Unassigned |
| 16 | Eve | Open **Inbox** → add "Buy safety shoes" due today | Task shows in Inbox and in **Today** with a 📥 Inbox label |
| 17 | Bob, Alice | Check Inbox / Today | Eve's personal task is **not** visible, even to the admin |
| 18 | Bob | Open Inbox | Only his own "Book dentist appointment" |
| 19 | Bob | Website Redesign → open "Draft new homepage wireframe" | **Subtasks 1/3** in the dialog (Hero done, Features, Pricing) |
| 20 | Bob | Type "Footer section" in *Add a subtask…* → Enter | Appears under the task. Count becomes 1/4 |
| 21 | Bob | Click **⑂ 1/4 ▾** on the task row | Subtasks collapse. Click again to expand |
| 22 | Carol | Tick the parent task's circle | Parent **and all its subtasks** complete |
| 23 | Dave, Eve | Look for the subtasks | Not visible: they follow the parent project's access |
| 24 | Carol | Mobile App Launch → **Board** | Columns: No section, Development, Release |
| 25 | Carol | Drag "Write release notes" to **No section** (on a phone, open the task → *Section*) | Card moves. "Moved to No section" message appears |
| 26 | Carol | Type in a column's **＋ Add task** box → Enter | Task is created in that column |
| 27 | Carol | Open a task → Due tomorrow, Time 09:30, Repeat *Every week*, Reminder *30 minutes before*, Labels `@analytics` → Save | Card shows 📅 Tomorrow 9:30 AM 🔁 ⏰ @analytics |
| 28 | Carol | Tick that task | Stays open and moves to next week ("🔁 Done! Next: …") |
| 29 | Carol | Sidebar **Filters ＋** → name "Urgent bugs", tap example `p1 & @urgent` → Save | Preview says 1 match. The filter lists "Fix login crash on Android" |
| 30 | Bob | Look at Filters | Sees only his own "My week", not Carol's filter |
| 31 | Bob | Click label **urgent** | Only "Set up staging site" (Mobile App tasks stay hidden) |
| 32 | Bob / Carol | Search "release" | Bob: no results. Carol: 2 Mobile App tasks |
| 33 | Dave | Tap **🔔 Enable reminders** → Allow. Keep the app open at 2:30 PM | "Finalize app store screenshots" reminder pops up (it's due 3:00 PM) |
