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
  async function loadState() {
    const tables = ['profiles', 'projects', 'project_members', 'sections', 'tasks', 'filters'];
    const results = await Promise.all(tables.map((t) => sb.from(t).select('*').limit(10000)));
    const [profiles, projects, members, sections, tasks, filters] = results.map(check);
    return {
      version: 2,
      users: profiles
        .map((p) => ({ id: p.id, name: p.name, email: p.email, role: p.role }))
        .sort((x, y) => x.name.localeCompare(y.name)),
      projects: projects
        .map((p) => Object.assign(fromRow('projects', p), {
          memberIds: members.filter((m) => m.project_id === p.id && m.user_id !== p.manager_id).map((m) => m.user_id),
        }))
        .sort((x, y) => x.createdAt.localeCompare(y.createdAt)),
      sections: sections.map((s) => fromRow('sections', s)).sort((x, y) => x.createdAt.localeCompare(y.createdAt)),
      filters: filters.map((f) => fromRow('filters', f)).sort((x, y) => x.createdAt.localeCompare(y.createdAt)),
      tasks: tasks.map((t) => Object.assign(fromRow('tasks', t), { labels: t.labels || [] })),
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
    const pairs = (st) => new Set(st.projects.flatMap((p) => p.memberIds.map((u) => p.id + '|' + u)));
    const before = pairs(prev);
    const after = pairs(next);
    const liveProjects = new Set(next.projects.map((p) => p.id));
    const addedMembers = [...after].filter((x) => !before.has(x)).map((x) => x.split('|'));
    const removedMembers = [...before].filter((x) => !after.has(x)).map((x) => x.split('|')).filter(([p]) => liveProjects.has(p));

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

    // Deletes: children before parents (subtasks and project contents also cascade in the database).
    const goneProjects = new Set(P.removed.map((p) => p.id));
    await remove('tasks', T.removed.filter((t) => !goneProjects.has(t.projectId)).map((t) => t.id));
    await remove('sections', S.removed.filter((s) => !goneProjects.has(s.projectId)).map((s) => s.id));
    await remove('filters', F.removed.map((f) => f.id));
    await remove('projects', P.removed.map((p) => p.id));
  }

  // ---- live updates ----------------------------------------------------
  let channel = null;
  function subscribe(onChange) {
    if (channel) sb.removeChannel(channel);
    channel = sb.channel('flexo-db')
      .on('postgres_changes', { event: '*', schema: 'public' }, () => onChange())
      .subscribe();
  }
  function unsubscribe() {
    if (channel) sb.removeChannel(channel);
    channel = null;
  }

  window.FlexoCloud = {
    cameFromPasswordReset, // true when opened from a "reset password" email
    linkError, // e.g. "Email link is invalid or has expired"
    getSession, signIn, sendSignInLink, sendPasswordReset, setPassword, signOut, onAuth, updateMyName,
    loadState, pushDiff, subscribe, unsubscribe,
  };
})();
