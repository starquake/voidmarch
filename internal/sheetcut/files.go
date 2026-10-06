package sheetcut

import (
	"bytes"
	"encoding/json"
	"fmt"
	"image"
	"image/png"
	"os"
	"path/filepath"
)

// fileMode is a committed asset's: a file anyone may read.
const fileMode = 0o644

// GridOptions are a strip to lay out as a grid, and where to write it.
type GridOptions struct {
	Src         string
	Out         string
	FrameWidth  int
	FrameHeight int
	Columns     int
	// Crop trims the margin that is transparent around every frame (Inset).
	Crop bool
}

// GridFile writes the strip at o.Src laid out as a grid (Grid) to o.Out.
func GridFile(o GridOptions) error {
	s, err := ReadStrip(o.Src, o.FrameWidth, o.FrameHeight)
	if err != nil {
		return err
	}
	inset := 0
	if o.Crop {
		if inset, err = Inset(s); err != nil {
			return err
		}
	}
	img, err := Grid(s, o.Columns, inset)
	if err != nil {
		return err
	}

	return WritePNG(o.Out, img)
}

// SplitFile writes the background layer strip at src, of frames w by h, as a
// sheet of pieces (Split) to sheetOut and its Layout to layoutOut.
func SplitFile(src, sheetOut, layoutOut string, w, h int) error {
	s, err := ReadStrip(src, w, h)
	if err != nil {
		return err
	}
	sheet, layout, err := Split(s)
	if err != nil {
		return err
	}
	if err = WritePNG(sheetOut, sheet); err != nil {
		return err
	}
	data, err := json.MarshalIndent(layout, "", "  ")
	if err != nil {
		return fmt.Errorf("error encoding the layout: %w", err)
	}
	if err = os.WriteFile(layoutOut, append(data, '\n'), fileMode); err != nil {
		return fmt.Errorf("error writing %s: %w", layoutOut, err)
	}

	return nil
}

// ReadStrip decodes the PNG at path as a strip of w by h frames.
func ReadStrip(path string, w, h int) (Strip, error) {
	data, err := os.ReadFile(filepath.Clean(path))
	if err != nil {
		return Strip{}, fmt.Errorf("error reading %s: %w", path, err)
	}
	img, err := png.Decode(bytes.NewReader(data))
	if err != nil {
		return Strip{}, fmt.Errorf("error decoding %s: %w", path, err)
	}
	nrgba, ok := img.(*image.NRGBA)
	if !ok {
		// Set converts each pixel on its own, so a palette's NRGBA colors
		// stay exact where draw.Draw would go through premultiplied alpha.
		b := img.Bounds()
		nrgba = image.NewNRGBA(b)
		for y := b.Min.Y; y < b.Max.Y; y++ {
			for x := b.Min.X; x < b.Max.X; x++ {
				nrgba.Set(x, y, img.At(x, y))
			}
		}
	}
	s := Strip{Image: nrgba, FrameWidth: w, FrameHeight: h}

	return s, s.check()
}

// WritePNG encodes img as a PNG at path.
func WritePNG(path string, img image.Image) error {
	var buf bytes.Buffer
	enc := png.Encoder{CompressionLevel: png.BestCompression}
	if err := enc.Encode(&buf, img); err != nil {
		return fmt.Errorf("error encoding %s: %w", path, err)
	}
	if err := os.WriteFile(path, buf.Bytes(), fileMode); err != nil {
		return fmt.Errorf("error writing %s: %w", path, err)
	}

	return nil
}
