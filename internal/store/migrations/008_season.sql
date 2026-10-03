-- The season (#10, #153): when it started, and when its finale fell, NULL
-- until then. One row; a file from before seasons starts its first now.
CREATE TABLE season (
    id         INTEGER PRIMARY KEY CHECK (id = 1),
    started_at INTEGER NOT NULL,
    won_at     INTEGER
) STRICT;

INSERT INTO season (id, started_at) VALUES (1, CAST(strftime('%s', 'now') AS INTEGER));
