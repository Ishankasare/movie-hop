-- Movie Hop: races for 2 to 4 players.  Run once in the Supabase SQL editor, AFTER 0001 and 0002.
--
-- Rooms keep working exactly as before when max_players is 2 (the default): the friend joins and the
-- match starts. With 3 or 4 players the host can press Start once at least 2 have joined, or the match
-- starts by itself when the room is full.
--
--   * seats 0..3, a per-room max_players (2..4), rounds 2 / 4 / 8
--   * the genre picker rotates through the players in seat order
--   * the race starts when EVERY player still in the match is ready
--   * a round closes when every player still in the match has a result, or at the deadline
--   * a player who leaves (or is silent for 20 s and dropped by someone else) is scored at the cap for
--     the rounds they miss; the match goes on while at least 2 players remain, and the last one standing
--     wins if everybody else has left
--   * a rematch needs every remaining player to ask for it
--
-- Safe to run more than once.

-- ---------------------------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------------------------
alter table public.rooms add column if not exists max_players int not null default 2;
alter table public.rooms drop constraint if exists rooms_max_players_check;
alter table public.rooms add constraint rooms_max_players_check check (max_players between 2 and 4);

alter table public.rooms drop constraint if exists rooms_rounds_total_check;
alter table public.rooms add constraint rooms_rounds_total_check check (rounds_total in (2, 4, 8));

alter table public.room_players drop constraint if exists room_players_seat_check;
alter table public.room_players add constraint room_players_seat_check check (seat between 0 and 3);
alter table public.room_players add column if not exists has_left boolean not null default false;

-- ---------------------------------------------------------------------------------------------
-- Helpers (internal)
-- ---------------------------------------------------------------------------------------------
create or replace function public._active_count(p_code text)
returns int language sql stable security definer set search_path = public as $$
  select count(*)::int from public.room_players where room_code = p_code and not has_left;
$$;

