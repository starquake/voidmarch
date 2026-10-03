-- One saved share of health per faction's Dreadnought (#140): the Kla'ed
-- one guards ring 2 and the Nairan one ring 3. The Kla'ed row carries over.
CREATE TABLE dreadnoughts (
    faction    TEXT PRIMARY KEY,
    health     REAL NOT NULL,
    updated_at INTEGER NOT NULL
) STRICT;

INSERT INTO dreadnoughts (faction, health, updated_at)
SELECT 'klaed', health, updated_at FROM dreadnought;

DROP TABLE dreadnought;
