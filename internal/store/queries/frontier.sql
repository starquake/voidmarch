-- name: OpenRings :one
SELECT open_rings FROM frontier WHERE id = 1;

-- name: SaveOpenRings :exec
INSERT INTO frontier (id, open_rings) VALUES (1, ?)
ON CONFLICT (id) DO UPDATE SET open_rings = excluded.open_rings;
