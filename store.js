/*
 * TaskStore — data model and permission rules for the task tracker.
 *
 * Every read/write method takes the acting user's id first and enforces:
 *   - admin            : can see and manage every project
 *   - project manager  : can see the project, edit it, manage members, delete any task
 *   - project member   : can see the project, add/edit/complete tasks, delete own tasks
 *   - everyone else    : cannot see the project or any of its tasks
 *
 * The store is plain JS with no DOM access so it can be unit tested (see tests.html).
 */
(function (global) {
  'use strict';

  class PermissionError extends Error {
    constructor(message) { super(message); this.name = 'PermissionError'; }
  }
  class ValidationError extends Error {
    constructor(message) { super(message); this.name = 'ValidationError'; }
  }
  class NotFoundError extends Error {
    constructor(message) { super(message); this.name = 'NotFoundError'; }
  }

  function isoDate(offsetDays, from) {
    const d = from ? new Date(from) : new Date();
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() + offsetDays);
    return d.toISOString().slice(0, 10);
  }

  const clone = (o) => JSON.parse(JSON.stringify(o));

  // Five demo users covering every access level.
  function seedData() {
    const now = new Date().toISOString();
    const task = (id, projectId, title, createdBy, assigneeId, due, priority, extra) =>
      Object.assign({
        id, projectId, title, description: '', createdBy, assigneeId,
        dueDate: due === null ? null : isoDate(due), priority,
        completed: false, completedAt: null, createdAt: now,
      }, extra);

    return {
      version: 1,
      nextId: 100,
      users: [
        { id: 'u1', name: 'Alice Santos', email: 'alice@example.com', role: 'admin' },
        { id: 'u2', name: 'Bob Reyes', email: 'bob@example.com', role: 'user' },
        { id: 'u3', name: 'Carol Cruz', email: 'carol@example.com', role: 'user' },
        { id: 'u4', name: 'Dave Lim', email: 'dave@example.com', role: 'user' },
        { id: 'u5', name: 'Eve Garcia', email: 'eve@example.com', role: 'user' },
      ],
      projects: [
        { id: 'p1', name: 'Website Redesign', color: '#db4035', managerId: 'u2', memberIds: ['u3'], createdBy: 'u2', createdAt: now },
        { id: 'p2', name: 'Mobile App Launch', color: '#4073ff', managerId: 'u3', memberIds: ['u4'], createdBy: 'u3', createdAt: now },
        { id: 'p3', name: 'Finance Audit 2026', color: '#299438', managerId: 'u1', memberIds: [], createdBy: 'u1', createdAt: now },
      ],
      tasks: [
        task('t1', 'p1', 'Draft new homepage wireframe', 'u2', 'u3', 0, 1, { description: 'Hero, features, pricing sections.' }),
        task('t2', 'p1', 'Collect brand assets', 'u2', 'u2', 1, 3),
        task('t3', 'p1', 'Review copy with marketing', 'u3', 'u3', 4, 2),
        task('t4', 'p1', 'Set up staging site', 'u2', null, -1, 2),
        task('t5', 'p2', 'Finalize app store screenshots', 'u3', 'u4', 0, 2),
        task('t6', 'p2', 'Fix login crash on Android', 'u3', 'u4', 2, 1, { description: 'Crash on Android 14 when biometric is enabled.' }),
        task('t7', 'p2', 'Write release notes', 'u4', 'u3', 6, 4),
        task('t8', 'p2', 'Beta test sign-off', 'u3', 'u3', null, 3, { completed: true, completedAt: now }),
        task('t9', 'p3', 'Reconcile Q3 bank statements', 'u1', 'u1', 3, 1),
        task('t10', 'p3', 'Prepare auditor document list', 'u1', 'u1', 8, 3),
      ],
    };
  }

  function createStore(initialState, onChange) {
    const state = initialState ? clone(initialState) : seedData();
    const notify = () => { if (onChange) onChange(state); };
    const newId = (prefix) => prefix + (state.nextId++);

    // ---- lookups -------------------------------------------------------
    function findUser(id) {
      const u = state.users.find((x) => x.id === id);
      if (!u) throw new NotFoundError('User not found: ' + id);
      return u;
    }
    function findProject(id) {
      const p = state.projects.find((x) => x.id === id);
      if (!p) throw new NotFoundError('Project not found');
      return p;
    }
    function findTask(id) {
      const t = state.tasks.find((x) => x.id === id);
      if (!t) throw new NotFoundError('Task not found');
      return t;
    }

    // ---- permission helpers -------------------------------------------
    const isAdmin = (actorId) => findUser(actorId).role === 'admin';
    const isMemberOf = (userId, p) => p.managerId === userId || p.memberIds.includes(userId);

    function roleIn(actorId, projectId) {
      const p = findProject(projectId);
      if (p.managerId === actorId) return 'manager';
      if (p.memberIds.includes(actorId)) return 'member';
      if (isAdmin(actorId)) return 'admin';
      return null;
    }
    const canView = (actorId, projectId) => roleIn(actorId, projectId) !== null;
    const canManage = (actorId, projectId) => {
      const r = roleIn(actorId, projectId);
      return r === 'manager' || r === 'admin' || isAdmin(actorId);
    };

    function requireView(actorId, projectId) {
      // Same error for "missing" and "forbidden" so outsiders can't probe for project ids.
      let ok = false;
      try { ok = canView(actorId, projectId); } catch (e) { if (!(e instanceof NotFoundError)) throw e; }
      if (!ok) throw new PermissionError('You do not have access to this project');
      return findProject(projectId);
    }
    function requireManage(actorId, projectId) {
      const p = requireView(actorId, projectId);
      if (!canManage(actorId, projectId)) throw new PermissionError('Only the project manager or an admin can do this');
      return p;
    }
    function requireTask(actorId, taskId) {
      let t;
      try { t = findTask(taskId); } catch (e) { throw new PermissionError('You do not have access to this task'); }
      requireView(actorId, t.projectId);
      return t;
    }

    function validateTaskFields(p, fields) {
      if ('title' in fields) {
        if (typeof fields.title !== 'string' || !fields.title.trim()) throw new ValidationError('Task title is required');
        fields.title = fields.title.trim();
      }
      if ('priority' in fields && ![1, 2, 3, 4].includes(Number(fields.priority))) {
        throw new ValidationError('Priority must be 1-4');
      }
      if ('priority' in fields) fields.priority = Number(fields.priority);
      if ('dueDate' in fields) {
        if (fields.dueDate === '' || fields.dueDate == null) fields.dueDate = null;
        else if (!/^\d{4}-\d{2}-\d{2}$/.test(fields.dueDate)) throw new ValidationError('Due date must be YYYY-MM-DD');
      }
      if ('assigneeId' in fields) {
        if (fields.assigneeId === '' || fields.assigneeId == null) fields.assigneeId = null;
        else if (!isMemberOf(fields.assigneeId, p)) throw new ValidationError('Assignee must be a member of the project');
      }
      return fields;
    }

    // ---- users ---------------------------------------------------------
    function listUsers() { return clone(state.users); }
    function getUser(id) { return clone(findUser(id)); }

    // ---- projects ------------------------------------------------------
    function listProjects(actorId) {
      findUser(actorId);
      return clone(state.projects.filter((p) => canView(actorId, p.id)));
    }

    function getProject(actorId, projectId) {
      return clone(requireView(actorId, projectId));
    }

    function createProject(actorId, { name, color, managerId, memberIds } = {}) {
      findUser(actorId);
      if (typeof name !== 'string' || !name.trim()) throw new ValidationError('Project name is required');
      const mgr = managerId || actorId;
      if (mgr !== actorId && !isAdmin(actorId)) {
        throw new PermissionError('Only an admin can assign someone else as project manager');
      }
      findUser(mgr);
      const members = [...new Set(memberIds || [])].filter((id) => id !== mgr);
      members.forEach(findUser);
      const p = {
        id: newId('p'), name: name.trim(), color: color || '#808080',
        managerId: mgr, memberIds: members, createdBy: actorId, createdAt: new Date().toISOString(),
      };
      state.projects.push(p);
      notify();
      return clone(p);
    }

    function updateProject(actorId, projectId, { name, color } = {}) {
      const p = requireManage(actorId, projectId);
      if (name !== undefined) {
        if (!String(name).trim()) throw new ValidationError('Project name is required');
        p.name = String(name).trim();
      }
      if (color !== undefined) p.color = color;
      notify();
      return clone(p);
    }

    function deleteProject(actorId, projectId) {
      requireManage(actorId, projectId);
      state.projects = state.projects.filter((p) => p.id !== projectId);
      state.tasks = state.tasks.filter((t) => t.projectId !== projectId);
      notify();
    }

    function addMember(actorId, projectId, userId) {
      const p = requireManage(actorId, projectId);
      findUser(userId);
      if (isMemberOf(userId, p)) throw new ValidationError('User is already in this project');
      p.memberIds.push(userId);
      notify();
      return clone(p);
    }

    function removeMember(actorId, projectId, userId) {
      const p = requireManage(actorId, projectId);
      if (p.managerId === userId) throw new ValidationError('The project manager cannot be removed; assign a new manager first');
      if (!p.memberIds.includes(userId)) throw new ValidationError('User is not a member of this project');
      p.memberIds = p.memberIds.filter((id) => id !== userId);
      // Their open assignments in this project go back to unassigned.
      state.tasks.forEach((t) => { if (t.projectId === projectId && t.assigneeId === userId) t.assigneeId = null; });
      notify();
      return clone(p);
    }

    function setManager(actorId, projectId, userId) {
      const p = requireView(actorId, projectId);
      if (!isAdmin(actorId)) throw new PermissionError('Only an admin can change the project manager');
      findUser(userId);
      if (p.managerId === userId) return clone(p);
      const previous = p.managerId;
      p.memberIds = p.memberIds.filter((id) => id !== userId);
      if (!p.memberIds.includes(previous)) p.memberIds.push(previous); // old manager stays as a member
      p.managerId = userId;
      notify();
      return clone(p);
    }

    // ---- tasks ---------------------------------------------------------
    /**
     * filter: { projectId?, view?: 'today' | 'upcoming' | 'mine', includeCompleted?, today? }
     */
    function listTasks(actorId, filter = {}) {
      findUser(actorId);
      const today = filter.today || isoDate(0);
      let tasks;
      if (filter.projectId) {
        requireView(actorId, filter.projectId);
        tasks = state.tasks.filter((t) => t.projectId === filter.projectId);
      } else {
        const visible = new Set(state.projects.filter((p) => canView(actorId, p.id)).map((p) => p.id));
        tasks = state.tasks.filter((t) => visible.has(t.projectId));
      }
      if (filter.view === 'today') tasks = tasks.filter((t) => t.dueDate && t.dueDate <= today);
      if (filter.view === 'upcoming') tasks = tasks.filter((t) => t.dueDate && t.dueDate > today);
      if (filter.view === 'mine') tasks = tasks.filter((t) => t.assigneeId === actorId);
      if (!filter.includeCompleted) tasks = tasks.filter((t) => !t.completed);
      return clone(tasks).sort((a, b) =>
        Number(a.completed) - Number(b.completed) ||
        (a.dueDate || '9999') .localeCompare(b.dueDate || '9999') ||
        a.priority - b.priority);
    }

    function getTask(actorId, taskId) { return clone(requireTask(actorId, taskId)); }

    function createTask(actorId, projectId, fields = {}) {
      const p = requireView(actorId, projectId);
      const f = validateTaskFields(p, Object.assign({ priority: 4, dueDate: null, assigneeId: null, description: '' }, fields, { title: fields.title }));
      const t = {
        id: newId('t'), projectId, title: f.title, description: String(f.description || ''),
        createdBy: actorId, assigneeId: f.assigneeId, dueDate: f.dueDate, priority: f.priority,
        completed: false, completedAt: null, createdAt: new Date().toISOString(),
      };
      state.tasks.push(t);
      notify();
      return clone(t);
    }

    function updateTask(actorId, taskId, patch = {}) {
      const t = requireTask(actorId, taskId);
      const p = findProject(t.projectId);
      const allowed = {};
      ['title', 'description', 'dueDate', 'priority', 'assigneeId'].forEach((k) => { if (k in patch) allowed[k] = patch[k]; });
      validateTaskFields(p, allowed);
      Object.assign(t, allowed);
      notify();
      return clone(t);
    }

    function toggleTask(actorId, taskId) {
      const t = requireTask(actorId, taskId);
      t.completed = !t.completed;
      t.completedAt = t.completed ? new Date().toISOString() : null;
      notify();
      return clone(t);
    }

    function deleteTask(actorId, taskId) {
      const t = requireTask(actorId, taskId);
      if (t.createdBy !== actorId && !canManage(actorId, t.projectId)) {
        throw new PermissionError('Only the task creator, project manager, or an admin can delete this task');
      }
      state.tasks = state.tasks.filter((x) => x.id !== taskId);
      notify();
    }

    return {
      get state() { return clone(state); },
      listUsers, getUser, isAdmin, roleIn, canView, canManage,
      listProjects, getProject, createProject, updateProject, deleteProject,
      addMember, removeMember, setManager,
      listTasks, getTask, createTask, updateTask, toggleTask, deleteTask,
    };
  }

  global.TaskStore = { createStore, seedData, isoDate, PermissionError, ValidationError, NotFoundError };
})(typeof window !== 'undefined' ? window : globalThis);
