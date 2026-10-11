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

  describe('8. End-to-end story across all 5 users', () => {
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
