import { createFileRoute, Link } from "@tanstack/react-router";
import { z } from "zod";
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { Chess, type Move, type Square, type Color } from "chess.js";
import {
  type BoardMap,
  type PieceType,
  STANDARD_ARMY,
  randomSetup,
  remainingPieces,
  isSetupComplete,
  buildGame,
  boardFromChess,
  glyph,
  PIECE_GLYPH,
  PIECE_GLYPH_DARK,
} from "@/lib/chess-engine";
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

  // Play phase state
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

  const remain = useMemo(() => remainingPieces(playerBoard, playerColor), [playerBoard, playerColor]);
  const setupDone = isSetupComplete(playerBoard, playerColor);

  // Setup timer
  useEffect(() => {
    if (phase !== "setup") return;
    const id = setInterval(() => {
      setSetupTimeLeft((t) => {
        if (t <= 1) return 0;
        return t - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [phase]);

  // Start game when: both ready OR time up (and player must have valid setup; else auto-fill)
  useEffect(() => {
    if (phase !== "setup") return;
    const timeUp = setupTimeLeft <= 0;
    const bothReady = playerReady; // AI is always ready
    if (!(timeUp || bothReady)) return;

    // Ensure valid player setup — if incomplete on timeout, auto-fill remaining.
    let finalPlayer = playerBoard;
    if (!isSetupComplete(finalPlayer, playerColor)) {
      // Fill missing pieces at random valid squares.
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
      const pieceOrder: PieceType[] = ["k", "q", "r", "b", "n", "p"];
      for (const t of pieceOrder) {
        while (rem[t] > 0 && emptySquares.length) {
          if (t === "k") {
            // find back rank square
            const idx = emptySquares.findIndex((s) => Number(s[1]) === backRank);
            if (idx === -1) break;
            const [sq] = emptySquares.splice(idx, 1);
            filled[sq] = { type: "k", color: playerColor };
          } else {
            const [sq] = emptySquares.splice(0, 1);
            filled[sq] = { type: t, color: playerColor };
          }
          rem[t] -= 1;
        }
      }
      finalPlayer = filled;
    }

    // Build combined chess game.
    const chess = buildGame(
      playerColor === "w" ? finalPlayer : aiBoard,
      playerColor === "w" ? aiBoard : finalPlayer,
    );
    chessRef.current = chess;
    setBoard(boardFromChess(chess));
    setTurn(chess.turn());
    setPhase("play");
  }, [playerReady, setupTimeLeft, phase, playerBoard, playerColor, aiBoard]);

  // Play-phase clock
  useEffect(() => {
    if (phase !== "play" || result || initial === 0) return;
    const start = Date.now();
    const id = setInterval(() => {
      const elapsed = Date.now() - start;
      if (turn === "w") {
        setClockW((c) => Math.max(0, c - 100));
      } else {
        setClockB((c) => Math.max(0, c - 100));
      }
      // check flag
      if ((turn === "w" ? clockW : clockB) - 100 <= 0) {
        setResult(`${turn === "w" ? "Black" : "White"} wins on time`);
      }
      void elapsed;
    }, 100);
    return () => clearInterval(id);
  }, [turn, phase, result, initial, clockW, clockB]);

  const applyMove = useCallback((m: Move) => {
    const chess = chessRef.current!;
    setBoard(boardFromChess(chess));
    setLastMove({ from: m.from as Square, to: m.to as Square });
    setSelectedSquare(null);
    setLegalTargets([]);
    // Increment clock for the side that just moved.
    if (inc > 0) {
      if (m.color === "w") setClockW((c) => c + inc * 1000);
      else setClockB((c) => c + inc * 1000);
    }
    setTurn(chess.turn());
    if (chess.isGameOver()) {
      if (chess.isCheckmate()) setResult(`${chess.turn() === "w" ? "Black" : "White"} wins by checkmate`);
      else if (chess.isStalemate()) setResult("Draw — stalemate");
      else if (chess.isDraw()) setResult("Draw");
    }
  }, [inc]);

  // AI turn
  useEffect(() => {
    if (phase !== "play" || result) return;
    if (turn !== aiColor) return;
    setAiThinking(true);
    const t = setTimeout(() => {
      const chess = chessRef.current!;
      const move = pickAiMove(chess, difficulty);
      if (move) {
        chess.move(move);
        applyMove(move);
      }
      setAiThinking(false);
    }, 300);
    return () => clearTimeout(t);
  }, [turn, aiColor, phase, difficulty, applyMove, result]);

  // ==== Handlers ====

  const handleSetupPlace = (target: Square, piece: PieceType) => {
    if (remain[piece] <= 0) return;
    setPlayerBoard((b) => ({ ...b, [target]: { type: piece, color: playerColor } }));
    // Auto-clear selection if we used the last one.
    if (remain[piece] - 1 <= 0) setSelectedPiece(null);
  };

  const handleSetupPickup = (from: Square) => {
    setPlayerBoard((b) => {
      const copy = { ...b };
      delete copy[from];
      return copy;
    });
  };

  const handleSquareClick = (square: Square) => {
    if (phase !== "play" || result || turn !== playerColor || aiThinking) return;
    const chess = chessRef.current!;
    const piece = chess.get(square);
    if (selectedSquare) {
      // try move
      const moves = chess.moves({ square: selectedSquare, verbose: true }) as Move[];
      const target = moves.find((m) => m.to === square);
      if (target) {
        chess.move(target);
        applyMove(target);
        return;
      }
      // re-select if own piece
      if (piece && piece.color === playerColor) {
        setSelectedSquare(square);
        const nm = chess.moves({ square, verbose: true }) as Move[];
        setLegalTargets(nm.map((m) => m.to as Square));
        return;
      }
      setSelectedSquare(null);
      setLegalTargets([]);
    } else {
      if (piece && piece.color === playerColor) {
        setSelectedSquare(square);
        const nm = chess.moves({ square, verbose: true }) as Move[];
        setLegalTargets(nm.map((m) => m.to as Square));
      }
    }
  };

  const handleMarkOpponent = (square: Square) => {
    setMarks((m) => ({ ...m, [square]: nextMark(m[square]) }));
  };

  const handleResign = () => {
    setResult(`${playerColor === "w" ? "Black" : "White"} wins by resignation`);
  };

  const displayBoard = phase === "setup" ? playerBoard : board;
  const inCheck = phase === "play" && chessRef.current?.inCheck()
    ? (() => {
        // find king of side to move
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
              result={result || (phase === "play" ? null : "Game over")}
              onResign={handleResign}
              onNewGame={() => window.location.assign("/")}
            />
          )}
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
  const glyphs = playerColor === "w" ? PIECE_GLYPH : PIECE_GLYPH_DARK;
  const order: PieceType[] = ["k", "q", "r", "b", "n", "p"];
  const names: Record<PieceType, string> = { k: "king", q: "queen", r: "rook", b: "bishop", n: "knight", p: "pawn" };

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
                "border p-2 text-center transition-colors",
                active ? "border-terminal-bright bg-terminal/20 text-terminal-bright" : "border-border text-terminal",
                disabled && "opacity-30 cursor-not-allowed",
                !disabled && !active && "hover:border-terminal",
              ].filter(Boolean).join(" ")}
            >
              <div className="text-3xl leading-none">{glyphs[p]}</div>
              <div className="text-[10px] uppercase text-terminal-dim mt-1">{names[p]} ×{remain[p]}</div>
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
    // show tenths
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
          right-click an enemy ★ to mark your guess (cycles through Q R B N P K).
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
