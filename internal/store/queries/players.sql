-- name: CreatePlayer :exec
INSERT INTO players (id, name, token_hash, created_at) VALUES (?, ?, ?, ?);

-- name: PlayerByTokenHash :one
SELECT id, name, weapon, engine, shield FROM players WHERE token_hash = ?;

-- name: SaveLoadout :exec
UPDATE players SET weapon = ?, engine = ?, shield = ? WHERE id = ?;

-- name: TouchPlayer :exec
UPDATE players SET last_seen_at = ? WHERE id = ?;

-- name: DeleteUnusedPlayers :execrows
DELETE FROM players WHERE last_seen_at IS NULL AND created_at <= ?;
