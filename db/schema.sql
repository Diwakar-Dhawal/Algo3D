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
  favorite    boolean     not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

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
