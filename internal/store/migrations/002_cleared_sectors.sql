-- The sectors whose garrison is destroyed (#99), by name ("C3"), with the
-- unix time they were cleared at.
CREATE TABLE cleared_sectors (
    name       TEXT PRIMARY KEY,
    cleared_at INTEGER NOT NULL
) STRICT;
