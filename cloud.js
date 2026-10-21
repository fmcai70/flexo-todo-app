/*
 * FlexoCloud — connects the app to the shared Supabase database.
 *
 * - Sign-in (email + password, or an emailed sign-in link)
 * - loadState(): everything the signed-in user is allowed to see, in the store's format
 * - pushDiff(prev, next): saves what changed after a store action
 * - subscribe(): live updates when anyone changes data
 *
 * The publishable key below is meant to be public. Data is protected by the
 * Row Level Security rules in supabase/schema.sql, not by hiding this key.
 */
(function () {
  'use strict';

  const SUPABASE_URL = 'https://wlqxdgjxgvnamgiojwge.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_8gUb_7V26fIWP1GyXt7NZQ_uPsR1IoC';

  if (!window.supabase || !window.supabase.createClient) return; // library failed to load (offline)

  // Read the link we arrived from before the Supabase client consumes and clears it.
  const startHash = new URLSearchParams(location.hash.replace(/^#/, ''));
  const cameFromPasswordReset = startHash.get('type') === 'recovery';
  const linkError = startHash.get('error_description');

  const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { flowType: 'implicit', detectSessionInUrl: true, persistSession: true, autoRefreshToken: true },
  });
  const appUrl = () => location.origin + location.pathname;

  // ---- column mapping: store (camelCase) ↔ database (snake_case) ----------
  const MAP = {
    projects: { id: 'id', name: 'name', color: 'color', managerId: 'manager_id', createdBy: 'created_by', createdAt: 'created_at' },
    sections: { id: 'id', projectId: 'project_id', name: 'name', createdAt: 'created_at' },
    filters: { id: 'id', ownerId: 'owner_id', name: 'name', query: 'query', createdAt: 'created_at' },
    comments: { id: 'id', taskId: 'task_id', authorId: 'author_id', body: 'body', createdAt: 'created_at', editedAt: 'edited_at' },
    tasks: {
      id: 'id', projectId: 'project_id', parentId: 'parent_id', sectionId: 'section_id', title: 'title',
      description: 'description', createdBy: 'created_by', assigneeId: 'assignee_id', dueDate: 'due_date',
      dueTime: 'due_time', recurrence: 'recurrence', reminder: 'reminder', labels: 'labels', priority: 'priority',
      completed: 'completed', completedAt: 'completed_at', lastCompletedAt: 'last_completed_at', createdAt: 'created_at',
    },
  };
  function toRow(table, obj, onlyKeys) {
    const row = {};
    Object.entries(MAP[table]).forEach(([k, col]) => {
      if (onlyKeys && !onlyKeys.includes(k)) return;
      row[col] = obj[k] === undefined ? null : obj[k];
    });
    return row;
  }
  function fromRow(table, row) {
    const obj = {};
    Object.entries(MAP[table]).forEach(([k, col]) => { obj[k] = row[col] === undefined ? null : row[col]; });
    return obj;
  }

  // Friendlier wording for database errors.
  function friendly(error) {
    const msg = (error && error.message) || String(error);
    if (/row-level security|permission denied/i.test(msg)) return 'You don\'t have permission to do that';
    if (/Failed to fetch|NetworkError|network/i.test(msg)) return 'No internet connection. Your change was not saved';
    if (/JWT|token.*expired/i.test(msg)) return 'Your session expired. Please sign in again';
    return msg;
  }
  function check({ error, data }) {
    if (error) throw new Error(friendly(error));
    return data;
  }

  // ---- auth ----------------------------------------------------------
  async function getSession() {
    const { data } = await sb.auth.getSession();
    return data.session;
  }
  async function signIn(email, password) {
    check(await sb.auth.signInWithPassword({ email: email.trim(), password }));
  }
  async function sendSignInLink(email) {
    // shouldCreateUser: false → only people the admin has added can get a link.
    check(await sb.auth.signInWithOtp({ email: email.trim(), options: { shouldCreateUser: false, emailRedirectTo: appUrl() } }));
  }
  async function sendPasswordReset(email) {
    check(await sb.auth.resetPasswordForEmail(email.trim(), { redirectTo: appUrl() }));
  }
  // Second sign-in step (authenticator code), required for every Flexo account: see mfa.js.
  // Resolves 'ok' once the session has passed it, or 'signed-out' if the person signed out there.
  function ensureMfa() {
    if (!window.FlexoMFA) throw new Error('Could not load the sign-in check. Reload the page');
    return window.FlexoMFA.ensure(sb, { appName: 'Flexo Todo', color: '#c63a2d' });
  }
  async function setPassword(password) {
    check(await sb.auth.updateUser({ password }));
  }
  async function signOut() {
    await sb.auth.signOut();
  }
  function onAuth(callback) {
    sb.auth.onAuthStateChange((event, session) => callback(event, session));
  }
  async function updateMyName(userId, name) {
    const data = check(await sb.from('profiles').update({ name: name.trim() }).eq('id', userId).select('id'));
    if (!data.length) throw new Error('You don\'t have permission to do that');
  }

  // ---- load ------------------------------------------------------------
  // False until schema.sql has been re-run with the comments table; the app then hides comments.
  let hasComments = false;
  // False until schema.sql has been re-run with per-app access; until then everyone can use Flexo Todo.
  let hasAppAccess = false;

  async function loadState() {
    const tables = ['profiles', 'projects', 'project_members', 'sections', 'tasks', 'filters'];
    const [results, commentResult, accessResult] = await Promise.all([
      Promise.all(tables.map((t) => sb.from(t).select('*').limit(10000))),
      sb.from('comments').select('*').limit(20000),
      sb.from('app_access').select('user_id, app').limit(20000),
    ]);
    const [profiles, projects, members, sections, tasks, filters] = results.map(check);
    hasComments = !commentResult.error;
    const comments = hasComments ? commentResult.data : [];
    hasAppAccess = !accessResult.error;
    const appsOf = (id) => (hasAppAccess ? accessResult.data.filter((r) => r.user_id === id).map((r) => r.app) : ['todo']);
    return {
      version: 2,
      users: profiles
        .map((p) => ({ id: p.id, name: p.name, email: p.email, role: p.role, apps: appsOf(p.id) }))
        .sort((x, y) => x.name.localeCompare(y.name)),
      projects: projects
        .map((p) => Object.assign(fromRow('projects', p), {
          memberIds: members.filter((m) => m.project_id === p.id && m.user_id !== p.manager_id).map((m) => m.user_id),
        }))
        .sort((x, y) => x.createdAt.localeCompare(y.createdAt)),
      sections: sections.map((s) => fromRow('sections', s)).sort((x, y) => x.createdAt.localeCompare(y.createdAt)),
      filters: filters.map((f) => fromRow('filters', f)).sort((x, y) => x.createdAt.localeCompare(y.createdAt)),
      tasks: tasks.map((t) => Object.assign(fromRow('tasks', t), { labels: t.labels || [] })),
      comments: comments.map((c) => fromRow('comments', c)),
    };
  }

  // ---- save ------------------------------------------------------------
  function diffById(prevList, nextList) {
    const prev = new Map(prevList.map((x) => [x.id, x]));
    const next = new Map(nextList.map((x) => [x.id, x]));
    const changedKeys = (a, b, table) => Object.keys(MAP[table]).filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
    return {
      added: nextList.filter((x) => !prev.has(x.id)),
      removed: prevList.filter((x) => !next.has(x.id)),
      changed: (table) => nextList
        .filter((x) => prev.has(x.id))
        .map((x) => ({ item: x, keys: changedKeys(prev.get(x.id), x, table) }))
        .filter((c) => c.keys.length),
    };
  }

  async function insert(table, rows) {
    if (rows.length) check(await sb.from(table).insert(rows));
  }
  async function update(table, id, row) {
    // .select() returns the updated rows; none means the rules blocked it.
    const data = check(await sb.from(table).update(row).eq('id', id).select('id'));
    if (!data.length) throw new Error('You don\'t have permission to do that, or it was deleted by someone else');
  }
  async function remove(table, ids) {
    if (ids.length) check(await sb.from(table).delete().in('id', ids));
  }

  /** Saves the difference between two store states, in an order the database rules accept. */
  async function pushDiff(prev, next) {
    const P = diffById(prev.projects, next.projects);
    const S = diffById(prev.sections, next.sections);
    const T = diffById(prev.tasks, next.tasks);
    const F = diffById(prev.filters, next.filters);
    const C = diffById(prev.comments || [], next.comments || []);
    const accessPairs = (st) => new Set(st.users.flatMap((u) => (u.apps || []).map((a) => u.id + '|' + a)));
    const accessBefore = accessPairs(prev);
    const accessAfter = accessPairs(next);
    const pairs = (st) => new Set(st.projects.flatMap((p) => p.memberIds.map((u) => p.id + '|' + u)));
    const before = pairs(prev);
    const after = pairs(next);
    const liveProjects = new Set(next.projects.map((p) => p.id));
    const addedMembers = [...after].filter((x) => !before.has(x)).map((x) => x.split('|'));
    const removedMembers = [...before].filter((x) => !after.has(x)).map((x) => x.split('|')).filter(([p]) => liveProjects.has(p));

    // App access first: adding a member needs them to have Flexo Todo access already.
    if (hasAppAccess) {
      await insert('app_access', [...accessAfter].filter((x) => !accessBefore.has(x))
        .map((x) => x.split('|')).map(([user_id, app]) => ({ user_id, app })));
      for (const [userId, app] of [...accessBefore].filter((x) => !accessAfter.has(x)).map((x) => x.split('|'))) {
        check(await sb.from('app_access').delete().eq('user_id', userId).eq('app', app));
      }
    }

    // Creates and updates: parents before children.
    await insert('projects', P.added.map((p) => toRow('projects', p)));
    for (const c of P.changed('projects')) await update('projects', c.item.id, toRow('projects', c.item, c.keys));
    await insert('project_members', addedMembers.map(([project_id, user_id]) => ({ project_id, user_id })));
    for (const [projectId, userId] of removedMembers) {
      check(await sb.from('project_members').delete().eq('project_id', projectId).eq('user_id', userId));
    }
    await insert('sections', S.added.map((s) => toRow('sections', s)));
    for (const c of S.changed('sections')) await update('sections', c.item.id, toRow('sections', c.item, c.keys));
    const newTasks = T.added.slice().sort((x, y) => Number(!!x.parentId) - Number(!!y.parentId));
    await insert('tasks', newTasks.map((t) => toRow('tasks', t)));
    for (const c of T.changed('tasks')) await update('tasks', c.item.id, toRow('tasks', c.item, c.keys));
    await insert('filters', F.added.map((f) => toRow('filters', f)));
    for (const c of F.changed('filters')) await update('filters', c.item.id, toRow('filters', c.item, c.keys));
    await insert('comments', C.added.map((c) => toRow('comments', c)));
    // Only the text changes; the database stamps edited_at itself.
    for (const c of C.changed('comments')) await update('comments', c.item.id, toRow('comments', c.item, ['body']));

    // Deletes: children before parents (subtasks, comments and project contents also cascade in the database).
    const goneProjects = new Set(P.removed.map((p) => p.id));
    const goneTasks = new Set(T.removed.map((t) => t.id));
    await remove('comments', C.removed.filter((c) => !goneTasks.has(c.taskId)).map((c) => c.id));
    await remove('tasks', T.removed.filter((t) => !goneProjects.has(t.projectId)).map((t) => t.id));
    await remove('sections', S.removed.filter((s) => !goneProjects.has(s.projectId)).map((s) => s.id));
    await remove('filters', F.removed.map((f) => f.id));
    await remove('projects', P.removed.map((p) => p.id));
  }

  // ---- notifications ---------------------------------------------------
  // Rows are created by the database (see schema.sql); people can only read and mark them.
  async function loadNotifications() {
    return check(await sb.from('notifications').select('*').order('created_at', { ascending: false }).limit(50));
  }
  async function markNotificationsRead(ids) {
    if (ids.length) check(await sb.from('notifications').update({ read_at: new Date().toISOString() }).in('id', ids));
  }
  async function getEmailPrefs(userId) {
    // email_on_comment only exists once schema.sql has been re-run with comments.
    const res = await sb.from('profiles').select('email, email_on_assign, email_on_complete, email_on_comment').eq('id', userId).single();
    if (!res.error) return res.data;
    return check(await sb.from('profiles').select('email, email_on_assign, email_on_complete').eq('id', userId).single());
  }
  async function setEmailPrefs(userId, prefs) {
    const data = check(await sb.from('profiles').update(prefs).eq('id', userId).select('id'));
    if (!data.length) throw new Error('You don\'t have permission to do that');
  }

  // ---- live updates ----------------------------------------------------
  let channel = null;
  function subscribe(onChange) {
    if (channel) sb.removeChannel(channel);
    // Only Flexo Todo's own tables: other Flexo apps share this database and shouldn't trigger reloads here.
    const tables = ['profiles', 'projects', 'project_members', 'sections', 'tasks', 'filters', 'notifications', 'comments', 'app_access'];
    channel = tables.reduce((ch, table) =>
      ch.on('postgres_changes', { event: '*', schema: 'public', table }, () => onChange()), sb.channel('flexo-db'));
    channel.subscribe();
  }
  function unsubscribe() {
    if (channel) sb.removeChannel(channel);
    channel = null;
  }

  window.FlexoCloud = {
    cameFromPasswordReset, // true when opened from a "reset password" email
    linkError, // e.g. "Email link is invalid or has expired"
    getSession, signIn, sendSignInLink, sendPasswordReset, setPassword, signOut, onAuth, updateMyName, ensureMfa,
    loadState, pushDiff, subscribe, unsubscribe,
    get hasComments() { return hasComments; },
    get hasAppAccess() { return hasAppAccess; },
    loadNotifications, markNotificationsRead, getEmailPrefs, setEmailPrefs,
  };
})();
