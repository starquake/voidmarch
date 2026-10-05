package sheetcut_test

import (
	"bytes"
	"encoding/json"
	"errors"
	"image"
	"image/color"
	"image/draw"
	"image/png"
	"os"
	"path/filepath"
	"testing"

	. "github.com/starquake/voidmarch/internal/sheetcut"
)

var (
	red   = color.NRGBA{R: 255, A: 255}
	green = color.NRGBA{G: 255, A: 128}
	blue  = color.NRGBA{B: 255, A: 255}
)

// strip makes a strip of w by h frames, each painted by paint.
func strip(w, h, frames int, paint func(f int, img *image.NRGBA, at image.Point)) Strip {
	img := image.NewNRGBA(image.Rect(0, 0, w*frames, h))
	for f := range frames {
		paint(f, img, image.Pt(f*w, 0))
	}

	return Strip{Image: img, FrameWidth: w, FrameHeight: h}
}

// frame copies frame f of s.
func frame(s Strip, f int) *image.NRGBA {
	out := image.NewNRGBA(image.Rect(0, 0, s.FrameWidth, s.FrameHeight))
	draw.Draw(out, out.Bounds(), s.Image, image.Pt(f*s.FrameWidth, 0), draw.Src)

	return out
}

// rebuild draws frame f of a split layer from its sheet, as the client does.
func rebuild(sheet *image.NRGBA, l Layout, f int) *image.NRGBA {
	out := image.NewNRGBA(image.Rect(0, 0, l.Width, l.Height))
	for _, p := range l.Pieces {
		src := image.Pt(p.SheetX+(f%p.Frames)*p.Width, p.SheetY)
		draw.Draw(out, image.Rect(p.X, p.Y, p.X+p.Width, p.Y+p.Height), sheet, src, draw.Src)
	}

	return out
}

// diff is the first pixel where a and b look different, if any.
func diff(t *testing.T, a, b *image.NRGBA) (image.Point, bool) {
	t.Helper()
	if a.Bounds() != b.Bounds() {
		t.Fatalf("bounds %v and %v differ", a.Bounds(), b.Bounds())
	}
	for y := range a.Bounds().Dy() {
		for x := range a.Bounds().Dx() {
			p, q := a.NRGBAAt(x, y), b.NRGBAAt(x, y)
			if p != q && (p.A != 0 || q.A != 0) {
				return image.Pt(x, y), true
			}
		}
	}

	return image.Point{}, false
}

// layer is a 3-frame, 40 by 20 layer: a still red star, a blue twinkle that
// blinks, and a green sparkle whose two arms, 3 px apart, change in turn.
func layer() Strip {
	return strip(40, 20, 3, func(f int, img *image.NRGBA, at image.Point) {
		img.SetNRGBA(at.X+2, at.Y+3, red)
		img.SetNRGBA(at.X+30, at.Y+15, red)
		if f != 1 {
			img.SetNRGBA(at.X+10, at.Y+10, blue)
		}
		img.SetNRGBA(at.X+20+f, at.Y+5, green)
		img.SetNRGBA(at.X+25, at.Y+6+f, green)
	})
}

func TestSplitRebuildsEveryFrame(t *testing.T) {
	t.Parallel()
	s := layer()
	sheet, l, err := Split(s)
	if err != nil {
		t.Fatalf("Split() error = %v", err)
	}
	if got, want := len(l.Pieces), 3; got != want {
		t.Fatalf("len(Pieces) = %d, want %d: %+v", got, want, l.Pieces)
	}
	for i, tc := range []struct {
		name string
		want Piece
	}{
		{name: "still, trimmed to the red stars", want: Piece{X: 2, Y: 3, Width: 29, Height: 13, Frames: 1}},
		{name: "the sparkle, both arms in one", want: Piece{X: 20, Y: 5, Width: 6, Height: 4, Frames: 3}},
		{name: "the twinkle", want: Piece{X: 10, Y: 10, Width: 1, Height: 1, Frames: 3}},
	} {
		got := l.Pieces[i]
		got.SheetX, got.SheetY = 0, 0
		if got != tc.want {
			t.Errorf("Pieces[%d] = %+v, want %+v: %s", i, got, tc.want, tc.name)
		}
	}
	for f := range s.Frames() {
		if at, differ := diff(t, rebuild(sheet, l, f), frame(s, f)); differ {
			t.Errorf("frame %d rebuilt differs at %v", f, at)
		}
	}
	for _, p := range l.Pieces {
		if p.SheetX+p.Width*p.Frames > sheet.Bounds().Dx() ||
			p.SheetY+p.Height > sheet.Bounds().Dy() {
			t.Errorf("piece %+v outside the %v sheet", p, sheet.Bounds())
		}
	}
}

