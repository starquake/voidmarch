-- How many rings around home are open (#123): 1 until the Kla'ed
-- Dreadnought falls. One row.
CREATE TABLE frontier (
    id         INTEGER PRIMARY KEY CHECK (id = 1),
    open_rings INTEGER NOT NULL
) STRICT;
