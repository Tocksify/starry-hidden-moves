import { createFileRoute, Link } from "@tanstack/react-router";
import { z } from "zod";
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { Chess, type Move, type Square, type Color } from "chess.js";
import {
  type BoardMap,
  type PieceType,
  randomSetup,
  remainingPieces,
  isSetupComplete,
  buildGame,
  boardFromChess,
} from "@/lib/chess-engine";
import { pieceImage } from "@/lib/pieces";
import { sfx } from "@/lib/sounds";
import { pickAiMove, DIFFICULTY_LABELS, type Difficulty } from "@/lib/chess-ai";
import { ChessBoard, nextMark, type Marks } from "@/components/ChessBoard";

const searchSchema = z.object({
  d: z.coerce.number().min(1).max(5).default(3),
  i: z.coerce.number().min(0).default(300),
  inc: z.coerce.number().min(0).default(0),
  c: z.enum(["w", "b"]).default("w"),
  tc: z.string().default("5+0 Blitz"),
});

export const Route = createFileRoute("/play")({
  validateSearch: searchSchema,
  head: () => ({ meta: [{ title: "fog.chess — game" }] }),
  component: PlayPage,
});

type Phase = "setup" | "play" | "over";
const SETUP_SECONDS = 30;
const PIECE_NAMES: Record<PieceType, string> = { k: "king", q: "queen", r: "rook", b: "bishop", n: "knight", p: "pawn" };
const PROMOTION_CHOICES: PieceType[] = ["q", "r", "b", "n"];

