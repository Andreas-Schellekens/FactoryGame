-- Protocol: Selene accounts, cloud saves, settings and leaderboard scores.
-- Personal data kept to a minimum: a chosen username, password and recovery-code
-- hashes, and timestamps. No e-mail addresses, no IP addresses.

create table users (
    id            bigserial primary key,
    name          text not null,
    name_key      text not null unique,          -- lower(name), for case-insensitive uniqueness
    pass_hash     text not null,                 -- Argon2id PHC string
    recovery_hash text not null,                 -- Argon2id of the one-time recovery code
    created_at    timestamptz not null default now()
);

create table sessions (
    token_hash bytea primary key,                -- sha256 of the cookie token
    user_id    bigint not null references users (id) on delete cascade,
    created_at timestamptz not null default now(),
    expires_at timestamptz not null
);
create index sessions_user on sessions (user_id);

create table saves (
    user_id    bigint not null references users (id) on delete cascade,
    slot       text not null,                    -- the client's slot id
    name       text not null,
    meta       jsonb not null,                   -- mode, progress, playtime, thumbnail
    data       jsonb not null,                   -- the save itself
    rev        integer not null default 1,       -- bumps on every write (conflict check)
    updated_at timestamptz not null default now(),
    primary key (user_id, slot)
);

create table settings (
    user_id       bigint primary key references users (id) on delete cascade,
    data          jsonb not null,
    client_ms     bigint not null,               -- when the client changed them (last write wins)
    updated_at    timestamptz not null default now()
);

-- Only personal bests are stored (on either board), each with the layout that scored it.
create table scores (
    id            bigserial primary key,
    user_id       bigint not null references users (id) on delete cascade,
    world         text not null,
    bench_version integer not null,
    per_minute    double precision not null,
    efficiency    double precision not null,
    machines      integer not null,
    sold          jsonb not null,
    layout        jsonb not null,
    created_at    timestamptz not null default now()
);
create index scores_user on scores (user_id);
create index scores_board on scores (world, bench_version);
