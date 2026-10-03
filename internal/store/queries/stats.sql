-- name: StatsOf :one
SELECT kills, companion_kills, shots, hits, deaths, rescues, sectors
FROM season_stats WHERE player_id = ?;

-- name: SaveStats :exec
INSERT INTO season_stats (
    player_id, kills, companion_kills, shots, hits, deaths, rescues, sectors
) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT (player_id) DO UPDATE SET
    kills = excluded.kills,
    companion_kills = excluded.companion_kills,
    shots = excluded.shots,
    hits = excluded.hits,
    deaths = excluded.deaths,
    rescues = excluded.rescues,
    sectors = excluded.sectors;

-- name: AllStats :many
SELECT p.id, p.name, s.kills, s.companion_kills, s.shots, s.hits, s.deaths, s.rescues, s.sectors
FROM season_stats s JOIN players p ON p.id = s.player_id
ORDER BY p.id;
