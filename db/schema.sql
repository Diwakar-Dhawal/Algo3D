-- Algo3D accounts, saved programs and activity.
-- Safe to run more than once: every statement is idempotent.

create table if not exists users (
  id             bigserial primary key,
  clerk_user_id  text        unique,
  email          text        not null,
  name           text,
  picture        text,
  created_at     timestamptz not null default now(),
  last_seen_at   timestamptz not null default now(),
  -- room for preferences, rewards, badges, streak freezes, …
  prefs          jsonb       not null default '{}'::jsonb
);

-- the identity now comes from Clerk; the old Google subject stays for rows that
-- predate the switch (there are none in practice) and must stop being required
alter table users add column if not exists clerk_user_id text;
alter table users drop column if exists google_sub;
create unique index if not exists users_clerk_idx on users (clerk_user_id);

create table if not exists saves (
  id          bigserial   primary key,
  user_id     bigint      not null references users(id) on delete cascade,
  title       text        not null,
  language    text        not null,
  code        text        not null,
  inputs      text        not null default '',
  description text        not null default '',
  favorite    boolean     not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table saves add column if not exists description text not null default '';

create index if not exists saves_user_idx on saves (user_id, favorite desc, updated_at desc);

-- one row per user, per day, per kind of event: the raw material for streaks
-- and future rewards (runs, saves, topic visits, solved challenges, …)
create table if not exists activity (
  user_id  bigint  not null references users(id) on delete cascade,
  day      date    not null,
  kind     text    not null,
  count    integer not null default 1,
  primary key (user_id, day, kind)
);

-- `sessions` is no longer used: Clerk owns sessions. Kept so an existing
-- database is not altered destructively; drop it whenever you like.
-- create table if not exists sessions (...);

-- ---------------------------------------------------------------- rooms --
-- A room is a shared code lab. Roles live in src/rooms/roles.ts so adding one
-- (`presenter`, `mentor`, …) is a single entry plus whatever UI uses it.

create table if not exists rooms (
  id          bigserial   primary key,
  owner_id    bigint      not null references users(id) on delete cascade,
  name        text        not null default 'Untitled room',
  -- two invite codes: whoever uses one joins as that kind of participant
  invite_code text        not null unique,
  editor_code text        not null unique,
  settings    jsonb       not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table rooms add column if not exists editor_code text;
-- rooms created before the editor code existed still need a working editor link
update rooms set editor_code = 'R' || lpad(id::text, 7, '0') where editor_code is null;
alter table rooms alter column editor_code set not null;
create unique index if not exists rooms_editor_code_idx on rooms (editor_code);

create table if not exists room_members (
  room_id      bigint      not null references rooms(id) on delete cascade,
  user_id      bigint      not null references users(id) on delete cascade,
  role         text        not null default 'viewer',
  last_seen_at timestamptz,
  joined_at    timestamptz not null default now(),
  primary key (room_id, user_id)
);

create index if not exists room_members_user_idx on room_members (user_id);

-- the shared program: one row per room, version bumps on every accepted change
create table if not exists room_state (
  room_id     bigint      primary key references rooms(id) on delete cascade,
  language    text        not null default 'java',
  code        text        not null default '',
  inputs      text        not null default '',
  step        integer     not null default 0,
  version     bigint      not null default 1,
  -- a soft lease: one editor at a time may push code, so keystrokes never collide
  driver_id   bigint      references users(id) on delete set null,
  driver_until timestamptz,
  updated_by  bigint      references users(id) on delete set null,
  updated_at  timestamptz not null default now()
);
