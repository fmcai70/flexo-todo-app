-- =====================================================================
-- Flexo Todo: 5-user permission test against the REAL database rules.
--
-- Run in Supabase → SQL Editor AFTER schema.sql.
-- It creates 5 temporary users (…@rls-test.local), acts as each one,
-- checks what they can see and do, then deletes everything it created.
--
--   ✔ Success: one row saying "All N permission checks passed".
--   ✘ Failure: an error listing every check that failed (nothing is kept).
--
--   Alice = admin · Bob = PM of Website · Carol = PM of Mobile, member of Website
--   Dave = member of Mobile · Eve = in no project
-- =====================================================================
do $$
declare
  a uuid := gen_random_uuid();  -- Alice (admin)
  b uuid := gen_random_uuid();  -- Bob
  c uuid := gen_random_uuid();  -- Carol
  d uuid := gen_random_uuid();  -- Dave
  e uuid := gen_random_uuid();  -- Eve
  f uuid := gen_random_uuid();  -- Frank: ActionRegister only, no Flexo Todo access
  web uuid := gen_random_uuid();
  mob uuid := gen_random_uuid();
  fin uuid := gen_random_uuid();
  s_mob uuid := gen_random_uuid();
  t_web uuid := gen_random_uuid();
  t_mob uuid := gen_random_uuid();
  t_eve uuid := gen_random_uuid();
  f_alice uuid := gen_random_uuid();
  cm uuid := gen_random_uuid();
  n int;
  txt text;
  failures text[] := '{}';
  checks int := 0;
