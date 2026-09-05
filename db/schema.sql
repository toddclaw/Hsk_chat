-- HSK Chat cloud sync schema.
--
-- Paste this whole file into the Supabase project's SQL editor (Dashboard ->
-- SQL Editor -> New query) and run it once, after creating the project and
-- before wiring up GitHub OAuth. Safe to re-run: every statement is
-- idempotent (create-if-not-exists / drop-then-create for policies).
--
-- Every user-data table is scoped to auth.uid() via Row Level Security: a
-- signed-in user can only ever see or write their own rows. The publishable
-- key (formerly "anon key") embedded in the app's client-side code is not a
-- secret -- RLS is the actual security boundary, same as Supabase's own
-- recommended pattern.
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

-- Conversations. One row per chat; messages point at it via
-- messages.conversation_id.
--
-- deleted_at is a TOMBSTONE and is the reason this table exists at all rather
-- than the grouping living on messages alone. Deleting a chat has to be
-- expressible to a device that was offline when it happened: hard-deleting the
-- message rows says nothing, so that device re-pushes its local copy on the
-- next sync and the chat comes back. A tombstone syncs, and every device
-- honours it. Deletion is monotonic in the merge -- once set it never unsets,
-- whatever timestamps the other side carries.
--
-- title is nullable and derived from the first message when a chat is created.
-- It is here from the start deliberately: adding a column later means whoever
-- runs this project applying SQL by hand again, which is the expensive kind of
-- change. UI-only additions are not.

create table if not exists public.conversations (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text,
  created_at timestamptz not null,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists conversations_user_updated_idx
  on public.conversations (user_id, updated_at desc);

-- Nullable on purpose: rows written before conversation history existed have
-- no conversation, and the app maps NULL to one fixed legacy conversation id
-- rather than inventing one per device -- two devices generating their own
-- would split a single old history into two chats.
alter table public.messages add column if not exists conversation_id uuid;
create index if not exists messages_conversation_idx
  on public.messages (user_id, conversation_id, created_at);

-- The grader's verdict on one student sentence: the intended meaning, a
-- corrected version, four category flags, and tagged errors. Nullable, because
-- grading is optional and because messages written before it existed have
-- none. See the note on conversation_id above for why the app tolerates this
-- column being absent rather than requiring the migration.

alter table public.messages add column if not exists grade jsonb;

-- Which activity a conversation was created in: chat, focused chat or story
-- time. Nullable, and NULL means "chat" -- conversations written before
-- activities existed are chats, and an un-migrated database degrades to
-- activity-less conversations rather than failing every push. See the note on
-- conversation_id above for why the app tolerates this column being absent.

alter table public.conversations add column if not exists activity text;

-- Which kind of assistant turn this is inside a story: "segment" or "question".
-- Story time interleaves them, and both are assistant turns, so nothing else
-- stored tells them apart -- `introduced` is absent on plenty of real segments.
-- Without it "part 3 of 5" miscounts on any device that pulled the story.
alter table public.messages add column if not exists kind text;

-- The vocabulary level a conversation was held at. Fixed at creation like
-- activity, and for the same reason: a transcript written under HSK 1 rules
-- does not become an HSK 3 transcript when the learner moves up. Nullable --
-- conversations written before this column existed have no level, and the app
-- shows nothing rather than guessing the current one.

alter table public.conversations add column if not exists level int;

-- Which role the STUDENT took in a 20 Questions conversation ("answerer" --
-- the student thinks of something and the model guesses -- or "guesser" --
-- the model thinks of something and the student guesses), and, only for a
-- guesser round, what the model is thinking of. Fixed at creation like
-- activity and level. secret is read by nothing except the prompt sent to
-- the model -- it is never shown to the student, so an un-migrated database
-- degrading to no secret just means the chooser reappears on that device.

alter table public.conversations add column if not exists side text;
alter table public.conversations add column if not exists secret text;

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

alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.vocab_extra enable row level security;
alter table public.vocab_learning enable row level security;
alter table public.vocab_known enable row level security;
alter table public.prefs enable row level security;

drop policy if exists "own rows" on public.conversations;
create policy "own rows" on public.conversations
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

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
-- both anon and authenticated -- so the publishable key embedded in the app
-- can never read or write it; only the secret key (formerly "service_role
-- key" -- used exclusively by the GitHub Actions workflow, stored as a repo
-- secret, never shipped to the browser) can, since it bypasses RLS entirely.

create table if not exists public._keepalive (
  id int primary key default 1,
  pinged_at timestamptz not null default now()
);
insert into public._keepalive (id, pinged_at) values (1, now())
  on conflict (id) do nothing;
alter table public._keepalive enable row level security;