function PlayPage() {
  const { d, i: initial, inc, c: playerColor, tc } = Route.useSearch();
  const difficulty = d as Difficulty;
  const aiColor: Color = playerColor === "w" ? "b" : "w";

  const [phase, setPhase] = useState<Phase>("setup");
  const [playerBoard, setPlayerBoard] = useState<BoardMap>({});
  const [aiBoard] = useState<BoardMap>(() => randomSetup(aiColor));
  const [selectedPiece, setSelectedPiece] = useState<PieceType | null>(null);
  const [playerReady, setPlayerReady] = useState(false);
  const [setupTimeLeft, setSetupTimeLeft] = useState(SETUP_SECONDS);

  const chessRef = useRef<Chess | null>(null);
  const [board, setBoard] = useState<BoardMap>({});
  const [turn, setTurn] = useState<Color>("w");
  const [selectedSquare, setSelectedSquare] = useState<Square | null>(null);
  const [legalTargets, setLegalTargets] = useState<Square[]>([]);
  const [lastMove, setLastMove] = useState<{ from: Square; to: Square } | null>(null);
  const [marks, setMarks] = useState<Marks>({});
  const [clockW, setClockW] = useState(initial * 1000);
  const [clockB, setClockB] = useState(initial * 1000);
  const [result, setResult] = useState<string | null>(null);
  const [aiThinking, setAiThinking] = useState(false);
  const [myCaptures, setMyCaptures] = useState<PieceType[]>([]);
  const [oppCaptures, setOppCaptures] = useState<PieceType[]>([]);
  const [promotion, setPromotion] = useState<{ from: Square; to: Square } | null>(null);

  const remain = useMemo(() => remainingPieces(playerBoard, playerColor), [playerBoard, playerColor]);
  const setupDone = isSetupComplete(playerBoard, playerColor);

  useEffect(() => {
    if (phase !== "setup") return;
    const id = setInterval(() => setSetupTimeLeft((t) => Math.max(0, t - 1)), 1000);
    return () => clearInterval(id);
  }, [phase]);

  useEffect(() => {
    if (phase !== "setup") return;
    if (!(setupTimeLeft <= 0 || playerReady)) return;

    let finalPlayer = playerBoard;
    if (!isSetupComplete(finalPlayer, playerColor)) {
      const filled = { ...finalPlayer };
      const rem = { ...remainingPieces(filled, playerColor) };
      const allHomeRanks = playerColor === "w" ? [1, 2] : [7, 8];
      const backRank = playerColor === "w" ? 1 : 8;
      const emptySquares: Square[] = [];
      for (const rank of allHomeRanks) {
        for (let f = 0; f < 8; f++) {
          const s = `${"abcdefgh"[f]}${rank}` as Square;
          if (!filled[s]) emptySquares.push(s);
        }
      }
      emptySquares.sort(() => Math.random() - 0.5);
      const order: PieceType[] = ["k", "q", "r", "b", "n", "p"];
      for (const t of order) {
        while (rem[t] > 0 && emptySquares.length) {
          if (t === "k") {
            const idx = emptySquares.findIndex((s) => Number(s[1]) === backRank);
            if (idx === -1) break;
            const [sq0] = emptySquares.splice(idx, 1);
            filled[sq0] = { type: "k", color: playerColor };
          } else {
            const [sq0] = emptySquares.splice(0, 1);
            filled[sq0] = { type: t, color: playerColor };
          }
          rem[t] -= 1;
        }
      }
      finalPlayer = filled;
    }

    const chess = buildGame(
      playerColor === "w" ? finalPlayer : aiBoard,
      playerColor === "w" ? aiBoard : finalPlayer,
    );
    chessRef.current = chess;
    setBoard(boardFromChess(chess));
    setTurn(chess.turn());
    setPhase("play");
    sfx.ready();
  }, [playerReady, setupTimeLeft, phase, playerBoard, playerColor, aiBoard]);

  useEffect(() => {
    if (phase !== "play" || result || initial === 0) return;
    const id = setInterval(() => {
      if (turn === "w") setClockW((c) => Math.max(0, c - 100));
      else setClockB((c) => Math.max(0, c - 100));
      if ((turn === "w" ? clockW : clockB) - 100 <= 0) {
        setResult(`${turn === "w" ? "Black" : "White"} wins on time`);
        sfx.gameEnd();
      }
    }, 100);
    return () => clearInterval(id);
  }, [turn, phase, result, initial, clockW, clockB]);

  const applyMove = useCallback((m: Move) => {
    const chess = chessRef.current!;
    setBoard(boardFromChess(chess));
    const from = m.from as Square;
    const to = m.to as Square;
    setLastMove({ from, to });
    setSelectedSquare(null);
    setLegalTargets([]);

    // Migrate marks: if the moving piece was ours-guessed at `from`, carry the guess to `to`.
    // If a piece we had guessed was captured at `to`, drop that guess.
    setMarks((prev) => {
      const next: Marks = { ...prev };
      const movedMark = next[from];
      // Remove mark on captured square (will be overwritten if we carry one).
      if (m.captured) delete next[to];
      if (movedMark !== undefined) {
        delete next[from];
        // Promotion: if the guess was a pawn and it promoted, update guess to promoted piece.
        if (m.promotion && movedMark === "p") next[to] = m.promotion as PieceType;
        else if (movedMark) next[to] = movedMark;
      }
      return next;
    });

    // Captures list
    if (m.captured) {
      const captured = m.captured as PieceType;
      if (m.color === playerColor) setOppCaptures((c) => [...c, captured]);
      else setMyCaptures((c) => [...c, captured]);
      sfx.capture();
    } else {
      if (m.color === playerColor) sfx.move(); else sfx.moveOpp();
    }

    if (inc > 0) {
      if (m.color === "w") setClockW((c) => c + inc * 1000);
      else setClockB((c) => c + inc * 1000);
    }
    setTurn(chess.turn());

    if (chess.inCheck() && !chess.isGameOver()) sfx.check();

    if (chess.isGameOver()) {
      if (chess.isCheckmate()) setResult(`${chess.turn() === "w" ? "Black" : "White"} wins by checkmate`);
      else if (chess.isStalemate()) setResult("Draw — stalemate");
      else if (chess.isDraw()) setResult("Draw");
      sfx.gameEnd();
    }
  }, [inc, playerColor]);

  useEffect(() => {
    if (phase !== "play" || result) return;
    if (turn !== aiColor) return;
    setAiThinking(true);
    const t = setTimeout(() => {
      const chess = chessRef.current!;
      const move = pickAiMove(chess, difficulty);
      if (move) {
        const applied = chess.move(move);
        if (applied) applyMove(applied);
      }
      setAiThinking(false);
    }, 300);
    return () => clearTimeout(t);
  }, [turn, aiColor, phase, difficulty, applyMove, result]);

  const handleSetupPlace = (target: Square, piece: PieceType) => {
    if (remain[piece] <= 0) return;
    setPlayerBoard((b) => ({ ...b, [target]: { type: piece, color: playerColor } }));
    if (remain[piece] - 1 <= 0) setSelectedPiece(null);
  };

  const handleSetupPickup = (from: Square) => {
    setPlayerBoard((b) => { const c = { ...b }; delete c[from]; return c; });
  };

  const tryMove = (from: Square, to: Square, promotionChoice?: PieceType) => {
    const chess = chessRef.current!;
    const moves = chess.moves({ square: from, verbose: true }) as Move[];
    const candidates = moves.filter((m) => m.to === to);
    if (!candidates.length) return false;
    // Promotion?
    if (candidates.some((m) => m.promotion) && !promotionChoice) {
      setPromotion({ from, to });
      return true;
    }
    const chosen = promotionChoice
      ? candidates.find((m) => m.promotion === promotionChoice) ?? candidates[0]
      : candidates[0];
    const applied = chess.move(chosen);
    if (applied) applyMove(applied);
    return true;
  };

  const handleSquareClick = (square: Square) => {
    if (phase !== "play" || result || turn !== playerColor || aiThinking || promotion) return;
    const chess = chessRef.current!;
    const piece = chess.get(square);
    if (selectedSquare) {
      if (tryMove(selectedSquare, square)) return;
      if (piece && piece.color === playerColor) {
        setSelectedSquare(square);
        const nm = chess.moves({ square, verbose: true }) as Move[];
        setLegalTargets(Array.from(new Set(nm.map((m) => m.to as Square))));
        return;
      }
      setSelectedSquare(null);
      setLegalTargets([]);
    } else if (piece && piece.color === playerColor) {
      setSelectedSquare(square);
      const nm = chess.moves({ square, verbose: true }) as Move[];
      setLegalTargets(Array.from(new Set(nm.map((m) => m.to as Square))));
    }
  };

  const handleMarkOpponent = (square: Square) => {
    setMarks((m) => ({ ...m, [square]: nextMark(m[square]) }));
  };

  const handleResign = () => {
    setResult(`${playerColor === "w" ? "Black" : "White"} wins by resignation`);
    sfx.gameEnd();
  };

  const displayBoard = phase === "setup" ? playerBoard : board;
  const inCheck = phase === "play" && chessRef.current?.inCheck()
    ? (() => {
        const b = chessRef.current!.board();
        for (const row of b) for (const cell of row) if (cell && cell.type === "k" && cell.color === turn) return cell.square as Square;
        return null;
      })()
    : null;

  return (
    <div className="min-h-screen p-4 md:p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-4 text-xs text-terminal-dim">
        <Link to="/" className="hover:text-terminal-bright">← back</Link>
        <div>{tc} · vs {DIFFICULTY_LABELS[difficulty]} AI · playing {playerColor === "w" ? "white" : "black"}</div>
      </div>

      <div className="grid md:grid-cols-[auto_1fr] gap-6 items-start">
        <div className="space-y-2">
          <CaptureRow label="opp lost" pieces={oppCaptures} color={aiColor} />
          <ChessBoard
            board={displayBoard}
            playerColor={playerColor}
            phase={phase === "over" ? "over" : phase}
            selectedPiece={selectedPiece}
            onPlace={handleSetupPlace}
            onPickup={handleSetupPickup}
            selectedSquare={selectedSquare}
            legalTargets={legalTargets}
            onSquareClick={handleSquareClick}
            hideOpponent={phase !== "setup"}
            marks={marks}
            onMarkOpponent={handleMarkOpponent}
            lastMove={lastMove}
            inCheck={inCheck}
          />
          <CaptureRow label="you lost" pieces={myCaptures} color={playerColor} />
        </div>

        <div className="space-y-4 min-w-[280px]">
          {phase === "setup" ? (
            <SetupPanel
              remain={remain}
              selectedPiece={selectedPiece}
              onSelect={setSelectedPiece}
              playerColor={playerColor}
              timeLeft={setupTimeLeft}
              ready={playerReady}
              onReady={() => setPlayerReady(true)}
              canReady={setupDone}
            />
          ) : (
            <PlayPanel
              turn={turn}
              playerColor={playerColor}
              clockW={clockW}
              clockB={clockB}
              hasClock={initial > 0}
              aiThinking={aiThinking}
              result={result}
              onResign={handleResign}
              onNewGame={() => window.location.assign("/")}
            />
          )}
        </div>
      </div>

      {promotion && (
        <PromotionModal
          color={playerColor}
          onPick={(p) => {
            const { from, to } = promotion;
            setPromotion(null);
            tryMove(from, to, p);
          }}
        />
      )}
    </div>
  );
}

