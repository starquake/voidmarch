-- The Dreadnought's health becomes the share of its maximum left (#132): the
-- maximum now follows the players near it. A saved health becomes its share
-- of the old fixed 200,000.
CREATE TABLE dreadnought_share (
    id         INTEGER PRIMARY KEY CHECK (id = 1),
    health     REAL NOT NULL,
    updated_at INTEGER NOT NULL
) STRICT;

INSERT INTO dreadnought_share (id, health, updated_at)
SELECT id, MIN(1.0, MAX(0.0, hp / 200000.0)), updated_at FROM dreadnought;

DROP TABLE dreadnought;

ALTER TABLE dreadnought_share RENAME TO dreadnought;
