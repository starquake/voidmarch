/**
 * A stars layer cut into pieces (#222): a still piece and the regions that
 * animate, packed in one sheet so no texture is over 4096 px. Drawing every
 * piece's frame at its place rebuilds the layer's frame exactly; the layout is
 * what cmd/cutsheets writes beside the sheet.
 */
export interface LayerLayout {
  /** The layer frame's size, and its animation's frame count. */
  width: number;
  height: number;
  frames: number;
  pieces: LayerPiece[];
}

/** A rectangle of the layer: one frame if still, the layer's frames side by side if animated. */
export interface LayerPiece {
  /** Where it goes on the layer's frame. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Its first frame in the sheet; the next ones follow to the right. */
  sheetX: number;
  sheetY: number;
  frames: number;
}

/** A frame of the sheet, named for the piece and its frame. */
export interface PieceFrame {
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A piece's frame drawn at its place on the layer. */
export interface Stamp {
  name: string;
  x: number;
  y: number;
}

const frameName = (piece: number, frame: number): string => `${String(piece)}/${String(frame)}`;

/** Every frame of every piece, where it is in the sheet. */
export function pieceFrames(layout: LayerLayout): PieceFrame[] {
  return layout.pieces.flatMap((p, i) =>
    Array.from({ length: p.frames }, (_, f) => ({ name: frameName(i, f), x: p.sheetX + f * p.width, y: p.sheetY, width: p.width, height: p.height })),
  );
}

/** What to draw for the layer's animation frame: each piece's frame at its place, a still piece's only frame. */
export function stamps(layout: LayerLayout, frame: number): Stamp[] {
  return layout.pieces.map((p, i) => ({ name: frameName(i, frame % p.frames), x: p.x, y: p.y }));
}
