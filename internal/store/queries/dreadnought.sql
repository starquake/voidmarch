-- name: Dreadnought :one
SELECT health, updated_at FROM dreadnought WHERE id = 1;

-- name: SaveDreadnought :exec
INSERT INTO dreadnought (id, health, updated_at) VALUES (1, ?, ?)
ON CONFLICT (id) DO UPDATE SET health = excluded.health, updated_at = excluded.updated_at;
