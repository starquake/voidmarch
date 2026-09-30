CREATE TABLE players (
    id           TEXT PRIMARY KEY,
    name         TEXT NOT NULL,
    token_hash   TEXT NOT NULL UNIQUE,
    weapon       TEXT NOT NULL DEFAULT '',
    engine       TEXT NOT NULL DEFAULT '',
    shield       TEXT NOT NULL DEFAULT '',
    created_at   INTEGER NOT NULL,
    last_seen_at INTEGER
) STRICT;

CREATE TABLE unlocks (
    player_id TEXT NOT NULL REFERENCES players (id) ON DELETE CASCADE,
    part      TEXT NOT NULL,
    tier      INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (player_id, part)
) STRICT;

CREATE TABLE hangar (
    id    INTEGER PRIMARY KEY CHECK (id = 1),
    ships INTEGER NOT NULL
) STRICT;
