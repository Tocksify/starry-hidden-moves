import type { Color } from "chess.js";
import type { PieceType } from "./chess-engine";

// Lichess cburnett SVG piece set — hotlink-safe CDN.
// https://github.com/lichess-org/lila/tree/master/public/piece/cburnett
export function pieceImage(type: PieceType, color: Color): string {
  const c = color === "w" ? "w" : "b";
  const t = type.toUpperCase();
  return `https://lichess1.org/assets/piece/cburnett/${c}${t}.svg`;
}
