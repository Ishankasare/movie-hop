-- Movie Hop: 2-player race.  Run once in the Supabase SQL editor (Database -> SQL Editor -> New query).
--
-- Design:
--  * Clients only READ tables (row level security: members of a room only).
--  * Every WRITE goes through the SECURITY DEFINER functions below, which check who is calling
--    (auth.uid(), i.e. the anonymous sign-in id) and take a row lock on the room, so two players acting at
--    the same moment are serialised and the first finisher / the round result is decided atomically.
--  * Finish times are measured with the server clock (now() - start_at), never taken from the client.
--  * Only hop COUNTS are stored while racing, never routes, so there is nothing to spoil.
--
-- Rules encoded here (constants are inline so they are easy to find):
--   hint penalty   15 s added to a finisher's time
--   grace window   60 s after the first finisher; after that the other player times out
--   hard cap       10 min per round if nobody finishes
--   gave up / timed out score the cap:  first finisher's raw time + 60 s (or 10 min if nobody finished)
--   countdown      race starts 4 s after both players are ready
--   forfeit        allowed when the opponent has been silent for 20 s (heartbeat every ~5 s)

create table if not exists public.rooms (
  code             text primary key,
  host_id          uuid not null,
  status           text not null default 'lobby'
                   check (status in ('lobby','picking','ready','racing','round_over','finished')),
  rounds_total     int  not null check (rounds_total in (2, 4)),
  band             int  check (band in (2, 3, 4)),          -- null = any hop band
  match_no         int  not null default 1,                  -- bumped by a rematch
  round_no         int  not null default 0,
  picker_id        uuid,                                     -- who chooses this round's genre
  category         text,
  pair_key         text,                                     -- "<startId>-<goalId>", looked up in pairs.json
  used_pairs       text[] not null default '{}',
  start_at         timestamptz,                              -- race starts here (countdown ends)
  first_finish_ms  int,                                      -- raw time of the first finisher this round
  deadline_at      timestamptz,                              -- the round closes here
  forfeit_winner   uuid,                                     -- set when the match ended by forfeit
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table if not exists public.room_players (
  room_code   text not null references public.rooms(code) on delete cascade,
  player_id   uuid not null,
  nickname    text not null,
  seat        int  not null check (seat in (0, 1)),
  ready       boolean not null default false,
  moves       int  not null default 0,                       -- live hop count: all the opponent ever sees
  hints       int  not null default 0,
  rematch     boolean not null default false,
  last_seen   timestamptz not null default now(),
  primary key (room_code, player_id),
  unique (room_code, seat)
);

create table if not exists public.round_results (
  room_code  text not null references public.rooms(code) on delete cascade,
  match_no   int  not null,
  round_no   int  not null,
  player_id  uuid not null,
  outcome    text not null check (outcome in ('finished', 'gaveup', 'timeout')),
  ms         int,                                            -- null until the round closes for gave-up / timeout
  hints      int  not null default 0,
  moves      int  not null default 0,
  primary key (room_code, match_no, round_no, player_id)
);

-- ---------------------------------------------------------------------------------------------
-- Row level security: read-only for members of the room; no direct writes from clients at all.
-- ---------------------------------------------------------------------------------------------
create or replace function public.is_member(p_code text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.room_players where room_code = p_code and player_id = auth.uid());
$$;

alter table public.rooms         enable row level security;
alter table public.room_players  enable row level security;
alter table public.round_results enable row level security;

drop policy if exists rooms_select on public.rooms;
create policy rooms_select on public.rooms for select to authenticated using (public.is_member(code));
drop policy if exists players_select on public.room_players;
create policy players_select on public.room_players for select to authenticated using (public.is_member(room_code));
drop policy if exists results_select on public.round_results;
create policy results_select on public.round_results for select to authenticated using (public.is_member(room_code));

revoke all on public.rooms, public.room_players, public.round_results from anon, authenticated;
grant select on public.rooms, public.room_players, public.round_results to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Helpers (internal)
-- ---------------------------------------------------------------------------------------------
create or replace function public._lock_room(p_code text)
returns public.rooms language plpgsql security definer set search_path = public as $$
declare r public.rooms;
begin
  if auth.uid() is null then raise exception 'not_signed_in'; end if;
  select * into r from public.rooms where code = upper(p_code) for update;
  if not found then raise exception 'room_not_found'; end if;
  if not exists (select 1 from public.room_players where room_code = r.code and player_id = auth.uid()) then
    raise exception 'not_a_member';
  end if;
  return r;
end $$;

create or replace function public._other_player(p_code text, p_me uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select player_id from public.room_players where room_code = p_code and player_id <> p_me limit 1;
$$;

-- Closes the current round: anyone without a result times out, gave-up / timed-out rows get the cap.
create or replace function public._close_round(p_code text)
returns void language plpgsql security definer set search_path = public as $$
declare r public.rooms; cap int;
begin
  select * into r from public.rooms where code = p_code;
  if r.status <> 'racing' then return; end if;

  insert into public.round_results (room_code, match_no, round_no, player_id, outcome, hints, moves)
  select p.room_code, r.match_no, r.round_no, p.player_id, 'timeout', p.hints, p.moves
  from public.room_players p
  where p.room_code = p_code
    and not exists (select 1 from public.round_results x
                    where x.room_code = p_code and x.match_no = r.match_no
                      and x.round_no = r.round_no and x.player_id = p.player_id);

  cap := coalesce(r.first_finish_ms + 60000, 600000);
  update public.round_results set ms = cap
   where room_code = p_code and match_no = r.match_no and round_no = r.round_no and ms is null;

  update public.rooms set status = 'round_over', updated_at = now() where code = p_code;
end $$;

-- Closes the round when everyone has a result, or when the deadline has passed.
create or replace function public._maybe_close(p_code text)
returns void language plpgsql security definer set search_path = public as $$
declare r public.rooms; done int;
begin
  select * into r from public.rooms where code = p_code;
  if r.status <> 'racing' then return; end if;
  select count(*) into done from public.round_results
   where room_code = p_code and match_no = r.match_no and round_no = r.round_no;
  if done >= 2 or (r.deadline_at is not null and now() >= r.deadline_at) then
    perform public._close_round(p_code);
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Public functions (called from the app through supabase.rpc)
-- ---------------------------------------------------------------------------------------------

-- Host creates a room. Returns the 5-letter code to share.
create or replace function public.create_room(p_nickname text, p_rounds int, p_band int)
returns text language plpgsql security definer set search_path = public as $$
declare v_code text; v_nick text := btrim(coalesce(p_nickname, '')); alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; i int;
begin
  if auth.uid() is null then raise exception 'not_signed_in'; end if;
  if char_length(v_nick) < 1 or char_length(v_nick) > 16 then raise exception 'bad_nickname'; end if;
  if p_rounds not in (2, 4) then raise exception 'bad_rounds'; end if;
  if p_band is not null and p_band not in (2, 3, 4) then raise exception 'bad_band'; end if;
  loop
    v_code := '';
    for i in 1..5 loop v_code := v_code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1); end loop;
    exit when not exists (select 1 from public.rooms where code = v_code);
  end loop;
  insert into public.rooms (code, host_id, rounds_total, band) values (v_code, auth.uid(), p_rounds, p_band);
  insert into public.room_players (room_code, player_id, nickname, seat) values (v_code, auth.uid(), v_nick, 0);
  return v_code;
end $$;

-- Friend joins with the code. The second player starts the match: a coin flip decides who picks first.
create or replace function public.join_room(p_code text, p_nickname text)
returns void language plpgsql security definer set search_path = public as $$
declare r public.rooms; v_nick text := btrim(coalesce(p_nickname, '')); n int;
begin
  if auth.uid() is null then raise exception 'not_signed_in'; end if;
  select * into r from public.rooms where code = upper(btrim(p_code)) for update;
  if not found then raise exception 'room_not_found'; end if;
  if exists (select 1 from public.room_players where room_code = r.code and player_id = auth.uid()) then return; end if;
  if char_length(v_nick) < 1 or char_length(v_nick) > 16 then raise exception 'bad_nickname'; end if;
  select count(*) into n from public.room_players where room_code = r.code;
  if r.status <> 'lobby' or n >= 2 then raise exception 'room_full'; end if;

  insert into public.room_players (room_code, player_id, nickname, seat) values (r.code, auth.uid(), v_nick, 1);
  update public.rooms
     set status = 'picking', round_no = 1,
         picker_id = case when random() < 0.5 then r.host_id else auth.uid() end,
         updated_at = now()
   where code = r.code;
end $$;

-- The picker chooses the goal's genre / universe and the pair (the app picks the pair from pairs.json).
create or replace function public.pick_round(p_code text, p_category text, p_pair_key text)
returns void language plpgsql security definer set search_path = public as $$
declare r public.rooms;
begin
  r := public._lock_room(p_code);
  if r.status <> 'picking' then raise exception 'wrong_state'; end if;
  if r.picker_id <> auth.uid() then raise exception 'not_your_pick'; end if;
  if p_category is not null and p_category !~ '^(marvel|dc|disney|saga|g[0-9]{1,6})$' then raise exception 'bad_category'; end if;
  if p_pair_key !~ '^[0-9]{1,9}-[0-9]{1,9}$' then raise exception 'bad_pair'; end if;
  if p_pair_key = any (r.used_pairs) then raise exception 'pair_already_played'; end if;

  update public.rooms
     set status = 'ready', category = p_category, pair_key = p_pair_key,
         used_pairs = array_append(used_pairs, p_pair_key), updated_at = now()
   where code = r.code;
  update public.room_players set ready = false, moves = 0, hints = 0 where room_code = r.code;
end $$;

-- Each player taps Ready; when both have, the race starts after a 4 s countdown.
create or replace function public.set_ready(p_code text)
returns void language plpgsql security definer set search_path = public as $$
declare r public.rooms; n int;
begin
  r := public._lock_room(p_code);
  if r.status <> 'ready' then raise exception 'wrong_state'; end if;
  update public.room_players set ready = true, last_seen = now() where room_code = r.code and player_id = auth.uid();
  select count(*) into n from public.room_players where room_code = r.code and ready;
  if n >= 2 then
    update public.rooms
       set status = 'racing', start_at = now() + interval '4 seconds',
           deadline_at = now() + interval '4 seconds' + interval '10 minutes',
           first_finish_ms = null, updated_at = now()
     where code = r.code;
  end if;
end $$;

-- Live hop count (the only thing the opponent can see while racing).
create or replace function public.report_progress(p_code text, p_moves int)
returns void language plpgsql security definer set search_path = public as $$
declare r public.rooms;
begin
  r := public._lock_room(p_code);
  if r.status <> 'racing' then return; end if;
  if exists (select 1 from public.round_results where room_code = r.code and match_no = r.match_no
             and round_no = r.round_no and player_id = auth.uid()) then return; end if;
  update public.room_players set moves = least(greatest(coalesce(p_moves, 0), 0), 999), last_seen = now()
   where room_code = r.code and player_id = auth.uid();
end $$;

-- One hint per round; it adds 15 s to this player's time.
create or replace function public.use_hint(p_code text)
returns void language plpgsql security definer set search_path = public as $$
declare r public.rooms;
begin
  r := public._lock_room(p_code);
  if r.status <> 'racing' then raise exception 'wrong_state'; end if;
  update public.room_players set hints = 1 where room_code = r.code and player_id = auth.uid() and hints = 0;
end $$;

-- Player reached the goal. Time comes from the server clock. The first finisher opens a 60 s window.
create or replace function public.finish_round(p_code text, p_moves int)
returns void language plpgsql security definer set search_path = public as $$
declare r public.rooms; raw_ms int; h int;
begin
  r := public._lock_room(p_code);
  if r.status <> 'racing' then raise exception 'wrong_state'; end if;
  if now() < r.start_at then raise exception 'too_early'; end if;
  -- too late: the window has closed, so this player times out instead of finishing
  if r.deadline_at is not null and now() >= r.deadline_at then perform public._maybe_close(r.code); return; end if;
  if exists (select 1 from public.round_results where room_code = r.code and match_no = r.match_no
             and round_no = r.round_no and player_id = auth.uid()) then return; end if;

  raw_ms := floor(extract(epoch from (now() - r.start_at)) * 1000)::int;
  select hints into h from public.room_players where room_code = r.code and player_id = auth.uid();

  insert into public.round_results (room_code, match_no, round_no, player_id, outcome, ms, hints, moves)
  values (r.code, r.match_no, r.round_no, auth.uid(), 'finished', raw_ms + coalesce(h, 0) * 15000,
          coalesce(h, 0), least(greatest(coalesce(p_moves, 0), 0), 999));
  update public.room_players set moves = least(greatest(coalesce(p_moves, 0), 0), 999), last_seen = now()
   where room_code = r.code and player_id = auth.uid();

  if r.first_finish_ms is null then
    update public.rooms
       set first_finish_ms = raw_ms,
           deadline_at = least(coalesce(deadline_at, now() + interval '60 seconds'), now() + interval '60 seconds'),
           updated_at = now()
     where code = r.code;
  end if;
  perform public._maybe_close(r.code);
end $$;

-- Giving up scores the cap (first finisher's time + 60 s), so quitting is never a shortcut.
create or replace function public.give_up(p_code text)
returns void language plpgsql security definer set search_path = public as $$
declare r public.rooms; h int; m int;
begin
  r := public._lock_room(p_code);
  if r.status <> 'racing' then raise exception 'wrong_state'; end if;
  if r.deadline_at is not null and now() >= r.deadline_at then perform public._maybe_close(r.code); return; end if;
  if exists (select 1 from public.round_results where room_code = r.code and match_no = r.match_no
             and round_no = r.round_no and player_id = auth.uid()) then return; end if;
  select hints, moves into h, m from public.room_players where room_code = r.code and player_id = auth.uid();
  insert into public.round_results (room_code, match_no, round_no, player_id, outcome, ms, hints, moves)
  values (r.code, r.match_no, r.round_no, auth.uid(), 'gaveup', null, coalesce(h, 0), coalesce(m, 0));
  perform public._maybe_close(r.code);
end $$;

-- Clients call this when the countdown to the deadline hits zero; harmless to call any time.
create or replace function public.settle(p_code text)
returns void language plpgsql security definer set search_path = public as $$
declare r public.rooms;
begin
  r := public._lock_room(p_code);
  perform public._maybe_close(r.code);
end $$;

-- After a round is over: move on to the next round (other player picks) or finish the match.
-- p_from_round makes this idempotent: both players may call it, only the first one advances.
create or replace function public.next_round(p_code text, p_from_round int)
returns void language plpgsql security definer set search_path = public as $$
declare r public.rooms;
begin
  r := public._lock_room(p_code);
  if r.status <> 'round_over' or r.round_no <> p_from_round then return; end if;
  if r.round_no >= r.rounds_total then
    update public.rooms set status = 'finished', updated_at = now() where code = r.code;
  else
    update public.rooms
       set status = 'picking', round_no = r.round_no + 1,
           picker_id = public._other_player(r.code, r.picker_id),
           category = null, pair_key = null, start_at = null, first_finish_ms = null, deadline_at = null,
           updated_at = now()
     where code = r.code;
    update public.room_players set ready = false, moves = 0, hints = 0 where room_code = r.code;
  end if;
end $$;

-- Heartbeat (every ~5 s) so the opponent can tell you are still here.
create or replace function public.touch(p_code text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not_signed_in'; end if;
  update public.room_players set last_seen = now() where room_code = upper(p_code) and player_id = auth.uid();
end $$;

-- Opponent silent for 20 s: caller wins the match. The server checks the silence, not the client.
create or replace function public.forfeit(p_code text)
returns void language plpgsql security definer set search_path = public as $$
declare r public.rooms; other uuid;
begin
  r := public._lock_room(p_code);
  if r.status in ('lobby', 'finished') then raise exception 'wrong_state'; end if;
  other := public._other_player(r.code, auth.uid());
  if other is null then raise exception 'no_opponent'; end if;
  if (select last_seen from public.room_players where room_code = r.code and player_id = other) > now() - interval '20 seconds' then
    raise exception 'opponent_still_here';
  end if;
  update public.rooms set status = 'finished', forfeit_winner = auth.uid(), updated_at = now() where code = r.code;
end $$;

-- Rematch: when both players ask, scores reset and a fresh coin flip decides who picks first.
create or replace function public.rematch(p_code text)
returns void language plpgsql security definer set search_path = public as $$
declare r public.rooms; n int; host uuid; guest uuid;
begin
  r := public._lock_room(p_code);
  if r.status <> 'finished' then raise exception 'wrong_state'; end if;
  update public.room_players set rematch = true where room_code = r.code and player_id = auth.uid();
  select count(*) into n from public.room_players where room_code = r.code and rematch;
  if n >= 2 then
    host := r.host_id;
    guest := public._other_player(r.code, host);
    update public.rooms
       set status = 'picking', match_no = match_no + 1, round_no = 1,
           picker_id = case when random() < 0.5 then host else guest end,
           category = null, pair_key = null, used_pairs = '{}', start_at = null, first_finish_ms = null,
           deadline_at = null, forfeit_winner = null, updated_at = now()
     where code = r.code;
    update public.room_players set ready = false, moves = 0, hints = 0, rematch = false where room_code = r.code;
  end if;
end $$;

-- Everything a client needs in one call (also gives the server clock for the countdown).
create or replace function public.room_snapshot(p_code text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r public.rooms;
begin
  if auth.uid() is null then raise exception 'not_signed_in'; end if;
  select * into r from public.rooms where code = upper(p_code);
  if not found or not public.is_member(r.code) then raise exception 'room_not_found'; end if;
  return jsonb_build_object(
    'now', now(),
    'room', to_jsonb(r),
    'players', (select coalesce(jsonb_agg(to_jsonb(p) order by p.seat), '[]'::jsonb) from public.room_players p where p.room_code = r.code),
    'results', (select coalesce(jsonb_agg(to_jsonb(x) order by x.match_no, x.round_no), '[]'::jsonb)
                from public.round_results x where x.room_code = r.code and x.match_no = r.match_no)
  );
end $$;

-- Only signed-in (including anonymous) users may call these.
do $$
declare fn text;
begin
  for fn in
    select format('%I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid))
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('create_room','join_room','pick_round','set_ready','report_progress','use_hint','finish_round',
                        'give_up','settle','next_round','touch','forfeit','rematch','room_snapshot','is_member')
  loop
    execute format('revoke all on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
  -- internal helpers are not callable from the app at all
  for fn in
    select format('%I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid))
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('_lock_room','_other_player','_close_round','_maybe_close')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
  end loop;
end $$;

-- Live updates to the clients (they re-read room_snapshot when anything changes).
do $$
begin
  begin alter publication supabase_realtime add table public.rooms; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.room_players; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.round_results; exception when duplicate_object then null; end;
end $$;
