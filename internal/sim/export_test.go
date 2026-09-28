package sim

// Len is how many pairs r remembers.
func (r *Rams[K]) Len() int { return len(r.last) }
