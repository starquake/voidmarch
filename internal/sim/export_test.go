package sim

// Len is how many pairs r remembers.
func (r *Rams[K]) Len() int { return len(r.last) }

// ChooseTarget exposes chooseTarget for tests.
func ChooseTarget(view BrainView) (BrainEnemy, bool) {
	return chooseTarget(&view)
}
