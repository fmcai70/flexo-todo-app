-- =====================================================================
-- Flexo Todo: database schema and access rules for Supabase.
--
-- Run once in Supabase → SQL Editor → New query → paste → Run.
-- Safe to run again after changes (it only creates or replaces things).
--
-- The rules here mirror store.js and are enforced by the database
-- itself (Row Level Security), so they hold even if someone bypasses the app:
--   • admin            : sees and manages every project
--   • project manager  : manages their project, its members and sections
--   • project member   : sees the project, adds/edits/completes tasks
--   • non-member       : cannot see the project or any of its tasks
--   • personal (Inbox) tasks and saved filters are private to their owner
-- =====================================================================

-- ---------------------------------------------------------------------
-- Who is an admin. Accounts with these emails become admins automatically.
-- ---------------------------------------------------------------------
create or replace function public.admin_emails() returns text[]
language sql immutable as $$
  select array['rogerick.aban@flexo.com.ph']::text[];
$$;

-- "rogerick.aban@flexo.com.ph" → "Rogerick Aban"
create or replace function public.name_from_email(p_email text) returns text
language sql immutable as $$
  select initcap(regexp_replace(split_part(p_email, '@', 1), '[._-]+', ' ', 'g'));
$$;

-- ---------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text not null unique,
  name        text not null check (length(trim(name)) > 0),
  role        text not null default 'user' check (role in ('admin', 'user')),
  created_at  timestamptz not null default now()
);

create table if not exists public.projects (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(trim(name)) > 0),
  color       text not null default '#808080',
  manager_id  uuid not null references public.profiles (id),
  created_by  uuid not null default auth.uid() references public.profiles (id),
  created_at  timestamptz not null default now()
);

