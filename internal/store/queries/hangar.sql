-- name: Hangar :one
SELECT ships FROM hangar WHERE id = 1;

-- name: SaveHangar :exec
INSERT INTO hangar (id, ships) VALUES (1, ?)
ON CONFLICT (id) DO UPDATE SET ships = excluded.ships;
