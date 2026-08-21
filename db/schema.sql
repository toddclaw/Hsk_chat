-- HSK Chat cloud sync schema.
--
-- Paste this whole file into the Supabase project's SQL editor (Dashboard ->
-- SQL Editor -> New query) and run it once, after creating the project and
-- before wiring up GitHub OAuth. Safe to re-run: every statement is
-- idempotent (create-if-not-exists / drop-then-create for policies).
--
-- Every user-data table is scoped to auth.uid() via Row Level Security: a
-- signed-in user can only ever see or write their own rows. The anon key
-- embedded in the app's client-side code is not a secret -- RLS is the
-- actual security boundary, same as Supabase's own recommended pattern.
--
-- messages.id is CLIENT-GENERATED (crypto.randomUUID(), assigned the moment
-- a turn is created locally), not server-generated. A message can be edited
-- after creation -- a translation added later, an explain-chat follow-up
-- appended -- and using a stable client id means those edits upsert the same
-- row instead of creating a duplicate. Ordering uses created_at (also
-- client-supplied), not a counter, so two devices never have to agree on
-- who gets the next sequence number.

create table if not exists public.messages (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null,
  text text not null,
  needs jsonb,
  attempts int,
  failed boolean,
  truncated boolean,
  introduced jsonb,
  translation text,
  show_translation boolean,
  explain_chat jsonb,
  created_at timestamptz not null,
  updated_at timestamptz not null default now()
);
create index if not exists messages_user_created_idx on public.messages (user_id, created_at);

-- Vocabulary tables: keyed by (user_id, word), upserted -- naturally
-- conflict-free, since two devices adding different words never collide and
-- re-adding the same word from two places is just a no-op update.

create table if not exists public.vocab_extra (
  user_id uuid not null references auth.users(id) on delete cascade,
  word text not null,
  p text,
  d text,
  sentence text,
  updated_at timestamptz not null default now(),
  primary key (user_id, word)
);

create table if not exists public.vocab_learning (
  user_id uuid not null references auth.users(id) on delete cascade,
  word text not null,
  p text,
  d text,
  seen int,
  from_level int,
  updated_at timestamptz not null default now(),
  primary key (user_id, word)
);

create table if not exists public.vocab_known (
  user_id uuid not null references auth.users(id) on delete cascade,
  word text not null,
  p text,
  d text,
  updated_at timestamptz not null default now(),
  primary key (user_id, word)
);

-- Preferences: one JSONB row per user, whole-blob last-write-wins by
-- updated_at. Everything in S that isn't the API key, the model cache, or
-- one of the tables above lives in here (level, model, mode, pinyin,
-- replyLength, script, speechRate, starters, attempts, anki, font,
-- freeOnly, modelSort, custom system prompt, pace settings + budget state).

create table if not exists public.prefs (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.messages enable row level security;
alter table public.vocab_extra enable row level security;
alter table public.vocab_learning enable row level security;
alter table public.vocab_known enable row level security;
alter table public.prefs enable row level security;

drop policy if exists "own rows" on public.messages;
create policy "own rows" on public.messages
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own rows" on public.vocab_extra;
create policy "own rows" on public.vocab_extra
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own rows" on public.vocab_learning;
create policy "own rows" on public.vocab_learning
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own rows" on public.vocab_known;
create policy "own rows" on public.vocab_known
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own rows" on public.prefs;
create policy "own rows" on public.prefs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Keepalive target for the scheduled GitHub Actions ping
-- (.github/workflows/keepalive.yml). A free-tier Supabase project pauses
-- after 7 days with no database ACTIVITY (not just dashboard visits or
-- cached reads), so the workflow writes to this table every few days to
-- keep it alive. RLS is enabled with no policies at all -- default-deny for
-- both anon and authenticated -- so the anon key embedded in the app can
-- never read or write it; only the service_role key (used exclusively by
-- the GitHub Actions workflow, stored as a repo secret, never shipped to
-- the browser) can, since service_role bypasses RLS entirely.

create table if not exists public._keepalive (
  id int primary key default 1,
  pinged_at timestamptz not null default now()
);
insert into public._keepalive (id, pinged_at) values (1, now())
  on conflict (id) do nothing;
alter table public._keepalive enable row level security;
