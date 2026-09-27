// Package wire encodes the WebSocket messages as binary protobuf, or as
// protobuf JSON for debugging. A connection's format is the one its client
// uses, so one browser tab can talk JSON while the others stay binary.
package wire

import (
	"fmt"

	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
)

// Format is how messages are encoded on a connection.
type Format int

// The two formats: binary frames carry protobuf, text frames protobuf JSON.
const (
	Binary Format = iota
	JSON
)

// String returns the format's name for logs.
func (f Format) String() string {
	if f == JSON {
		return "json"
	}

	return "binary"
}

// Marshal encodes m in the format.
func (f Format) Marshal(m proto.Message) ([]byte, error) {
	var (
		data []byte
		err  error
	)
	if f == JSON {
		data, err = protojson.Marshal(m)
	} else {
		data, err = proto.Marshal(m)
	}
	if err != nil {
		return nil, fmt.Errorf("error encoding %s message: %w", f, err)
	}

	return data, nil
}

// Unmarshal decodes data in the format into m.
func (f Format) Unmarshal(data []byte, m proto.Message) error {
	var err error
	if f == JSON {
		err = protojson.Unmarshal(data, m)
	} else {
		err = proto.Unmarshal(data, m)
	}
	if err != nil {
		return fmt.Errorf("error decoding %s message: %w", f, err)
	}

	return nil
}