begin
  -- ---- setup (as the database owner) -------------------------------
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, raw_user_meta_data, created_at, updated_at)
  values
    (a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'alice@rls-test.local', '', '{"name":"Alice Test"}', now(), now()),
    (b, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'bob@rls-test.local',   '', '{"name":"Bob Test"}',   now(), now()),
    (c, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'carol@rls-test.local', '', '{"name":"Carol Test"}', now(), now()),
    (d, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'dave@rls-test.local',  '', '{"name":"Dave Test"}',  now(), now()),
    (e, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'eve@rls-test.local',   '', '{"name":"Eve Test"}',   now(), now()),
    (f, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'frank@rls-test.local', '', '{"name":"Frank Test"}', now(), now());
  update public.profiles set role = 'admin' where id = a;
  -- Everyone but Frank uses Flexo Todo; Frank only uses ActionRegister.
  insert into public.app_access (user_id, app) values (b, 'todo'), (c, 'todo'), (d, 'todo'), (e, 'todo'), (f, 'actionregister');

  select count(*) into n from public.profiles where id in (a, b, c, d, e, f);
  checks := checks + 1;
  if n <> 6 then failures := failures || format('profiles created for new accounts (got %s of 6)', n); end if;

  -- From here on every statement runs as a signed-in app user, with RLS applied.
  set local role authenticated;

  -- ---- Bob creates Website with Carol as member ---------------------
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  insert into public.projects (id, name, color, manager_id, created_by) values (web, 'RLS Website', '#db4035', b, b);
  insert into public.project_members (project_id, user_id) values (web, c);
  insert into public.tasks (id, project_id, title, created_by, assignee_id) values (t_web, web, 'Homepage wireframe', b, c);

  -- ---- Carol creates Mobile with Dave as member ----------------------
  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  insert into public.projects (id, name, color, manager_id, created_by) values (mob, 'RLS Mobile', '#4073ff', c, c);
  insert into public.project_members (project_id, user_id) values (mob, d);
  insert into public.sections (id, project_id, name) values (s_mob, mob, 'Release');
  insert into public.tasks (id, project_id, section_id, title, created_by, assignee_id) values (t_mob, mob, s_mob, 'Fix login crash', c, d);

  -- ---- Alice (admin) creates an admin-only project and a filter ------
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  insert into public.projects (id, name, manager_id, created_by) values (fin, 'RLS Finance', a, a);
  insert into public.filters (id, owner_id, name, query) values (f_alice, a, 'Urgent', 'p1');

  -- ---- Eve adds a personal task --------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', e, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  insert into public.tasks (id, project_id, title, created_by, assignee_id) values (t_eve, null, 'Buy safety shoes', e, e);

  -- ---- 1. Project visibility -----------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  select count(*) into n from public.projects where id in (web, mob, fin);
  checks := checks + 1; if n <> 3 then failures := failures || format('Alice (admin) should see 3 projects, saw %s', n); end if;

  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  select count(*) into n from public.projects where id in (web, mob, fin);
  checks := checks + 1; if n <> 1 then failures := failures || format('Bob should see 1 project, saw %s', n); end if;
  select count(*) into n from public.tasks where id = t_mob;
  checks := checks + 1; if n <> 0 then failures := failures || 'Bob could see a Mobile task'::text; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  select count(*) into n from public.projects where id in (web, mob, fin);
  checks := checks + 1; if n <> 2 then failures := failures || format('Carol should see 2 projects, saw %s', n); end if;

  perform set_config('request.jwt.claims', json_build_object('sub', d, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  select count(*) into n from public.projects where id in (web, mob, fin);
  checks := checks + 1; if n <> 1 then failures := failures || format('Dave should see 1 project, saw %s', n); end if;
  select count(*) into n from public.tasks where id in (t_web, t_mob);
  checks := checks + 1; if n <> 1 then failures := failures || format('Dave should see 1 of the 2 tasks, saw %s', n); end if;

  perform set_config('request.jwt.claims', json_build_object('sub', e, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  select count(*) into n from public.projects where id in (web, mob, fin);
  checks := checks + 1; if n <> 0 then failures := failures || format('Eve should see 0 projects, saw %s', n); end if;
  select count(*) into n from public.sections where id = s_mob;
  checks := checks + 1; if n <> 0 then failures := failures || 'Eve could see a Mobile section'::text; end if;

  -- ---- 2. Private things stay private ---------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  select count(*) into n from public.tasks where id = t_eve;
  checks := checks + 1; if n <> 0 then failures := failures || 'Admin could see Eve''s personal task'::text; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', e, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  select count(*) into n from public.tasks where id = t_eve;
  checks := checks + 1; if n <> 1 then failures := failures || 'Eve could not see her own personal task'::text; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  select count(*) into n from public.filters where id = f_alice;
  checks := checks + 1; if n <> 0 then failures := failures || 'Bob could see Alice''s saved filter'::text; end if;

  -- ---- 3. Things users must NOT be able to do --------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', e, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  checks := checks + 1;
  begin
    insert into public.tasks (project_id, title, created_by) values (web, 'Sneaky task', e);
    failures := failures || 'Eve (non-member) could add a task to Website'::text;
  exception when others then null;
  end;
  checks := checks + 1;
  begin
    insert into public.tasks (project_id, parent_id, title, created_by) values (web, t_web, 'Sneaky subtask', e);
    failures := failures || 'Eve could add a subtask to a Website task'::text;
  exception when others then null;
  end;

  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  checks := checks + 1;
  begin
    insert into public.project_members (project_id, user_id) values (web, d);
    failures := failures || 'Carol (member, not PM) could add a member to Website'::text;
  exception when others then null;
  end;
  checks := checks + 1;
  begin
    insert into public.tasks (project_id, parent_id, title, created_by) values (mob, t_web, 'Cross-project subtask', c);
    failures := failures || 'A subtask could be put under a task in another project'::text;
  exception when others then null;
  end;

  perform set_config('request.jwt.claims', json_build_object('sub', d, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  update public.projects set name = 'Hacked' where id = mob;
  get diagnostics n = row_count;
  checks := checks + 1; if n <> 0 then failures := failures || 'Dave (member) could rename the project'::text; end if;
  delete from public.sections where id = s_mob;
  get diagnostics n = row_count;
  checks := checks + 1; if n <> 0 then failures := failures || 'Dave (member) could delete a section'::text; end if;
  delete from public.tasks where id = t_mob;
  get diagnostics n = row_count;
  checks := checks + 1; if n <> 0 then failures := failures || 'Dave could delete a task created by Carol'::text; end if;
  update public.profiles set role = 'admin' where id = d;
  select role into txt from public.profiles where id = d;
  checks := checks + 1; if txt <> 'user' then failures := failures || 'Dave could make himself admin'::text; end if;
  checks := checks + 1;
  begin
    insert into public.projects (id, name, manager_id, created_by) values (gen_random_uuid(), 'Not mine', c, d);
    failures := failures || 'Dave (non-admin) could create a project with someone else as PM'::text;
  exception when others then null;
  end;

  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  checks := checks + 1;
  begin
    update public.projects set manager_id = c where id = web;
    failures := failures || 'Bob (PM, not admin) could change the project manager'::text;
  exception when others then null;
  end;
  checks := checks + 1;
  begin
    update public.tasks set assignee_id = d where id = t_web;
    failures := failures || 'A task could be assigned to a non-member'::text;
  exception when others then null;
  end;
  update public.tasks set title = 'x' where id = t_mob;
  get diagnostics n = row_count;
  checks := checks + 1; if n <> 0 then failures := failures || 'Bob could edit a Mobile task'::text; end if;

  -- ---- 4. Things users CAN do -----------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', d, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  update public.tasks set completed = true, completed_at = now() where id = t_mob;
  get diagnostics n = row_count;
  checks := checks + 1; if n <> 1 then failures := failures || 'Dave (member) could not complete a Mobile task'::text; end if;
  insert into public.sections (project_id, name) values (mob, 'QA');
  checks := checks + 1;

  -- ---- 5. Notifications ------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  select count(*) into n from public.notifications where task_id = t_web and type = 'assigned';
  checks := checks + 1; if n <> 1 then failures := failures || format('Carol should have 1 "assigned" notification from Bob, has %s', n); end if;
  select count(*) into n from public.notifications where task_id = t_mob and type = 'completed';
  checks := checks + 1; if n <> 1 then failures := failures || format('Carol should be notified that Dave completed her task, has %s', n); end if;
  update public.notifications set type = 'uncompleted', task_title = 'Fake', read_at = now() where task_id = t_web;
  select type || '|' || task_title || '|' || (read_at is not null)::text into txt from public.notifications where task_id = t_web and user_id = c;
  checks := checks + 1; if txt <> 'assigned|Homepage wireframe|true' then failures := failures || format('Notification rewrite should only change read status, got %s', txt); end if;
  checks := checks + 1;
  begin
    insert into public.notifications (user_id, type, task_title) values (d, 'assigned', 'Fake notification');
    failures := failures || 'Carol could create a fake notification for Dave'::text;
  exception when others then null;
  end;
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  select count(*) into n from public.notifications where user_id = c;
  checks := checks + 1; if n <> 0 then failures := failures || 'Bob could read Carol''s notifications'::text; end if;
  select count(*) into n from public.notifications where user_id = b;
  checks := checks + 1; if n <> 0 then failures := failures || 'Bob was notified about his own actions'::text; end if;

  -- ---- 6. Comments -----------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  insert into public.comments (id, task_id, author_id, body) values (cm, t_web, c, 'Draft is ready');
  checks := checks + 1;
  begin
    insert into public.comments (task_id, author_id, body) values (t_web, b, 'Pretending to be Bob');
    failures := failures || 'Carol could post a comment as Bob'::text;
  exception when others then null;
  end;
  update public.comments set body = 'Draft v2 is ready', task_id = t_mob where id = cm;
  select task_id::text || '|' || body || '|' || (edited_at is not null)::text into txt from public.comments where id = cm;
  checks := checks + 1; if txt <> t_web::text || '|Draft v2 is ready|true' then failures := failures || format('Comment edit should change only the text and mark it edited, got %s', txt); end if;

  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  select count(*) into n from public.comments where task_id = t_web;
  checks := checks + 1; if n <> 1 then failures := failures || 'Bob (PM) could not read Carol''s comment'::text; end if;
  select count(*) into n from public.notifications where user_id = b and type = 'commented' and comment_id = cm;
  checks := checks + 1; if n <> 1 then failures := failures || format('Bob should get 1 "commented" notification, has %s', n); end if;
  update public.comments set body = 'Edited by Bob' where id = cm;
  get diagnostics n = row_count;
  checks := checks + 1; if n <> 0 then failures := failures || 'Bob could edit Carol''s comment'::text; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', d, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  select count(*) into n from public.comments where id = cm;
  checks := checks + 1; if n <> 0 then failures := failures || 'Dave (non-member) could read a Website comment'::text; end if;
  checks := checks + 1;
  begin
    insert into public.comments (task_id, author_id, body) values (t_web, d, 'Sneaky comment');
    failures := failures || 'Dave (non-member) could comment on a Website task'::text;
  exception when others then null;
  end;

  perform set_config('request.jwt.claims', json_build_object('sub', e, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  insert into public.comments (task_id, author_id, body) values (t_eve, e, 'Size 42');
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  select count(*) into n from public.comments where task_id = t_eve;
  checks := checks + 1; if n <> 0 then failures := failures || 'Admin could read a comment on Eve''s personal task'::text; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  delete from public.comments where id = cm;
  get diagnostics n = row_count;
  checks := checks + 1; if n <> 1 then failures := failures || 'Bob (PM) could not delete a comment in his project'::text; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  insert into public.project_members (project_id, user_id) values (web, e);
  perform set_config('request.jwt.claims', json_build_object('sub', e, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  select count(*) into n from public.tasks where id = t_web;
  checks := checks + 1; if n <> 1 then failures := failures || 'Eve could not see Website after Bob added her'::text; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  delete from public.project_members where project_id = web and user_id = c;
  select assignee_id::text into txt from public.tasks where id = t_web;
  checks := checks + 1; if txt is not null then failures := failures || 'Removed member''s task was not unassigned'::text; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  select count(*) into n from public.projects where id = web;
  checks := checks + 1; if n <> 0 then failures := failures || 'Carol could still see Website after being removed'::text; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  update public.projects set name = 'RLS Mobile (renamed by admin)' where id = mob;
  get diagnostics n = row_count;
  checks := checks + 1; if n <> 1 then failures := failures || 'Admin could not rename a project she is not in'::text; end if;
  update public.projects set manager_id = e where id = web;
  get diagnostics n = row_count;
  checks := checks + 1; if n <> 1 then failures := failures || 'Admin could not change a project manager'::text; end if;

  -- ---- 7. Per-app access ---------------------------------------------------
  -- Frank has an account (ActionRegister) but no Flexo Todo access.
  perform set_config('request.jwt.claims', json_build_object('sub', f, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  checks := checks + 1;
  begin
    insert into public.projects (id, name, manager_id, created_by) values (gen_random_uuid(), 'Frank project', f, f);
    failures := failures || 'Frank (no Todo access) could create a project'::text;
  exception when others then null;
  end;
  checks := checks + 1;
  begin
    insert into public.tasks (project_id, title, created_by) values (null, 'Frank inbox task', f);
    failures := failures || 'Frank (no Todo access) could add an Inbox task'::text;
  exception when others then null;
  end;
  checks := checks + 1;
  begin
    insert into public.filters (owner_id, name, query) values (f, 'x', 'p1');
    failures := failures || 'Frank (no Todo access) could save a filter'::text;
  exception when others then null;
  end;
  checks := checks + 1;
  begin
    insert into public.app_access (user_id, app) values (f, 'todo');
    failures := failures || 'Frank (not admin) could give himself Todo access'::text;
  exception when others then null;
  end;
  select count(*) into n from public.app_access where user_id = b;
  checks := checks + 1; if n <> 1 then failures := failures || 'Frank could not see who uses which app (needed for people lists)'::text; end if;

  -- Carol (PM of Mobile) can't add Frank to her project; admin gives Frank access, then she can.
  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  checks := checks + 1;
  begin
    insert into public.project_members (project_id, user_id) values (mob, f);
    failures := failures || 'A person without Todo access could be added to a project'::text;
  exception when others then null;
  end;
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  insert into public.app_access (user_id, app) values (f, 'todo');
  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  insert into public.project_members (project_id, user_id) values (mob, f);
  perform set_config('request.jwt.claims', json_build_object('sub', f, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  select count(*) into n from public.projects where id = mob;
  checks := checks + 1; if n <> 1 then failures := failures || 'Frank could not see Mobile after getting access and being added'::text; end if;

  -- Admin removes Dave's Todo access: he keeps his membership row but sees nothing.
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  delete from public.app_access where user_id = d and app = 'todo';
  get diagnostics n = row_count;
  checks := checks + 1; if n <> 1 then failures := failures || 'Admin could not remove Todo access'::text; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', d, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  select count(*) into n from public.projects where id = mob;
  checks := checks + 1; if n <> 0 then failures := failures || 'Dave still saw Mobile after his Todo access was removed'::text; end if;
  select count(*) into n from public.tasks where id = t_mob;
  checks := checks + 1; if n <> 0 then failures := failures || 'Dave still saw Mobile tasks after his Todo access was removed'::text; end if;
  update public.tasks set title = 'x' where id = t_mob;
  get diagnostics n = row_count;
  checks := checks + 1; if n <> 0 then failures := failures || 'Dave could still edit a task after his Todo access was removed'::text; end if;

  -- Admins don't need an app_access row.
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  select count(*) into n from public.projects where id in (web, mob, fin);
  checks := checks + 1; if n <> 3 then failures := failures || format('Admin without an app_access row should still see 3 projects, saw %s', n); end if;

  -- ---- MFA: a password-only session (no authenticator code yet, aal1) gets nothing ----------
  -- Eve manages Website by now. With the code she sees it (so the "without" checks below mean something).
  perform set_config('request.jwt.claims', json_build_object('sub', e, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  select count(*) into n from public.projects where id = web;
  checks := checks + 1; if n <> 1 then failures := failures || 'Eve (with the code) should see Website'::text; end if;
  select count(*) into n from public.tasks where id = t_web;
  checks := checks + 1; if n <> 1 then failures := failures || 'Eve (with the code) should see the Website task'::text; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', e, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  select count(*) into n from public.projects where id = web;
  checks := checks + 1; if n <> 0 then failures := failures || 'Eve saw her project without the authenticator code'::text; end if;
  select count(*) into n from public.tasks where id = t_web;
  checks := checks + 1; if n <> 0 then failures := failures || 'Eve saw a task without the authenticator code'::text; end if;
  select count(*) into n from public.profiles;
  checks := checks + 1; if n <> 0 then failures := failures || 'Eve saw staff profiles without the authenticator code'::text; end if;
  select count(*) into n from public.app_access;
  checks := checks + 1; if n <> 0 then failures := failures || 'Eve saw app access without the authenticator code'::text; end if;
  update public.tasks set title = 'no code' where id = t_web;
  get diagnostics n = row_count;
  checks := checks + 1; if n <> 0 then failures := failures || 'Eve edited a task without the authenticator code'::text; end if;
  checks := checks + 1;
  begin
    insert into public.tasks (project_id, title, created_by) values (web, 'no code', e);
    failures := failures || 'Eve added a task without the authenticator code'::text;
  exception when others then null;
  end;
  checks := checks + 1; if public.has_app_access('todo') then failures := failures || 'has_app_access was true without the authenticator code'::text; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  checks := checks + 1; if public.is_admin() then failures := failures || 'Alice counted as admin without the authenticator code'::text; end if;
  -- With the code, checking someone else's access works as before (it never depends on their session).
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  checks := checks + 1; if not public.has_app_access('todo', b) then failures := failures || 'Alice (with code) could not see that Bob has Flexo Todo'::text; end if;
  checks := checks + 1; if not public.is_admin() then failures := failures || 'Alice with the authenticator code was not admin'::text; end if;

  -- ---- cleanup (back to the database owner) ----------------------------
  reset role;
  delete from public.tasks where project_id in (web, mob, fin) or created_by in (a, b, c, d, e, f);
  delete from public.projects where id in (web, mob, fin);
  delete from public.filters where owner_id in (a, b, c, d, e, f);
  delete from public.comments where author_id in (a, b, c, d, e, f);
  delete from public.notifications where user_id in (a, b, c, d, e, f);
  delete from public.app_access where user_id in (a, b, c, d, e, f);
  delete from auth.users where id in (a, b, c, d, e, f);

  if array_length(failures, 1) > 0 then
    raise exception E'% of % permission checks FAILED:\n - %',
      array_length(failures, 1), checks, array_to_string(failures, E'\n - ');
  end if;
  perform set_config('flexo.rls_checks', checks::text, false);
end $$;

select 'All ' || current_setting('flexo.rls_checks') || ' permission checks passed ✔' as result;