create table if not exists public.project_members (
  project_id  uuid not null references public.projects (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  primary key (project_id, user_id)
);

create table if not exists public.sections (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects (id) on delete cascade,
  name        text not null check (length(trim(name)) > 0),
  created_at  timestamptz not null default now()
);

create table if not exists public.tasks (
  id                 uuid primary key default gen_random_uuid(),
  project_id         uuid references public.projects (id) on delete cascade,   -- null = personal Inbox task
  parent_id          uuid references public.tasks (id) on delete cascade,      -- set = subtask
  section_id         uuid references public.sections (id) on delete set null,
  title              text not null check (length(trim(title)) > 0),
  description        text not null default '',
  created_by         uuid not null default auth.uid() references public.profiles (id),
  assignee_id        uuid references public.profiles (id) on delete set null,
  due_date           date,
  due_time           text check (due_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  recurrence         text check (recurrence in ('daily', 'weekdays', 'weekly', 'biweekly', 'monthly', 'yearly')),
  reminder           integer check (reminder in (0, 10, 30, 60, 120, 1440)),
  labels             text[] not null default '{}',
  priority           integer not null default 4 check (priority between 1 and 4),
  completed          boolean not null default false,
  completed_at       timestamptz,
  last_completed_at  timestamptz,
  created_at         timestamptz not null default now(),
  -- Time, repeat and reminder only make sense with a due date.
  constraint tasks_date_needed check (due_date is not null or (due_time is null and recurrence is null and reminder is null))
);

create table if not exists public.filters (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  name        text not null check (length(trim(name)) > 0),
  query       text not null check (length(trim(query)) > 0),
  created_at  timestamptz not null default now()
);

create index if not exists tasks_project_idx on public.tasks (project_id);
create index if not exists tasks_parent_idx on public.tasks (parent_id);
create index if not exists tasks_created_by_idx on public.tasks (created_by);
create index if not exists project_members_user_idx on public.project_members (user_id);
create index if not exists sections_project_idx on public.sections (project_id);
create index if not exists filters_owner_idx on public.filters (owner_id);

-- ---------------------------------------------------------------------
-- Permission helpers (security definer so policies don't recurse)
-- ---------------------------------------------------------------------
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

create or replace function public.is_user_in_project(p_project uuid, p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.projects where id = p_project and manager_id = p_user)
      or exists (select 1 from public.project_members where project_id = p_project and user_id = p_user);
$$;

create or replace function public.can_view_project(p_project uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin() or public.is_user_in_project(p_project, auth.uid());
$$;

create or replace function public.can_manage_project(p_project uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin()
      or exists (select 1 from public.projects where id = p_project and manager_id = auth.uid());
$$;

-- A task is visible if it's your own personal task, or belongs to a project you can see.
create or replace function public.can_view_task(p_project uuid, p_creator uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select case when p_project is null then p_creator = auth.uid()
              else public.can_view_project(p_project) end;
$$;

-- ---------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------

-- New login account → profile (name from email; admin if listed above).
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, name, role)
  values (
    new.id,
    lower(new.email),
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'name'), ''), public.name_from_email(new.email)),
    case when lower(new.email) = any (public.admin_emails()) then 'admin' else 'user' end
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Users can rename themselves, but only an admin can change roles or emails.
-- (auth.uid() is null for dashboard/SQL editor changes, which are allowed.)
create or replace function public.protect_profile() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_admin() then
    new.role := old.role;
    new.email := old.email;
  end if;
  new.id := old.id;
  return new;
end $$;

drop trigger if exists protect_profile on public.profiles;
create trigger protect_profile
  before update on public.profiles
  for each row execute function public.protect_profile();

-- Only an admin can change a project's manager; the creator never changes.
create or replace function public.protect_project() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_admin() and new.manager_id is distinct from old.manager_id then
    raise exception 'Only an admin can change the project manager';
  end if;
  new.created_by := old.created_by;
  return new;
end $$;

drop trigger if exists protect_project on public.projects;
create trigger protect_project
  before update on public.projects
  for each row execute function public.protect_project();

-- Task integrity: subtasks, sections and assignees must make sense.
create or replace function public.validate_task() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  par public.tasks;
  sec public.sections;
begin
  if tg_op = 'UPDATE' and (new.project_id is distinct from old.project_id
      or new.created_by is distinct from old.created_by
      or new.parent_id is distinct from old.parent_id) then
    raise exception 'A task''s project, creator and parent cannot be changed';
  end if;

  if new.parent_id is not null then
    select * into par from public.tasks where id = new.parent_id;
    if par.id is null then
      raise exception 'Parent task not found';
    elsif par.parent_id is not null then
      raise exception 'Subtasks cannot have their own subtasks';
    elsif par.project_id is distinct from new.project_id then
      raise exception 'A subtask must be in the same project as its parent';
    elsif new.project_id is null and par.created_by <> new.created_by then
      raise exception 'You do not have access to this task';
    elsif new.section_id is not null then
      raise exception 'Subtasks stay in their parent''s section';
    end if;
  end if;

  if new.section_id is not null then
    select * into sec from public.sections where id = new.section_id;
    if sec.id is null or new.project_id is null or sec.project_id <> new.project_id then
      raise exception 'Section does not belong to this project';
    end if;
  end if;

  if new.assignee_id is not null then
    if new.project_id is null then
      if new.assignee_id <> new.created_by then
        raise exception 'Personal tasks cannot be assigned to other users';
      end if;
    elsif not public.is_user_in_project(new.project_id, new.assignee_id) then
      raise exception 'Assignee must be a member of the project';
    end if;
  end if;

  return new;
end $$;

drop trigger if exists validate_task on public.tasks;
create trigger validate_task
  before insert or update on public.tasks
  for each row execute function public.validate_task();

-- Removing someone from a project unassigns their tasks there.
create or replace function public.unassign_removed_member() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.projects where id = old.project_id)
     and not public.is_user_in_project(old.project_id, old.user_id) then
    update public.tasks set assignee_id = null
     where project_id = old.project_id and assignee_id = old.user_id;
  end if;
  return old;
end $$;

drop trigger if exists unassign_removed_member on public.project_members;
create trigger unassign_removed_member
  after delete on public.project_members
  for each row execute function public.unassign_removed_member();

-- ---------------------------------------------------------------------
-- Row Level Security policies
-- ---------------------------------------------------------------------
alter table public.profiles        enable row level security;
alter table public.projects        enable row level security;
alter table public.project_members enable row level security;
alter table public.sections        enable row level security;
alter table public.tasks           enable row level security;
alter table public.filters         enable row level security;

-- profiles: everyone signed in can see staff names (to pick members/assignees)
drop policy if exists "profiles_select" on public.profiles;
create policy "profiles_select" on public.profiles
  for select to authenticated using (true);
drop policy if exists "profiles_update" on public.profiles;
create policy "profiles_update" on public.profiles
  for update to authenticated
  using (id = auth.uid() or public.is_admin())
  with check (id = auth.uid() or public.is_admin());

-- projects
drop policy if exists "projects_select" on public.projects;
create policy "projects_select" on public.projects
  for select to authenticated using (public.can_view_project(id));
drop policy if exists "projects_insert" on public.projects;
create policy "projects_insert" on public.projects
  for insert to authenticated
  with check (created_by = auth.uid() and (manager_id = auth.uid() or public.is_admin()));
drop policy if exists "projects_update" on public.projects;
create policy "projects_update" on public.projects
  for update to authenticated
  using (public.can_manage_project(id))
  with check (public.can_manage_project(id));
drop policy if exists "projects_delete" on public.projects;
create policy "projects_delete" on public.projects
  for delete to authenticated using (public.can_manage_project(id));

-- project members: visible to the team; managed by the PM/admin
drop policy if exists "members_select" on public.project_members;
create policy "members_select" on public.project_members
  for select to authenticated using (public.can_view_project(project_id));
drop policy if exists "members_insert" on public.project_members;
create policy "members_insert" on public.project_members
  for insert to authenticated with check (public.can_manage_project(project_id));
drop policy if exists "members_delete" on public.project_members;
create policy "members_delete" on public.project_members
  for delete to authenticated using (public.can_manage_project(project_id));

-- sections: members add/rename; PM/admin delete
drop policy if exists "sections_select" on public.sections;
create policy "sections_select" on public.sections
  for select to authenticated using (public.can_view_project(project_id));
drop policy if exists "sections_insert" on public.sections;
create policy "sections_insert" on public.sections
  for insert to authenticated with check (public.can_view_project(project_id));
drop policy if exists "sections_update" on public.sections;
create policy "sections_update" on public.sections
  for update to authenticated
  using (public.can_view_project(project_id))
  with check (public.can_view_project(project_id));
drop policy if exists "sections_delete" on public.sections;
create policy "sections_delete" on public.sections
  for delete to authenticated using (public.can_manage_project(project_id));

-- tasks
drop policy if exists "tasks_select" on public.tasks;
create policy "tasks_select" on public.tasks
  for select to authenticated using (public.can_view_task(project_id, created_by));
drop policy if exists "tasks_insert" on public.tasks;
create policy "tasks_insert" on public.tasks
  for insert to authenticated
  with check (created_by = auth.uid() and public.can_view_task(project_id, created_by));
drop policy if exists "tasks_update" on public.tasks;
create policy "tasks_update" on public.tasks
  for update to authenticated
  using (public.can_view_task(project_id, created_by))
  with check (public.can_view_task(project_id, created_by));
drop policy if exists "tasks_delete" on public.tasks;
create policy "tasks_delete" on public.tasks
  for delete to authenticated
  using (public.can_view_task(project_id, created_by)
         and (created_by = auth.uid() or (project_id is not null and public.can_manage_project(project_id))));

-- saved filters: private to their owner
drop policy if exists "filters_owner" on public.filters;
create policy "filters_owner" on public.filters
  for all to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

-- Only signed-in users get table access; anonymous visitors get nothing.
revoke all on all tables in schema public from anon;
grant select, insert, update, delete on all tables in schema public to authenticated;

-- ---------------------------------------------------------------------
-- Live updates (Realtime) for every table
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['profiles', 'projects', 'project_members', 'sections', 'tasks', 'filters'] loop
    if not exists (select 1 from pg_publication_tables
                    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Profiles for accounts that already exist, and admin roles
-- ---------------------------------------------------------------------
insert into public.profiles (id, email, name, role)
select u.id,
       lower(u.email),
       coalesce(nullif(trim(u.raw_user_meta_data ->> 'name'), ''), public.name_from_email(u.email)),
       case when lower(u.email) = any (public.admin_emails()) then 'admin' else 'user' end
  from auth.users u
 where u.email is not null
on conflict (id) do nothing;

update public.profiles set role = 'admin' where email = any (public.admin_emails());

select 'Flexo Todo database is ready ✔' as result;
