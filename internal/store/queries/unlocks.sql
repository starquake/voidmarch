-- name: UnlocksOf :many
SELECT part, tier FROM unlocks WHERE player_id = ?;

-- name: SaveUnlock :exec
INSERT INTO unlocks (player_id, part, tier) VALUES (?, ?, ?)
ON CONFLICT (player_id, part) DO UPDATE SET tier = excluded.tier;
