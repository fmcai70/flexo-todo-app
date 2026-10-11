/*
 * TaskStore — data model and permission rules for the task tracker.
 *
 * Every read/write method takes the acting user's id first and enforces:
 *   - admin            : can see and manage every project
 *   - project manager  : can see the project, edit it, manage members, delete any task or section
 *   - project member   : can see the project, add/edit/complete tasks, add sections, delete own tasks
 *   - everyone else    : cannot see the project or any of its tasks
 *
 * Personal tasks (projectId === null) live in the owner's private Inbox:
 * only the user who created them can see or change them, not even an admin.
 * Saved filters are private to the user who made them as well.
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

  // ---- dates (local calendar days as YYYY-MM-DD) ----------------------
  const pad = (n) => String(n).padStart(2, '0');
  const toISO = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  function parseISO(s) {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d, 12);
  }
  function isoDate(offsetDays, from) {
    const d = from ? parseISO(from) : new Date();
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() + offsetDays);
    return toISO(d);
  }
  const nowTime = (now) => pad(now.getHours()) + ':' + pad(now.getMinutes());

  // ---- recurring tasks -----------------------------------------------
  const RECURRENCE = {
    daily: 'Every day',
    weekdays: 'Every weekday (Mon–Fri)',
    weekly: 'Every week',
    biweekly: 'Every 2 weeks',
    monthly: 'Every month',
    yearly: 'Every year',
  };

  function addMonthsClamped(d, n) {
    const day = d.getDate();
    const r = new Date(d.getFullYear(), d.getMonth() + n, 1, 12);
    const last = new Date(r.getFullYear(), r.getMonth() + 1, 0).getDate();
    r.setDate(Math.min(day, last)); // Jan 31 + 1 month = Feb 28/29
    return r;
  }
  function advance(dateStr, rule) {
    const d = parseISO(dateStr);
    switch (rule) {
      case 'daily': d.setDate(d.getDate() + 1); break;
      case 'weekdays': do { d.setDate(d.getDate() + 1); } while (d.getDay() === 0 || d.getDay() === 6); break;
      case 'weekly': d.setDate(d.getDate() + 7); break;
      case 'biweekly': d.setDate(d.getDate() + 14); break;
      case 'monthly': return toISO(addMonthsClamped(d, 1));
      case 'yearly': return toISO(addMonthsClamped(d, 12));
      default: throw new ValidationError('Unknown repeat rule');
    }
    return toISO(d);
  }
  /** Next occurrence after completing: at least one step forward and never in the past. */
  function nextDueDate(dateStr, rule, today) {
    today = today || isoDate(0);
    let next = advance(dateStr, rule);
    while (next <= today) next = advance(next, rule);
    return next;
  }

  // ---- reminders -----------------------------------------------------
  const REMINDERS = { 0: 'At due time', 10: '10 minutes before', 30: '30 minutes before', 60: '1 hour before', 120: '2 hours before', 1440: '1 day before' };
  /** When a task's reminder fires (Date), or null. Date-only tasks count as due at 09:00. */
  function reminderAt(t) {
    if (t.reminder == null || !t.dueDate) return null;
    const [y, m, d] = t.dueDate.split('-').map(Number);
    const [hh, mm] = (t.dueTime || '09:00').split(':').map(Number);
    return new Date(y, m - 1, d, hh, mm - t.reminder);
  }

  // ---- labels ----------------------------------------------------------
  function normalizeLabels(value) {
    const list = Array.isArray(value) ? value : String(value || '').split(/[\s,]+/);
    const out = [];
    list.forEach((raw) => {
      const l = String(raw).trim().replace(/^@/, '').toLowerCase();
      if (!l) return;
      if (!/^[a-z0-9][a-z0-9_-]{0,29}$/.test(l)) throw new ValidationError('Invalid label "' + raw + '": use letters, numbers, - or _');
      if (!out.includes(l)) out.push(l);
    });
    return out;
  }

  // ---- filter queries (Todoist-like) ------------------------------------
  /*
   * Terms joined with & (and) and | (or); & binds tighter. Prefix ! to negate.
   *   p1..p4 · today · tomorrow · overdue · no date · next 7 days · recurring · subtask
   *   @label · #Project Name · #Inbox · assigned to: me | Name | nobody · search: text
   */
  function compileTerm(term, raw) {
    const t = term.toLowerCase();
    let m;
    if (/^p[1-4]$/.test(t)) { const p = Number(t[1]); return (x) => x.priority === p; }
    if (t === 'today') return (x, c) => x.dueDate === c.today;
    if (t === 'tomorrow') return (x, c) => x.dueDate === isoDate(1, c.today);
    if (t === 'overdue') return (x, c) => !!x.dueDate && (x.dueDate < c.today || (x.dueDate === c.today && !!x.dueTime && x.dueTime < c.time));
    if (t === 'no date') return (x) => !x.dueDate;
    if (t === 'recurring') return (x) => !!x.recurrence;
    if (t === 'subtask') return (x) => !!x.parentId;
    if ((m = t.match(/^next (\d{1,3}) days?$/))) {
      const n = Number(m[1]);
      return (x, c) => !!x.dueDate && x.dueDate >= c.today && x.dueDate <= isoDate(n, c.today);
    }
    if (t.startsWith('@') && t.length > 1) { const l = t.slice(1); return (x) => x.labels.includes(l); }
    if (t.startsWith('#') && t.length > 1) {
      const name = t.slice(1).trim();
      return (x, c) => (name === 'inbox' ? x.projectId === null : x.projectId !== null && c.projectName(x.projectId) === name);
    }
    if ((m = t.match(/^assigned to:?\s*(.+)$/))) {
      const who = m[1].trim();
      return (x, c) => {
        if (who === 'me') return x.assigneeId === c.actorId;
        if (who === 'nobody' || who === 'none') return x.projectId !== null && !x.assigneeId;
        const name = x.assigneeId ? c.userName(x.assigneeId) : '';
        return !!name && (name === who || name.split(' ')[0] === who);
      };
    }
    if ((m = t.match(/^search:\s*(.+)$/))) {
      const s = m[1].trim();
      return (x) => (x.title + ' ' + x.description).toLowerCase().includes(s);
    }
    throw new ValidationError('Unknown filter term "' + raw + '"');
  }
  function parseQuery(query) {
    const q = String(query || '').trim();
    if (!q) throw new ValidationError('Filter query is empty');
    return q.split('|').map((group) => group.split('&').map((raw) => {
      let term = raw.trim();
      let neg = false;
      if (term.startsWith('!')) { neg = true; term = term.slice(1).trim(); }
      if (!term) throw new ValidationError('Filter has an empty term near "' + q + '"');
      return { neg, test: compileTerm(term, raw.trim()) };
    }));
  }

  const clone = (o) => JSON.parse(JSON.stringify(o));

  // Five demo users covering every access level.
  function seedData() {
    const now = new Date().toISOString();
    const task = (id, projectId, title, createdBy, assigneeId, due, priority, extra) =>
      Object.assign({
        id, projectId, parentId: null, sectionId: null, title, description: '', createdBy, assigneeId,
        dueDate: due === null ? null : isoDate(due), dueTime: null, recurrence: null, reminder: null, labels: [],
        priority, completed: false, completedAt: null, lastCompletedAt: null, createdAt: now,
      }, extra);

    return {
      version: 2,
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
      sections: [
        { id: 's1', projectId: 'p1', name: 'Design', createdAt: now },
        { id: 's2', projectId: 'p1', name: 'Build', createdAt: now },
        { id: 's3', projectId: 'p2', name: 'Development', createdAt: now },
        { id: 's4', projectId: 'p2', name: 'Release', createdAt: now },
      ],
      filters: [
        { id: 'f1', ownerId: 'u1', name: 'Urgent work', query: '@urgent | p1', createdAt: now },
        { id: 'f2', ownerId: 'u2', name: 'My week', query: 'assigned to: me & next 7 days', createdAt: now },
      ],
      tasks: [
        task('t1', 'p1', 'Draft new homepage wireframe', 'u2', 'u3', 0, 1, { sectionId: 's1', labels: ['design'], description: 'Hero, features, pricing sections.' }),
        task('t2', 'p1', 'Collect brand assets', 'u2', 'u2', 1, 3, { sectionId: 's1', labels: ['design'] }),
        task('t3', 'p1', 'Review copy with marketing', 'u3', 'u3', 4, 2, { sectionId: 's1' }),
        task('t4', 'p1', 'Set up staging site', 'u2', null, -1, 2, { sectionId: 's2', labels: ['urgent'] }),
        task('t5', 'p2', 'Finalize app store screenshots', 'u3', 'u4', 0, 2, { sectionId: 's4', labels: ['release'], dueTime: '15:00', reminder: 30 }),
        task('t6', 'p2', 'Fix login crash on Android', 'u3', 'u4', 2, 1, { sectionId: 's3', labels: ['bug', 'urgent'], description: 'Crash on Android 14 when biometric is enabled.' }),
        task('t7', 'p2', 'Write release notes', 'u4', 'u3', 6, 4, { sectionId: 's4', labels: ['release'] }),
        task('t8', 'p2', 'Beta test sign-off', 'u3', 'u3', null, 3, { sectionId: 's4', completed: true, completedAt: now }),
        task('t9', 'p3', 'Reconcile Q3 bank statements', 'u1', 'u1', 3, 1),
        task('t10', 'p3', 'Prepare auditor document list', 'u1', 'u1', 8, 3),
        // Personal Inbox tasks (private to their creator).
        task('t11', null, 'Renew car registration', 'u1', 'u1', 5, 2),
        task('t12', null, 'Book dentist appointment', 'u2', 'u2', 3, 3),
        task('t13', null, 'Read onboarding handbook', 'u5', 'u5', 0, 2),
        task('t14', null, 'Set up email signature', 'u5', 'u5', null, 4),
        // Subtasks (inherit the parent's project and visibility).
        task('t15', 'p1', 'Hero section', 'u2', 'u3', null, 4, { parentId: 't1', completed: true, completedAt: now }),
        task('t16', 'p1', 'Features section', 'u2', 'u3', null, 4, { parentId: 't1' }),
        task('t17', 'p1', 'Pricing section', 'u3', 'u3', null, 4, { parentId: 't1' }),
        task('t18', 'p2', 'Reproduce on Pixel 8', 'u3', 'u4', 1, 2, { parentId: 't6' }),
        task('t19', null, 'Get emission test', 'u1', 'u1', 3, 3, { parentId: 't11' }),
        // Recurring tasks.
        task('t20', 'p3', 'Weekly cash position report', 'u1', 'u1', 1, 2, { recurrence: 'weekly', dueTime: '10:00', reminder: 60, labels: ['report'] }),
        task('t21', null, 'Pay electricity bill', 'u1', 'u1', 6, 2, { recurrence: 'monthly' }),
        task('t22', null, 'Plan tomorrow', 'u3', 'u3', 0, 3, { recurrence: 'weekdays', dueTime: '17:30', reminder: 10 }),
      ],
    };
  }

  // Older saved data may predate sections, filters, labels, etc.
  function normalize(state) {
    state.sections = state.sections || [];
    state.filters = state.filters || [];
    state.tasks.forEach((t) => {
      ['parentId', 'sectionId', 'dueTime', 'recurrence', 'reminder', 'lastCompletedAt'].forEach((k) => { if (t[k] === undefined) t[k] = null; });
      if (!Array.isArray(t.labels)) t.labels = [];
    });
    return state;
  }

  /** opts.newId: id generator (e.g. crypto.randomUUID for the shared database). */
  function createStore(initialState, onChange, opts = {}) {
    const state = normalize(initialState ? clone(initialState) : seedData());
    const notify = () => { if (onChange) onChange(clone(state)); };
    const newId = opts.newId ? () => opts.newId() : (prefix) => prefix + (state.nextId++);

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
      if (t.projectId === null) {
        if (t.createdBy !== actorId) throw new PermissionError('You do not have access to this task');
      } else {
        requireView(actorId, t.projectId);
      }
      return t;
    }
    function requireSection(actorId, sectionId) {
      const s = state.sections.find((x) => x.id === sectionId);
      if (!s) throw new PermissionError('You do not have access to this section');
      requireView(actorId, s.projectId);
      return s;
    }

    /** All tasks the actor may see: tasks of visible projects plus their own personal tasks. */
    function visibleTasks(actorId) {
      findUser(actorId);
      const visible = new Set(state.projects.filter((p) => canView(actorId, p.id)).map((p) => p.id));
      return state.tasks.filter((t) => (t.projectId === null ? t.createdBy === actorId : visible.has(t.projectId)));
    }

    const sortTasks = (tasks) => tasks.sort((a, b) =>
      Number(a.completed) - Number(b.completed) ||
      (a.dueDate || '9999').localeCompare(b.dueDate || '9999') ||
      (a.dueTime || '99:99').localeCompare(b.dueTime || '99:99') ||
      a.priority - b.priority);

    /**
     * Validates and normalizes task fields in place.
     * p: the project, or null for a personal task owned by ownerId. existing: the task being updated.
     */
    function validateTaskFields(p, fields, ownerId, existing) {
      if ('title' in fields) {
        if (typeof fields.title !== 'string' || !fields.title.trim()) throw new ValidationError('Task title is required');
        fields.title = fields.title.trim();
      }
      if ('description' in fields) fields.description = String(fields.description || '');
      if ('priority' in fields) {
        if (![1, 2, 3, 4].includes(Number(fields.priority))) throw new ValidationError('Priority must be 1-4');
        fields.priority = Number(fields.priority);
      }
      if ('dueDate' in fields) {
        if (fields.dueDate === '' || fields.dueDate == null) fields.dueDate = null;
        else if (!/^\d{4}-\d{2}-\d{2}$/.test(fields.dueDate)) throw new ValidationError('Due date must be YYYY-MM-DD');
      }
      if ('dueTime' in fields) {
        if (!fields.dueTime) fields.dueTime = null;
        else if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(fields.dueTime)) throw new ValidationError('Time must be HH:MM (24-hour)');
      }
      if ('recurrence' in fields) {
        if (!fields.recurrence) fields.recurrence = null;
        else if (!RECURRENCE[fields.recurrence]) throw new ValidationError('Unknown repeat rule');
      }
      if ('reminder' in fields) {
        if (fields.reminder === '' || fields.reminder == null) fields.reminder = null;
        else {
          fields.reminder = Number(fields.reminder);
          if (!(fields.reminder in REMINDERS)) throw new ValidationError('Unknown reminder option');
        }
      }
      if ('labels' in fields) fields.labels = normalizeLabels(fields.labels);
      if ('assigneeId' in fields) {
        if (!p) {
          // Personal tasks always belong to their owner.
          if (fields.assigneeId && fields.assigneeId !== ownerId) throw new ValidationError('Personal tasks cannot be assigned to other users');
          fields.assigneeId = ownerId;
        } else if (fields.assigneeId === '' || fields.assigneeId == null) fields.assigneeId = null;
        else if (!isMemberOf(fields.assigneeId, p)) throw new ValidationError('Assignee must be a member of the project');
      }
      if ('sectionId' in fields) {
        if (!fields.sectionId) fields.sectionId = null;
        else {
          if (!p) throw new ValidationError('Inbox tasks cannot be put in a section');
          if (existing && existing.parentId) throw new ValidationError('Subtasks stay in their parent\'s section');
          const s = state.sections.find((x) => x.id === fields.sectionId);
          if (!s || s.projectId !== p.id) throw new ValidationError('Section does not belong to this project');
        }
      }
      // Time, repeat and reminder only make sense with a due date.
      const final = Object.assign({}, existing || {}, fields);
      if (!final.dueDate) {
        const msg = { dueTime: 'Set a due date before a time', recurrence: 'Set a due date before choosing a repeat', reminder: 'Set a due date before adding a reminder' };
        Object.keys(msg).forEach((k) => {
          if (existing && k in fields && fields[k] != null) throw new ValidationError(msg[k]);
          if (!existing && fields[k] != null) throw new ValidationError(msg[k]);
          if (final[k] != null) fields[k] = null; // clearing the date clears these too
        });
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
      state.sections = state.sections.filter((s) => s.projectId !== projectId);
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

    // ---- sections ------------------------------------------------------
    function listSections(actorId, projectId) {
      requireView(actorId, projectId);
      return clone(state.sections.filter((s) => s.projectId === projectId));
    }

    /** Any project member can add or rename sections; deleting one is for the PM/admin. */
    function createSection(actorId, projectId, name) {
      requireView(actorId, projectId);
      if (!String(name || '').trim()) throw new ValidationError('Section name is required');
      const s = { id: newId('s'), projectId, name: String(name).trim(), createdAt: new Date().toISOString() };
      state.sections.push(s);
      notify();
      return clone(s);
    }

    function renameSection(actorId, sectionId, name) {
      const s = requireSection(actorId, sectionId);
      if (!String(name || '').trim()) throw new ValidationError('Section name is required');
      s.name = String(name).trim();
      notify();
      return clone(s);
    }

    /** Tasks in a deleted section are kept and move to "No section". */
    function deleteSection(actorId, sectionId) {
      const s = requireSection(actorId, sectionId);
      if (!canManage(actorId, s.projectId)) throw new PermissionError('Only the project manager or an admin can delete a section');
      state.sections = state.sections.filter((x) => x.id !== sectionId);
      state.tasks.forEach((t) => { if (t.sectionId === sectionId) t.sectionId = null; });
      notify();
    }

    // ---- tasks ---------------------------------------------------------
    /**
     * filter: { projectId?, view?: 'inbox' | 'today' | 'upcoming' | 'mine', label?, includeCompleted?, today? }
     * Without a projectId, results cover the actor's visible projects plus their personal tasks.
     */
    function listTasks(actorId, filter = {}) {
      findUser(actorId);
      const today = filter.today || isoDate(0);
      let tasks;
      if (filter.projectId) {
        requireView(actorId, filter.projectId);
        tasks = state.tasks.filter((t) => t.projectId === filter.projectId);
      } else if (filter.view === 'inbox') {
        tasks = state.tasks.filter((t) => t.projectId === null && t.createdBy === actorId);
      } else {
        tasks = visibleTasks(actorId);
      }
      if (filter.view === 'today') tasks = tasks.filter((t) => t.dueDate && t.dueDate <= today);
      if (filter.view === 'upcoming') tasks = tasks.filter((t) => t.dueDate && t.dueDate > today);
      if (filter.view === 'mine') tasks = tasks.filter((t) => t.assigneeId === actorId);
      if (filter.label) tasks = tasks.filter((t) => t.labels.includes(filter.label));
      if (!filter.includeCompleted) tasks = tasks.filter((t) => !t.completed);
      return sortTasks(clone(tasks));
    }

    function getTask(actorId, taskId) { return clone(requireTask(actorId, taskId)); }

    function buildTask(actorId, projectId, fields, parentId) {
      const p = projectId === null ? null : requireView(actorId, projectId);
      const defaults = { priority: 4, dueDate: null, dueTime: null, recurrence: null, reminder: null, labels: [], assigneeId: null, sectionId: null, description: '' };
      const f = validateTaskFields(p, Object.assign(defaults, fields, { title: fields.title }), actorId, null);
      return {
        id: newId('t'), projectId, parentId, sectionId: f.sectionId, title: f.title, description: f.description,
        createdBy: actorId, assigneeId: f.assigneeId, dueDate: f.dueDate, dueTime: f.dueTime,
        recurrence: f.recurrence, reminder: f.reminder, labels: f.labels, priority: f.priority,
        completed: false, completedAt: null, lastCompletedAt: null, createdAt: new Date().toISOString(),
      };
    }

    /** projectId null (or 'inbox') creates a personal task in the actor's Inbox. */
    function createTask(actorId, projectId, fields = {}) {
      findUser(actorId);
      if (projectId === 'inbox') projectId = null;
      const t = buildTask(actorId, projectId, fields, null);
      state.tasks.push(t);
      notify();
      return clone(t);
    }

    const childrenOf = (taskId) => state.tasks.filter((x) => x.parentId === taskId);

    /**
     * Adds a subtask under parentId. It lives in the parent's project (or the owner's Inbox)
     * and anyone who can see the parent can add one. Only one level deep, like a checklist.
     */
    function createSubtask(actorId, parentId, fields = {}) {
      const parent = requireTask(actorId, parentId);
      if (parent.parentId) throw new ValidationError('Subtasks cannot have their own subtasks');
      if (fields.sectionId) throw new ValidationError('Subtasks stay in their parent\'s section');
      const t = buildTask(actorId, parent.projectId, fields, parent.id);
      state.tasks.push(t);
      // Adding open work under a finished task reopens it.
      if (parent.completed) { parent.completed = false; parent.completedAt = null; }
      notify();
      return clone(t);
    }

    function listSubtasks(actorId, taskId) {
      requireTask(actorId, taskId);
      return clone(childrenOf(taskId)).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id, undefined, { numeric: true }));
    }

    function updateTask(actorId, taskId, patch = {}) {
      const t = requireTask(actorId, taskId);
      const p = t.projectId === null ? null : findProject(t.projectId);
      const allowed = {};
      ['title', 'description', 'dueDate', 'dueTime', 'recurrence', 'reminder', 'labels', 'priority', 'assigneeId', 'sectionId']
        .forEach((k) => { if (k in patch) allowed[k] = patch[k]; });
      validateTaskFields(p, allowed, t.createdBy, t);
      Object.assign(t, allowed);
      notify();
      return clone(t);
    }

    /**
     * Completes or reopens a task. A recurring task is never "done": completing it moves the
     * due date to the next occurrence and reopens its subtasks (result has rolledOver: true).
     */
    function toggleTask(actorId, taskId, opts = {}) {
      const t = requireTask(actorId, taskId);
      const stamp = new Date().toISOString();
      if (!t.completed && t.recurrence && t.dueDate) {
        t.dueDate = nextDueDate(t.dueDate, t.recurrence, opts.today);
        t.lastCompletedAt = stamp;
        childrenOf(t.id).forEach((c) => { c.completed = false; c.completedAt = null; });
        notify();
        return Object.assign(clone(t), { rolledOver: true });
      }
      t.completed = !t.completed;
      t.completedAt = t.completed ? stamp : null;
      if (t.completed) {
        // Completing a task completes its subtasks (as in Todoist).
        childrenOf(t.id).forEach((c) => { if (!c.completed) { c.completed = true; c.completedAt = stamp; } });
      } else if (t.parentId) {
        // Reopening a subtask reopens its parent.
        const parent = findTask(t.parentId);
        parent.completed = false;
        parent.completedAt = null;
      }
      notify();
      return clone(t);
    }

    function deleteTask(actorId, taskId) {
      const t = requireTask(actorId, taskId);
      if (t.createdBy !== actorId && (t.projectId === null || !canManage(actorId, t.projectId))) {
        throw new PermissionError('Only the task creator, project manager, or an admin can delete this task');
      }
      // Subtasks go with their parent.
      state.tasks = state.tasks.filter((x) => x.id !== taskId && x.parentId !== taskId);
      notify();
    }

    // ---- labels, search, filters ----------------------------------------
    /** Labels used on tasks the actor can see, with their open-task counts. */
    function listLabels(actorId) {
      const counts = {};
      visibleTasks(actorId).forEach((t) => t.labels.forEach((l) => {
        counts[l] = (counts[l] || 0) + (t.completed ? 0 : 1);
      }));
      return Object.keys(counts).sort().map((name) => ({ name, count: counts[name] }));
    }

    function searchTasks(actorId, text, opts = {}) {
      const q = String(text || '').trim().toLowerCase();
      if (!q) return [];
      const hits = visibleTasks(actorId).filter((t) =>
        (opts.includeCompleted || !t.completed) &&
        (t.title.toLowerCase().includes(q) || t.description.toLowerCase().includes(q) || t.labels.includes(q.replace(/^@/, ''))));
      return sortTasks(clone(hits));
    }

    /** Runs a filter query over the actor's visible, open tasks. opts.now (Date) is for tests. */
    function filterTasks(actorId, query, opts = {}) {
      const groups = parseQuery(query);
      const now = opts.now || new Date();
      const ctx = {
        actorId,
        today: opts.today || toISO(now),
        time: nowTime(now),
        projectName: (id) => findProject(id).name.toLowerCase(),
        userName: (id) => findUser(id).name.toLowerCase(),
      };
      const hits = visibleTasks(actorId).filter((t) => (opts.includeCompleted || !t.completed) &&
        groups.some((g) => g.every((term) => term.test(t, ctx) !== term.neg)));
      return sortTasks(clone(hits));
    }

    function findOwnFilter(actorId, filterId) {
      const f = state.filters.find((x) => x.id === filterId);
      if (!f || f.ownerId !== actorId) throw new PermissionError('You do not have access to this filter');
      return f;
    }
    function listFilters(actorId) {
      findUser(actorId);
      return clone(state.filters.filter((f) => f.ownerId === actorId));
    }
    function getFilter(actorId, filterId) { return clone(findOwnFilter(actorId, filterId)); }
    function createFilter(actorId, { name, query } = {}) {
      findUser(actorId);
      if (!String(name || '').trim()) throw new ValidationError('Filter name is required');
      parseQuery(query); // throws on invalid queries
      const f = { id: newId('f'), ownerId: actorId, name: String(name).trim(), query: String(query).trim(), createdAt: new Date().toISOString() };
      state.filters.push(f);
      notify();
      return clone(f);
    }
    function updateFilter(actorId, filterId, { name, query } = {}) {
      const f = findOwnFilter(actorId, filterId);
      if (name !== undefined) {
        if (!String(name).trim()) throw new ValidationError('Filter name is required');
        f.name = String(name).trim();
      }
      if (query !== undefined) { parseQuery(query); f.query = String(query).trim(); }
      notify();
      return clone(f);
    }
    function deleteFilter(actorId, filterId) {
      findOwnFilter(actorId, filterId);
      state.filters = state.filters.filter((x) => x.id !== filterId);
      notify();
    }

    // ---- reminders -----------------------------------------------------
    /** Open tasks assigned to the actor whose reminder time passed within the last 24 hours. */
    function dueReminders(actorId, now = new Date()) {
      const from = now.getTime() - 24 * 3600 * 1000;
      return clone(visibleTasks(actorId).filter((t) => {
        if (t.completed || t.assigneeId !== actorId) return false;
        const at = reminderAt(t);
        return at && at.getTime() <= now.getTime() && at.getTime() > from;
      }));
    }

    return {
      get state() { return clone(state); },
      listUsers, getUser, isAdmin, roleIn, canView, canManage,
      listProjects, getProject, createProject, updateProject, deleteProject,
      addMember, removeMember, setManager,
      listSections, createSection, renameSection, deleteSection,
      listTasks, getTask, createTask, createSubtask, listSubtasks, updateTask, toggleTask, deleteTask,
      listLabels, searchTasks, filterTasks,
      listFilters, getFilter, createFilter, updateFilter, deleteFilter,
      dueReminders,
    };
  }

  global.TaskStore = {
    createStore, seedData, isoDate, nextDueDate, reminderAt, normalizeLabels, parseQuery,
    RECURRENCE, REMINDERS, PermissionError, ValidationError, NotFoundError,
  };
})(typeof window !== 'undefined' ? window : globalThis);
