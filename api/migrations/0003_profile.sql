-- Iteration 7, stream D: profiles (an avatar chosen from the game's own pictures, and
-- whether the profile is public), achievements (earned on the client, kept here as a
-- union), and passkeys (WebAuthn: public credentials only, never a private key).

create table profiles (
    user_id    bigint primary key references users (id) on delete cascade,
    avatar     text,                             -- an avatar id like 'b:smelter' or 'd:happy'
    public     boolean not null default true,    -- false: only the leaderboard row is shown
    updated_at timestamptz not null default now()
);

create table achievements (
    user_id   bigint not null references users (id) on delete cascade,
    id        text not null,                     -- the client's achievement id
    earned_at timestamptz not null,
    primary key (user_id, id)
);

create table passkeys (
    id           bigserial primary key,
    user_id      bigint not null references users (id) on delete cascade,
    cred_id      bytea not null unique,          -- the credential id the authenticator chose
    handle       uuid not null,                  -- the WebAuthn user handle (random, one per user)
    credential   jsonb not null,                 -- webauthn-rs Passkey: public key, counter, flags
    name         text not null,
    created_at   timestamptz not null default now(),
    last_used_at timestamptz
);
create index passkeys_user on passkeys (user_id);
create index passkeys_handle on passkeys (handle);