func TestSplitWithoutStillPixels(t *testing.T) {
	t.Parallel()
	s := strip(8, 8, 2, func(f int, img *image.NRGBA, at image.Point) {
		img.SetNRGBA(at.X+3+f, at.Y+3, blue)
	})
	_, l, err := Split(s)
	if err != nil {
		t.Fatalf("Split() error = %v", err)
	}
	if got, want := len(l.Pieces), 1; got != want || l.Pieces[0].Frames != 2 {
		t.Errorf("Pieces = %+v, want one animated piece and no still one", l.Pieces)
	}
}

func TestSplitTooLarge(t *testing.T) {
	t.Parallel()
	// A row that changes all the way across: 3 frames of it are 3 * 2048 px.
	s := strip(MaxSize/2, 2, 3, func(f int, img *image.NRGBA, at image.Point) {
		for x := range MaxSize / 2 {
			img.SetNRGBA(at.X+x, at.Y, color.NRGBA{R: uint8(f), A: 255})
		}
	})
	if _, _, err := Split(s); !errors.Is(err, ErrTooLarge) {
		t.Errorf("Split() error = %v, want ErrTooLarge", err)
	}
}

func TestGrid(t *testing.T) {
	t.Parallel()
	colors := []color.NRGBA{red, green, blue, red, green}
	s := strip(6, 6, len(colors), func(f int, img *image.NRGBA, at image.Point) {
		img.SetNRGBA(at.X+2, at.Y+2, colors[f])
		img.SetNRGBA(at.X+3, at.Y+3, colors[f])
	})
	inset, err := Inset(s)
	if err != nil {
		t.Fatalf("Inset() error = %v", err)
	}
	if got, want := inset, 2; got != want {
		t.Errorf("Inset() = %d, want %d", got, want)
	}
	for _, tc := range []struct {
		name    string
		columns int
		inset   int
		size    image.Point
	}{
		{name: "uncropped", columns: 2, inset: 0, size: image.Pt(12, 18)},
		{name: "cropped", columns: 3, inset: 2, size: image.Pt(6, 4)},
		{name: "one row", columns: 9, inset: 0, size: image.Pt(30, 6)},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			img, err := Grid(s, tc.columns, tc.inset)
			if err != nil {
				t.Fatalf("Grid() error = %v", err)
			}
			if got := img.Bounds().Size(); got != tc.size {
				t.Errorf("Grid() size = %v, want %v", got, tc.size)
			}
			w := s.FrameWidth - 2*tc.inset
			for f, c := range colors {
				at := image.Pt((f%tc.columns)*w+2-tc.inset, (f/tc.columns)*w+2-tc.inset)
				if got := img.NRGBAAt(at.X, at.Y); got != c {
					t.Errorf("frame %d at %v = %v, want %v", f, at, got, c)
				}
			}
		})
	}
}

func TestGridErrors(t *testing.T) {
	t.Parallel()
	s := strip(4, 4, 3, func(int, *image.NRGBA, image.Point) {})
	for _, tc := range []struct {
		name    string
		strip   Strip
		columns int
		inset   int
		want    error
	}{
		{name: "no columns", strip: s, columns: 0, want: ErrLayout},
		{name: "cropped away", strip: s, columns: 1, inset: 2, want: ErrLayout},
		{name: "uneven strip", strip: Strip{Image: s.Image, FrameWidth: 5, FrameHeight: 4}, columns: 1, want: ErrLayout},
		{name: "wrong height", strip: Strip{Image: s.Image, FrameWidth: 4, FrameHeight: 3}, columns: 1, want: ErrLayout},
		{
			name:    "too tall",
			strip:   strip(1, MaxSize, 2, func(int, *image.NRGBA, image.Point) {}),
			columns: 1,
			want:    ErrTooLarge,
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			if _, err := Grid(tc.strip, tc.columns, tc.inset); !errors.Is(err, tc.want) {
				t.Errorf("Grid() error = %v, want %v", err, tc.want)
			}
		})
	}
	uneven := Strip{Image: s.Image, FrameWidth: 5, FrameHeight: 4}
	if _, err := Inset(uneven); !errors.Is(err, ErrLayout) {
		t.Errorf("Inset() error = %v, want ErrLayout", err)
	}
	if _, _, err := Split(uneven); !errors.Is(err, ErrLayout) {
		t.Errorf("Split() error = %v, want ErrLayout", err)
	}
}

