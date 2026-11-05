-- ============================================================================
-- Мини-CRM для строительной компании
-- Схема БД с безопасностью: RLS-политики, проверка переходов статусов
-- на стороне базы, append-only история статусов.
--
-- Порядок выполнения важен:
--   1) типы  ->  2) все таблицы  ->  3) функции  ->  4) политики RLS
--      ->  5) RPC и триггеры
-- Postgres валидирует ссылки на таблицы/функции при создании политик
-- и при создании sql-функций, поэтому всё должно существовать заранее.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Типы
-- ----------------------------------------------------------------------------
create type public.user_role as enum ('manager', 'worker');

create type public.task_status as enum (
  'new',        -- Новая
  'in_progress',-- В работе
  'review',     -- На проверке
  'accepted',   -- Принята
  'rework'      -- На доработке
);

-- ----------------------------------------------------------------------------
-- 2. Таблицы
-- ----------------------------------------------------------------------------

-- Профили пользователей (создаются триггером при создании auth.users)
create table public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  email      text not null,
  full_name  text not null default '',
  role       public.user_role not null default 'worker',
  created_at timestamptz not null default now()
);

-- Объекты (стройки)
create table public.projects (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  address    text not null default '',
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now()
);

-- Задачи
create table public.tasks (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  description text not null default '',
  project_id  uuid not null references public.projects (id) on delete cascade,
  assignee_id uuid references public.profiles (id),
  status      public.task_status not null default 'new',
  author_id   uuid not null references public.profiles (id),
  created_at  timestamptz not null default now()
);

-- История смены статусов: append-only, запись идёт только из триггера
create table public.task_status_history (
  id          uuid primary key default gen_random_uuid(),
  task_id     uuid not null references public.tasks (id) on delete cascade,
  changed_by  uuid references public.profiles (id),
  from_status public.task_status not null,
  to_status   public.task_status not null,
  comment     text,
  created_at  timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- 3. Вспомогательные функции (SECURITY DEFINER — работают внутри RLS-проверок)
-- ----------------------------------------------------------------------------

-- Признак постановщика. Используется в политиках ниже.
create or replace function public.is_manager()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'manager'
  );
$$;

-- ----------------------------------------------------------------------------
-- 4. Включение RLS и политики доступа
-- ----------------------------------------------------------------------------

-- Профили ---------------------------------------------------------------
alter table public.profiles enable row level security;

-- Свои профиль видит сам пользователь (нужно для определения роли в UI)
create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = id);

-- Менеджер может видеть роли всех (нужно для назначения исполнителей)
create policy "profiles_select_manager" on public.profiles
  for select using (public.is_manager());

-- Любой аутентифицированный пользователь видит имена/почты коллег —
-- это нужно для отображения исполнителя и автора задач. Паролей и
-- служебных данных здесь нет, а доступ к самим задачам закрыт отдельно.
create policy "profiles_select_authenticated" on public.profiles
  for select to authenticated using (true);

-- Обновление профиля (в т.ч. смена роли) — только менеджер
create policy "profiles_update_manager" on public.profiles
  for update using (public.is_manager());

-- Объекты ---------------------------------------------------------------
alter table public.projects enable row level security;

create policy "projects_select_manager" on public.projects
  for select using (public.is_manager());

-- Исполнитель видит только объекты, в которых у него есть задачи.
-- ВАЖНО: явная квалификация projects.id — иначе unqualified id внутри
-- подзапроса разрешается как tasks.id и политика не срабатывает.
create policy "projects_select_worker_with_tasks" on public.projects
  for select using (
    exists (
      select 1 from public.tasks t
      where t.project_id = projects.id and t.assignee_id = auth.uid()
    )
  );

create policy "projects_insert_manager" on public.projects
  for insert with check (public.is_manager());

create policy "projects_update_manager" on public.projects
  for update using (public.is_manager());

create policy "projects_delete_manager" on public.projects
  for delete using (public.is_manager());

-- Задачи ----------------------------------------------------------------
alter table public.tasks enable row level security;

create policy "tasks_select_manager" on public.tasks
  for select using (public.is_manager());

-- Исполнитель видит только СВОИ задачи
create policy "tasks_select_assignee" on public.tasks
  for select using (assignee_id = auth.uid());

create policy "tasks_insert_manager" on public.tasks
  for insert with check (public.is_manager() and author_id = auth.uid());

-- Прямое изменение задач доступно только менеджеру (и только для обычных
-- полей — смену статуса блокирует триггер, см. ниже: только через RPC).
create policy "tasks_update_manager" on public.tasks
  for update using (public.is_manager());

create policy "tasks_delete_manager" on public.tasks
  for delete using (public.is_manager());

-- История статусов ------------------------------------------------------
alter table public.task_status_history enable row level security;

create policy "history_select_manager" on public.task_status_history
  for select using (public.is_manager());

