-- name: Dreadnoughts :many
SELECT faction, health, updated_at FROM dreadnoughts ORDER BY faction;

-- name: SaveDreadnought :exec
INSERT INTO dreadnoughts (faction, health, updated_at) VALUES (?, ?, ?)
ON CONFLICT (faction) DO UPDATE SET health = excluded.health, updated_at = excluded.updated_at;
