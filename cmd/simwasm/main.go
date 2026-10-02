//go:build wasm

// Command simwasm exports the browser's part of the sim (internal/simbridge)
// to WebAssembly. TinyGo builds it into internal/web/static/wasm/sim.wasm
// (make wasm); standard Go builds it too, as the fallback. Only numbers
// cross: the state and scratch arrays are read in place through their
// addresses.
package main

import (
	"unsafe"

	"github.com/starquake/voidmarch/internal/sim"
	"github.com/starquake/voidmarch/internal/simbridge"
)

//nolint:gochecknoglobals // the one sim the exports share.
var bridge = simbridge.New()

//go:wasmexport statePointer
func statePointer() int32 {
	return int32(uintptr(unsafe.Pointer(&bridge.State[0])))
}

//go:wasmexport scratchPointer
func scratchPointer() int32 {
	return int32(uintptr(unsafe.Pointer(&bridge.Scratch[0])))
}

//go:wasmexport advance
func advance(
	frameSeconds, moveX, moveY, aimX, aimY float64,
	fire int32,
	squadmateDistance, friendDistance float64,
) {
	bridge.Advance(
		frameSeconds,
		sim.Command{MoveX: moveX, MoveY: moveY, AimX: aimX, AimY: aimY, Fire: fire != 0},
		squadmateDistance,
		friendDistance,
	)
}

//go:wasmexport respawn
func respawn(x, y float64) int32 {
	if bridge.Respawn(x, y) {
		return 1
	}

	return 0
}

//go:wasmexport takeHit
func takeHit(from float64) int32 {
	if bridge.TakeHit(from) {
		return 1
	}

	return 0
}

//go:wasmexport setControlMode
func setControlMode(screen int32) {
	mode := sim.ControlShip
	if screen != 0 {
		mode = sim.ControlScreen
	}
	bridge.SetControlMode(mode)
}

//go:wasmexport placeShip
func placeShip(x, y float64) {
	bridge.PlaceShip(x, y)
}

//go:wasmexport setLoadout
func setLoadout(weapon, engine, shield, weaponTier, engineTier, shieldTier int32) {
	bridge.SetLoadout(
		int(weapon),
		int(engine),
		int(shield),
		int(weaponTier),
		int(engineTier),
		int(shieldTier),
	)
}

//go:wasmexport setDamage
func setDamage(damage int32) {
	bridge.SetDamage(int(damage))
}

//go:wasmexport setRotationSnap
func setRotationSnap(steps int32) {
	bridge.SetRotationSnap(int(steps))
}

//go:wasmexport setFrontier
func setFrontier(openRings int32) {
	bridge.SetFrontier(int(openRings))
}

//go:wasmexport openSector
func openSector(q, r int32) {
	bridge.OpenSector(int(q), int(r))
}

//go:wasmexport spawn
func spawn(kind, faction int32, x, y, angle, age float64, shotID int32) int32 {
	return int32(bridge.Spawn(int(kind), int(faction), x, y, angle, age, int(shotID)))
}

//go:wasmexport deactivate
func deactivate(slot int32) {
	bridge.Deactivate(int(slot))
}

//go:wasmexport clear
func clear(faction int32) {
	bridge.Clear(int(faction))
}

//go:wasmexport hitsPointer
func hitsPointer() int32 {
	return int32(uintptr(unsafe.Pointer(&bridge.Hits[0])))
}

//go:wasmexport steer
func steer(faction int32, stepSeconds float64, n int32) {
	bridge.Steer(int(faction), stepSeconds, int(n))
}

//go:wasmexport burstSeed
func burstSeed(n, shotID int32) uint32 {
	return bridge.BurstSeed(int(n), int(shotID))
}

//go:wasmexport burst
func burst(weapon, faction int32, x, y float64, shotID int32, seed uint32, from int32) int32 {
	return int32(bridge.Burst(int(weapon), int(faction), x, y, int(shotID), seed, int(from)))
}

//go:wasmexport shipScan
func shipScan(stepSeconds float64, n int32) int32 {
	return int32(bridge.ShipScan(stepSeconds, int(n)))
}

//go:wasmexport hitScan
func hitScan(faction int32, stepSeconds float64, n int32) int32 {
	return int32(bridge.HitScan(int(faction), stepSeconds, int(n)))
}

//go:wasmexport bump
func bump(n int32) int32 {
	return int32(bridge.Bump(int(n)))
}

//go:wasmexport enemyPattern
func enemyPattern(kind int32, x, y, angle, seed float64) int32 {
	return int32(bridge.EnemyPattern(int(kind), x, y, angle, uint32(seed)))
}

// main blocks, so the exports stay callable once it has run.
func main() {
	select {}
}
