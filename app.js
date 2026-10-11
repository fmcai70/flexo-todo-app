/* UI layer: renders the store for the signed-in user and persists to localStorage. */
(function () {
  'use strict';

  const STORAGE_KEY = 'flexoTodo.data.v1';
  const USER_KEY = 'flexoTodo.user';
  const { createStore, isoDate } = window.TaskStore;

  // ---- persistence (wrapped: storage can be unavailable in private windows) ----
  function load(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
  function save(key, value) { try { localStorage.setItem(key, value); } catch (e) { /* ignore */ } }

  let saved = null;
  try { saved = JSON.parse(load(STORAGE_KEY)); } catch (e) { saved = null; }
  let store = createStore(saved, (state) => save(STORAGE_KEY, JSON.stringify(state)));
  if (!saved) save(STORAGE_KEY, JSON.stringify(store.state));

  let currentUser = load(USER_KEY) || 'u1';
  if (!store.listUsers().some((u) => u.id === currentUser)) currentUser = 'u1';
  let current = { type: 'view', id: 'today' };
  let showCompleted = false;

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
  const AVATAR_COLORS = ['#b8255f', '#4073ff', '#299438', '#ff9933', '#884dff'];
  function avatar(user) {
    const idx = parseInt(user.id.replace(/\D/g, ''), 10) % AVATAR_COLORS.length;
    const initials = user.name.split(' ').map((s) => s[0]).join('').slice(0, 2).toUpperCase();
    return el('span', { class: 'avatar', style: 'background:' + AVATAR_COLORS[idx], title: user.name }, initials);
  }
  const userById = (id) => store.listUsers().find((u) => u.id === id);

  function toast(msg, isError) {
    const t = $('toast');
    t.textContent = msg;
    t.className = 'toast' + (isError ? ' error' : '');
    t.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { t.hidden = true; }, 2800);
  }
  function attempt(fn) {
    try { return fn(); } catch (e) { toast(e.message, true); return undefined; }
  }

  function formatDue(due) {
    if (!due) return null;
    const today = isoDate(0);
    const tomorrow = isoDate(1);
    let cls = '';
    let label;
    if (due < today) { cls = 'overdue'; label = new Date(due + 'T12:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); }
    else if (due === today) { cls = 'today'; label = 'Today'; }
    else if (due === tomorrow) { label = 'Tomorrow'; }
    else label = new Date(due + 'T12:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
    return el('span', { class: 'due ' + cls }, '📅 ' + label);
  }

  const ROLE_LABEL = { manager: 'Manager', member: 'Member', admin: 'Admin access' };

  // ---- render --------------------------------------------------------
  function render() {
    // A project may have become invisible (e.g. removed, or user switched).
    if (current.type === 'project' && !store.canView(currentUser, current.id)) current = { type: 'view', id: 'today' };
    renderUserSelect();
    renderSidebar();
    renderMain();
  }

  function renderUserSelect() {
    const sel = $('userSelect');
    sel.replaceChildren(...store.listUsers().map((u) =>
      el('option', { value: u.id, selected: u.id === currentUser }, u.name + (u.role === 'admin' ? ' (Admin)' : ''))));
  }

  function renderSidebar() {
    const counts = {
      inbox: store.listTasks(currentUser, { view: 'inbox' }).length,
      today: store.listTasks(currentUser, { view: 'today' }).length,
      upcoming: store.listTasks(currentUser, { view: 'upcoming' }).length,
      mine: store.listTasks(currentUser, { view: 'mine' }).length,
    };
    $('countInbox').textContent = counts.inbox || '';
    $('countToday').textContent = counts.today || '';
    $('countUpcoming').textContent = counts.upcoming || '';
    $('countMine').textContent = counts.mine || '';
    document.querySelectorAll('#viewNav li').forEach((li) =>
      li.classList.toggle('active', current.type === 'view' && current.id === li.dataset.view));

    const projects = store.listProjects(currentUser);
    $('noProjects').hidden = projects.length > 0;
    $('projectNav').replaceChildren(...projects.map((p) => {
      const role = store.roleIn(currentUser, p.id);
      const open = store.listTasks(currentUser, { projectId: p.id }).length;
      return el('li', {
        class: current.type === 'project' && current.id === p.id ? 'active' : '',
        onclick: () => { current = { type: 'project', id: p.id }; closeSidebar(); render(); },
      },
      el('span', { class: 'dot', style: 'background:' + p.color }),
      el('span', null, p.name),
      role !== 'member' ? el('span', { class: 'tag ' + role }, role === 'manager' ? 'PM' : 'Admin') : null,
      el('span', { class: 'count' }, open || ''));
    }));
  }

  function renderMain() {
    const isProject = current.type === 'project';
    const project = isProject ? store.getProject(currentUser, current.id) : null;
    const isInbox = current.type === 'view' && current.id === 'inbox';
    const titles = { inbox: 'Inbox', today: 'Today', upcoming: 'Upcoming', mine: 'Assigned to me' };

    $('viewTitle').replaceChildren(isProject
      ? el('span', null, el('span', { class: 'dot', style: 'display:inline-block;background:' + project.color }), ' ' + project.name)
      : titles[current.id]);

    // Subtitle & header actions
    const actions = [];
    if (isProject) {
      const role = store.roleIn(currentUser, project.id);
      const mgr = userById(project.managerId);
      $('viewSub').textContent = 'Project manager: ' + mgr.name + ' · Your role: ' + ROLE_LABEL[role];
      actions.push(el('button', { class: 'btn ghost small', onclick: () => openProjectDialog(project.id) },
        store.canManage(currentUser, project.id) ? '⚙ Manage project' : 'ⓘ Project info'));
      const people = [project.managerId, ...project.memberIds].map(userById);
      $('membersBar').replaceChildren(...people.map((u) =>
        el('span', { class: 'chip' }, avatar(u), u.name, u.id === project.managerId ? el('span', { class: 'tag manager' }, 'PM') : null)));
    } else {
      $('viewSub').textContent = {
        inbox: '🔒 Your personal tasks. Only you can see these.',
        today: new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }) + ' · overdue and due today',
        upcoming: 'Due after today, across your Inbox and projects',
        mine: 'Tasks assigned to you, including your Inbox',
      }[current.id];
      $('membersBar').replaceChildren();
    }
    $('headerActions').replaceChildren(...actions);

    // Tasks
    const filter = isProject ? { projectId: project.id } : { view: current.id };
    filter.includeCompleted = showCompleted;
    const tasks = store.listTasks(currentUser, filter);
    $('taskList').replaceChildren(...tasks.map((t) => renderTask(t, !isProject && !isInbox)));
    const empty = $('emptyState');
    empty.hidden = tasks.length > 0;
    if (!tasks.length) {
      empty.textContent = isInbox
        ? 'Your Inbox is empty. Add a personal task below.'
        : 'Nothing here. Enjoy your day! 🎉';
    }

    // Add task form inside a project or in the personal Inbox
    $('addTaskForm').hidden = !(isProject || isInbox);
    $('newAssignee').hidden = !isProject;
    $('newTitle').placeholder = isInbox ? 'Personal task, e.g. Renew passport' : 'Task name, e.g. Send invoice';
    if (isProject) {
      const opts = [el('option', { value: '' }, 'Unassigned')]
        .concat([project.managerId, ...project.memberIds].map((id) => el('option', { value: id }, userById(id).name)));
      $('newAssignee').replaceChildren(...opts);
    }
  }

  function projectLabel(projectId) {
    if (projectId === null) return el('span', { class: 'project-label' }, '📥 Inbox');
    const p = store.getProject(currentUser, projectId);
    return el('span', { class: 'project-label' }, el('span', { class: 'dot', style: 'background:' + p.color }), p.name);
  }

  function renderTask(t, showProject) {
    const assignee = t.assigneeId ? userById(t.assigneeId) : null;
    return el('li', { class: 'task' + (t.completed ? ' done' : '') },
      el('button', {
        class: 'check p' + t.priority, title: t.completed ? 'Mark incomplete' : 'Complete task', 'aria-label': 'Toggle complete',
        onclick: () => attempt(() => { const r = store.toggleTask(currentUser, t.id); toast(r.completed ? 'Task completed' : 'Task reopened'); render(); }),
      }, '✓'),
      el('div', { class: 'task-body', onclick: () => openTaskDialog(t.id) },
        el('div', { class: 'title' }, t.title),
        t.description ? el('div', { class: 'desc' }, t.description) : null,
        el('div', { class: 'meta-row' },
          formatDue(t.dueDate),
          // Personal tasks are always the owner's, so skip the assignee there.
          t.projectId === null ? null
            : assignee ? el('span', { class: 'project-label' }, avatar(assignee), ' ' + assignee.name) : el('span', null, 'Unassigned'),
          showProject ? projectLabel(t.projectId) : null)));
  }

  // ---- add task ------------------------------------------------------
  $('addTaskForm').addEventListener('submit', (e) => {
    e.preventDefault();
    attempt(() => {
      store.createTask(currentUser, current.type === 'project' ? current.id : null, {
        title: $('newTitle').value,
        description: $('newDesc').value,
        dueDate: $('newDue').value,
        priority: $('newPriority').value,
        assigneeId: $('newAssignee').value,
      });
      $('newTitle').value = ''; $('newDesc').value = ''; $('newDue').value = '';
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
    editingTaskId = taskId;
    const p = t.projectId === null ? null : store.getProject(currentUser, t.projectId);
    $('editTitle').value = t.title;
    $('editDesc').value = t.description;
    $('editDue').value = t.dueDate || '';
    $('editPriority').value = String(t.priority);
    const people = p ? [p.managerId, ...p.memberIds] : [t.createdBy];
    $('editAssignee').replaceChildren(...(p ? [el('option', { value: '' }, 'Unassigned')] : []),
      ...people.map((id) => el('option', { value: id, selected: id === t.assigneeId }, userById(id).name)));
    $('editAssignee').closest('label').hidden = !p;
    $('editMeta').textContent = p
      ? 'In ' + p.name + ' · created by ' + userById(t.createdBy).name
      : '📥 Personal task in your Inbox · only you can see it';
    $('taskDelete').hidden = !(t.createdBy === currentUser || (p && store.canManage(currentUser, p.id)));
    $('taskError').textContent = '';
    $('taskDialog').showModal();
  }

  $('taskForm').addEventListener('submit', (e) => {
    if (e.submitter && e.submitter.value === 'cancel') return;
    e.preventDefault();
    try {
      store.updateTask(currentUser, editingTaskId, {
        title: $('editTitle').value,
        description: $('editDesc').value,
        dueDate: $('editDue').value,
        priority: $('editPriority').value,
        assigneeId: $('editAssignee').value,
      });
      $('taskDialog').close();
      toast('Task updated');
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

  // ---- global controls -----------------------------------------------
  $('userSelect').addEventListener('change', (e) => {
    currentUser = e.target.value;
    save(USER_KEY, currentUser);
    current = { type: 'view', id: 'today' };
    toast('Signed in as ' + userById(currentUser).name);
    render();
  });
  $('viewNav').addEventListener('click', (e) => {
    const li = e.target.closest('li');
    if (!li) return;
    current = { type: 'view', id: li.dataset.view };
    closeSidebar();
    render();
  });
  $('addProjectBtn').addEventListener('click', () => openProjectDialog(null));
  $('showCompleted').addEventListener('change', (e) => { showCompleted = e.target.checked; render(); });
  $('resetBtn').addEventListener('click', () => {
    if (!confirm('Reset all data to the 5-user demo scenario?')) return;
    store = createStore(null, (state) => save(STORAGE_KEY, JSON.stringify(state)));
    save(STORAGE_KEY, JSON.stringify(store.state));
    current = { type: 'view', id: 'today' };
    toast('Demo data restored');
    render();
  });
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

  render();
})();
