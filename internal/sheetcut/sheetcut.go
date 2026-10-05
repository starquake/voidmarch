// Package sheetcut lays out the Void packs' animation strips so that no
// texture is wider or taller than a 4096 px GPU allows (#222): a strip as a
// grid of frames, and a background layer as one still piece plus the regions
// that animate. Every pixel is the pack's own; only where it sits changes.
package sheetcut

import (
	"errors"
	"fmt"
	"image"
	"image/color"
	"image/draw"
	"slices"
)

// MaxSize is the widest and tallest texture the cut sheets may be: the
// smallest MAX_TEXTURE_SIZE a WebGL GPU in use reports.
const MaxSize = 4096

// regionGap is how far apart, in pixels, two changing pixels may be and still
// belong to one animated region: it joins a sparkle's arms into one piece.
const regionGap = 4

// sides is how many margins a crop trims across a frame, one on each side.
const sides = 2

// ErrLayout is returned for a strip whose size doesn't match its frames.
var ErrLayout = errors.New("strip does not divide into frames")

// ErrTooLarge is returned when a cut sheet would exceed MaxSize.
var ErrTooLarge = errors.New("sheet larger than the maximum texture size")

// Strip is an animation strip: frames of FrameWidth by FrameHeight, side by
// side from the left.
type Strip struct {
	Image       *image.NRGBA
	FrameWidth  int
	FrameHeight int
}

// Frames is how many frames the strip holds.
func (s Strip) Frames() int {
	return s.Image.Bounds().Dx() / s.FrameWidth
}

// check returns ErrLayout unless the strip is a whole number of frames high
// and wide.
func (s Strip) check() error {
	b := s.Image.Bounds()
	if s.FrameWidth <= 0 || s.FrameHeight <= 0 || b.Dx()%s.FrameWidth != 0 ||
		b.Dy() != s.FrameHeight {
		return fmt.Errorf(
			"error reading a %dx%d strip as %dx%d frames: %w",
			b.Dx(), b.Dy(), s.FrameWidth, s.FrameHeight, ErrLayout,
		)
	}

	return nil
}

// at is frame f's pixel at (x, y) of the frame.
func (s Strip) at(f, x, y int) color.NRGBA {
	b := s.Image.Bounds()

	return s.Image.NRGBAAt(b.Min.X+f*s.FrameWidth+x, b.Min.Y+y)
}

// frameRect is frame f's rectangle in the strip's image.
func (s Strip) frameRect(f int) image.Rectangle {
	b := s.Image.Bounds()
	at := image.Pt(b.Min.X+f*s.FrameWidth, b.Min.Y)

	return image.Rectangle{Min: at, Max: at.Add(image.Pt(s.FrameWidth, s.FrameHeight))}
}

// same reports whether two pixels look alike: any two fully transparent
// pixels do, whatever color they carry.
func same(a, b color.NRGBA) bool {
	return a == b || (a.A == 0 && b.A == 0)
}

// Inset is the widest margin that is transparent on every side of every
// frame, so cropping it keeps each frame's center where it was.
func Inset(s Strip) (int, error) {
	if err := s.check(); err != nil {
		return 0, err
	}
	inset := min(s.FrameWidth, s.FrameHeight) / sides
	for f := range s.Frames() {
		for y := range s.FrameHeight {
			for x := range s.FrameWidth {
				if s.at(f, x, y).A != 0 {
					inset = min(inset, x, y, s.FrameWidth-1-x, s.FrameHeight-1-y)
				}
			}
		}
	}

	return inset, nil
}

