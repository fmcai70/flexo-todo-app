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

Other rules:
- Tasks can only be assigned to the project's PM or members.
- When a member is removed, their tasks in that project go back to *Unassigned*.
- The PM can't be removed. An admin has to assign a new PM first, and the old PM then stays on as a member.

## Automated tests

Open `tests.html` in a browser. It runs 36 checks in 6 groups and shows **PASS/FAIL** in the tab title:

1. Project visibility per user
2. Non-members are blocked from direct access (by id, task edits, cross-project views)
3. Project creation: manager and members
4. Managing members (add, remove, change PM, delete project)
5. Tasks (assignment rules, complete/reopen, delete rights, Today/Upcoming views)
6. An end-to-end story across all 5 users

## Manual walkthrough

Use the **Signed in as** dropdown to switch users. **Reset demo** restores the starting data.

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
