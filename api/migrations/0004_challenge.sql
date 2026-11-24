-- The weekly challenge's board (iteration 7): each Steward's best factory per week. The
-- server scores it itself (src/benchmark.js runChallenge in QuickJS); `version` is the
-- challenge's score version (BENCH_VERSION * 100 + CHALLENGE_VERSION), so a change to the
-- rules starts a fresh board. Removed with the account (on delete cascade).

create table challenge_scores (
    user_id     bigint not null references users (id) on delete cascade,
    week        text not null,                   -- the period key, '2026-W48'
    version     integer not null,
    per_minute  double precision not null,       -- the week's target delivered per minute
    cost        integer not null,                -- credits the factory cost (ties: cheaper first)
    machines    integer not null,                -- machines under the cap (belts, splitters, mergers don't count)
    cells       integer not null,                -- every building in the layout
    layout      jsonb not null,
    created_at  timestamptz not null default now(),
    primary key (user_id, week, version)
);
create index challenge_board on challenge_scores (week, version, per_minute desc, cost);
