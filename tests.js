/*
 * 5-user test scenario. Open tests.html in a browser to run.
 *
 *   u1 Alice Santos  — Admin           (PM of "Finance Audit 2026")
 *   u2 Bob Reyes     — User            (PM of "Website Redesign")
 *   u3 Carol Cruz    — User            (PM of "Mobile App Launch", member of "Website Redesign")
 *   u4 Dave Lim      — User            (member of "Mobile App Launch")
 *   u5 Eve Garcia    — User            (not in any project)
 */
(function () {
  'use strict';
  const { createStore, PermissionError, ValidationError } = window.TaskStore;
  const ALICE = 'u1', BOB = 'u2', CAROL = 'u3', DAVE = 'u4', EVE = 'u5';
  const WEB = 'p1', MOBILE = 'p2', FINANCE = 'p3';

  const results = [];
  let section = '';
  const describe = (name, fn) => { section = name; fn(); };
  function test(name, fn) {
    try { fn(createStore()); results.push({ section, name, ok: true }); }
    catch (e) { results.push({ section, name, ok: false, error: e && e.stack ? e.message : String(e) }); }
  }
  function assert(cond, msg) { if (!cond) throw new Error(msg || 'Assertion failed'); }
  function eq(actual, expected, msg) {
    const a = JSON.stringify(actual), b = JSON.stringify(expected);
    if (a !== b) throw new Error((msg ? msg + ': ' : '') + 'expected ' + b + ', got ' + a);
  }
  function throws(fn, Type, msg) {
    try { fn(); } catch (e) {
      if (Type && !(e instanceof Type)) throw new Error((msg || 'Wrong error') + ': expected ' + Type.name + ', got ' + e.name + ' (' + e.message + ')');
      return e;
    }
    throw new Error((msg || 'Expected an error') + ' — but none was thrown');
  }
  const projectNames = (s, user) => s.listProjects(user).map((p) => p.id).sort();

  // ------------------------------------------------------------------
  describe('1. Project visibility per user', () => {
    test('Alice (admin) sees ALL projects, including ones she is not a member of', (s) => {
      eq(projectNames(s, ALICE), [WEB, MOBILE, FINANCE]);
      eq(s.roleIn(ALICE, WEB), 'admin');
      eq(s.roleIn(ALICE, FINANCE), 'manager');
    });
    test('Bob sees only Website Redesign', (s) => eq(projectNames(s, BOB), [WEB]));
    test('Carol sees Website Redesign and Mobile App', (s) => eq(projectNames(s, CAROL), [WEB, MOBILE]));
    test('Dave sees only Mobile App', (s) => eq(projectNames(s, DAVE), [MOBILE]));
    test('Eve sees no projects and no project tasks (only her own Inbox)', (s) => {
      eq(projectNames(s, EVE), []);
      eq(s.listTasks(EVE, { includeCompleted: true }).filter((t) => t.projectId !== null).length, 0);
    });
    test('Nobody but the admin can see Finance Audit (admin-only project)', (s) => {
      [BOB, CAROL, DAVE, EVE].forEach((u) => assert(!s.canView(u, FINANCE), u + ' should not see Finance'));
    });
  });

  describe('2. Non-members are blocked from direct access', () => {
    test('Dave cannot open Website Redesign by id', (s) => throws(() => s.getProject(DAVE, WEB), PermissionError));
    test('Bob cannot list Mobile App tasks', (s) => throws(() => s.listTasks(BOB, { projectId: MOBILE }), PermissionError));
    test('Eve cannot add a task to Website Redesign', (s) => throws(() => s.createTask(EVE, WEB, { title: 'sneaky' }), PermissionError));
    test('Bob cannot read, edit, complete or delete a Mobile App task', (s) => {
      throws(() => s.getTask(BOB, 't6'), PermissionError);
      throws(() => s.updateTask(BOB, 't6', { title: 'x' }), PermissionError);
      throws(() => s.toggleTask(BOB, 't6'), PermissionError);
      throws(() => s.deleteTask(BOB, 't6'), PermissionError);
    });
    test('Unknown project id gives the same "no access" error (no id probing)', (s) => {
      const e = throws(() => s.getProject(EVE, 'p999'), PermissionError);
      eq(e.message, 'You do not have access to this project');
    });
    test('Cross-project views (Today/Upcoming/Mine) never leak other projects\' tasks', (s) => {
      const visible = new Set(projectNames(s, DAVE));
      ['today', 'upcoming', 'mine', undefined].forEach((view) =>
        s.listTasks(DAVE, { view, includeCompleted: true }).forEach((t) =>
          assert(t.projectId === null ? t.createdBy === DAVE : visible.has(t.projectId), 'leaked task ' + t.id + ' in view ' + view)));
    });
  });

  describe('3. Project creation: manager & members', () => {
    test('Eve creates a project → she becomes its PM; only she and the admin see it', (s) => {
      const p = s.createProject(EVE, { name: 'Office Move', memberIds: [] });
      eq(p.managerId, EVE);
      eq(s.roleIn(EVE, p.id), 'manager');
      assert(s.canView(ALICE, p.id), 'admin should see it');
      [BOB, CAROL, DAVE].forEach((u) => assert(!s.canView(u, p.id), u + ' should not see it'));
    });
    test('Members chosen at creation can see the project immediately', (s) => {
      const p = s.createProject(BOB, { name: 'Q4 Campaign', memberIds: [DAVE, EVE] });
      assert(s.canView(DAVE, p.id) && s.canView(EVE, p.id));
      assert(!s.canView(CAROL, p.id));
    });
    test('A non-admin cannot appoint someone else as PM', (s) =>
      throws(() => s.createProject(DAVE, { name: 'X', managerId: CAROL }), PermissionError));
    test('Admin can create a project and appoint another user as PM', (s) => {
      const p = s.createProject(ALICE, { name: 'Hiring', managerId: DAVE, memberIds: [EVE] });
      eq(p.managerId, DAVE);
      eq(s.roleIn(DAVE, p.id), 'manager');
      eq(s.roleIn(ALICE, p.id), 'admin', 'admin keeps access without being a member');
    });
    test('Manager is not duplicated in the member list', (s) => {
      const p = s.createProject(CAROL, { name: 'Dup', memberIds: [CAROL, DAVE, DAVE] });
      eq(p.memberIds, [DAVE]);
    });
    test('Project name is required', (s) => throws(() => s.createProject(BOB, { name: '  ' }), ValidationError));
  });

  describe('4. Managing members', () => {
    test('Bob (PM) adds Eve → Eve can now see Website Redesign and its tasks', (s) => {
      s.addMember(BOB, WEB, EVE);
      eq(projectNames(s, EVE), [WEB]);
      assert(s.listTasks(EVE, { projectId: WEB }).length > 0);
    });
    test('Carol (member, not PM) cannot add members to Website Redesign', (s) =>
      throws(() => s.addMember(CAROL, WEB, DAVE), PermissionError));
    test('Admin can add members to any project', (s) => {
      s.addMember(ALICE, MOBILE, BOB);
      assert(s.canView(BOB, MOBILE));
    });
    test('Removing Carol from Website Redesign revokes access and unassigns her tasks', (s) => {
      s.removeMember(BOB, WEB, CAROL);
      assert(!s.canView(CAROL, WEB));
      throws(() => s.getTask(CAROL, 't1'), PermissionError);
      eq(s.getTask(BOB, 't1').assigneeId, null);
      eq(s.getTask(BOB, 't3').assigneeId, null);
    });
    test('The PM cannot be removed from their own project', (s) =>
      throws(() => s.removeMember(ALICE, WEB, BOB), ValidationError));
    test('Only the admin can change the PM; old PM stays as a member', (s) => {
      throws(() => s.setManager(BOB, WEB, CAROL), PermissionError);
      const p = s.setManager(ALICE, WEB, CAROL);
      eq(p.managerId, CAROL);
      assert(p.memberIds.includes(BOB) && !p.memberIds.includes(CAROL));
      assert(s.canManage(CAROL, WEB) && !s.canManage(BOB, WEB));
    });
    test('Members cannot rename or delete the project', (s) => {
      throws(() => s.updateProject(DAVE, MOBILE, { name: 'Hacked' }), PermissionError);
      throws(() => s.deleteProject(DAVE, MOBILE), PermissionError);
    });
    test('Admin can delete any project (and its tasks)', (s) => {
      s.deleteProject(ALICE, MOBILE);
      eq(projectNames(s, DAVE), []);
      eq(s.state.tasks.filter((t) => t.projectId === MOBILE).length, 0);
    });
  });

  describe('5. Tasks', () => {
    test('Dave (member) adds a task and assigns it to Carol (PM)', (s) => {
      const t = s.createTask(DAVE, MOBILE, { title: 'Update privacy policy', assigneeId: CAROL, priority: 2, dueDate: '2026-12-01' });
      eq([t.createdBy, t.assigneeId, t.priority], [DAVE, CAROL, 2]);
      assert(s.listTasks(CAROL, { view: 'mine' }).some((x) => x.id === t.id));
    });
    test('Tasks can only be assigned to project members', (s) => {
      throws(() => s.createTask(BOB, WEB, { title: 'x', assigneeId: DAVE }), ValidationError);
      throws(() => s.updateTask(BOB, 't2', { assigneeId: EVE }), ValidationError);
    });
    test('Admin can add tasks to a project they are not a member of', (s) => {
      const t = s.createTask(ALICE, WEB, { title: 'Security review' });
      eq(t.projectId, WEB);
    });
    test('Members can complete and reopen tasks', (s) => {
      eq(s.toggleTask(DAVE, 't5').completed, true);
      eq(s.toggleTask(DAVE, 't5').completed, false);
    });
    test('Completed tasks are hidden unless requested', (s) => {
      assert(!s.listTasks(CAROL, { projectId: MOBILE }).some((t) => t.id === 't8'));
      assert(s.listTasks(CAROL, { projectId: MOBILE, includeCompleted: true }).some((t) => t.id === 't8'));
    });
    test('A member can delete their own task but not someone else\'s', (s) => {
      s.deleteTask(DAVE, 't7'); // Dave created t7
      throws(() => s.deleteTask(DAVE, 't6'), PermissionError); // Carol created t6
    });
    test('The PM and the admin can delete any task in the project', (s) => {
      s.deleteTask(CAROL, 't7');
      s.deleteTask(ALICE, 't6');
      eq(s.listTasks(CAROL, { projectId: MOBILE, includeCompleted: true }).map((t) => t.id).sort(), ['t5', 't8']);
    });
    test('Title is required and priority must be 1-4', (s) => {
      throws(() => s.createTask(BOB, WEB, { title: '' }), ValidationError);
      throws(() => s.createTask(BOB, WEB, { title: 'x', priority: 7 }), ValidationError);
    });
    test('Today view = overdue + due today; Upcoming = after today', (s) => {
      const today = window.TaskStore.isoDate(0);
      s.listTasks(BOB, { view: 'today' }).forEach((t) => assert(t.dueDate <= today));
      s.listTasks(BOB, { view: 'upcoming' }).forEach((t) => assert(t.dueDate > today));
      eq(s.listTasks(BOB, { view: 'today' }).map((t) => t.id).sort(), ['t1', 't4']);
    });
  });

  describe('6. Personal tasks (private Inbox)', () => {
    test('Every user, even one with no projects, can create a personal task', (s) => {
      [ALICE, BOB, CAROL, DAVE, EVE].forEach((u) => {
        const t = s.createTask(u, null, { title: 'My own task ' + u });
        eq([t.projectId, t.createdBy, t.assigneeId], [null, u, u]);
      });
    });
    test('Inbox shows only the user\'s own personal tasks', (s) => {
      eq(s.listTasks(EVE, { view: 'inbox', includeCompleted: true }).map((t) => t.id).sort(), ['t13', 't14']);
      eq(s.listTasks(BOB, { view: 'inbox' }).map((t) => t.id), ['t12']);
      eq(s.listTasks(DAVE, { view: 'inbox' }).length, 0);
    });
    test('Other users cannot see, edit, complete or delete someone\'s personal task', (s) => {
      [BOB, CAROL, DAVE].forEach((u) => {
        throws(() => s.getTask(u, 't13'), PermissionError);
        throws(() => s.updateTask(u, 't13', { title: 'x' }), PermissionError);
        throws(() => s.toggleTask(u, 't13'), PermissionError);
        throws(() => s.deleteTask(u, 't13'), PermissionError);
        assert(!s.listTasks(u, { includeCompleted: true }).some((t) => t.id === 't13'), u + ' sees Eve\'s task');
      });
    });
    test('Personal tasks stay private even from the admin', (s) => {
      throws(() => s.getTask(ALICE, 't12'), PermissionError);
      assert(!s.listTasks(ALICE, { includeCompleted: true }).some((t) => t.id === 't12'));
    });
    test('Personal tasks appear in the owner\'s Today / Upcoming / Assigned to me', (s) => {
      assert(s.listTasks(EVE, { view: 'today' }).some((t) => t.id === 't13'), 'Today');
      assert(s.listTasks(BOB, { view: 'upcoming' }).some((t) => t.id === 't12'), 'Upcoming');
      assert(s.listTasks(EVE, { view: 'mine' }).some((t) => t.id === 't14'), 'Assigned to me');
    });
    test('Owner can edit, complete and delete their personal task', (s) => {
      eq(s.updateTask(EVE, 't13', { title: 'Read handbook ch.1', priority: 1 }).priority, 1);
      eq(s.toggleTask(EVE, 't13').completed, true);
      s.deleteTask(EVE, 't13');
      throws(() => s.getTask(EVE, 't13'), PermissionError);
    });
    test('Personal tasks cannot be assigned to someone else', (s) => {
      throws(() => s.createTask(BOB, null, { title: 'x', assigneeId: CAROL }), ValidationError);
      throws(() => s.updateTask(BOB, 't12', { assigneeId: CAROL }), ValidationError);
    });
  });

  describe('7. Subtasks', () => {
    test('A member adds a subtask; it inherits the parent\'s project', (s) => {
      const st = s.createSubtask(CAROL, 't6', { title: 'Check crash logs', assigneeId: DAVE });
      eq([st.parentId, st.projectId, st.assigneeId], ['t6', MOBILE, DAVE]);
      eq(s.listSubtasks(DAVE, 't6').map((t) => t.title), ['Reproduce on Pixel 8', 'Check crash logs']);
    });
    test('Non-members can neither see nor add subtasks', (s) => {
      throws(() => s.listSubtasks(BOB, 't6'), PermissionError);
      throws(() => s.getTask(BOB, 't18'), PermissionError);
      throws(() => s.createSubtask(EVE, 't1', { title: 'x' }), PermissionError);
    });
    test('Subtasks of a personal task stay private to the owner', (s) => {
      eq(s.listSubtasks(ALICE, 't11').map((t) => t.id), ['t19']);
      throws(() => s.getTask(BOB, 't19'), PermissionError);
      throws(() => s.createSubtask(BOB, 't11', { title: 'x' }), PermissionError);
      const st = s.createSubtask(EVE, 't13', { title: 'Chapter 1' });
      eq([st.projectId, st.assigneeId], [null, EVE]);
    });
    test('Subtask assignee must be a project member', (s) =>
      throws(() => s.createSubtask(BOB, 't1', { title: 'x', assigneeId: DAVE }), ValidationError));
    test('Only one level: a subtask cannot have subtasks', (s) =>
      throws(() => s.createSubtask(BOB, 't16', { title: 'x' }), ValidationError));
    test('Completing a task completes all of its subtasks', (s) => {
      s.toggleTask(BOB, 't1');
      assert(s.listSubtasks(BOB, 't1').every((t) => t.completed));
    });
    test('Reopening a subtask reopens its parent', (s) => {
      s.toggleTask(BOB, 't1');
      s.toggleTask(CAROL, 't17');
      eq(s.getTask(BOB, 't1').completed, false);
    });
    test('Adding a subtask to a completed task reopens it', (s) => {
      s.toggleTask(CAROL, 't8'); // reopen…
      s.toggleTask(CAROL, 't8'); // …and complete again
      s.createSubtask(CAROL, 't8', { title: 'Late feedback' });
      eq(s.getTask(CAROL, 't8').completed, false);
    });
    test('Deleting a task deletes its subtasks', (s) => {
      s.deleteTask(BOB, 't1');
      ['t15', 't16', 't17'].forEach((id) => assert(!s.state.tasks.some((t) => t.id === id), id + ' still exists'));
    });
    test('Subtasks with due dates show in Today / Upcoming / Assigned to me', (s) => {
      assert(s.listTasks(DAVE, { view: 'upcoming' }).some((t) => t.id === 't18'));
      assert(s.listTasks(DAVE, { view: 'mine' }).some((t) => t.id === 't18'));
    });
  });

  const { nextDueDate, reminderAt, normalizeLabels, isoDate } = window.TaskStore;
  const ids = (tasks) => tasks.map((t) => t.id).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const atToday = (hh, mm) => { const [y, m, d] = isoDate(0).split('-').map(Number); return new Date(y, m - 1, d, hh, mm); };

  describe('8. Recurring tasks, due times and reminders', () => {
    test('Next date: daily, weekly (overdue), weekdays (Fri → Mon), early completion', () => {
      eq(nextDueDate('2026-10-11', 'daily', '2026-10-11'), '2026-10-12');
      eq(nextDueDate('2026-10-05', 'weekly', '2026-10-11'), '2026-10-12', 'overdue weekly jumps past today');
      eq(nextDueDate('2026-10-09', 'weekdays', '2026-10-09'), '2026-10-12', 'Friday → Monday');
      eq(nextDueDate('2026-10-20', 'daily', '2026-10-11'), '2026-10-21', 'completed early → one step');
      eq(nextDueDate('2026-10-11', 'biweekly', '2026-10-11'), '2026-10-25');
    });
    test('Next date: monthly and yearly clamp to the end of short months', () => {
      eq(nextDueDate('2026-01-31', 'monthly', '2026-01-31'), '2026-02-28');
      eq(nextDueDate('2028-01-31', 'monthly', '2028-01-31'), '2028-02-29', 'leap year');
      eq(nextDueDate('2026-03-15', 'yearly', '2026-03-15'), '2027-03-15');
    });
    test('Completing a recurring task moves it to the next date and keeps it open', (s) => {
      const r = s.toggleTask(CAROL, 't22');
      const today = isoDate(0);
      assert(r.rolledOver && !r.completed, 'should roll over, not complete');
      assert(r.dueDate > today, 'next date after today');
      assert(![0, 6].includes(new Date(r.dueDate + 'T12:00').getDay()), 'weekday rule skips weekends');
      assert(r.lastCompletedAt, 'remembers when it was last done');
    });
    test('Completing a recurring task reopens its subtasks for the next round', (s) => {
      const sub = s.createSubtask(ALICE, 't20', { title: 'Export bank balances' });
      s.toggleTask(ALICE, sub.id);
      const before = s.getTask(ALICE, 't20').dueDate;
      s.toggleTask(ALICE, 't20');
      eq(s.getTask(ALICE, sub.id).completed, false);
      eq(s.getTask(ALICE, 't20').dueDate, nextDueDate(before, 'weekly'));
    });
    test('Repeat, time and reminder need a due date; bad values are rejected', (s) => {
      throws(() => s.createTask(BOB, WEB, { title: 'x', recurrence: 'weekly' }), ValidationError);
      throws(() => s.createTask(BOB, WEB, { title: 'x', dueTime: '10:00' }), ValidationError);
      throws(() => s.createTask(BOB, WEB, { title: 'x', reminder: 30 }), ValidationError);
      throws(() => s.createTask(BOB, WEB, { title: 'x', dueDate: '2026-12-01', dueTime: '25:00' }), ValidationError);
      throws(() => s.createTask(BOB, WEB, { title: 'x', dueDate: '2026-12-01', recurrence: 'hourly' }), ValidationError);
      throws(() => s.createTask(BOB, WEB, { title: 'x', dueDate: '2026-12-01', reminder: 7 }), ValidationError);
    });
    test('Clearing the due date also clears time, repeat and reminder', (s) => {
      const t = s.updateTask(ALICE, 't20', { dueDate: '' });
      eq([t.dueDate, t.dueTime, t.recurrence, t.reminder], [null, null, null, null]);
    });
    test('Reminder time: minutes before the due time; date-only tasks count as 09:00', () => {
      eq(reminderAt({ dueDate: '2026-10-11', dueTime: '15:00', reminder: 30 }).getTime(), new Date(2026, 9, 11, 14, 30).getTime());
      eq(reminderAt({ dueDate: '2026-10-11', dueTime: null, reminder: 0 }).getTime(), new Date(2026, 9, 11, 9, 0).getTime());
      eq(reminderAt({ dueDate: '2026-10-11', dueTime: null, reminder: 1440 }).getTime(), new Date(2026, 9, 10, 9, 0).getTime());
      eq(reminderAt({ dueDate: '2026-10-11', dueTime: '15:00', reminder: null }), null);
    });
    test('Reminders go only to the assignee, once the time has passed', (s) => {
      // t5: due today 15:00, remind 30 min before, assigned to Dave.
      eq(ids(s.dueReminders(DAVE, atToday(14, 45))), ['t5']);
      eq(s.dueReminders(DAVE, atToday(14, 0)).length, 0, 'not yet');
      eq(s.dueReminders(CAROL, atToday(14, 45)).filter((t) => t.id === 't5').length, 0, 'Carol is not the assignee');
      eq(s.dueReminders(BOB, atToday(14, 45)).length, 0, 'Bob cannot see the project');
    });
  });

  describe('9. Sections and board columns', () => {
    test('Members see the project\'s sections; non-members cannot', (s) => {
      eq(s.listSections(DAVE, MOBILE).map((x) => x.name), ['Development', 'Release']);
      throws(() => s.listSections(BOB, MOBILE), PermissionError);
    });
    test('Members can add and rename sections; outsiders cannot', (s) => {
      const qa = s.createSection(DAVE, MOBILE, 'QA');
      eq(s.renameSection(DAVE, qa.id, 'Testing').name, 'Testing');
      throws(() => s.createSection(EVE, WEB, 'Sneaky'), PermissionError);
      throws(() => s.renameSection(BOB, 's3', 'x'), PermissionError);
    });
    test('Tasks can be created in and moved between sections of the same project', (s) => {
      eq(s.createTask(DAVE, MOBILE, { title: 'Crash analytics', sectionId: 's3' }).sectionId, 's3');
      eq(s.updateTask(CAROL, 't7', { sectionId: 's3' }).sectionId, 's3');
      eq(s.updateTask(CAROL, 't7', { sectionId: '' }).sectionId, null, 'back to No section');
      throws(() => s.createTask(DAVE, MOBILE, { title: 'x', sectionId: 's1' }), ValidationError, 'section from another project');
    });
    test('Subtasks and Inbox tasks cannot be put in a section', (s) => {
      throws(() => s.updateTask(BOB, 't16', { sectionId: 's2' }), ValidationError);
      throws(() => s.createTask(EVE, null, { title: 'x', sectionId: 's1' }), ValidationError);
    });
    test('Only the PM/admin can delete a section; its tasks move to No section', (s) => {
      throws(() => s.deleteSection(DAVE, 's4'), PermissionError);
      s.deleteSection(CAROL, 's4');
      eq(s.listSections(CAROL, MOBILE).map((x) => x.id), ['s3']);
      ['t5', 't7', 't8'].forEach((id) => eq(s.getTask(CAROL, id).sectionId, null, id));
    });
    test('Deleting a project deletes its sections', (s) => {
      s.deleteProject(ALICE, MOBILE);
      assert(!s.state.sections.some((x) => x.projectId === MOBILE));
    });
  });

  describe('10. Labels, filters and search', () => {
    test('Labels are normalized: "@Urgent, client-x urgent" → urgent, client-x', () => {
      eq(normalizeLabels('@Urgent, client-x urgent'), ['urgent', 'client-x']);
      throws(() => normalizeLabels('hello!'), ValidationError);
    });
    test('Members can label tasks', (s) => eq(s.updateTask(DAVE, 't6', { labels: '@bug @android' }).labels, ['bug', 'android']));
    test('Label list only includes labels from tasks the user can see', (s) => {
      eq(s.listLabels(BOB).map((l) => l.name), ['design', 'urgent']);
      eq(s.listLabels(CAROL).map((l) => l.name), ['bug', 'design', 'release', 'urgent']);
      eq(s.listLabels(EVE), []);
    });
    test('@label view respects visibility (Carol sees 2 urgent tasks, Bob 1)', (s) => {
      eq(ids(s.listTasks(CAROL, { label: 'urgent' })), ['t4', 't6']);
      eq(ids(s.listTasks(BOB, { label: 'urgent' })), ['t4']);
    });
    test('Filter terms: p1 & @label, today | overdue, #Project, #Inbox, no date, recurring', (s) => {
      eq(ids(s.filterTasks(CAROL, 'p1 & @urgent')), ['t6']);
      eq(ids(s.filterTasks(BOB, 'today | overdue', { now: atToday(8, 0) })), ['t1', 't4']);
      eq(ids(s.filterTasks(DAVE, '#Mobile App Launch')), ['t5', 't6', 't7', 't18']);
      eq(ids(s.filterTasks(EVE, '#Inbox')), ['t13', 't14']);
      eq(ids(s.filterTasks(EVE, 'no date')), ['t14']);
      eq(ids(s.filterTasks(ALICE, 'recurring')), ['t20', 't21']);
    });
    test('Filter terms: assigned to, negation, search:, next N days', (s) => {
      eq(ids(s.filterTasks(DAVE, 'assigned to: me')), ['t5', 't6', 't18']);
      eq(ids(s.filterTasks(BOB, 'assigned to: Carol')), ['t1', 't3', 't16', 't17']);
      eq(ids(s.filterTasks(BOB, '#Website Redesign & !@urgent & !subtask')), ['t1', 't2', 't3']);
      eq(ids(s.filterTasks(CAROL, 'search: crash')), ['t6']);
      eq(ids(s.filterTasks(BOB, 'assigned to: me & next 7 days')), ['t2', 't12']);
    });
    test('"Overdue" includes tasks due earlier today once their time has passed', (s) => {
      assert(!s.filterTasks(DAVE, 'overdue', { now: atToday(14, 0) }).some((t) => t.id === 't5'));
      assert(s.filterTasks(DAVE, 'overdue', { now: atToday(15, 30) }).some((t) => t.id === 't5'));
    });
    test('Filters never reveal tasks outside the user\'s projects', (s) => {
      eq(ids(s.filterTasks(EVE, 'p1 | p2 | p3 | p4')), ['t13', 't14']);
      eq(s.filterTasks(BOB, '#Mobile App Launch').length, 0);
    });
    test('Invalid filter queries are rejected with a clear message', (s) => {
      const e = throws(() => s.filterTasks(BOB, 'p1 & banana'), ValidationError);
      assert(e.message.includes('banana'));
      throws(() => s.filterTasks(BOB, '  '), ValidationError);
      throws(() => s.createFilter(BOB, { name: 'Bad', query: 'p9' }), ValidationError);
    });
    test('Saved filters are private to their owner', (s) => {
      eq(s.listFilters(ALICE).map((f) => f.id), ['f1']);
      eq(s.listFilters(BOB).map((f) => f.id), ['f2']);
      throws(() => s.getFilter(BOB, 'f1'), PermissionError);
      throws(() => s.deleteFilter(BOB, 'f1'), PermissionError);
      throws(() => s.updateFilter(BOB, 'f1', { name: 'x' }), PermissionError);
      const f = s.createFilter(EVE, { name: 'My P1s', query: 'p1' });
      eq(s.listFilters(EVE).map((x) => x.id), [f.id]);
      s.deleteFilter(EVE, f.id);
      eq(s.listFilters(EVE).length, 0);
    });
    test('Search matches title, description and labels within visible tasks only', (s) => {
      eq(ids(s.searchTasks(CAROL, 'crash')), ['t6']);
      eq(s.searchTasks(BOB, 'crash').length, 0, 'Bob is not in Mobile App');
      eq(ids(s.searchTasks(DAVE, 'biometric')), ['t6'], 'description match');
      eq(ids(s.searchTasks(BOB, 'dentist')), ['t12']);
      eq(s.searchTasks(ALICE, 'dentist').length, 0, 'personal tasks stay private');
      eq(ids(s.searchTasks(CAROL, '@release')), ['t5', 't7']);
    });
  });

  describe('11. End-to-end story across all 5 users', () => {
    test('Full scenario', (s) => {
      // Alice (admin) starts a project, appoints Bob as PM with Dave as member.
      const p = s.createProject(ALICE, { name: 'Customer Portal', managerId: BOB, memberIds: [DAVE] });
      // Bob plans the work and brings Eve on board.
      s.addMember(BOB, p.id, EVE);
      const t1 = s.createTask(BOB, p.id, { title: 'API design', assigneeId: DAVE, priority: 1 });
      const t2 = s.createTask(BOB, p.id, { title: 'Login page', assigneeId: EVE, priority: 2 });
      // Carol is not on the team and can't see any of it.
      assert(!s.canView(CAROL, p.id));
      assert(!s.listTasks(CAROL, { includeCompleted: true }).some((t) => t.projectId === p.id));
      // Dave and Eve complete their work.
      s.toggleTask(DAVE, t1.id);
      s.toggleTask(EVE, t2.id);
      eq(s.listTasks(BOB, { projectId: p.id }).length, 0, 'no open tasks left');
      // Bob removes Eve after the project; she loses access, Alice still sees everything.
      s.removeMember(BOB, p.id, EVE);
      assert(!s.canView(EVE, p.id));
      eq(s.listTasks(ALICE, { projectId: p.id, includeCompleted: true }).length, 2);
    });
  });

  describe('12. Comments', () => {
    const bodies = (s, user, taskId) => s.listComments(user, taskId).map((c) => c.body);
    test('Project members can comment and read the thread oldest first', (s) => {
      const before = s.listComments(BOB, 't1').length;
      s.addComment(CAROL, 't1', '  Draft is ready for review  ');
      const list = s.listComments(BOB, 't1');
      eq(list.length, before + 1);
      eq(list[list.length - 1].body, 'Draft is ready for review', 'trimmed, appended last');
      eq(list[list.length - 1].authorId, CAROL);
      eq(s.listComments(ALICE, 't1').length, before + 1, 'admin sees it too');
    });
    test('Non-members cannot read or add comments', (s) => {
      throws(() => s.listComments(DAVE, 't1'), PermissionError);
      throws(() => s.addComment(DAVE, 't1', 'hi'), PermissionError);
      throws(() => s.addComment(EVE, 't6', 'hi'), PermissionError);
      throws(() => s.deleteComment(EVE, 'c3'), PermissionError, 'cannot touch a comment on a task she cannot see');
    });
    test('Comments on Inbox tasks are private to the owner, not even the admin', (s) => {
      const c = s.addComment(EVE, 't13', 'Chapter 3 done');
      eq(bodies(s, EVE, 't13'), ['Chapter 3 done']);
      throws(() => s.listComments(ALICE, 't13'), PermissionError);
      throws(() => s.addComment(ALICE, 't13', 'x'), PermissionError);
      throws(() => s.deleteComment(ALICE, c.id), PermissionError);
      eq(s.commentCounts(ALICE)['t13'], undefined, 'not counted for the admin');
    });
    test('Empty and over-long comments are rejected', (s) => {
      throws(() => s.addComment(CAROL, 't1', '   '), ValidationError);
      throws(() => s.addComment(CAROL, 't1', 'x'.repeat(5001)), ValidationError);
      s.addComment(CAROL, 't1', 'x'.repeat(5000));
    });
    test('Only the author can edit a comment; edits are marked', (s) => {
      throws(() => s.updateComment(CAROL, 'c1', 'changed by Carol'), PermissionError);
      throws(() => s.updateComment(ALICE, 'c1', 'changed by admin'), PermissionError);
      const c = s.updateComment(BOB, 'c1', 'Hero: one headline, one button, one image.');
      eq(c.body, 'Hero: one headline, one button, one image.');
      assert(c.editedAt, 'editedAt set');
      throws(() => s.updateComment(BOB, 'c1', ''), ValidationError);
    });
    test('Author, project manager and admin can delete a comment; other members cannot', (s) => {
      const carols = s.addComment(CAROL, 't5', 'Carol on Mobile');
      throws(() => s.deleteComment(DAVE, carols.id), PermissionError);
      const own = s.addComment(DAVE, 't5', 'mine');
      s.deleteComment(DAVE, own.id); // author
      s.deleteComment(CAROL, 'c3'); // Carol is PM of Mobile; c3 is Dave's
      s.deleteComment(ALICE, 'c2'); // admin
      eq(bodies(s, BOB, 't1'), ['Please keep the hero short: one headline and one button.']);
      assert(s.canDeleteComment(BOB, 'c1') && !s.canDeleteComment(CAROL, 'c1'), 'canDeleteComment matches the rule');
    });
    test('Comment counts cover only visible tasks', (s) => {
      eq(s.commentCounts(BOB), { t1: 2 });
      eq(s.commentCounts(DAVE), { t6: 1 });
      eq(s.commentCounts(CAROL), { t1: 2, t6: 1 });
      eq(s.commentCounts(EVE), {});
    });
    test('Deleting a task, its parent, or its project removes the comments', (s) => {
      s.addComment(CAROL, 't16', 'on a subtask');
      s.deleteTask(BOB, 't1'); // removes subtask t16 too
      eq(s.state.comments.filter((c) => c.taskId === 't1' || c.taskId === 't16').length, 0);
      s.deleteProject(CAROL, MOBILE);
      eq(s.state.comments.length, 0);
    });
  });

  // ---- report --------------------------------------------------------
  const passed = results.filter((r) => r.ok).length;
  const failed = results.length - passed;
  const out = document.getElementById('results');
  let lastSection = null;
  results.forEach((r) => {
    if (r.section !== lastSection) {
      const h = document.createElement('h2'); h.textContent = r.section; out.append(h);
      lastSection = r.section;
    }
    const li = document.createElement('div');
    li.className = 'result ' + (r.ok ? 'pass' : 'fail');
    li.textContent = (r.ok ? '✔ ' : '✘ ') + r.name + (r.ok ? '' : ' — ' + r.error);
    out.append(li);
  });
  const summary = document.getElementById('summary');
  summary.textContent = passed + ' passed, ' + failed + ' failed (' + results.length + ' tests)';
  summary.className = failed ? 'fail' : 'pass';
  document.title = (failed ? 'FAIL' : 'PASS') + ' ' + passed + '/' + results.length + ' — Flexo Todo tests';
  window.testResults = { passed, failed, results };
})();
