-- name: ForgetClearedSectors :exec
DELETE FROM cleared_sectors;

-- name: ForgetFrontier :exec
DELETE FROM frontier;

-- name: ForgetDreadnoughts :exec
DELETE FROM dreadnoughts;

-- name: ForgetHangar :exec
DELETE FROM hangar;

-- name: ForgetUnlocks :exec
DELETE FROM unlocks;

-- name: ForgetLoadouts :exec
UPDATE players SET weapon = '', engine = '', shield = '';

-- name: ForgetStats :exec
DELETE FROM season_stats;

-- name: StartSeason :exec
UPDATE season SET started_at = ?, won_at = NULL WHERE id = 1;