// Grid lays the strip's frames out left to right in rows of columns, each
// frame cropped by inset pixels on every side.
func Grid(s Strip, columns, inset int) (*image.NRGBA, error) {
	if err := s.check(); err != nil {
		return nil, err
	}
	frames := s.Frames()
	if columns <= 0 || sides*inset >= min(s.FrameWidth, s.FrameHeight) {
		return nil, fmt.Errorf(
			"error laying out %d columns cropped by %d: %w", columns, inset, ErrLayout,
		)
	}
	w, h := s.FrameWidth-sides*inset, s.FrameHeight-sides*inset
	rows := (frames + columns - 1) / columns
	out := image.NewNRGBA(image.Rect(0, 0, min(frames, columns)*w, rows*h))
	if err := fits(out.Bounds()); err != nil {
		return nil, err
	}
	for f := range frames {
		at := image.Pt((f%columns)*w, (f/columns)*h)
		src := s.frameRect(f).Min.Add(image.Pt(inset, inset))
		dst := image.Rectangle{Min: at, Max: at.Add(image.Pt(w, h))}
		draw.Draw(out, dst, s.Image, src, draw.Src)
	}

	return out, nil
}

// fits returns ErrTooLarge for a sheet over MaxSize either way.
func fits(r image.Rectangle) error {
	if r.Dx() > MaxSize || r.Dy() > MaxSize {
		return fmt.Errorf(
			"error laying out a %dx%d sheet, over %d: %w", r.Dx(), r.Dy(), MaxSize, ErrTooLarge,
		)
	}

	return nil
}

// changed marks every pixel of a frame that differs between any two frames.
func changed(s Strip) []bool {
	marks := make([]bool, s.FrameWidth*s.FrameHeight)
	for f := 1; f < s.Frames(); f++ {
		for y := range s.FrameHeight {
			for x := range s.FrameWidth {
				if !same(s.at(0, x, y), s.at(f, x, y)) {
					marks[y*s.FrameWidth+x] = true
				}
			}
		}
	}

	return marks
}

// regions groups the marked pixels of a w-wide mask into rectangles that
// don't overlap, joining pixels up to regionGap apart, in reading order.
func regions(marks []bool, w int) []image.Rectangle {
	h := len(marks) / w
	seen := make([]bool, len(marks))
	var out []image.Rectangle
	for i, marked := range marks {
		if !marked || seen[i] {
			continue
		}
		seen[i] = true
		r := image.Rect(i%w, i/w, i%w+1, i/w+1)
		for stack := []int{i}; len(stack) > 0; {
			p := stack[len(stack)-1]
			stack = stack[:len(stack)-1]
			r = r.Union(image.Rect(p%w, p/w, p%w+1, p/w+1))
			near := image.Rect(p%w-regionGap, p/w-regionGap, p%w+regionGap+1, p/w+regionGap+1).
				Intersect(image.Rect(0, 0, w, h))
			for y := near.Min.Y; y < near.Max.Y; y++ {
				for x := near.Min.X; x < near.Max.X; x++ {
					if j := y*w + x; marks[j] && !seen[j] {
						seen[j] = true
						stack = append(stack, j)
					}
				}
			}
		}
		out = append(out, r)
	}

	return merge(out)
}

// merge joins overlapping rectangles until none overlap, in reading order.
func merge(rects []image.Rectangle) []image.Rectangle {
	for joined := true; joined; {
		joined = false
		for i := 0; i < len(rects) && !joined; i++ {
			for j := i + 1; j < len(rects); j++ {
				if rects[i].Overlaps(rects[j]) {
					rects[i] = rects[i].Union(rects[j])
					rects = slices.Delete(rects, j, j+1)
					joined = true

					break
				}
			}
		}
	}
	slices.SortFunc(rects, func(a, b image.Rectangle) int {
		if a.Min.Y != b.Min.Y {
			return a.Min.Y - b.Min.Y
		}

		return a.Min.X - b.Min.X
	})

	return rects
}

// opaque is the smallest rectangle holding every visible pixel of img's
// rectangle r, empty when none is.
func opaque(img *image.NRGBA, r image.Rectangle) image.Rectangle {
	var out image.Rectangle
	for y := r.Min.Y; y < r.Max.Y; y++ {
		for x := r.Min.X; x < r.Max.X; x++ {
			if img.NRGBAAt(x, y).A != 0 {
				out = out.Union(image.Rect(x, y, x+1, y+1))
			}
		}
	}

	return out
}
