import { useMemo, useState } from "react";
import { type Square, type Color } from "chess.js";
import {
  type BoardMap,
  type PieceType,
  FILES,
  sq,
  isInHomeRanks,
  canPlace,
  PIECE_GLYPH,
  PIECE_GLYPH_DARK,
} from "@/lib/chess-engine";
import { pieceImage } from "@/lib/pieces";

export type Marks = Partial<Record<Square, PieceType | null>>;

interface Props {
  board: BoardMap;
  playerColor: Color;
  phase: "setup" | "play" | "over";
  selectedPiece?: PieceType | null;
  onPlace?: (target: Square, piece: PieceType) => void;
  onPickup?: (from: Square) => void;
  legalTargets?: Square[];
  selectedSquare?: Square | null;
  onSquareClick?: (square: Square) => void;
  hideOpponent?: boolean;
  marks?: Marks;
  onMarkOpponent?: (square: Square) => void;
  lastMove?: { from: Square; to: Square } | null;
  inCheck?: Square | null;
}

const MARK_CYCLE: (PieceType | null)[] = [null, "q", "r", "b", "n", "p", "k"];

export function ChessBoard(props: Props) {
  const {
    board, playerColor, phase, selectedPiece, onPlace, onPickup,
    legalTargets = [], selectedSquare, onSquareClick,
    hideOpponent, marks = {}, onMarkOpponent, lastMove, inCheck,
  } = props;

  const ranks = playerColor === "w" ? [8, 7, 6, 5, 4, 3, 2, 1] : [1, 2, 3, 4, 5, 6, 7, 8];
  const files = playerColor === "w" ? [0, 1, 2, 3, 4, 5, 6, 7] : [7, 6, 5, 4, 3, 2, 1, 0];

  const [hoverSq, setHoverSq] = useState<Square | null>(null);

  const placementInvalid = useMemo(() => {
    if (phase !== "setup" || !selectedPiece || !hoverSq) return null;
    const check = canPlace(selectedPiece, hoverSq, playerColor, board);
    return check.ok ? null : check.reason;
  }, [phase, selectedPiece, hoverSq, playerColor, board]);

  const opponentColor: Color = playerColor === "w" ? "b" : "w";

  return (
    <div className="inline-block term-panel p-2 select-none">
      <div className="grid grid-cols-[auto_1fr] gap-1">
        <div />
        <div className="grid grid-cols-8 text-[10px] text-terminal-dim text-center">
          {files.map((f) => <div key={f}>{FILES[f]}</div>)}
        </div>
        <div className="grid grid-rows-8 text-[10px] text-terminal-dim items-center justify-items-center gap-0" style={{ width: "1.2rem" }}>
          {ranks.map((r) => <div key={r} className="h-14 flex items-center">{r}</div>)}
        </div>
        <div className="grid grid-cols-8 grid-rows-8 gap-0">
          {ranks.map((rank) =>
            files.map((file) => {
              const square = sq(file, rank);
              const p = board[square];
              const isLight = (file + rank) % 2 === 1;
              const isHome = isInHomeRanks(square, playerColor);
              const isSelected = selectedSquare === square;
              const isLegal = legalTargets.includes(square);
              const isLast = lastMove && (lastMove.from === square || lastMove.to === square);
              const isCheck = inCheck === square;

              const setupInvalidHover = phase === "setup" && selectedPiece && hoverSq === square && placementInvalid;
              const setupValidHover = phase === "setup" && selectedPiece && hoverSq === square && !placementInvalid;
              const setupTargetHint = phase === "setup" && selectedPiece && isHome;

              const handleContextMenu = (e: React.MouseEvent) => {
                e.preventDefault();
                if (!hideOpponent || !p || p.color === playerColor) return;
                onMarkOpponent?.(square);
              };

              const handleClick = () => {
                if (phase === "setup") {
                  if (selectedPiece) {
                    const chk = canPlace(selectedPiece, square, playerColor, board);
                    if (chk.ok) onPlace?.(square, selectedPiece);
                  } else if (p && p.color === playerColor) {
                    onPickup?.(square);
                  }
                } else if (phase === "play") {
                  onSquareClick?.(square);
                }
              };

              const bg = isLight ? "bg-square-light" : "bg-square-dark";
              const opponentPiece = p && p.color !== playerColor;
              const showAsStar = hideOpponent && opponentPiece;
              const mark = marks[square];

              let content: React.ReactNode = null;
              if (p) {
                if (showAsStar) {
                  if (mark) {
                    // Guessed piece — render as a red-tinted opponent piece image.
                    content = (
                      <div className="relative w-full h-full flex items-center justify-center">
                        <img
                          src={pieceImage(mark, opponentColor)}
                          alt=""
                          draggable={false}
                          className="w-[82%] h-[82%]"
                          style={{ filter: "drop-shadow(0 0 4px var(--color-danger)) brightness(0.9) sepia(1) saturate(6) hue-rotate(-30deg)" }}
                        />
                        <span className="absolute bottom-0 right-0.5 text-[9px] text-danger font-bold">?</span>
                      </div>
                    );
                  } else {
                    content = (
                      <span className="text-terminal text-3xl" style={{ textShadow: "0 0 8px var(--color-terminal)" }}>★</span>
                    );
                  }
                } else {
                  content = (
                    <img
                      src={pieceImage(p.type, p.color)}
                      alt=""
                      draggable={false}
                      className="w-[82%] h-[82%]"
                      style={{ filter: p.color === "w"
                        ? "drop-shadow(0 0 3px var(--color-terminal-bright))"
                        : "drop-shadow(0 0 3px var(--color-terminal-dim)) brightness(0.95)" }}
                    />
                  );
                }
              }

              return (
                <button
                  key={square}
                  type="button"
                  onClick={handleClick}
                  onContextMenu={handleContextMenu}
                  onMouseEnter={() => setHoverSq(square)}
                  onMouseLeave={() => setHoverSq((s) => s === square ? null : s)}
                  className={[
                    "relative w-14 h-14 flex items-center justify-center font-mono transition-colors",
                    bg,
                    isSelected && "outline outline-2 outline-terminal-bright z-10",
                    isLegal && "after:absolute after:inset-2 after:rounded-full after:bg-terminal/30 after:pointer-events-none",
                    isLast && "ring-1 ring-terminal/60",
                    isCheck && "ring-2 ring-danger",
                    setupTargetHint && !p && "outline outline-1 outline-terminal-dim/40",
                    setupInvalidHover && "outline outline-2 outline-danger",
                    setupValidHover && !p && "outline outline-2 outline-terminal-bright",
                  ].filter(Boolean).join(" ")}
                >
                  {content}
                </button>
              );
            }),
          )}
        </div>
      </div>
      {phase === "setup" && placementInvalid && (
        <div className="mt-2 text-xs text-danger px-1">! {placementInvalid}</div>
      )}
    </div>
  );
}

export function nextMark(current: PieceType | null | undefined): PieceType | null {
  const i = MARK_CYCLE.indexOf(current ?? null);
  const next = MARK_CYCLE[(i + 1) % MARK_CYCLE.length];
  return next;
}

export { PIECE_GLYPH, PIECE_GLYPH_DARK };
