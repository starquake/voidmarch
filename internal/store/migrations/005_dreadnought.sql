-- The Kla'ed Dreadnought's health (#124), kept across sessions with the
-- unix time it was saved at, so the hours nobody was on still regenerate it.
-- One row.
CREATE TABLE dreadnought (
    id         INTEGER PRIMARY KEY CHECK (id = 1),
    hp         INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
) STRICT;
