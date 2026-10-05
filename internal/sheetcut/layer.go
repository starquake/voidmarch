package sheetcut

import (
	"cmp"
	"image"
	"image/draw"
	"slices"
)

// Layout says where a background layer's pieces are in its sheet and where
// each goes on the layer's frame; the client draws them to build a frame.
type Layout struct {
	// Width and Height are the layer frame's size.
	Width  int `json:"width"`
	Height int `json:"height"`
	// Frames is how many frames the layer's animation has.
	Frames int     `json:"frames"`
	Pieces []Piece `json:"pieces"`
}

// Piece is a rectangle of the layer: still, with one frame, or animated,
// with every frame of the layer side by side in the sheet.
type Piece struct {
	// X and Y are where the piece goes on the layer's frame.
	X int `json:"x"`
	Y int `json:"y"`
	// Width and Height are one frame of the piece.
	Width  int `json:"width"`
	Height int `json:"height"`
	// SheetX and SheetY are its first frame in the sheet; frame f is
	// Width*f further right.
	SheetX int `json:"sheetX"`
	SheetY int `json:"sheetY"`
	Frames int `json:"frames"`
}

// Split cuts a background layer's strip into one sheet: a still piece, the
// first frame with every changing region cleared and trimmed to what is
// left, and an animated piece for each region that changes between frames.
// Drawing the pieces at their places rebuilds every frame exactly.
func Split(s Strip) (*image.NRGBA, Layout, error) {
	if err := s.check(); err != nil {
		return nil, Layout{}, err
	}
	frames := s.Frames()
	layout := Layout{Width: s.FrameWidth, Height: s.FrameHeight, Frames: frames}
	moving := regions(changed(s), s.FrameWidth)

	still := image.NewNRGBA(image.Rect(0, 0, s.FrameWidth, s.FrameHeight))
	draw.Draw(still, still.Bounds(), s.Image, s.frameRect(0).Min, draw.Src)
	for _, r := range moving {
		draw.Draw(still, r, image.Transparent, image.Point{}, draw.Src)
	}
	if r := opaque(still, still.Bounds()); !r.Empty() {
		layout.Pieces = append(layout.Pieces, piece(r, 1))
	}
	for _, r := range moving {
		layout.Pieces = append(layout.Pieces, piece(r, frames))
	}

	size := pack(layout.Pieces)
	if err := fits(image.Rectangle{Max: size}); err != nil {
		return nil, Layout{}, err
	}
	sheet := image.NewNRGBA(image.Rectangle{Max: size})
	for _, p := range layout.Pieces {
		for f := range p.Frames {
			src := still
			at := image.Pt(p.X, p.Y)
			if p.Frames > 1 {
				src = s.Image
				at = s.frameRect(f).Min.Add(at)
			}
			dst := image.Rect(0, 0, p.Width, p.Height).Add(image.Pt(p.SheetX+f*p.Width, p.SheetY))
			draw.Draw(sheet, dst, src, at, draw.Src)
		}
	}

	return sheet, layout, nil
}

// piece is the piece for rectangle r of the layer, with frames frames.
func piece(r image.Rectangle, frames int) Piece {
	return Piece{X: r.Min.X, Y: r.Min.Y, Width: r.Dx(), Height: r.Dy(), Frames: frames}
}

// pack places each piece's frames as one row in the sheet, tallest first, on
// shelves as wide as the widest row, and returns the sheet's size.
func pack(pieces []Piece) image.Point {
	order := make([]int, len(pieces))
	width := 0
	for i, p := range pieces {
		order[i] = i
		width = max(width, p.Width*p.Frames)
	}
	slices.SortStableFunc(order, func(a, b int) int {
		return cmp.Compare(pieces[b].Height, pieces[a].Height)
	})
	x, y, shelf := 0, 0, 0
	for _, i := range order {
		p := &pieces[i]
		if x+p.Width*p.Frames > width {
			x, y, shelf = 0, y+shelf, 0
		}
		p.SheetX, p.SheetY = x, y
		x += p.Width * p.Frames
		shelf = max(shelf, p.Height)
	}

	return image.Pt(width, y+shelf)
}
