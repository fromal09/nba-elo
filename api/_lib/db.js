// Postgres for the card collection (Neon via the Vercel integration sets DATABASE_URL).
// The schema creates itself on the first request after a cold start.
import postgres from 'postgres'
import { cardPoints } from './points.js'
import { ensurePredSchema } from './predictions.js'
import { ensureWishSchema } from './wishes.js'
import { ensureChallengeSchema } from './challenge.js'
import { applyRenames } from './renames.js'

let sql = null
let ready = null

export function db() {
  if (!sql) {
    const url = process.env.DATABASE_URL || process.env.POSTGRES_URL
    if (!url) throw Object.assign(new Error('The collection database isn’t connected yet (DATABASE_URL is missing).'), { status: 503 })
    // Neon's pooled endpoint runs PgBouncer, which can't keep prepared statements
    sql = postgres(url, { max: 1, prepare: false, idle_timeout: 20, connect_timeout: 10, onnotice: () => {} })
  }
  return sql
}

// Bump when the schema below changes: a cold start whose database already has this version skips the ~60 statements
export const SCHEMA_VERSION = '2026-10-28b'

export function ensureSchema() {
  if (!ready) {
    const s = db()
    ready = s`select v from schema_meta limit 1`.catch(() => []).then(([m]) => (m?.v === SCHEMA_VERSION ? null : migrate(s)))
      .catch(e => { ready = null; throw e })
  }
  return ready
}

function migrate(s) {
  {
    return s.begin(async t => {
      await t`create table if not exists users (
        id serial primary key,
        username text not null,
        username_key text not null unique,
        pass_hash text not null,
        favorite_team text,
        starred bigint[] not null default '{}',
        showcase bigint[] not null default '{}',
        streak int not null default 0,
        last_claim date,
        since_big int not null default 0,
        coins int not null default 0,
        created_at timestamptz not null default now())`
      await t`alter table users add column if not exists coins int not null default 0`
      await t`alter table users add column if not exists best_streak int not null default 0`
      await t`create table if not exists sessions (
        token_hash text primary key,
        user_id int not null references users(id) on delete cascade,
        expires_at timestamptz not null)`
      await t`create table if not exists claims (
        user_id int not null references users(id) on delete cascade,
        day date not null,
        kind text not null,
        created_at timestamptz not null default now(),
        primary key (user_id, day, kind))`
      await t`create table if not exists packs (
        id serial primary key,
        user_id int not null references users(id) on delete cascade,
        kind text not null,
        day date not null,
        team text,
        slots jsonb not null,
        picks int[] not null default '{}',
        pity boolean not null default false,
        status text not null default 'open',
        opened_at timestamptz not null default now(),
        done_at timestamptz)`
      await t`create table if not exists cards (
        id bigserial primary key,
        user_id int not null references users(id) on delete cascade,
        pack_id int not null references packs(id) on delete cascade,
        tier text not null,
        ref text not null,
        card jsonb not null,
        pulled_at timestamptz not null default now(),
        points int not null default 0,
        unique (user_id, ref))`
      // Databases created before binder points: add the column, then score the cards already kept
      await t`alter table cards add column if not exists points int not null default 0`
      const unscored = await t`select id, card from cards where points = 0 limit 20000`
      for (const c of unscored) await t`update cards set points = ${cardPoints(c.card).points} where id = ${c.id}`
      // Cards bought in the store (or bought back) don't come from a pack
      await t`alter table cards alter column pack_id drop not null`
      await t`alter table cards add column if not exists source text`
      await t`create index if not exists cards_user on cards (user_id, id desc)`
      await t`create index if not exists cards_ref on cards (ref, pulled_at, id)`
      // Coins: every grant and charge; ref makes a grant once-only (nulls never conflict)
      await t`create table if not exists coin_ledger (
        id bigserial primary key,
        user_id int not null references users(id) on delete cascade,
        day date not null,
        kind text not null,
        ref text,
        amount int not null,
        created_at timestamptz not null default now(),
        unique (user_id, kind, ref))`
      await t`create index if not exists coin_ledger_day on coin_ledger (user_id, day)`
      // Sold cards, kept for the 24-hour buyback
      await t`create table if not exists sold (
        id bigserial primary key,
        user_id int not null references users(id) on delete cascade,
        ref text not null,
        card jsonb not null,
        points int not null,
        price int not null,
        sold_at timestamptz not null default now(),
        bought_back boolean not null default false)`
      // When the sold card was first kept, so binder score history counts it for the weeks it was held
      await t`alter table sold add column if not exists pulled_at timestamptz`
      // Weekly leaderboard payouts, once per week
      await t`create table if not exists settlements (week date primary key, settled_at timestamptz not null default now())`
      // Daily predictions: the slate, your picks, your finished days
      await ensurePredSchema(t)
      await ensureWishSchema(t)
      await ensureChallengeSchema(t)
      await applyRenames(t)
      await t`create index if not exists packs_open on packs (user_id) where status = 'open'`
      await t`create index if not exists sessions_user on sessions (user_id)`
      await t`create table if not exists schema_meta (v text not null)`
      await t`delete from schema_meta`
      await t`insert into schema_meta (v) values (${SCHEMA_VERSION})`
    })
  }
}