-- The next player (in seat order, wrapping around) after p_after who is still in the match.
create or replace function public._next_picker(p_code text, p_after uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select a.player_id
    from public.room_players a
   where a.room_code = p_code and not a.has_left
   order by (case when a.seat > coalesce((select c.seat from public.room_players c
                                           where c.room_code = p_code and c.player_id = p_after), -1) then 0 else 1 end),
            a.seat
   limit 1;
$$;

-- Starts the match: round 1, and a coin flip (a random player) picks first.
create or replace function public._begin_match(p_code text)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.rooms
     set status = 'picking', round_no = 1,
         picker_id = (select player_id from public.room_players where room_code = p_code and not has_left order by random() limit 1),
         category = null, pair_key = null, start_at = null, first_finish_ms = null, deadline_at = null,
         updated_at = now()
   where code = p_code;
  update public.room_players set ready = false, moves = 0, hints = 0 where room_code = p_code;
end $$;

-- When everyone still in the match is ready, the race starts after a 4 s countdown.
create or replace function public._start_if_all_ready(p_code text)
returns void language plpgsql security definer set search_path = public as $$
declare r public.rooms; waiting int;
begin
  select * into r from public.rooms where code = p_code;
  if r.status <> 'ready' then return; end if;
  select count(*) into waiting from public.room_players where room_code = p_code and not has_left and not ready;
  if waiting = 0 and public._active_count(p_code) >= 2 then
    update public.rooms
       set status = 'racing', start_at = now() + interval '4 seconds',
           deadline_at = now() + interval '4 seconds' + interval '10 minutes',
           first_finish_ms = null, updated_at = now()
     where code = p_code;
  end if;
end $$;

-- Closes the round when everyone still in the match has a result, or when the deadline has passed.
create or replace function public._maybe_close(p_code text)
returns void language plpgsql security definer set search_path = public as $$
declare r public.rooms; pending int;
begin
  select * into r from public.rooms where code = p_code;
  if r.status <> 'racing' then return; end if;
  select count(*) into pending from public.room_players p
   where p.room_code = p_code and not p.has_left
     and not exists (select 1 from public.round_results x
                      where x.room_code = p_code and x.match_no = r.match_no
                        and x.round_no = r.round_no and x.player_id = p.player_id);
  if pending = 0 or (r.deadline_at is not null and now() >= r.deadline_at) then
    perform public._close_round(p_code);
  end if;
end $$;

-- A player leaves the match (their choice, or dropped after going silent). The match goes on while 2 or more remain.
create or replace function public._drop_player(p_code text, p_player uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r public.rooms; active int; survivor uuid;
begin
  select * into r from public.rooms where code = p_code;
  update public.room_players set has_left = true where room_code = p_code and player_id = p_player and not has_left;
  if not found then return; end if;

  active := public._active_count(p_code);
  if active < 2 then
    select player_id into survivor from public.room_players where room_code = p_code and not has_left limit 1;
    update public.rooms set status = 'finished', forfeit_winner = survivor, updated_at = now() where code = p_code;
    return;
  end if;

  if r.status = 'picking' and r.picker_id = p_player then
    update public.rooms set picker_id = public._next_picker(p_code, p_player), updated_at = now() where code = p_code;
  elsif r.status = 'ready' then
    perform public._start_if_all_ready(p_code);
  elsif r.status = 'racing' then
    perform public._maybe_close(p_code);
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Public functions
-- ---------------------------------------------------------------------------------------------

-- The host chooses how many players the room takes (2 by default, as before).
drop function if exists public.create_room(text, int, int);
create or replace function public.create_room(p_nickname text, p_rounds int, p_band int, p_max_players int default 2)
returns text language plpgsql security definer set search_path = public as $$
declare v_code text; v_nick text := btrim(coalesce(p_nickname, '')); alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; i int; recent int;
begin
  if auth.uid() is null then raise exception 'not_signed_in'; end if;
  if char_length(v_nick) < 1 or char_length(v_nick) > 16 then raise exception 'bad_nickname'; end if;
  if p_rounds not in (2, 4, 8) then raise exception 'bad_rounds'; end if;
  if p_band is not null and p_band not in (2, 3, 4) then raise exception 'bad_band'; end if;
  if p_max_players not between 2 and 4 then raise exception 'bad_players'; end if;

  select count(*) into recent from public.rooms where host_id = auth.uid() and created_at > now() - interval '1 hour';
  if recent >= 10 then raise exception 'too_many_rooms'; end if;

  loop
    v_code := '';
    for i in 1..5 loop v_code := v_code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1); end loop;
    exit when not exists (select 1 from public.rooms where code = v_code);
  end loop;
  insert into public.rooms (code, host_id, rounds_total, band, max_players) values (v_code, auth.uid(), p_rounds, p_band, p_max_players);
  insert into public.room_players (room_code, player_id, nickname, seat) values (v_code, auth.uid(), v_nick, 0);
  return v_code;
end $$;

-- Joining takes the lowest free seat. The match starts by itself when the room is full.
create or replace function public.join_room(p_code text, p_nickname text)
returns void language plpgsql security definer set search_path = public as $$
declare r public.rooms; v_nick text := btrim(coalesce(p_nickname, '')); n int; v_seat int;
begin
  if auth.uid() is null then raise exception 'not_signed_in'; end if;
  select * into r from public.rooms where code = upper(btrim(p_code)) for update;
  if not found then raise exception 'room_not_found'; end if;
  if exists (select 1 from public.room_players where room_code = r.code and player_id = auth.uid()) then return; end if;
  if char_length(v_nick) < 1 or char_length(v_nick) > 16 then raise exception 'bad_nickname'; end if;
  select count(*) into n from public.room_players where room_code = r.code;
  if r.status <> 'lobby' or n >= r.max_players then raise exception 'room_full'; end if;

  select min(s) into v_seat from generate_series(0, 3) as s
   where not exists (select 1 from public.room_players where room_code = r.code and seat = s);
  insert into public.room_players (room_code, player_id, nickname, seat) values (r.code, auth.uid(), v_nick, v_seat);

  if n + 1 >= r.max_players then
    perform public._begin_match(r.code);
  else
    update public.rooms set updated_at = now() where code = r.code;
  end if;
end $$;

-- The host starts the match early once at least 2 players are in the lobby.
create or replace function public.start_match(p_code text)
returns void language plpgsql security definer set search_path = public as $$
declare r public.rooms;
begin
  r := public._lock_room(p_code);
  if r.host_id <> auth.uid() then raise exception 'not_host'; end if;
  if r.status <> 'lobby' then raise exception 'wrong_state'; end if;
  if public._active_count(r.code) < 2 then raise exception 'need_more_players'; end if;
  perform public._begin_match(r.code);
end $$;

-- Each player taps Ready; when everyone still in the match has, the race starts after a 4 s countdown.
create or replace function public.set_ready(p_code text)
returns void language plpgsql security definer set search_path = public as $$
declare r public.rooms;
begin
  r := public._lock_room(p_code);
  if r.status <> 'ready' then raise exception 'wrong_state'; end if;
  update public.room_players set ready = true, last_seen = now() where room_code = r.code and player_id = auth.uid();
  perform public._start_if_all_ready(r.code);
end $$;

-- After a round is over: the next player in seat order picks, or the match ends after the last round.
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
           picker_id = public._next_picker(r.code, r.picker_id),
           category = null, pair_key = null, start_at = null, first_finish_ms = null, deadline_at = null,
           updated_at = now()
     where code = r.code;
    update public.room_players set ready = false, moves = 0, hints = 0 where room_code = r.code;
  end if;
end $$;

-- Anyone silent for 20 s can be dropped by another player (the server checks the silence, not the client).
-- Kept under its old name so the page that is already live keeps working.
create or replace function public.forfeit(p_code text)
returns void language plpgsql security definer set search_path = public as $$
declare r public.rooms; other record; dropped int := 0;
begin
  r := public._lock_room(p_code);
  if r.status in ('lobby', 'finished') then raise exception 'wrong_state'; end if;
  for other in
    select player_id from public.room_players
     where room_code = r.code and player_id <> auth.uid() and not has_left
       and last_seen < now() - interval '20 seconds'
  loop
    perform public._drop_player(r.code, other.player_id);
    dropped := dropped + 1;
  end loop;
  if dropped = 0 then raise exception 'opponent_still_here'; end if;
end $$;

-- Leave the room. In the lobby you are simply removed (the room goes if the host leaves); mid-match you
-- are scored at the cap for what you miss and the others carry on.
create or replace function public.leave_room(p_code text)
returns void language plpgsql security definer set search_path = public as $$
declare r public.rooms;
begin
  r := public._lock_room(p_code);
  if r.status = 'lobby' then
    if r.host_id = auth.uid() then
      delete from public.rooms where code = r.code;
    else
      delete from public.room_players where room_code = r.code and player_id = auth.uid();
      update public.rooms set updated_at = now() where code = r.code;
    end if;
  elsif r.status = 'finished' then
    update public.room_players set has_left = true where room_code = r.code and player_id = auth.uid();
  else
    perform public._drop_player(r.code, auth.uid());
  end if;
end $$;

-- Rematch: when every remaining player asks, scores reset and a fresh coin flip decides who picks first.
create or replace function public.rematch(p_code text)
returns void language plpgsql security definer set search_path = public as $$
declare r public.rooms; waiting int;
begin
  r := public._lock_room(p_code);
  if r.status <> 'finished' then raise exception 'wrong_state'; end if;
  update public.room_players set rematch = true where room_code = r.code and player_id = auth.uid();
  select count(*) into waiting from public.room_players where room_code = r.code and not has_left and not rematch;
  if waiting = 0 and public._active_count(r.code) >= 2 then
    update public.rooms
       set match_no = match_no + 1, used_pairs = '{}', forfeit_winner = null where code = r.code;
    perform public._begin_match(r.code);
    update public.room_players set rematch = false where room_code = r.code;
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Who may call what
-- ---------------------------------------------------------------------------------------------
do $$
declare fn text;
begin
  for fn in
    select format('%I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid))
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('create_room','join_room','start_match','set_ready','next_round','forfeit','leave_room','rematch')
  loop
    execute format('revoke all on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
  for fn in
    select format('%I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid))
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('_active_count','_next_picker','_begin_match','_start_if_all_ready','_maybe_close','_drop_player')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
  end loop;
end $$;
