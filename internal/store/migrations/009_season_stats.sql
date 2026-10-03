-- Each player's stats for the season (#154): their own ship's kills, shots
-- and hits, their companions' kills, how often they went down, the
-- derelicts they docked, and the sectors cleared with them in it.
CREATE TABLE season_stats (
    player_id       TEXT PRIMARY KEY REFERENCES players (id) ON DELETE CASCADE,
    kills           INTEGER NOT NULL DEFAULT 0,
    companion_kills INTEGER NOT NULL DEFAULT 0,
    shots           INTEGER NOT NULL DEFAULT 0,
    hits            INTEGER NOT NULL DEFAULT 0,
    deaths          INTEGER NOT NULL DEFAULT 0,
    rescues         INTEGER NOT NULL DEFAULT 0,
    sectors         INTEGER NOT NULL DEFAULT 0
) STRICT;
