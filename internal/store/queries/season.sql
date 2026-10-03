-- name: Season :one
SELECT started_at, won_at FROM season WHERE id = 1;

-- name: SaveSeasonWon :exec
UPDATE season SET won_at = ? WHERE id = 1 AND won_at IS NULL;
