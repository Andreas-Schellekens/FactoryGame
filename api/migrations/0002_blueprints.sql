-- Blueprints: a player's saved machine groups (iteration 7), synced from the game's library.
-- Last write wins, by the client's clock (client_ms), like settings.

create table blueprints (
    user_id    bigint not null references users (id) on delete cascade,
    id         text not null,                    -- the client's blueprint id
    name       text not null,
    data       jsonb not null,                   -- { w, h, machines: [{ x, y, type, dir, recipe?, off? }] }
    client_ms  bigint not null,                  -- when the client last changed it
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    primary key (user_id, id)
);
