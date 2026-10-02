-- name: Dreadnought :one
SELECT hp, updated_at FROM dreadnought WHERE id = 1;

-- name: SaveDreadnought :exec
INSERT INTO dreadnought (id, hp, updated_at) VALUES (1, ?, ?)
ON CONFLICT (id) DO UPDATE SET hp = excluded.hp, updated_at = excluded.updated_at;
