
-- =============== PROFILES ===============
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique not null check (char_length(username) between 3 and 20 and username ~ '^[a-zA-Z0-9_]+$'),
  created_at timestamptz not null default now()
);
grant select on public.profiles to anon, authenticated;
grant insert, update on public.profiles to authenticated;
grant all on public.profiles to service_role;
alter table public.profiles enable row level security;
create policy "profiles are public" on public.profiles for select using (true);
create policy "own profile insert" on public.profiles for insert to authenticated with check (auth.uid() = id);
create policy "own profile update" on public.profiles for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);

-- Auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  base_name text;
  candidate text;
  n int := 0;
begin
  base_name := coalesce(
    nullif(regexp_replace(coalesce(new.raw_user_meta_data->>'username',''), '[^a-zA-Z0-9_]', '', 'g'), ''),
    nullif(regexp_replace(split_part(coalesce(new.email,''), '@', 1), '[^a-zA-Z0-9_]', '', 'g'), ''),
    'player'
  );
  if char_length(base_name) < 3 then base_name := base_name || '_' || substr(new.id::text, 1, 4); end if;
  if char_length(base_name) > 16 then base_name := substr(base_name, 1, 16); end if;
  candidate := base_name;
  while exists (select 1 from public.profiles where username = candidate) loop
    n := n + 1;
    candidate := substr(base_name, 1, greatest(3, 16 - char_length(n::text))) || n::text;
  end loop;
  insert into public.profiles(id, username) values (new.id, candidate);
  return new;
end $$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- =============== FRIENDSHIPS ===============
create table public.friendships (
  id uuid primary key default gen_random_uuid(),
  user_a uuid not null references auth.users(id) on delete cascade,
  user_b uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','accepted','declined')),
  requested_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint friendships_ordered check (user_a < user_b),
  unique (user_a, user_b)
);
grant select, insert, update, delete on public.friendships to authenticated;
grant all on public.friendships to service_role;
alter table public.friendships enable row level security;
create policy "read own friendships" on public.friendships for select to authenticated using (auth.uid() in (user_a, user_b));
create policy "update own friendships" on public.friendships for update to authenticated using (auth.uid() in (user_a, user_b));
create policy "delete own friendships" on public.friendships for delete to authenticated using (auth.uid() in (user_a, user_b));
-- Inserts happen only via server function (using service role) to canonicalize ordering and dedup.

-- =============== CHALLENGES ===============
create table public.challenges (
  id uuid primary key default gen_random_uuid(),
  from_id uuid not null references auth.users(id) on delete cascade,
  to_id uuid not null references auth.users(id) on delete cascade,
  tc_name text not null,
  initial_seconds int not null,
  increment_seconds int not null,
  color text not null check (color in ('w','b','r')),
  status text not null default 'pending' check (status in ('pending','accepted','declined','cancelled')),
  game_id uuid,
  created_at timestamptz not null default now(),
  check (from_id <> to_id)
);
grant select on public.challenges to authenticated;
grant all on public.challenges to service_role;
alter table public.challenges enable row level security;
create policy "read own challenges" on public.challenges for select to authenticated using (auth.uid() in (from_id, to_id));

-- =============== GAMES ===============
create table public.games (
  id uuid primary key default gen_random_uuid(),
  white_id uuid not null references auth.users(id) on delete cascade,
  black_id uuid not null references auth.users(id) on delete cascade,
  tc_name text not null,
  initial_seconds int not null,
  increment_seconds int not null,
  status text not null default 'setup' check (status in ('setup','playing','over')),
  turn text default 'w' check (turn in ('w','b')),
  result text,
  fen text,
  white_clock_ms int,
  black_clock_ms int,
  last_move_at timestamptz,
  setup_deadline timestamptz,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  ended_at timestamptz
);
grant select on public.games to authenticated;
grant all on public.games to service_role;
alter table public.games enable row level security;
create policy "read own games" on public.games for select to authenticated using (auth.uid() in (white_id, black_id));

-- =============== GAME SETUPS ===============
create table public.game_setups (
  game_id uuid not null references public.games(id) on delete cascade,
  player_id uuid not null references auth.users(id) on delete cascade,
  color text not null check (color in ('w','b')),
  board jsonb not null,
  ready boolean not null default false,
  submitted_at timestamptz not null default now(),
  primary key (game_id, player_id)
);
grant select on public.game_setups to authenticated;
grant all on public.game_setups to service_role;
alter table public.game_setups enable row level security;
create policy "read own setup" on public.game_setups for select to authenticated using (auth.uid() = player_id);

-- Function: opponent readiness + presence (no piece info leaked)
create or replace function public.get_opponent_status(_game_id uuid)
returns table(color text, has_setup boolean, ready boolean)
language sql stable security definer set search_path = public as $$
  select s.color, true, s.ready
  from public.game_setups s
  join public.games g on g.id = s.game_id
  where s.game_id = _game_id
    and auth.uid() in (g.white_id, g.black_id)
    and s.player_id <> auth.uid()
$$;
grant execute on function public.get_opponent_status(uuid) to authenticated;

-- Function: opponent occupied squares (types hidden during setup phase — while status='setup', return nothing)
create or replace function public.get_opponent_squares(_game_id uuid)
returns setof text
language sql stable security definer set search_path = public as $$
  select jsonb_object_keys(s.board)
  from public.game_setups s
  join public.games g on g.id = s.game_id
  where s.game_id = _game_id
    and auth.uid() in (g.white_id, g.black_id)
    and s.player_id <> auth.uid()
    and g.status in ('playing','over')
$$;
grant execute on function public.get_opponent_squares(uuid) to authenticated;

-- =============== GAME MOVES ===============
create table public.game_moves (
  id bigserial primary key,
  game_id uuid not null references public.games(id) on delete cascade,
  ply int not null,
  color text not null check (color in ('w','b')),
  from_sq text not null,
  to_sq text not null,
  captured boolean not null default false,
  captured_type text,
  promotion text,
  san text not null,
  is_check boolean not null default false,
  created_at timestamptz not null default now(),
  unique (game_id, ply)
);
grant select on public.game_moves to authenticated;
grant all on public.game_moves to service_role;
alter table public.game_moves enable row level security;
create policy "read moves of own games" on public.game_moves for select to authenticated using (
  exists (select 1 from public.games g where g.id = game_id and auth.uid() in (g.white_id, g.black_id))
);

-- =============== REALTIME ===============
alter publication supabase_realtime add table public.friendships;
alter publication supabase_realtime add table public.challenges;
alter publication supabase_realtime add table public.games;
alter publication supabase_realtime add table public.game_setups;
alter publication supabase_realtime add table public.game_moves;

-- Enable full row info in realtime updates for challenges (needed for from/to notifications)
alter table public.challenges replica identity full;
alter table public.friendships replica identity full;
alter table public.games replica identity full;
alter table public.game_moves replica identity full;
