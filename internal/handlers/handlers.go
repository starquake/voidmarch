// Package handlers provides helpers shared by the HTTP handlers.
package handlers

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
)

// maxJSONBodySize caps a JSON request body; the API's requests are tiny.
const maxJSONBodySize = 64 * 1024

var (
	// ErrNotJSON is returned by DecodeJSON when the request is not application/json.
	ErrNotJSON = errors.New("request body must be application/json")
	// ErrTrailingJSONData is returned by DecodeJSON when the body holds more than one value.
	ErrTrailingJSONData = errors.New("unexpected data after JSON value")
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

// DecodeJSON reads one JSON value of type T from the request body. It
// requires the application/json content type, which a cross-site form cannot
// send without a preflight, and rejects unknown fields and trailing data.
func DecodeJSON[T any](w http.ResponseWriter, r *http.Request) (T, error) {
	var v T

	mediaType, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || mediaType != "application/json" {
		return v, ErrNotJSON
	}

	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxJSONBodySize))
	dec.DisallowUnknownFields()
	if err = dec.Decode(&v); err != nil {
		return v, fmt.Errorf("error decoding json: %w", err)
	}
	if err = dec.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return v, ErrTrailingJSONData
	}

	return v, nil
}