-- Исполнитель видит историю только своих задач
create policy "history_select_assignee" on public.task_status_history
  for select using (
    exists (
      select 1 from public.tasks t
      where t.id = task_id and t.assignee_id = auth.uid()
    )
  );

-- Явно отзываем все прочие права на историю (защита от подделки).
-- Политик INSERT/UPDATE/DELETE нет ни для кого — любая попытка
-- изменить или удалить историю через API будет отклонена базой.
revoke all on public.task_status_history from anon, authenticated;
grant select on public.task_status_history to authenticated;

-- ----------------------------------------------------------------------------
-- 5. Смена статуса задачи: ЕДИНСТВЕННЫЙ разрешённый путь — RPC.
-- Проверяет допустимость перехода, роль и назначение. Прямые UPDATE статуса
-- через API блокируются триггером.
-- ----------------------------------------------------------------------------
create or replace function public.task_transition(
  p_task_id   uuid,
  p_to_status public.task_status,
  p_comment   text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task public.tasks%rowtype;
  v_is_manager boolean := public.is_manager();
begin
  if auth.uid() is null then
    raise exception 'Требуется аутентификация';
  end if;

  select * into v_task from public.tasks where id = p_task_id;
  if not found then
    raise exception 'Задача не найдена';
  end if;

  -- Исполнитель работает только со своей задачей
  if not v_is_manager and v_task.assignee_id is distinct from auth.uid() then
    raise exception 'Доступ запрещён: это не ваша задача';
  end if;

  -- Матрица разрешённых переходов
  if
    p_to_status = 'in_progress'
      and v_task.status in ('new', 'rework')
      and v_task.assignee_id = auth.uid()
  then
    null; -- Взять в работу / вернуться к работе
  elsif
    p_to_status = 'review'
      and v_task.status = 'in_progress'
      and v_task.assignee_id = auth.uid()
  then
    null; -- Отправить на проверку
  elsif
    p_to_status = 'accepted'
      and v_task.status = 'review'
      and v_is_manager
  then
    null; -- Принять
  elsif
    p_to_status = 'rework'
      and v_task.status = 'review'
      and v_is_manager
  then
    -- Комментарий обязателен
    if coalesce(trim(p_comment), '') = '' then
      raise exception 'Комментарий обязателен при возврате на доработку';
    end if;
  else
    raise exception 'Переход статуса % -> % запрещён', v_task.status, p_to_status;
  end if;

  -- Комментарий передаётся триггеру истории через session-переменную.
  -- Флаг in_transition разрешает легитимный UPDATE из этого RPC.
  perform set_config('app.task_comment', coalesce(p_comment, ''), true);
  perform set_config('app.in_transition', 'on', true);

  update public.tasks
  set status = p_to_status
  where id = p_task_id;
end;
$$;

grant execute on function public.task_transition(uuid, public.task_status, text) to authenticated;

-- ----------------------------------------------------------------------------
-- Триггер: блокирует ПРЯМОЕ изменение статуса через UPDATE-запросы в обход RPC.
-- ----------------------------------------------------------------------------
create or replace function public.block_direct_status_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status is distinct from old.status
     and current_setting('app.in_transition', true) is distinct from 'on'
  then
    raise exception 'Смена статуса разрешена только через RPC task_transition';
  end if;
  return new;
end;
$$;

create trigger trg_block_direct_status_update
  before update of status on public.tasks
  for each row execute function public.block_direct_status_update();

-- ----------------------------------------------------------------------------
-- Триггер: пишет запись в историю при каждой смене статуса. Вызывается и при
-- легитимном RPC-переходе. SECURITY DEFINER — запись возможна только изнутри,
-- никто снаружи не может вставить/изменить/удалить строку истории.
-- ----------------------------------------------------------------------------
create or replace function public.on_task_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status is distinct from old.status then
    insert into public.task_status_history
      (task_id, changed_by, from_status, to_status, comment)
    values
      (new.id, auth.uid(), old.status, new.status,
       nullif(current_setting('app.task_comment', true), ''));
  end if;
  return new;
end;
$$;

create trigger trg_task_status_history
  after update of status on public.tasks
  for each row execute function public.on_task_status_change();

-- ----------------------------------------------------------------------------
-- Профиль создаётся автоматически при создании пользователя в Supabase
-- (пользователей создаёт админ вручную, регистрация отключена).
-- Роль затем меняется вручную: update profiles set role='manager' ...
-- ----------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'full_name', ''));
  return new;
end;
$$;

create trigger trg_handle_new_user
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================================
-- Справка по переходам статусов (проверяются в task_transition):
--   new         -> in_progress  (исполнитель)
--   rework      -> in_progress  (исполнитель)
--   in_progress -> review       (исполнитель)
--   review      -> accepted     (постановщик)
--   review      -> rework       (постановщик, комментарий обязателен)
-- Все прочие переходы отклоняются базой.
-- ============================================================================