// paletted is s's image with an 8-bit palette, as some PNGs are saved.
func paletted(s Strip) *image.Paletted {
	p := image.NewPaletted(s.Image.Bounds(), color.Palette{color.NRGBA{}, red, green, blue})
	for y := range s.Image.Bounds().Dy() {
		for x := range s.Image.Bounds().Dx() {
			p.Set(x, y, s.Image.NRGBAAt(x, y))
		}
	}

	return p
}

// writeStrip saves img as a PNG in dir.
func writeStrip(t *testing.T, dir string, img image.Image) string {
	t.Helper()
	path := filepath.Join(dir, "strip.png")
	if err := WritePNG(path, img); err != nil {
		t.Fatalf("WritePNG() error = %v", err)
	}

	return path
}

// readPNG reads the PNG at path as one frame.
func readPNG(t *testing.T, path string) *image.NRGBA {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("reading %s: %v", path, err)
	}
	cfg, err := png.DecodeConfig(bytes.NewReader(data))
	if err != nil {
		t.Fatalf("decoding %s: %v", path, err)
	}
	s, err := ReadStrip(path, cfg.Width, cfg.Height)
	if err != nil {
		t.Fatalf("ReadStrip(%s) error = %v", path, err)
	}

	return s.Image
}

func TestSplitFile(t *testing.T) {
	t.Parallel()
	s := layer()
	for _, tc := range []struct {
		name string
		img  image.Image
	}{
		{name: "NRGBA", img: s.Image},
		{name: "paletted", img: paletted(s)},
	} {
		dir := t.TempDir()
		src := writeStrip(t, dir, tc.img)
		sheetPath, layoutPath := filepath.Join(dir, "sheet.png"), filepath.Join(dir, "sheet.json")
		if err := SplitFile(src, sheetPath, layoutPath, 40, 20); err != nil {
			t.Fatalf("SplitFile() error = %v", err)
		}
		data, err := os.ReadFile(layoutPath)
		if err != nil {
			t.Fatalf("reading the layout: %v", err)
		}
		var l Layout
		if err = json.Unmarshal(data, &l); err != nil {
			t.Fatalf("decoding the layout: %v", err)
		}
		sheet := readPNG(t, sheetPath)
		for f := range s.Frames() {
			if at, differ := diff(t, rebuild(sheet, l, f), frame(s, f)); differ {
				t.Errorf("%s: frame %d rebuilt from the files differs at %v", tc.name, f, at)
			}
		}
	}
}

func TestGridFile(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	s := strip(6, 6, 4, func(_ int, img *image.NRGBA, at image.Point) {
		img.SetNRGBA(at.X+1, at.Y+1, blue)
	})
	src := writeStrip(t, dir, s.Image)
	out := filepath.Join(dir, "grid.png")
	o := GridOptions{Src: src, Out: out, FrameWidth: 6, FrameHeight: 6, Columns: 2, Crop: true}
	if err := GridFile(o); err != nil {
		t.Fatalf("GridFile() error = %v", err)
	}
	if got, want := readPNG(t, out).Bounds().Size(), image.Pt(8, 8); got != want {
		t.Errorf("grid size = %v, want %v: 4 frames cropped to 4 px, 2 by 2", got, want)
	}
}

func TestFileErrors(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	missing := filepath.Join(dir, "missing.png")
	notPNG := filepath.Join(dir, "not.png")
	if err := os.WriteFile(notPNG, []byte("not a png"), 0o600); err != nil {
		t.Fatal(err)
	}
	good := writeStrip(t, dir, layer().Image)
	for _, tc := range []struct {
		name string
		err  error
	}{
		{name: "grid of a missing file", err: GridFile(GridOptions{Src: missing, FrameWidth: 1, FrameHeight: 1, Columns: 1})},
		{name: "grid of a non-PNG", err: GridFile(GridOptions{Src: notPNG, FrameWidth: 1, FrameHeight: 1, Columns: 1})},
		{name: "grid with no columns", err: GridFile(GridOptions{Src: good, FrameWidth: 40, FrameHeight: 20, Crop: true})},
		{name: "grid to a missing directory", err: GridFile(GridOptions{
			Src: good, Out: filepath.Join(missing, "x.png"), FrameWidth: 40, FrameHeight: 20, Columns: 1,
		})},
		{name: "split of a missing file", err: SplitFile(missing, "", "", 1, 1)},
		{name: "split with the wrong frame height", err: SplitFile(good, "", "", 40, 10)},
		{name: "split to a missing directory", err: SplitFile(good, filepath.Join(missing, "x.png"), "", 40, 20)},
		{name: "layout to a missing directory", err: SplitFile(
			good, filepath.Join(dir, "ok.png"), filepath.Join(missing, "x.json"), 40, 20,
		)},
	} {
		if tc.err == nil {
			t.Errorf("%s: no error", tc.name)
		}
	}
}