function CaptureRow({ label, pieces, color }: { label: string; pieces: PieceType[]; color: Color }) {
  return (
    <div className="flex items-center gap-2 text-xs text-terminal-dim min-h-[28px] px-1">
      <span className="uppercase tracking-widest w-16">{label}</span>
      <div className="flex flex-wrap gap-0.5">
        {pieces.length === 0 && <span className="text-terminal-dim/50">—</span>}
        {pieces.map((p, i) => (
          <img key={i} src={pieceImage(p, color)} alt={p} className="w-5 h-5" draggable={false} style={{ opacity: 0.85 }} />
        ))}
      </div>
    </div>
  );
}

function PromotionModal({ color, onPick }: { color: Color; onPick: (p: PieceType) => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
      <div className="term-panel p-4">
        <div className="text-terminal-bright uppercase tracking-widest text-xs mb-3 text-center">// promote to</div>
        <div className="flex gap-2">
          {PROMOTION_CHOICES.map((p) => (
            <button
              key={p}
              onClick={() => onPick(p)}
              className="w-16 h-16 border border-terminal hover:border-terminal-bright hover:bg-terminal/10 flex items-center justify-center"
            >
              <img src={pieceImage(p, color)} alt={p} className="w-12 h-12" draggable={false} />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function SetupPanel({
  remain, selectedPiece, onSelect, playerColor, timeLeft, ready, onReady, canReady,
}: {
  remain: Record<PieceType, number>;
  selectedPiece: PieceType | null;
  onSelect: (p: PieceType | null) => void;
  playerColor: Color;
  timeLeft: number;
  ready: boolean;
  onReady: () => void;
  canReady: boolean;
}) {
  const order: PieceType[] = ["k", "q", "r", "b", "n", "p"];

  return (
    <div className="term-panel p-4">
      <div className="flex items-baseline justify-between mb-3">
        <div className="text-terminal-bright uppercase tracking-widest text-xs">// setup</div>
        <div className="text-terminal-bright text-2xl font-bold" style={{ textShadow: "0 0 10px var(--color-terminal)" }}>
          {String(Math.floor(timeLeft / 60)).padStart(2, "0")}:{String(timeLeft % 60).padStart(2, "0")}
        </div>
      </div>
      <p className="text-xs text-terminal-dim mb-3">
        Pick a piece then click a square in your two home ranks. Click a placed piece to pick it back up.
        {" "}King must stay on the back rank.
      </p>
      <div className="grid grid-cols-3 gap-2 mb-4">
        {order.map((p) => {
          const disabled = remain[p] <= 0;
          const active = selectedPiece === p;
          return (
            <button
              key={p}
              disabled={disabled}
              onClick={() => onSelect(active ? null : p)}
              className={[
                "border p-2 text-center transition-colors flex flex-col items-center",
                active ? "border-terminal-bright bg-terminal/20" : "border-border",
                disabled && "opacity-30 cursor-not-allowed",
                !disabled && !active && "hover:border-terminal",
              ].filter(Boolean).join(" ")}
            >
              <img src={pieceImage(p, playerColor)} alt={p} className="w-10 h-10" draggable={false} />
              <div className="text-[10px] uppercase text-terminal-dim mt-1">{PIECE_NAMES[p]} ×{remain[p]}</div>
            </button>
          );
        })}
      </div>
      {!canReady && (
        <div className="text-[11px] text-terminal-dim mb-2">→ place all 16 pieces to ready up</div>
      )}
      <button
        onClick={onReady}
        disabled={ready}
        className={[
          "w-full py-3 border-2 uppercase tracking-widest font-bold transition-colors",
          ready ? "border-terminal-dim text-terminal-dim" : "border-terminal-bright text-terminal-bright bg-terminal/10 hover:bg-terminal hover:text-background",
        ].join(" ")}
        style={!ready ? { boxShadow: "0 0 16px var(--color-terminal)" } : undefined}
      >
        {ready ? "✓ ready — waiting…" : canReady ? "▶ ready" : "▶ ready (auto-fill)"}
      </button>
    </div>
  );
}

function fmtClock(ms: number) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  if (ms < 20000) {
    const tenths = Math.max(0, Math.floor((ms % 1000) / 100));
    return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}.${tenths}`;
  }
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

function PlayPanel({
  turn, playerColor, clockW, clockB, hasClock, aiThinking, result, onResign, onNewGame,
}: {
  turn: Color; playerColor: Color; clockW: number; clockB: number; hasClock: boolean;
  aiThinking: boolean; result: string | null; onResign: () => void; onNewGame: () => void;
}) {
  const isMyTurn = turn === playerColor;
  return (
    <div className="space-y-3">
      <div className="term-panel p-4">
        <div className="text-terminal-bright uppercase tracking-widest text-xs mb-3">// clocks</div>
        <div className="space-y-2">
          <ClockRow label={playerColor === "b" ? "you (b)" : "opp (b)"} ms={clockB} active={turn === "b"} hasClock={hasClock} />
          <ClockRow label={playerColor === "w" ? "you (w)" : "opp (w)"} ms={clockW} active={turn === "w"} hasClock={hasClock} />
        </div>
      </div>

      <div className="term-panel p-4">
        <div className="text-terminal-bright uppercase tracking-widest text-xs mb-2">// status</div>
        {result ? (
          <div className="text-danger font-bold">{result}</div>
        ) : (
          <div className="text-terminal">
            {isMyTurn ? "> your move" : aiThinking ? "> AI thinking…" : "> waiting"}
          </div>
        )}
        <div className="text-xs text-terminal-dim mt-2">
          right-click an enemy ★ to mark your guess (red = your guess).
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <button onClick={onResign} disabled={!!result} className="border border-danger text-danger py-2 uppercase text-xs hover:bg-danger/10 disabled:opacity-30">
          resign
        </button>
        <button onClick={onNewGame} className="border border-terminal text-terminal py-2 uppercase text-xs hover:bg-terminal/10">
          new game
        </button>
      </div>
    </div>
  );
}

function ClockRow({ label, ms, active, hasClock }: { label: string; ms: number; active: boolean; hasClock: boolean }) {
  return (
    <div className={`flex items-center justify-between border px-3 py-2 ${active ? "border-terminal-bright bg-terminal/10" : "border-border"}`}>
      <span className="text-xs uppercase text-terminal-dim">{label}</span>
      <span className={`font-bold text-xl tabular-nums ${active ? "text-terminal-bright" : "text-terminal"}`} style={active ? { textShadow: "0 0 8px var(--color-terminal)" } : undefined}>
        {hasClock ? fmtClock(ms) : "--:--"}
      </span>
    </div>
  );
}
