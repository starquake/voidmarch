-- name: ClearedSectors :many
SELECT name FROM cleared_sectors ORDER BY name;

-- name: ClearSector :exec
INSERT INTO cleared_sectors (name, cleared_at) VALUES (?, ?)
ON CONFLICT (name) DO NOTHING;
