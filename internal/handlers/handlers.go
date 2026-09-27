// Package handlers provides helpers shared by the HTTP handlers.
package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
)

// EncodeJSON writes v as a JSON response with the given status code.
func EncodeJSON[T any](w http.ResponseWriter, status int, v T) error {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(v); err != nil {
		return fmt.Errorf("error encoding json: %w", err)
	}

	return nil
}
