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
  web uuid := gen_random_uuid();
  mob uuid := gen_random_uuid();
  fin uuid := gen_random_uuid();
  s_mob uuid := gen_random_uuid();
  t_web uuid := gen_random_uuid();
  t_mob uuid := gen_random_uuid();
  t_eve uuid := gen_random_uuid();
  f_alice uuid := gen_random_uuid();
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
    (e, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'eve@rls-test.local',   '', '{"name":"Eve Test"}',   now(), now());
  update public.profiles set role = 'admin' where id = a;

  select count(*) into n from public.profiles where id in (a, b, c, d, e);
  checks := checks + 1;
  if n <> 5 then failures := failures || format('profiles created for new accounts (got %s of 5)', n); end if;

  -- From here on every statement runs as a signed-in app user, with RLS applied.
  set local role authenticated;

  -- ---- Bob creates Website with Carol as member ---------------------
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  insert into public.projects (id, name, color, manager_id, created_by) values (web, 'RLS Website', '#db4035', b, b);
  insert into public.project_members (project_id, user_id) values (web, c);
  insert into public.tasks (id, project_id, title, created_by, assignee_id) values (t_web, web, 'Homepage wireframe', b, c);

  -- ---- Carol creates Mobile with Dave as member ----------------------
  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  insert into public.projects (id, name, color, manager_id, created_by) values (mob, 'RLS Mobile', '#4073ff', c, c);
  insert into public.project_members (project_id, user_id) values (mob, d);
  insert into public.sections (id, project_id, name) values (s_mob, mob, 'Release');
  insert into public.tasks (id, project_id, section_id, title, created_by, assignee_id) values (t_mob, mob, s_mob, 'Fix login crash', c, d);

  -- ---- Alice (admin) creates an admin-only project and a filter ------
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  insert into public.projects (id, name, manager_id, created_by) values (fin, 'RLS Finance', a, a);
  insert into public.filters (id, owner_id, name, query) values (f_alice, a, 'Urgent', 'p1');

  -- ---- Eve adds a personal task --------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', e, 'role', 'authenticated')::text, true);
  insert into public.tasks (id, project_id, title, created_by, assignee_id) values (t_eve, null, 'Buy safety shoes', e, e);

  -- ---- 1. Project visibility -----------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  select count(*) into n from public.projects where id in (web, mob, fin);
  checks := checks + 1; if n <> 3 then failures := failures || format('Alice (admin) should see 3 projects, saw %s', n); end if;

  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  select count(*) into n from public.projects where id in (web, mob, fin);
  checks := checks + 1; if n <> 1 then failures := failures || format('Bob should see 1 project, saw %s', n); end if;
  select count(*) into n from public.tasks where id = t_mob;
  checks := checks + 1; if n <> 0 then failures := failures || 'Bob could see a Mobile task'; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  select count(*) into n from public.projects where id in (web, mob, fin);
  checks := checks + 1; if n <> 2 then failures := failures || format('Carol should see 2 projects, saw %s', n); end if;

  perform set_config('request.jwt.claims', json_build_object('sub', d, 'role', 'authenticated')::text, true);
  select count(*) into n from public.projects where id in (web, mob, fin);
  checks := checks + 1; if n <> 1 then failures := failures || format('Dave should see 1 project, saw %s', n); end if;
  select count(*) into n from public.tasks where id in (t_web, t_mob);
  checks := checks + 1; if n <> 1 then failures := failures || format('Dave should see 1 of the 2 tasks, saw %s', n); end if;

  perform set_config('request.jwt.claims', json_build_object('sub', e, 'role', 'authenticated')::text, true);
  select count(*) into n from public.projects where id in (web, mob, fin);
  checks := checks + 1; if n <> 0 then failures := failures || format('Eve should see 0 projects, saw %s', n); end if;
  select count(*) into n from public.sections where id = s_mob;
  checks := checks + 1; if n <> 0 then failures := failures || 'Eve could see a Mobile section'; end if;

  -- ---- 2. Private things stay private ---------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  select count(*) into n from public.tasks where id = t_eve;
  checks := checks + 1; if n <> 0 then failures := failures || 'Admin could see Eve''s personal task'; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', e, 'role', 'authenticated')::text, true);
  select count(*) into n from public.tasks where id = t_eve;
  checks := checks + 1; if n <> 1 then failures := failures || 'Eve could not see her own personal task'; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  select count(*) into n from public.filters where id = f_alice;
  checks := checks + 1; if n <> 0 then failures := failures || 'Bob could see Alice''s saved filter'; end if;

  -- ---- 3. Things users must NOT be able to do --------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', e, 'role', 'authenticated')::text, true);
  checks := checks + 1;
  begin
    insert into public.tasks (project_id, title, created_by) values (web, 'Sneaky task', e);
    failures := failures || 'Eve (non-member) could add a task to Website';
  exception when others then null;
  end;
  checks := checks + 1;
  begin
    insert into public.tasks (project_id, parent_id, title, created_by) values (web, t_web, 'Sneaky subtask', e);
    failures := failures || 'Eve could add a subtask to a Website task';
  exception when others then null;
  end;

  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  checks := checks + 1;
  begin
    insert into public.project_members (project_id, user_id) values (web, d);
    failures := failures || 'Carol (member, not PM) could add a member to Website';
  exception when others then null;
  end;
  checks := checks + 1;
  begin
    insert into public.tasks (project_id, parent_id, title, created_by) values (mob, t_web, 'Cross-project subtask', c);
    failures := failures || 'A subtask could be put under a task in another project';
  exception when others then null;
  end;

  perform set_config('request.jwt.claims', json_build_object('sub', d, 'role', 'authenticated')::text, true);
  update public.projects set name = 'Hacked' where id = mob;
  get diagnostics n = row_count;
  checks := checks + 1; if n <> 0 then failures := failures || 'Dave (member) could rename the project'; end if;
  delete from public.sections where id = s_mob;
  get diagnostics n = row_count;
  checks := checks + 1; if n <> 0 then failures := failures || 'Dave (member) could delete a section'; end if;
  delete from public.tasks where id = t_mob;
  get diagnostics n = row_count;
  checks := checks + 1; if n <> 0 then failures := failures || 'Dave could delete a task created by Carol'; end if;
  update public.profiles set role = 'admin' where id = d;
  select role into txt from public.profiles where id = d;
  checks := checks + 1; if txt <> 'user' then failures := failures || 'Dave could make himself admin'; end if;
  checks := checks + 1;
  begin
    insert into public.projects (id, name, manager_id, created_by) values (gen_random_uuid(), 'Not mine', c, d);
    failures := failures || 'Dave (non-admin) could create a project with someone else as PM';
  exception when others then null;
  end;

  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  checks := checks + 1;
  begin
    update public.projects set manager_id = c where id = web;
    failures := failures || 'Bob (PM, not admin) could change the project manager';
  exception when others then null;
  end;
  checks := checks + 1;
  begin
    update public.tasks set assignee_id = d where id = t_web;
    failures := failures || 'A task could be assigned to a non-member';
  exception when others then null;
  end;
  update public.tasks set title = 'x' where id = t_mob;
  get diagnostics n = row_count;
  checks := checks + 1; if n <> 0 then failures := failures || 'Bob could edit a Mobile task'; end if;

  -- ---- 4. Things users CAN do -----------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', d, 'role', 'authenticated')::text, true);
  update public.tasks set completed = true, completed_at = now() where id = t_mob;
  get diagnostics n = row_count;
  checks := checks + 1; if n <> 1 then failures := failures || 'Dave (member) could not complete a Mobile task'; end if;
  insert into public.sections (project_id, name) values (mob, 'QA');
  checks := checks + 1;

  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  insert into public.project_members (project_id, user_id) values (web, e);
  perform set_config('request.jwt.claims', json_build_object('sub', e, 'role', 'authenticated')::text, true);
  select count(*) into n from public.tasks where id = t_web;
  checks := checks + 1; if n <> 1 then failures := failures || 'Eve could not see Website after Bob added her'; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  delete from public.project_members where project_id = web and user_id = c;
  select assignee_id::text into txt from public.tasks where id = t_web;
  checks := checks + 1; if txt is not null then failures := failures || 'Removed member''s task was not unassigned'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  select count(*) into n from public.projects where id = web;
  checks := checks + 1; if n <> 0 then failures := failures || 'Carol could still see Website after being removed'; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  update public.projects set name = 'RLS Mobile (renamed by admin)' where id = mob;
  get diagnostics n = row_count;
  checks := checks + 1; if n <> 1 then failures := failures || 'Admin could not rename a project she is not in'; end if;
  update public.projects set manager_id = e where id = web;
  get diagnostics n = row_count;
  checks := checks + 1; if n <> 1 then failures := failures || 'Admin could not change a project manager'; end if;

  -- ---- cleanup (back to the database owner) ----------------------------
  reset role;
  delete from public.tasks where project_id in (web, mob, fin) or created_by in (a, b, c, d, e);
  delete from public.projects where id in (web, mob, fin);
  delete from public.filters where owner_id in (a, b, c, d, e);
  delete from auth.users where id in (a, b, c, d, e);

  if array_length(failures, 1) > 0 then
    raise exception E'% of % permission checks FAILED:\n - %',
      array_length(failures, 1), checks, array_to_string(failures, E'\n - ');
  end if;
  perform set_config('flexo.rls_checks', checks::text, false);
end $$;

select 'All ' || current_setting('flexo.rls_checks') || ' permission checks passed ✔' as result;
