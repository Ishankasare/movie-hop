-- Movie Hop: race hardening.  Run once in the Supabase SQL editor, AFTER 0001_race.sql.
--
--  1. create_room: at most 10 new rooms per player per hour, so nobody can flood the database.
--  2. cleanup_old_rooms(): deletes finished / abandoned rooms (rooms, players and results go together).
--     It is scheduled daily with pg_cron when that extension is available; if not, a notice says so and
--     you can run `select public.cleanup_old_rooms();` by hand now and then.
--
-- Safe to run more than once.

create or replace function public.create_room(p_nickname text, p_rounds int, p_band int)
returns text language plpgsql security definer set search_path = public as $$
declare v_code text; v_nick text := btrim(coalesce(p_nickname, '')); alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; i int; recent int;
begin
  if auth.uid() is null then raise exception 'not_signed_in'; end if;
  if char_length(v_nick) < 1 or char_length(v_nick) > 16 then raise exception 'bad_nickname'; end if;
  if p_rounds not in (2, 4) then raise exception 'bad_rounds'; end if;
  if p_band is not null and p_band not in (2, 3, 4) then raise exception 'bad_band'; end if;

  select count(*) into recent from public.rooms where host_id = auth.uid() and created_at > now() - interval '1 hour';
  if recent >= 10 then raise exception 'too_many_rooms'; end if;

  loop
    v_code := '';
    for i in 1..5 loop v_code := v_code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1); end loop;
    exit when not exists (select 1 from public.rooms where code = v_code);
  end loop;
  insert into public.rooms (code, host_id, rounds_total, band) values (v_code, auth.uid(), p_rounds, p_band);
  insert into public.room_players (room_code, player_id, nickname, seat) values (v_code, auth.uid(), v_nick, 0);
  return v_code;
end $$;

-- Rooms nobody has touched for 3 days (or lobbies nobody joined for 6 hours) are removed.
create or replace function public.cleanup_old_rooms()
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  delete from public.rooms
   where updated_at < now() - interval '3 days'
      or (status = 'lobby' and updated_at < now() - interval '6 hours');
  get diagnostics n = row_count;
  return n;
end $$;

-- only the database itself (pg_cron, the SQL editor) may run it, never a player
revoke all on function public.cleanup_old_rooms() from public, anon, authenticated;

-- schedule it daily at 03:17 if pg_cron can be used
do $$
begin
  create extension if not exists pg_cron;
  perform cron.unschedule('movie-hop-cleanup') where exists (select 1 from cron.job where jobname = 'movie-hop-cleanup');
  perform cron.schedule('movie-hop-cleanup', '17 3 * * *', 'select public.cleanup_old_rooms()');
  raise notice 'Scheduled the daily room cleanup.';
exception when others then
  raise notice 'pg_cron is not available (%). Run "select public.cleanup_old_rooms();" occasionally, or enable the pg_cron extension under Database > Extensions and run this file again.', sqlerrm;
end $$;
