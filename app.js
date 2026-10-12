/*
 * UI layer: renders the store for the signed-in user.
 *
 * Two modes:
 *   - shared (default): sign in, data lives in Supabase (cloud.js) and syncs live between people
 *   - demo: the 5 sample users, data kept only in this browser (localStorage)
 */
(function () {
  'use strict';

  const STORAGE_KEY = 'flexoTodo.data.v1';
  const USER_KEY = 'flexoTodo.user';
  const MODE_KEY = 'flexoTodo.mode';
  const NOTIFIED_KEY = 'flexoTodo.notified';
  const VIEWMODE_KEY = 'flexoTodo.viewMode';
  const { createStore, isoDate, RECURRENCE, REMINDERS } = window.TaskStore;
  const Cloud = window.FlexoCloud; // undefined if the Supabase library couldn't load

  // ---- persistence (wrapped: storage can be unavailable in private windows) ----
  function load(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
  function save(key, value) { try { localStorage.setItem(key, value); } catch (e) { /* ignore */ } }
  function loadJSON(key, fallback) { try { return JSON.parse(load(key)) || fallback; } catch (e) { return fallback; } }

  let mode = load(MODE_KEY) === 'demo' ? 'demo' : 'cloud';
  let store = null;
  let currentUser = null;
  let synced = null; // cloud mode: the state the database is known to have
  // current: { type: 'view', id } | { type: 'project', id } | { type: 'label', id } | { type: 'filter', id } | { type: 'search', q }
  let current = { type: 'view', id: 'today' };
  let showCompleted = false;
  const viewModes = loadJSON(VIEWMODE_KEY, {}); // projectId -> 'list' | 'board'
  const collapsed = new Set(); // parent task ids whose subtasks are hidden
  let commentCounts = {}; // taskId -> number of comments, refreshed on every render
  // Shared mode needs the comments table (schema.sql re-run); until then comments stay hidden.
  const commentsOn = () => mode === 'demo' || !!(Cloud && Cloud.hasComments);

  // ---- helpers -------------------------------------------------------
  const $ = (id) => document.getElementById(id);
  function el(tag, attrs, ...children) {
    const n = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([k, v]) => {
      if (v == null || v === false) return;
      if (k === 'class') n.className = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else if (k === 'style') n.setAttribute('style', v);
      else n.setAttribute(k, v === true ? '' : v);
    });
    children.flat().forEach((c) => { if (c != null && c !== false) n.append(c.nodeType ? c : String(c)); });
    return n;
  }
  const options = (pairs, selected) => pairs.map(([value, label]) =>
    el('option', { value, selected: String(value) === String(selected ?? '') }, label));
  const AVATAR_COLORS = ['#b8255f', '#4073ff', '#299438', '#ff9933', '#884dff'];
  function avatar(user) {
    const idx = parseInt(user.id.replace(/\D/g, ''), 10) % AVATAR_COLORS.length;
    const initials = user.name.split(' ').map((s) => s[0]).join('').slice(0, 2).toUpperCase();
    return el('span', { class: 'avatar', style: 'background:' + AVATAR_COLORS[idx], title: user.name }, initials);
  }
  const userById = (id) => store.listUsers().find((u) => u.id === id);
  const go = (view) => { current = view; closeSidebar(); render(); };

  function toast(msg, isError, ms) {
    const t = $('toast');
    t.textContent = msg;
    t.className = 'toast' + (isError ? ' error' : '');
    t.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { t.hidden = true; }, ms || 2800);
  }
  function attempt(fn) {
    try { return fn(); } catch (e) { toast(e.message, true); return undefined; }
  }

  const pad = (n) => String(n).padStart(2, '0');
  const nowHM = () => { const d = new Date(); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };
  function dateLabel(due) {
    const today = isoDate(0);
    if (due === today) return 'Today';
    if (due === isoDate(1)) return 'Tomorrow';
    if (due === isoDate(-1)) return 'Yesterday';
    const opts = due < today ? { month: 'short', day: 'numeric' } : { weekday: 'short', month: 'short', day: 'numeric' };
    return new Date(due + 'T12:00').toLocaleDateString(undefined, opts);
  }
  function timeLabel(hm) {
    const [h, m] = hm.split(':').map(Number);
    return new Date(2000, 0, 1, h, m).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }
  function formatDue(t) {
    if (!t.dueDate) return null;
    const today = isoDate(0);
    let cls = '';
    if (t.dueDate < today || (t.dueDate === today && t.dueTime && t.dueTime < nowHM())) cls = 'overdue';
    else if (t.dueDate === today) cls = 'today';
    return el('span', { class: 'due ' + cls }, '📅 ' + dateLabel(t.dueDate) + (t.dueTime ? ' ' + timeLabel(t.dueTime) : ''));
  }

  const ROLE_LABEL = { manager: 'Manager', member: 'Member', admin: 'Admin access' };
  const REPEAT_OPTIONS = [['', 'Does not repeat'], ...Object.entries(RECURRENCE)];
  const REMINDER_OPTIONS = [['', 'No reminder'], ...Object.entries(REMINDERS).sort((a, b) => a[0] - b[0])];
  const peopleOf = (p) => [p.managerId, ...p.memberIds];

  // ---- render --------------------------------------------------------
  function render() {
    // The current view may have disappeared (removed from project, filter deleted, user switched).
    if ((current.type === 'project' && !store.canView(currentUser, current.id)) ||
        (current.type === 'filter' && !store.listFilters(currentUser).some((f) => f.id === current.id))) {
      current = { type: 'view', id: 'today' };
    }
    commentCounts = commentsOn() ? store.commentCounts(currentUser) : {};
    renderTopbar();
    renderSidebar();
    renderMain();
  }

  function renderTopbar() {
    const demo = mode === 'demo';
    ['demoUser', 'resetBtn', 'exitDemoBtn'].forEach((id) => { $(id).hidden = !demo; });
    ['meBtn', 'signOutBtn'].forEach((id) => { $(id).hidden = demo; });
    if (demo) {
      $('userSelect').replaceChildren(...store.listUsers().map((u) =>
        el('option', { value: u.id, selected: u.id === currentUser }, u.name + (u.role === 'admin' ? ' (Admin)' : ''))));
    } else {
      const me = userById(currentUser);
      $('meBtn').textContent = '👤 ' + me.name + (me.role === 'admin' ? ' · Admin' : '');
    }
    $('notifyBtn').hidden = !('Notification' in window) || Notification.permission !== 'default';
    renderBell();
    if (current.type !== 'search' && document.activeElement !== $('searchInput')) $('searchInput').value = '';
  }

  function navItem(active, onclick, ...children) {
    return el('li', { class: active ? 'active' : '', onclick }, ...children);
  }

  function renderSidebar() {
    const count = (f) => store.listTasks(currentUser, f).length || '';
    $('countInbox').textContent = count({ view: 'inbox' });
    $('countToday').textContent = count({ view: 'today' });
    $('countUpcoming').textContent = count({ view: 'upcoming' });
    $('countMine').textContent = count({ view: 'mine' });
    document.querySelectorAll('#viewNav li').forEach((li) =>
      li.classList.toggle('active', current.type === 'view' && current.id === li.dataset.view));

    const projects = store.listProjects(currentUser);
    $('noProjects').hidden = projects.length > 0;
    $('projectNav').replaceChildren(...projects.map((p) => {
      const role = store.roleIn(currentUser, p.id);
      return navItem(current.type === 'project' && current.id === p.id, () => go({ type: 'project', id: p.id }),
        el('span', { class: 'dot', style: 'background:' + p.color }),
        el('span', null, p.name),
        role !== 'member' ? el('span', { class: 'tag ' + role }, role === 'manager' ? 'PM' : 'Admin') : null,
        el('span', { class: 'count' }, count({ projectId: p.id })));
    }));

    $('filterNav').replaceChildren(...store.listFilters(currentUser).map((f) => {
      let n = '';
      try { n = store.filterTasks(currentUser, f.query).length || ''; } catch (e) { n = '!'; }
      return navItem(current.type === 'filter' && current.id === f.id, () => go({ type: 'filter', id: f.id }),
        el('span', { class: 'nav-icon' }, '⚡'), el('span', null, f.name), el('span', { class: 'count' }, n));
    }));

    const labels = store.listLabels(currentUser);
    $('noLabels').hidden = labels.length > 0;
    $('labelNav').replaceChildren(...labels.map((l) =>
      navItem(current.type === 'label' && current.id === l.name, () => go({ type: 'label', id: l.name }),
        el('span', { class: 'nav-icon' }, '🏷'), el('span', null, l.name), el('span', { class: 'count' }, l.count || ''))));
  }

  function renderMain() {
    const isProject = current.type === 'project';
    const isInbox = current.type === 'view' && current.id === 'inbox';
    const project = isProject ? store.getProject(currentUser, current.id) : null;
    const boardMode = isProject && viewModes[project.id] === 'board';
    const actions = [];
    let title;
    let sub = '';
    let tasks;
    let emptyText = 'Nothing here. Enjoy your day! 🎉';
    $('membersBar').replaceChildren();

    if (isProject) {
      const role = store.roleIn(currentUser, project.id);
      title = el('span', null, el('span', { class: 'dot', style: 'display:inline-block;background:' + project.color }), ' ' + project.name);
      sub = 'Project manager: ' + userById(project.managerId).name + ' · Your role: ' + ROLE_LABEL[role];
      actions.push(
        el('div', { class: 'segmented', role: 'group', 'aria-label': 'Layout' },
          el('button', { class: boardMode ? '' : 'on', onclick: () => setViewMode(project.id, 'list') }, '☰ List'),
          el('button', { class: boardMode ? 'on' : '', onclick: () => setViewMode(project.id, 'board') }, '▦ Board')),
        el('button', { class: 'btn ghost small', onclick: () => addSection(project.id) }, '＋ Section'),
        el('button', { class: 'btn ghost small', onclick: () => openProjectDialog(project.id) },
          store.canManage(currentUser, project.id) ? '⚙ Manage' : 'ⓘ Info'));
      $('membersBar').replaceChildren(...peopleOf(project).map(userById).map((u) =>
        el('span', { class: 'chip' }, avatar(u), u.name, u.id === project.managerId ? el('span', { class: 'tag manager' }, 'PM') : null)));
      tasks = store.listTasks(currentUser, { projectId: project.id, includeCompleted: showCompleted });
    } else if (current.type === 'view') {
      title = { inbox: 'Inbox', today: 'Today', upcoming: 'Upcoming', mine: 'Assigned to me' }[current.id];
      sub = {
        inbox: '🔒 Your personal tasks. Only you can see these.',
        today: new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }) + ' · overdue and due today',
        upcoming: 'Due after today, across your Inbox and projects',
        mine: 'Tasks assigned to you, including your Inbox',
      }[current.id];
      if (isInbox) emptyText = 'Your Inbox is empty. Add a personal task below.';
      tasks = store.listTasks(currentUser, { view: current.id, includeCompleted: showCompleted });
    } else if (current.type === 'label') {
      title = '🏷 @' + current.id;
      sub = 'Tasks with this label in your Inbox and projects';
      tasks = store.listTasks(currentUser, { label: current.id, includeCompleted: showCompleted });
    } else if (current.type === 'filter') {
      const f = store.getFilter(currentUser, current.id);
      title = '⚡ ' + f.name;
      sub = 'Filter: ' + f.query;
      actions.push(el('button', { class: 'btn ghost small', onclick: () => openFilterDialog(f.id) }, '✎ Edit filter'));
      tasks = attempt(() => store.filterTasks(currentUser, f.query, { includeCompleted: showCompleted })) || [];
      emptyText = 'No tasks match this filter.';
    } else {
      title = 'Search: "' + current.q + '"';
      sub = 'Matches in titles, descriptions and labels';
      tasks = store.searchTasks(currentUser, current.q, { includeCompleted: showCompleted });
      emptyText = 'No tasks found.';
    }

    $('viewTitle').replaceChildren(title);
    $('viewSub').textContent = sub;
    $('headerActions').replaceChildren(...actions);
    $('main').classList.toggle('wide', boardMode);

    // Task area: board, sectioned list, nested list, or flat list.
    $('board').hidden = !boardMode;
    $('taskList').hidden = boardMode;
    if (boardMode) {
      renderBoard(project, tasks);
    } else if (isProject) {
      $('taskList').replaceChildren(...renderSectionedList(project, tasks));
    } else if (isInbox) {
      $('taskList').replaceChildren(...nestedRows(tasks));
    } else {
      $('taskList').replaceChildren(...tasks.map((t) => renderTask(t, { showProject: true })));
    }
    $('emptyState').hidden = tasks.length > 0 || isProject;
    $('emptyState').textContent = emptyText;

    renderAddForm(isProject ? project : null, isInbox, boardMode);
  }

  // Subtasks nested under their parent. A subtask whose parent is filtered out shows on its own.
  function nestedRows(tasks) {
    const ids = new Set(tasks.map((t) => t.id));
    return tasks.filter((t) => !t.parentId || !ids.has(t.parentId)).flatMap((t) => [
      renderTask(t, { nested: true }),
      ...(collapsed.has(t.id) ? [] : tasks.filter((c) => c.parentId === t.id).map((c) => renderTask(c, { indent: true }))),
    ]);
  }

  function renderSectionedList(project, tasks) {
    const sections = store.listSections(currentUser, project.id);
    const top = (sectionId) => tasks.filter((t) => !t.parentId && (t.sectionId || null) === sectionId);
    const withSubs = (list) => nestedRows(tasks.filter((t) => list.includes(t) || list.some((p) => p.id === t.parentId)));
    const rows = [];
    const unsectioned = top(null);
    if (unsectioned.length || !sections.length) rows.push(...withSubs(unsectioned));
    if (!tasks.length && !sections.length) rows.push(el('li', { class: 'empty' }, 'No tasks yet. Add one below.'));
    sections.forEach((s) => {
      const list = top(s.id);
      rows.push(el('li', { class: 'section-head' }, sectionHeader(project, s, list.length)));
      rows.push(...withSubs(list));
    });
    return rows;
  }

  function sectionHeader(project, s, n) {
    return el('div', { class: 'section-title' },
      el('span', null, s.name), el('span', { class: 'count' }, n || ''),
      el('div', { class: 'spacer' }),
      el('button', { class: 'icon-btn', title: 'Rename section', 'aria-label': 'Rename section', onclick: () => renameSection(s) }, '✎'),
      store.canManage(currentUser, project.id)
        ? el('button', { class: 'icon-btn', title: 'Delete section', 'aria-label': 'Delete section', onclick: () => deleteSection(s) }, '🗑')
        : null);
  }

  function renderBoard(project, tasks) {
    const sections = [{ id: null, name: 'No section' }, ...store.listSections(currentUser, project.id)];
    const columns = sections.map((s) => {
      const cards = tasks.filter((t) => !t.parentId && (t.sectionId || null) === s.id);
      const col = el('div', { class: 'column', 'data-section': s.id || '' },
        s.id ? sectionHeader(project, s, cards.length)
          : el('div', { class: 'section-title' }, el('span', null, s.name), el('span', { class: 'count' }, cards.length || '')),
        el('ul', { class: 'cards' }, ...cards.map((t) => renderTask(t, { card: true }))),
        el('form', {
          class: 'quick-add',
          onsubmit: (e) => {
            e.preventDefault();
            const input = e.target.querySelector('input');
            if (!input.value.trim()) return;
            attempt(() => { store.createTask(currentUser, project.id, { title: input.value, sectionId: s.id }); render(); });
          },
        }, el('input', { placeholder: '＋ Add task', 'aria-label': 'Add task to ' + s.name, autocomplete: 'off' })));
      // Drag a card onto a column to move it there (desktop; on phones use the Section field in the task).
      col.addEventListener('dragover', (e) => { e.preventDefault(); col.classList.add('drop'); });
      col.addEventListener('dragleave', () => col.classList.remove('drop'));
      col.addEventListener('drop', (e) => {
        e.preventDefault();
        col.classList.remove('drop');
        const id = e.dataTransfer.getData('text/plain');
        if (id) attempt(() => { store.updateTask(currentUser, id, { sectionId: s.id }); toast('Moved to ' + s.name); render(); });
      });
      return col;
    });
    columns.push(el('div', { class: 'column add-column' },
      el('button', { class: 'btn ghost', onclick: () => addSection(project.id) }, '＋ Add section')));
    $('board').replaceChildren(...columns);
  }

  function projectLabel(projectId) {
    if (projectId === null) return el('span', { class: 'project-label' }, '📥 Inbox');
    const p = store.getProject(currentUser, projectId);
    return el('span', { class: 'project-label' }, el('span', { class: 'dot', style: 'background:' + p.color }), p.name);
  }

  function toggle(t) {
    attempt(() => {
      const r = store.toggleTask(currentUser, t.id);
      if (r.rolledOver) toast('🔁 Done! Next: ' + dateLabel(r.dueDate));
      else toast(r.completed ? 'Task completed' : 'Task reopened');
      render();
    });
  }

  // opts: { showProject, nested (subtasks listed below it), indent (is a nested subtask), card (board) }
  function renderTask(t, opts = {}) {
    const assignee = t.assigneeId ? userById(t.assigneeId) : null;
    const subs = t.parentId ? [] : store.listSubtasks(currentUser, t.id);
    let subBadge = null;
    if (subs.length) {
      const label = '⑂ ' + subs.filter((s) => s.completed).length + '/' + subs.length;
      subBadge = opts.nested
        ? el('button', {
          class: 'sub-badge', title: collapsed.has(t.id) ? 'Show subtasks' : 'Hide subtasks',
          onclick: (e) => { e.stopPropagation(); collapsed.has(t.id) ? collapsed.delete(t.id) : collapsed.add(t.id); render(); },
        }, label + (collapsed.has(t.id) ? ' ▸' : ' ▾'))
        : el('span', { class: 'sub-badge' }, label);
    }
    // In flat views (Today, Upcoming…) show which task a subtask belongs to.
    const parentHint = t.parentId && !opts.indent
      ? el('span', { class: 'parent-hint' }, '↳ ' + store.getTask(currentUser, t.parentId).title)
      : null;
    const labelChips = t.labels.map((l) => el('button', {
      class: 'label-chip', title: 'Show tasks labelled @' + l,
      onclick: (e) => { e.stopPropagation(); go({ type: 'label', id: l }); },
    }, '@' + l));

    const li = el('li', { class: 'task' + (t.completed ? ' done' : '') + (opts.indent ? ' sub' : '') + (opts.card ? ' card' : '') },
      el('button', {
        class: 'check p' + t.priority, title: t.completed ? 'Mark incomplete' : 'Complete task', 'aria-label': 'Toggle complete',
        onclick: () => toggle(t),
      }, '✓'),
      el('div', { class: 'task-body', onclick: () => openTaskDialog(t.id) },
        el('div', { class: 'title' }, t.title),
        t.description && !opts.card ? el('div', { class: 'desc' }, t.description) : null,
        el('div', { class: 'meta-row' },
          subBadge,
          commentCounts[t.id] ? el('span', { class: 'comment-badge', title: commentCounts[t.id] + ' comment' + (commentCounts[t.id] === 1 ? '' : 's') }, '💬 ' + commentCounts[t.id]) : null,
          formatDue(t),
          t.recurrence ? el('span', { title: RECURRENCE[t.recurrence] }, '🔁') : null,
          t.reminder != null ? el('span', { title: 'Reminder: ' + REMINDERS[t.reminder] }, '⏰') : null,
          // Personal tasks are always the owner's, so skip the assignee there.
          t.projectId === null ? null
            : assignee ? el('span', { class: 'project-label' }, avatar(assignee), opts.card ? '' : ' ' + assignee.name)
              : opts.card ? null : el('span', null, 'Unassigned'),
          labelChips,
          parentHint,
          opts.showProject ? projectLabel(t.projectId) : null)));
    if (opts.card) {
      li.draggable = true;
      li.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', t.id); li.classList.add('dragging'); });
      li.addEventListener('dragend', () => li.classList.remove('dragging'));
    }
    return li;
  }

  function setViewMode(projectId, mode) {
    viewModes[projectId] = mode;
    save(VIEWMODE_KEY, JSON.stringify(viewModes));
    render();
  }

  // ---- sections --------------------------------------------------------
  function addSection(projectId) {
    const name = prompt('Section name (e.g. To do, In progress, Done):');
    if (name === null) return;
    attempt(() => { store.createSection(currentUser, projectId, name); toast('Section added'); render(); });
  }
  function renameSection(s) {
    const name = prompt('Rename section:', s.name);
    if (name === null) return;
    attempt(() => { store.renameSection(currentUser, s.id, name); render(); });
  }
  function deleteSection(s) {
    if (!confirm('Delete section "' + s.name + '"? Its tasks are kept and move to "No section".')) return;
    attempt(() => { store.deleteSection(currentUser, s.id); toast('Section deleted'); render(); });
  }

  // ---- add task ------------------------------------------------------
  function renderAddForm(project, isInbox, boardMode) {
    // List views of a project and the Inbox get the full form; the board has per-column quick add.
    $('addTaskForm').hidden = !((project && !boardMode) || isInbox);
    if ($('addTaskForm').hidden) return;
    $('newTitle').placeholder = isInbox ? 'Personal task, e.g. Renew passport' : 'Task name, e.g. Send invoice';
    $('newAssignee').hidden = !project;
    if (!$('newRepeat').options.length) $('newRepeat').replaceChildren(...options(REPEAT_OPTIONS, ''));
    if (project) {
      const keep = $('newAssignee').value;
      $('newAssignee').replaceChildren(...options([['', 'Unassigned'], ...peopleOf(project).map((id) => [id, userById(id).name])], keep));
      const sections = store.listSections(currentUser, project.id);
      const keepSection = $('newSection').value;
      $('newSection').replaceChildren(...options([['', 'No section'], ...sections.map((s) => [s.id, s.name])], keepSection));
      $('newSection').hidden = !sections.length;
    } else {
      $('newSection').hidden = true;
    }
  }

  $('addTaskForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const isProject = current.type === 'project';
    attempt(() => {
      store.createTask(currentUser, isProject ? current.id : null, {
        title: $('newTitle').value,
        description: $('newDesc').value,
        dueDate: $('newDue').value,
        dueTime: $('newTime').value,
        recurrence: $('newRepeat').value,
        priority: $('newPriority').value,
        assigneeId: isProject ? $('newAssignee').value : null,
        sectionId: isProject ? $('newSection').value : null,
        labels: $('newLabels').value,
      });
      ['newTitle', 'newDesc', 'newDue', 'newTime', 'newLabels'].forEach((id) => { $(id).value = ''; });
      $('newRepeat').value = '';
      toast('Task added');
      render();
      $('newTitle').focus();
    });
  });

  // ---- project dialog ------------------------------------------------
  let editingProjectId = null;

  function renderMemberChecks(managerId, selected, editable) {
    $('projMembers').replaceChildren(...store.listUsers().filter((u) => u.id !== managerId).map((u) =>
      el('label', null,
        el('input', { type: 'checkbox', value: u.id, checked: selected.includes(u.id), disabled: !editable }),
        avatar(u), u.name)));
  }

  function openProjectDialog(projectId) {
    editingProjectId = projectId || null;
    const admin = store.isAdmin(currentUser);
    const p = projectId ? store.getProject(currentUser, projectId) : null;
    const editable = !p || store.canManage(currentUser, p.id);

    $('projectDialogTitle').textContent = p ? (editable ? 'Manage project' : 'Project info') : 'Add project';
    $('projName').value = p ? p.name : '';
    $('projColor').value = p ? p.color : '#4073ff';
    $('projName').disabled = !editable;
    $('projColor').disabled = !editable;

    const managerId = p ? p.managerId : currentUser;
    $('projManager').replaceChildren(...store.listUsers().map((u) =>
      el('option', { value: u.id, selected: u.id === managerId }, u.name)));
    // Non-admins create projects as their own PM; only admins can reassign a PM.
    $('projManager').disabled = !admin;
    renderMemberChecks(managerId, p ? p.memberIds : [], editable);

    $('projDelete').hidden = !(p && editable);
    $('projSave').hidden = !editable;
    $('projError').textContent = '';
    $('projectDialog').showModal();
  }

  $('projManager').addEventListener('focus', (e) => { e.target.dataset.prev = e.target.value; });
  $('projManager').addEventListener('change', (e) => {
    const checked = [...$('projMembers').querySelectorAll('input:checked')].map((i) => i.value);
    // Keep the previous manager on the team by default.
    if (e.target.dataset.prev) checked.push(e.target.dataset.prev);
    e.target.dataset.prev = e.target.value;
    renderMemberChecks(e.target.value, checked, true);
  });

  $('projectForm').addEventListener('submit', (e) => {
    if (e.submitter && e.submitter.value === 'cancel') return;
    e.preventDefault();
    const name = $('projName').value;
    const color = $('projColor').value;
    const managerId = $('projManager').value;
    const memberIds = [...$('projMembers').querySelectorAll('input:checked')].map((i) => i.value);
    try {
      if (!editingProjectId) {
        const p = store.createProject(currentUser, { name, color, managerId, memberIds });
        current = { type: 'project', id: p.id };
        toast('Project created');
      } else {
        const id = editingProjectId;
        store.updateProject(currentUser, id, { name, color });
        let p = store.getProject(currentUser, id);
        if (managerId !== p.managerId) p = store.setManager(currentUser, id, managerId);
        p.memberIds.filter((m) => !memberIds.includes(m)).forEach((m) => store.removeMember(currentUser, id, m));
        memberIds.filter((m) => !p.memberIds.includes(m)).forEach((m) => store.addMember(currentUser, id, m));
        toast('Project updated');
      }
      $('projectDialog').close();
      render();
    } catch (err) {
      $('projError').textContent = err.message;
      render();
    }
  });

  $('projDelete').addEventListener('click', () => {
    const p = store.getProject(currentUser, editingProjectId);
    if (!confirm('Delete "' + p.name + '" and all of its tasks?')) return;
    attempt(() => {
      store.deleteProject(currentUser, p.id);
      $('projectDialog').close();
      current = { type: 'view', id: 'today' };
      toast('Project deleted');
      render();
    });
  });

  // ---- task dialog ---------------------------------------------------
  let editingTaskId = null;

  function openTaskDialog(taskId) {
    const t = attempt(() => store.getTask(currentUser, taskId));
    if (!t) return;
    if (editingTaskId !== taskId || !$('taskDialog').open) $('newComment').value = '';
    editingTaskId = taskId;
    editingCommentId = null;
    const p = t.projectId === null ? null : store.getProject(currentUser, t.projectId);
    $('editTitle').value = t.title;
    $('editDesc').value = t.description;
    $('editDue').value = t.dueDate || '';
    $('editTime').value = t.dueTime || '';
    $('editPriority').value = String(t.priority);
    $('editRepeat').replaceChildren(...options(REPEAT_OPTIONS, t.recurrence));
    $('editReminder').replaceChildren(...options(REMINDER_OPTIONS, t.reminder));
    $('editLabels').value = t.labels.map((l) => '@' + l).join(' ');
    const people = p ? peopleOf(p) : [t.createdBy];
    $('editAssignee').replaceChildren(...(p ? [el('option', { value: '' }, 'Unassigned')] : []),
      ...people.map((id) => el('option', { value: id, selected: id === t.assigneeId }, userById(id).name)));
    $('editAssignee').closest('label').hidden = !p;
    // Sections apply to top-level project tasks only.
    const sections = p && !t.parentId ? store.listSections(currentUser, p.id) : [];
    $('editSection').replaceChildren(...options([['', 'No section'], ...sections.map((s) => [s.id, s.name])], t.sectionId));
    $('editSectionWrap').hidden = !sections.length;
    $('editMeta').textContent = (p
      ? 'In ' + p.name + ' · created by ' + userById(t.createdBy).name
      : '📥 Personal task in your Inbox · only you can see it') +
      (t.lastCompletedAt ? ' · last done ' + new Date(t.lastCompletedAt).toLocaleDateString() : '');
    $('taskDelete').hidden = !canDelete(t, p);
    $('taskError').textContent = '';

    // Subtasks: a top-level task lists and adds them; a subtask links back to its parent.
    $('subtaskSection').hidden = !!t.parentId;
    $('parentLink').hidden = !t.parentId;
    if (t.parentId) {
      const parent = store.getTask(currentUser, t.parentId);
      $('parentLink').replaceChildren('Subtask of ',
        el('a', { href: '#', onclick: (e) => { e.preventDefault(); openTaskDialog(parent.id); } }, parent.title));
    } else {
      $('newSubtask').value = '';
      renderSubtaskList();
    }
    renderComments();
    if (!$('taskDialog').open) $('taskDialog').showModal();
  }

  // ---- comments --------------------------------------------------------
  let editingCommentId = null;

  // Plain text with clickable web links (text nodes only, so nothing typed can run as HTML).
  function linkify(text) {
    return text.split(/(https?:\/\/[^\s<]*[^\s<.,;:!?)\]'"])/g).map((part, i) => (i % 2
      ? el('a', { href: part, target: '_blank', rel: 'noopener noreferrer' }, part)
      : part));
  }

  function renderComments() {
    $('commentSection').hidden = !commentsOn();
    if (!commentsOn()) return;
    const list = store.listComments(currentUser, editingTaskId);
    $('commentCount').textContent = list.length || '';
    $('commentHint').textContent = (store.getTask(currentUser, editingTaskId).projectId === null
      ? '🔒 Only you can see comments on your personal tasks.'
      : 'Everyone on the project can read comments.') + ' Ctrl+Enter sends.';
    $('commentList').replaceChildren(...(list.length ? list.map(renderComment)
      : [el('li', { class: 'empty' }, 'No comments yet. Ask a question or share an update.')]));
  }

  function renderComment(c) {
    const author = userById(c.authorId) || { id: c.authorId, name: 'Former user' };
    const head = el('div', { class: 'comment-head' },
      el('b', null, author.name),
      el('span', { class: 'meta', title: new Date(c.createdAt).toLocaleString() }, timeAgo(c.createdAt) + (c.editedAt ? ' · edited' : '')),
      el('div', { class: 'spacer' }),
      c.authorId === currentUser && editingCommentId !== c.id ? el('button', {
        type: 'button', class: 'icon-btn', title: 'Edit comment', 'aria-label': 'Edit comment',
        onclick: () => { editingCommentId = c.id; renderComments(); },
      }, '✎') : null,
      store.canDeleteComment(currentUser, c.id) ? el('button', {
        type: 'button', class: 'icon-btn', title: 'Delete comment', 'aria-label': 'Delete comment',
        onclick: () => deleteComment(c),
      }, '🗑') : null);

    let body;
    if (editingCommentId === c.id) {
      const box = el('textarea', { rows: 3, maxlength: 5000, 'aria-label': 'Edit comment' });
      box.value = c.body;
      const cancel = () => { editingCommentId = null; renderComments(); };
      const saveEdit = () => attempt(() => {
        store.updateComment(currentUser, c.id, box.value);
        editingCommentId = null;
        renderComments();
      });
      box.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); saveEdit(); }
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancel(); }
      });
      body = el('div', { class: 'comment-edit' }, box,
        el('div', { class: 'row' }, el('div', { class: 'spacer' }),
          el('button', { type: 'button', class: 'btn small ghost', onclick: cancel }, 'Cancel'),
          el('button', { type: 'button', class: 'btn small primary', onclick: saveEdit }, 'Save')));
      setTimeout(() => box.focus(), 0);
    } else {
      body = el('div', { class: 'comment-body' }, ...linkify(c.body));
    }
    return el('li', { class: 'comment' }, avatar(author), el('div', { class: 'comment-main' }, head, body));
  }

  function addComment() {
    const body = $('newComment').value;
    if (!body.trim()) return;
    attempt(() => {
      store.addComment(currentUser, editingTaskId, body);
      $('newComment').value = '';
      renderComments();
      $('commentList').scrollTop = $('commentList').scrollHeight;
      render();
    });
  }

  function deleteComment(c) {
    if (!confirm('Delete this comment?')) return;
    attempt(() => {
      store.deleteComment(currentUser, c.id);
      if (editingCommentId === c.id) editingCommentId = null;
      renderComments();
      render();
    });
  }

  $('addCommentBtn').addEventListener('click', addComment);
  $('newComment').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); addComment(); }
  });

  // Someone else changed things while this task is open: refresh its subtasks and comments.
  function refreshOpenTask() {
    if (!$('taskDialog').open || !editingTaskId) return;
    let t;
    try { t = store.getTask(currentUser, editingTaskId); } catch (e) { return; } // deleted or no longer visible
    if (!t.parentId) renderSubtaskList();
    if (!editingCommentId) renderComments();
  }

  const canDelete = (t, p) => t.createdBy === currentUser || !!(p && store.canManage(currentUser, p.id));

  function renderSubtaskList() {
    const parent = store.getTask(currentUser, editingTaskId);
    const p = parent.projectId === null ? null : store.getProject(currentUser, parent.projectId);
    const subs = store.listSubtasks(currentUser, editingTaskId);
    $('subtaskCount').textContent = subs.length ? subs.filter((s) => s.completed).length + '/' + subs.length : '';
    $('subtaskList').replaceChildren(...subs.map((s) => el('li', { class: s.completed ? 'done' : '' },
      el('button', {
        type: 'button', class: 'check small p' + s.priority, 'aria-label': 'Toggle subtask',
        onclick: () => attempt(() => { store.toggleTask(currentUser, s.id); renderSubtaskList(); render(); }),
      }, '✓'),
      el('a', { href: '#', class: 'sub-title', onclick: (e) => { e.preventDefault(); openTaskDialog(s.id); } }, s.title),
      s.assigneeId && p ? avatar(userById(s.assigneeId)) : null,
      canDelete(s, p) ? el('button', {
        type: 'button', class: 'icon-btn', title: 'Delete subtask', 'aria-label': 'Delete subtask',
        onclick: () => attempt(() => { store.deleteTask(currentUser, s.id); renderSubtaskList(); render(); }),
      }, '✕') : null)));
  }

  function addSubtask() {
    const title = $('newSubtask').value;
    if (!title.trim()) return;
    attempt(() => {
      store.createSubtask(currentUser, editingTaskId, { title });
      $('newSubtask').value = '';
      renderSubtaskList();
      render();
    });
    $('newSubtask').focus();
  }
  $('addSubtaskBtn').addEventListener('click', addSubtask);
  $('newSubtask').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); addSubtask(); }
  });

  $('taskForm').addEventListener('submit', (e) => {
    if (e.submitter && e.submitter.value === 'cancel') return;
    e.preventDefault();
    try {
      const patch = {
        title: $('editTitle').value,
        description: $('editDesc').value,
        dueDate: $('editDue').value,
        dueTime: $('editTime').value,
        recurrence: $('editRepeat').value,
        reminder: $('editReminder').value,
        priority: $('editPriority').value,
        assigneeId: $('editAssignee').value,
        labels: $('editLabels').value,
      };
      if (!$('editSectionWrap').hidden) patch.sectionId = $('editSection').value;
      store.updateTask(currentUser, editingTaskId, patch);
      // A comment typed but not sent yet is posted with the save rather than lost.
      const draft = $('newComment').value;
      if (commentsOn() && draft.trim()) store.addComment(currentUser, editingTaskId, draft);
      $('newComment').value = '';
      $('taskDialog').close();
      toast(commentsOn() && draft.trim() ? 'Task updated and comment posted' : 'Task updated');
      render();
    } catch (err) { $('taskError').textContent = err.message; }
  });

  $('taskDelete').addEventListener('click', () => {
    attempt(() => {
      store.deleteTask(currentUser, editingTaskId);
      $('taskDialog').close();
      toast('Task deleted');
      render();
    });
  });

  // ---- saved filters -------------------------------------------------
  let editingFilterId = null;
  const FILTER_EXAMPLES = ['today | overdue', 'p1 & @urgent', 'assigned to: me & next 7 days', '#Inbox & no date', '!@urgent & overdue', 'recurring'];

  function previewFilter() {
    const q = $('filterQuery').value;
    if (!q.trim()) { $('filterPreview').textContent = ''; $('filterError').textContent = ''; return; }
    try {
      const n = store.filterTasks(currentUser, q).length;
      $('filterPreview').textContent = 'Matches ' + n + ' open task' + (n === 1 ? '' : 's') + ' right now.';
      $('filterError').textContent = '';
    } catch (err) {
      $('filterPreview').textContent = '';
      $('filterError').textContent = err.message;
    }
  }

  function openFilterDialog(filterId) {
    editingFilterId = filterId || null;
    const f = filterId ? store.getFilter(currentUser, filterId) : null;
    $('filterDialogTitle').textContent = f ? 'Edit filter' : 'Add filter';
    $('filterName').value = f ? f.name : '';
    $('filterQuery').value = f ? f.query : '';
    $('filterDelete').hidden = !f;
    $('filterExamples').replaceChildren(...FILTER_EXAMPLES.map((q) => el('button', {
      type: 'button', class: 'example',
      onclick: () => { $('filterQuery').value = q; previewFilter(); },
    }, q)));
    previewFilter();
    $('filterDialog').showModal();
  }

  $('filterQuery').addEventListener('input', previewFilter);
  $('filterForm').addEventListener('submit', (e) => {
    if (e.submitter && e.submitter.value === 'cancel') return;
    e.preventDefault();
    try {
      const data = { name: $('filterName').value, query: $('filterQuery').value };
      const f = editingFilterId ? store.updateFilter(currentUser, editingFilterId, data) : store.createFilter(currentUser, data);
      $('filterDialog').close();
      toast(editingFilterId ? 'Filter updated' : 'Filter saved');
      go({ type: 'filter', id: f.id });
    } catch (err) { $('filterError').textContent = err.message; }
  });
  $('filterDelete').addEventListener('click', () => {
    if (!confirm('Delete this filter? Tasks are not affected.')) return;
    attempt(() => {
      store.deleteFilter(currentUser, editingFilterId);
      $('filterDialog').close();
      toast('Filter deleted');
      go({ type: 'view', id: 'today' });
    });
  });

  // ---- reminders -----------------------------------------------------
  // Checked every 30 s while the app is open. Each reminder fires once per occurrence.
  function checkReminders() {
    if (!store) return;
    const notified = loadJSON(NOTIFIED_KEY, {});
    const cutoff = Date.now() - 3 * 24 * 3600 * 1000;
    Object.keys(notified).forEach((k) => { if (notified[k] < cutoff) delete notified[k]; });
    store.dueReminders(currentUser).forEach((t) => {
      const key = [currentUser, t.id, t.dueDate, t.dueTime, t.reminder].join('|');
      if (notified[key]) return;
      notified[key] = Date.now();
      showReminder(t);
    });
    save(NOTIFIED_KEY, JSON.stringify(notified));
  }

  function showReminder(t) {
    const when = dateLabel(t.dueDate) + (t.dueTime ? ' at ' + timeLabel(t.dueTime) : '');
    toast('⏰ ' + t.title + ' (due ' + when + ')', false, 8000);
    systemNotify('⏰ ' + t.title, 'Due ' + when, t.id);
  }

  // A phone/desktop pop-up, if the person allowed them.
  function systemNotify(title, body, tag) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const opts = { body, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', tag };
    // Android only allows notifications through the service worker.
    const fallback = () => { try { new Notification(title, opts); } catch (e) { /* toast already shown */ } };
    if (navigator.serviceWorker && navigator.serviceWorker.getRegistration) {
      navigator.serviceWorker.getRegistration()
        .then((reg) => (reg ? reg.showNotification(title, opts) : fallback()))
        .catch(fallback);
    } else fallback();
  }

  $('notifyBtn').addEventListener('click', () => {
    Notification.requestPermission().then((p) => {
      toast(p === 'granted' ? 'Reminders and assignments will pop up as notifications' : 'Pop-ups blocked; you\'ll see them inside the app');
      render();
    });
  });

  // ---- notifications (shared mode) ---------------------------------
  let notifications = [];
  let notificationsAvailable = false; // false until the database has the notifications table
  let seenNotificationIds = null;
  const NOTIF_VERB = { assigned: 'assigned you', completed: 'completed', uncompleted: 'reopened', commented: 'commented on' };
  const NOTIF_ICON = { assigned: '👤', completed: '✅', uncompleted: '↩', commented: '💬' };

  function timeAgo(iso) {
    const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return mins + 'm ago';
    if (mins < 24 * 60) return Math.round(mins / 60) + 'h ago';
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  // announce: pop up anything new since the last check (live updates).
  async function refreshNotifications(announce) {
    if (mode !== 'cloud' || !Cloud || !store) return;
    try {
      const list = await Cloud.loadNotifications();
      if (announce && seenNotificationIds) {
        list.filter((n) => !n.read_at && !seenNotificationIds.has(n.id)).reverse().forEach((n) => {
          const text = (n.actor_name || 'Someone') + ' ' + NOTIF_VERB[n.type] + ': ' + n.task_title;
          toast('🔔 ' + text, false, 6000);
          systemNotify('🔔 ' + text, n.type === 'commented' && n.comment_text ? n.comment_text : n.project_name, n.id);
        });
      }
      seenNotificationIds = new Set(list.map((n) => n.id));
      notifications = list;
      notificationsAvailable = true;
    } catch (err) {
      notificationsAvailable = false; // e.g. schema.sql not re-run yet
    }
    renderBell();
    if ($('notifDialog').open) renderNotificationList();
  }

  function renderBell() {
    $('bellBtn').hidden = mode !== 'cloud' || !notificationsAvailable;
    const unread = notifications.filter((n) => !n.read_at).length;
    $('bellCount').hidden = !unread;
    $('bellCount').textContent = unread > 9 ? '9+' : String(unread);
  }

  function renderNotificationList() {
    if (!notifications.length) {
      $('notifList').replaceChildren(el('li', { class: 'empty' }, 'No notifications yet. You\'ll see tasks assigned to you and new comments here.'));
      return;
    }
    $('notifList').replaceChildren(...notifications.map((n) => el('li', {
      class: n.read_at ? '' : 'unread',
      onclick: () => openNotification(n),
    },
    el('span', { class: 'notif-icon' }, NOTIF_ICON[n.type] || '🔔'),
    el('div', { class: 'notif-body' },
      el('div', null, el('b', null, n.actor_name || 'Someone'), ' ' + NOTIF_VERB[n.type] + ' ', el('b', null, n.task_title)),
      n.type === 'commented' && n.comment_text ? el('div', { class: 'notif-quote' }, '“' + n.comment_text + '”') : null,
      el('div', { class: 'meta' }, [n.project_name, n.due_date ? 'due ' + dateLabel(n.due_date) + (n.due_time ? ' ' + timeLabel(n.due_time) : '') : '', timeAgo(n.created_at)]
        .filter(Boolean).join(' · '))))));
  }

  function openNotification(n) {
    if (!n.read_at) {
      n.read_at = new Date().toISOString();
      Cloud.markNotificationsRead([n.id]).catch(() => {});
      renderBell();
    }
    $('notifDialog').close();
    if (n.task_id && store.listTasks(currentUser, { includeCompleted: true }).some((t) => t.id === n.task_id)) {
      openTaskDialog(n.task_id);
      if (n.type === 'commented') {
        $('commentSection').scrollIntoView({ block: 'nearest' });
        $('commentList').scrollTop = $('commentList').scrollHeight;
      }
    } else {
      toast('That task is no longer available', true);
    }
  }

  $('bellBtn').addEventListener('click', async () => {
    renderNotificationList();
    $('notifDialog').showModal();
    try {
      const prefs = await Cloud.getEmailPrefs(currentUser);
      $('prefAssign').checked = prefs.email_on_assign;
      $('prefComplete').checked = prefs.email_on_complete;
      $('prefCommentWrap').hidden = prefs.email_on_comment === undefined;
      $('prefComment').checked = !!prefs.email_on_comment;
      $('prefEmail').textContent = prefs.email;
    } catch (e) { $('emailSettings').hidden = true; }
  });
  $('notifClose').addEventListener('click', () => $('notifDialog').close());
  $('markAllReadBtn').addEventListener('click', () => {
    const ids = notifications.filter((n) => !n.read_at).map((n) => n.id);
    const stamp = new Date().toISOString();
    notifications.forEach((n) => { if (!n.read_at) n.read_at = stamp; });
    renderBell();
    renderNotificationList();
    Cloud.markNotificationsRead(ids).catch((err) => toast(err.message, true));
  });
  function savePref(column, checkbox) {
    Cloud.setEmailPrefs(currentUser, { [column]: checkbox.checked })
      .then(() => toast('Email settings saved'))
      .catch((err) => { checkbox.checked = !checkbox.checked; toast(err.message, true); });
  }
  $('prefAssign').addEventListener('change', (e) => savePref('email_on_assign', e.target));
  $('prefComplete').addEventListener('change', (e) => savePref('email_on_complete', e.target));
  $('prefComment').addEventListener('change', (e) => savePref('email_on_comment', e.target));

  // ---- global controls -----------------------------------------------
  $('userSelect').addEventListener('change', (e) => {
    if (mode !== 'demo') return;
    currentUser = e.target.value;
    save(USER_KEY, currentUser);
    current = { type: 'view', id: 'today' };
    toast('Signed in as ' + userById(currentUser).name);
    render();
    checkReminders();
  });
  $('viewNav').addEventListener('click', (e) => {
    const li = e.target.closest('li');
    if (li) go({ type: 'view', id: li.dataset.view });
  });
  $('searchForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const q = $('searchInput').value.trim();
    if (q) go({ type: 'search', q });
  });
  $('searchInput').addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { $('searchInput').value = ''; $('searchInput').blur(); }
  });
  $('addProjectBtn').addEventListener('click', () => openProjectDialog(null));
  $('addFilterBtn').addEventListener('click', () => openFilterDialog(null));
  $('showCompleted').addEventListener('change', (e) => { showCompleted = e.target.checked; render(); });
  $('resetBtn').addEventListener('click', () => {
    if (!confirm('Reset all data to the 5-user demo scenario?')) return;
    store = createStore(null, (state) => save(STORAGE_KEY, JSON.stringify(state)));
    save(STORAGE_KEY, JSON.stringify(store.state));
    current = { type: 'view', id: 'today' };
    toast('Demo data restored');
    render();
  });

  // ---- start-up: demo or shared mode -----------------------------------
  function showScreen(which) {
    $('loadingScreen').hidden = which !== 'loading';
    $('authScreen').hidden = which !== 'auth';
    $('appShell').hidden = which !== 'app';
  }

  function startDemo() {
    mode = 'demo';
    save(MODE_KEY, 'demo');
    const saved = loadJSON(STORAGE_KEY, null);
    store = createStore(saved, (state) => save(STORAGE_KEY, JSON.stringify(state)));
    if (!saved) save(STORAGE_KEY, JSON.stringify(store.state));
    currentUser = load(USER_KEY) || 'u1';
    if (!store.listUsers().some((u) => u.id === currentUser)) currentUser = 'u1';
    current = { type: 'view', id: 'today' };
    $('syncStatus').hidden = true;
    showScreen('app');
    render();
    checkReminders();
  }

  $('exitDemoBtn').addEventListener('click', () => {
    save(MODE_KEY, 'cloud');
    mode = 'cloud';
    store = null;
    showAuth();
  });
  $('demoBtn').addEventListener('click', startDemo);

  // ---- shared mode: sign-in ------------------------------------------
  const NO_CLOUD = 'Could not load the sign-in service. Check your internet connection and reload the page. You can still try the demo.';
  function showAuth(errorText, infoText) {
    notifications = [];
    notificationsAvailable = false;
    seenNotificationIds = null;
    showScreen('auth');
    // Without the Supabase library there is nothing to sign in with, so only offer the demo.
    $('signInForm').hidden = !Cloud;
    if (!Cloud) errorText = errorText || NO_CLOUD;
    $('newPasswordForm').hidden = true;
    $('authSub').textContent = 'Sign in with your Flexo account';
    $('authError').textContent = errorText || '';
    $('authInfo').textContent = infoText || '';
  }
  function authBusy(busy) {
    document.querySelectorAll('#authScreen button, #authScreen input').forEach((n) => { n.disabled = busy; });
  }
  async function authAction(fn, info) {
    if (!Cloud) { $('authError').textContent = NO_CLOUD; return; }
    $('authError').textContent = '';
    $('authInfo').textContent = '';
    authBusy(true);
    try {
      await fn();
      if (info) $('authInfo').textContent = info;
    } catch (err) {
      $('authError').textContent = /Invalid login credentials/i.test(err.message) ? 'Wrong email or password.'
        : /No internet connection/i.test(err.message) ? 'Could not reach the sign-in server. Check your internet connection and try again.'
          : err.message;
    } finally { authBusy(false); }
  }
  const authEmail = () => {
    const email = $('authEmail').value.trim();
    if (!email) { $('authError').textContent = 'Enter your email first.'; $('authEmail').focus(); }
    return email;
  };

  $('signInForm').addEventListener('submit', (e) => {
    e.preventDefault();
    if (!$('authPassword').value) { $('authError').textContent = 'Enter your password, or use "Email me a sign-in link".'; return; }
    authAction(() => Cloud.signIn($('authEmail').value, $('authPassword').value));
  });
  $('magicLinkBtn').addEventListener('click', () => {
    const email = authEmail();
    if (email) authAction(() => Cloud.sendSignInLink(email), 'Check your email for a sign-in link (it can take a minute).');
  });
  $('forgotBtn').addEventListener('click', () => {
    const email = authEmail();
    if (email) authAction(() => Cloud.sendPasswordReset(email), 'Check your email for a link to set a new password.');
  });
  // Opened from a "reset password" email: hold here until a new password is saved.
  let recovering = !!(Cloud && Cloud.cameFromPasswordReset);
  function showNewPassword() {
    recovering = true;
    showScreen('auth');
    $('signInForm').hidden = true;
    $('newPasswordForm').hidden = false;
    $('authSub').textContent = 'Choose a new password';
    $('authError').textContent = '';
    $('authInfo').textContent = '';
    $('newPassword').focus();
  }
  $('newPasswordForm').addEventListener('submit', (e) => {
    e.preventDefault();
    authAction(async () => {
      const session = await Cloud.getSession();
      if (!session) throw new Error('This reset link has expired. Go back and tap "Forgot password?" again.');
      await Cloud.setPassword($('newPassword').value);
      $('newPassword').value = '';
      recovering = false;
      toast('Password saved');
      enterCloud(session);
    });
  });
  $('signOutBtn').addEventListener('click', async () => {
    Cloud.unsubscribe();
    await Cloud.signOut();
    store = null;
    showAuth('', 'You have signed out.');
  });
  $('meBtn').addEventListener('click', () => {
    const me = userById(currentUser);
    const name = prompt('Your display name:', me.name);
    if (name === null || !name.trim() || name.trim() === me.name) return;
    Cloud.updateMyName(currentUser, name).then(() => { toast('Name updated'); reloadCloud(); })
      .catch((err) => toast(err.message, true));
  });

  // ---- shared mode: data ---------------------------------------------
  let writeQueue = Promise.resolve();
  let pendingWrites = 0;
  let reloadWanted = false;
  let reloadTimer = null;

  function setSync(text) {
    $('syncStatus').hidden = !text;
    $('syncStatus').textContent = text || '';
  }

  // Every store action → save the difference to the database, one change at a time, in order.
  function onCloudChange(state) {
    const prev = synced;
    synced = state;
    pendingWrites++;
    setSync('Saving…');
    writeQueue = writeQueue
      .then(() => Cloud.pushDiff(prev, state))
      .catch((err) => {
        toast('Not saved: ' + err.message, true, 6000);
        reloadWanted = true; // put the screen back in line with the database
      })
      .finally(() => {
        pendingWrites--;
        if (!pendingWrites) {
          setSync(navigator.onLine === false ? 'Offline' : 'Saved');
          if (reloadWanted) reloadCloud();
        }
      });
  }

  async function reloadCloud() {
    if (pendingWrites) { reloadWanted = true; return; }
    reloadWanted = false;
    try {
      const state = await Cloud.loadState();
      if (pendingWrites) { reloadWanted = true; return; } // a change started meanwhile; reload after it
      store = createStore(state, onCloudChange, { newId: () => crypto.randomUUID() });
      synced = store.state;
      if (!$('appShell').hidden) { render(); refreshOpenTask(); }
      refreshNotifications(true);
    } catch (err) {
      setSync('Offline');
      toast('Could not load the latest data: ' + err.message, true, 5000);
    }
  }
  // Live updates from other people: reload shortly after the last change.
  function scheduleReload() {
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(reloadCloud, 400);
  }

  let entering = false;
  async function enterCloud(session) {
    if (recovering || entering || (store && currentUser === session.user.id && mode === 'cloud')) return;
    entering = true;
    try {
      mode = 'cloud';
      currentUser = session.user.id;
      showScreen('loading');
      const state = await Cloud.loadState();
      if (!state.users.some((u) => u.id === currentUser)) {
        await Cloud.signOut();
        showAuth('Your account is not set up yet. Ask the admin to run the database setup (supabase/schema.sql).');
        return;
      }
      if (recovering) return; // a reset link was detected while loading
      store = createStore(state, onCloudChange, { newId: () => crypto.randomUUID() });
      synced = store.state;
      current = { type: 'view', id: 'today' };
      setSync('Saved');
      showScreen('app');
      render();
      checkReminders();
      Cloud.subscribe(scheduleReload);
      seenNotificationIds = null;
      refreshNotifications(false);
    } catch (err) {
      showAuth('Could not load your data: ' + err.message);
    } finally { entering = false; }
  }

  async function startCloud() {
    if (!Cloud) {
      showAuth(NO_CLOUD);
      return;
    }
    if (Cloud.linkError) {
      // e.g. an old or already-used email link.
      showAuth(Cloud.linkError.replace(/\+/g, ' ') + '. Please request a new link.');
      history.replaceState(null, '', location.pathname);
    }
    if (recovering) showNewPassword();
    Cloud.onAuth((event, session) => {
      if (event === 'PASSWORD_RECOVERY') {
        showNewPassword();
      } else if (event === 'SIGNED_IN' && session && !recovering) {
        enterCloud(session);
      } else if (event === 'SIGNED_OUT' && mode === 'cloud') {
        recovering = false;
        store = null;
        showAuth();
      }
    });
    const session = await Cloud.getSession();
    if (recovering) return;
    if (session) enterCloud(session);
    else if (!Cloud.linkError) showAuth();
  }
  $('menuBtn').addEventListener('click', () => $('sidebar').classList.toggle('open'));
  function closeSidebar() { $('sidebar').classList.remove('open'); }

  // ---- install as app (PWA) -----------------------------------------
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => { /* offline support is optional */ });
    // When an update takes over (not on the very first install), reload once to run the new version.
    if (navigator.serviceWorker.controller) {
      let reloaded = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!reloaded) { reloaded = true; location.reload(); }
      });
    }
  }
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  let installPrompt = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    // Android/desktop Chrome & Edge: show our own Install button.
    e.preventDefault();
    installPrompt = e;
    $('installBtn').hidden = false;
  });
  window.addEventListener('appinstalled', () => { $('installBtn').hidden = true; toast('App installed'); });
  // iOS Safari has no install prompt; the button explains the Share-sheet steps instead.
  if (isIOS && !standalone) $('installBtn').hidden = false;
  $('installBtn').addEventListener('click', async () => {
    if (installPrompt) {
      installPrompt.prompt();
      await installPrompt.userChoice;
      installPrompt = null;
      $('installBtn').hidden = true;
    } else {
      alert('To install on iPhone/iPad:\n\n1. Tap the Share button (square with arrow) in Safari\n2. Choose "Add to Home Screen"\n3. Tap "Add"');
    }
  });

  // A reset-password or sign-in link always opens the shared mode, even if the demo was last used.
  if (mode === 'demo' && !(Cloud && (Cloud.cameFromPasswordReset || Cloud.linkError))) startDemo();
  else { mode = 'cloud'; save(MODE_KEY, 'cloud'); startCloud(); }
  setInterval(() => { checkReminders(); }, 30000);
  // Coming back to the app: refresh "Today"/overdue colours, and catch up on others' changes.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden || !store) return;
    if (mode === 'cloud') reloadCloud(); else render();
    checkReminders();
  });
  window.addEventListener('online', () => { if (mode === 'cloud' && store) reloadCloud(); });
  window.addEventListener('offline', () => { if (mode === 'cloud') setSync('Offline'); });
})();
