import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { ChessBoard, nextMark, type Marks } from "@/components/ChessBoard";
import { pieceImage } from "@/lib/pieces";
import { sfx } from "@/lib/sounds";
import {
  type BoardMap, type PieceType,
  remainingPieces, isSetupComplete,
} from "@/lib/chess-engine";
import type { Square, Color } from "chess.js";
import { getGameView, submitSetup, tickSetup, makeMove, resignGame } from "@/lib/online.functions";

export const Route = createFileRoute("/_authenticated/online/$gameId")({
  head: () => ({ meta: [{ title: "fog.chess — online" }] }),
  component: OnlineGame,
});

const PIECE_NAMES: Record<PieceType, string> = { k: "king", q: "queen", r: "rook", b: "bishop", n: "knight", p: "pawn" };
const PROMO: PieceType[] = ["q", "r", "b", "n"];

function OnlineGame() {
  const { gameId } = Route.useParams();
  const { userId } = useAuth();
  const qc = useQueryClient();

  const getViewFn = useServerFn(getGameView);
  const submitSetupFn = useServerFn(submitSetup);
  const tickSetupFn = useServerFn(tickSetup);
  const makeMoveFn = useServerFn(makeMove);
  const resignFn = useServerFn(resignGame);

  const viewQ = useQuery({
    queryKey: ["gameView", gameId],
    enabled: !!userId,
    queryFn: async () => await getViewFn({ data: { gameId } }),
    refetchOnWindowFocus: false,
  });

  // Realtime invalidate on any game / setup / move change
  useEffect(() => {
    if (!userId) return;
    const ch = supabase.channel(`game:${gameId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "games", filter: `id=eq.${gameId}` }, () => qc.invalidateQueries({ queryKey: ["gameView", gameId] }))
      .on("postgres_changes", { event: "*", schema: "public", table: "game_setups", filter: `game_id=eq.${gameId}` }, () => qc.invalidateQueries({ queryKey: ["gameView", gameId] }))
      .on("postgres_changes", { event: "*", schema: "public", table: "game_moves", filter: `game_id=eq.${gameId}` }, () => {
        qc.invalidateQueries({ queryKey: ["gameView", gameId] });
        qc.invalidateQueries({ queryKey: ["moves", gameId] });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [userId, gameId, qc]);

  const movesQ = useQuery({
    queryKey: ["moves", gameId],
    enabled: !!userId,
    queryFn: async () => {
      const { data } = await supabase.from("game_moves").select("*").eq("game_id", gameId).order("ply");
      return data ?? [];
    },
  });

  const [setupBoard, setSetupBoard] = useState<BoardMap>({});
  const [selectedPiece, setSelectedPiece] = useState<PieceType | null>(null);
  const [ready, setReady] = useState(false);
  const [selectedSquare, setSelectedSquare] = useState<Square | null>(null);
  const [marks, setMarks] = useState<Marks>({});
  const [promotion, setPromotion] = useState<{ from: Square; to: Square } | null>(null);
  const [tick, setTick] = useState(0);
  const lastPlyRef = useRef<number>(0);

  // Play sfx on new opponent move
  useEffect(() => {
    if (!movesQ.data || !viewQ.data) return;
    const ply = movesQ.data.length;
    if (ply > lastPlyRef.current && lastPlyRef.current !== 0) {
      const last = movesQ.data[ply - 1];
      if (last.color !== viewQ.data.myColor) {
        if (last.captured) sfx.capture(); else sfx.moveOpp();
        if (last.is_check) setTimeout(() => sfx.check(), 60);
      }
      // Migrate marks
      setMarks((prev) => {
        const next: Marks = { ...prev };
        const from = last.from_sq as Square;
        const to = last.to_sq as Square;
        const m = next[from];
        if (last.captured) delete next[to];
        if (m !== undefined) {
          delete next[from];
          if (last.promotion) next[to] = last.promotion as PieceType;
          else if (m) next[to] = m;
        }
        return next;
      });
    }
    lastPlyRef.current = ply;
  }, [movesQ.data, viewQ.data]);

  // Sync my own setup from server if present
  useEffect(() => {
    if (!viewQ.data || !userId) return;
    if (viewQ.data.game.status !== "setup") return;
    supabase.from("game_setups").select("*").eq("game_id", gameId).eq("player_id", userId).maybeSingle()
      .then(({ data }) => {
        if (data?.board && Object.keys(setupBoard).length === 0) {
          setSetupBoard(data.board as BoardMap);
          setReady(!!data.ready);
        }
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewQ.data?.game.status, userId, gameId]);

  // Setup timer tick + auto-tickSetup when deadline passes
  useEffect(() => {
    if (viewQ.data?.game.status !== "setup") return;
    const id = setInterval(() => setTick((t) => t + 1), 500);
    return () => clearInterval(id);
  }, [viewQ.data?.game.status]);
  useEffect(() => {
    const g = viewQ.data?.game;
    if (!g || g.status !== "setup" || !g.setup_deadline) return;
    if (new Date(g.setup_deadline).getTime() < Date.now()) {
      tickSetupFn({ data: { gameId } }).catch(() => {});
    }
  }, [tick, viewQ.data, tickSetupFn, gameId]);

  // Play-phase clock re-render
  useEffect(() => {
    if (viewQ.data?.game.status !== "playing") return;
    const id = setInterval(() => setTick((t) => t + 1), 100);
    return () => clearInterval(id);
  }, [viewQ.data?.game.status]);

  if (viewQ.isLoading || !viewQ.data) return <div className="p-6 text-terminal-dim">{'>'} loading game…</div>;
  if (viewQ.isError) return <div className="p-6 text-danger">! {(viewQ.error as Error).message}</div>;

  const view = viewQ.data;
  const g = view.game;
  const myColor = view.myColor as Color;
  const oppColor: Color = myColor === "w" ? "b" : "w";
  const oppProfile = myColor === "w" ? view.black : view.white;

  // Build display board:
  // - during setup: my local setup + no opponent
  // - during play: my pieces from view.myBoard, opponent as ★ on opponent squares
  let displayBoard: BoardMap = {};
  if (g.status === "setup") {
    displayBoard = setupBoard;
  } else {
    displayBoard = { ...view.myBoard };
    for (const s of view.oppSquares) {
      displayBoard[s as Square] = { type: "p", color: oppColor }; // type is fake; will render as ★
    }
  }

  const rem = remainingPieces(setupBoard, myColor);
  const setupDone = isSetupComplete(setupBoard, myColor);

  const setupSecondsLeft = g.setup_deadline
    ? Math.max(0, Math.ceil((new Date(g.setup_deadline).getTime() - Date.now()) / 1000))
    : 0;

  const clockW = liveClock(g, "w");
  const clockB = liveClock(g, "b");

  const legalTargets: Square[] = selectedSquare ? ((view.legal?.[selectedSquare as string] ?? []) as Square[]) : [];

  const handleSetupPlace = (target: Square, piece: PieceType) => {
    if (rem[piece] <= 0) return;
    setSetupBoard((b) => ({ ...b, [target]: { type: piece, color: myColor } }));
  };
  const handleSetupPickup = (from: Square) => {
    setSetupBoard((b) => { const c = { ...b }; delete c[from]; return c; });
  };
  const submit = async (readyFlag: boolean) => {
    try {
      await submitSetupFn({ data: { gameId, board: setupBoard as never, ready: readyFlag } });
      setReady(readyFlag);
      if (readyFlag) sfx.ready();
    } catch (e) { toast.error((e as Error).message); }
  };

  const tryMove = async (from: Square, to: Square, promotionChoice?: PieceType) => {
    try {
      await makeMoveFn({ data: { gameId, from, to, promotion: promotionChoice } });
      setSelectedSquare(null);
      sfx.move();
    } catch (e) {
      const msg = (e as Error).message;
      // If promotion required, we detect via legal moves — user picks
      if (msg.includes("Illegal") && !promotionChoice) {
        // Might be a missing promotion — attempt with q default popup
        setPromotion({ from, to });
        return;
      }
      toast.error(msg);
    }
  };

  const handleSquareClick = (square: Square) => {
    if (g.status !== "playing") return;
    if (g.turn !== myColor) return;
    const myPiece = view.myBoard[square as keyof BoardMap];
    if (selectedSquare) {
      if (legalTargets.includes(square)) {
        // detect promotion (pawn reaching last rank)
        const piece = view.myBoard[selectedSquare as keyof BoardMap];
        const targetRank = Number(square[1]);
        if (piece?.type === "p" && (targetRank === 8 || targetRank === 1)) {
          setPromotion({ from: selectedSquare, to: square });
          return;
        }
        tryMove(selectedSquare, square);
        return;
      }
      if (myPiece) { setSelectedSquare(square); return; }
      setSelectedSquare(null);
    } else if (myPiece) {
      setSelectedSquare(square);
    }
  };

  const handleMarkOpponent = (square: Square) => {
    setMarks((m) => ({ ...m, [square]: nextMark(m[square]) }));
  };

  const lastMove = movesQ.data && movesQ.data.length > 0
    ? { from: movesQ.data[movesQ.data.length - 1].from_sq as Square, to: movesQ.data[movesQ.data.length - 1].to_sq as Square }
    : null;

  const myCaptures = (movesQ.data ?? []).filter((m) => m.color === myColor && m.captured).map((m) => m.captured_type as PieceType);
  const oppCaptures = (movesQ.data ?? []).filter((m) => m.color !== myColor && m.captured).map((m) => m.captured_type as PieceType);

  return (
    <div className="max-w-6xl mx-auto p-4 md:p-6">
      <div className="flex items-center justify-between mb-4 text-xs text-terminal-dim">
        <Link to="/lobby" className="hover:text-terminal-bright">← lobby</Link>
        <div>
          {g.tc_name} · vs <span className="text-terminal-bright">{oppProfile?.username ?? "?"}</span> · you are {myColor === "w" ? "white" : "black"}
        </div>
      </div>

      <div className="grid md:grid-cols-[auto_1fr] gap-6 items-start">
        <div className="space-y-2">
          <CaptureRow label={`${oppProfile?.username ?? "opp"} lost`} pieces={oppCaptures} color={oppColor} />
          <ChessBoard
            board={displayBoard}
            playerColor={myColor}
            phase={g.status === "over" ? "over" : g.status === "setup" ? "setup" : "play"}
            selectedPiece={selectedPiece}
            onPlace={handleSetupPlace}
            onPickup={handleSetupPickup}
            selectedSquare={selectedSquare}
            legalTargets={legalTargets}
            onSquareClick={handleSquareClick}
            hideOpponent={g.status !== "setup"}
            marks={marks}
            onMarkOpponent={handleMarkOpponent}
            lastMove={lastMove}
          />
          <CaptureRow label="you lost" pieces={myCaptures} color={myColor} />
        </div>

        <div className="space-y-4 min-w-[280px]">
          {g.status === "setup" ? (
            <SetupPanel
              remain={rem}
              selectedPiece={selectedPiece}
              onSelect={setSelectedPiece}
              playerColor={myColor}
              timeLeft={setupSecondsLeft}
              ready={ready}
              onReady={() => submit(true)}
              onSave={() => submit(false)}
              canReady={setupDone}
              oppUsername={oppProfile?.username ?? "opponent"}
            />
          ) : (
            <PlayPanel
              game={g}
              myColor={myColor}
              clockW={clockW}
              clockB={clockB}
              onResign={async () => { try { await resignFn({ data: { gameId } }); sfx.gameEnd(); } catch (e) { toast.error((e as Error).message); } }}
              oppUsername={oppProfile?.username ?? "opp"}
            />
          )}
        </div>
      </div>

      {promotion && (
        <PromotionModal color={myColor} onPick={(p) => { const { from, to } = promotion; setPromotion(null); tryMove(from, to, p); }} />
      )}
    </div>
  );
}

function liveClock(g: { status: string; turn: string | null; last_move_at: string | null; white_clock_ms: number | null; black_clock_ms: number | null; initial_seconds: number }, color: "w" | "b") {
  const base = (color === "w" ? g.white_clock_ms : g.black_clock_ms) ?? 0;
  if (g.status !== "playing" || g.turn !== color || !g.last_move_at || g.initial_seconds === 0) return base;
  const elapsed = Date.now() - new Date(g.last_move_at).getTime();
  return Math.max(0, base - elapsed);
}

function CaptureRow({ label, pieces, color }: { label: string; pieces: PieceType[]; color: Color }) {
  return (
    <div className="flex items-center gap-2 text-xs text-terminal-dim min-h-[28px] px-1">
      <span className="uppercase tracking-widest">{label}</span>
      <div className="flex flex-wrap gap-0.5">
        {pieces.length === 0 && <span className="text-terminal-dim/50">—</span>}
        {pieces.map((p, i) => <img key={i} src={pieceImage(p, color)} alt={p} className="w-5 h-5" style={{ opacity: 0.85 }} />)}
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
          {PROMO.map((p) => (
            <button key={p} onClick={() => onPick(p)} className="w-16 h-16 border border-terminal hover:border-terminal-bright hover:bg-terminal/10 flex items-center justify-center">
              <img src={pieceImage(p, color)} alt={p} className="w-12 h-12" />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function SetupPanel({
  remain, selectedPiece, onSelect, playerColor, timeLeft, ready, onReady, onSave, canReady, oppUsername,
}: {
  remain: Record<PieceType, number>;
  selectedPiece: PieceType | null;
  onSelect: (p: PieceType | null) => void;
  playerColor: Color;
  timeLeft: number;
  ready: boolean;
  onReady: () => void;
  onSave: () => void;
  canReady: boolean;
  oppUsername: string;
}) {
  const order: PieceType[] = ["k", "q", "r", "b", "n", "p"];
  return (
    <div className="term-panel p-4">
      <div className="flex items-baseline justify-between mb-3">
        <div className="text-terminal-bright uppercase tracking-widest text-xs">// setup vs {oppUsername}</div>
        <div className="text-terminal-bright text-2xl font-bold" style={{ textShadow: "0 0 10px var(--color-terminal)" }}>
          {String(Math.floor(timeLeft / 60)).padStart(2, "0")}:{String(timeLeft % 60).padStart(2, "0")}
        </div>
      </div>
      <p className="text-xs text-terminal-dim mb-3">
        Place your 16 pieces in your two home ranks. King on back rank. When both ready (or timer hits 0), game starts.
      </p>
      <div className="grid grid-cols-3 gap-2 mb-3">
        {order.map((p) => {
          const disabled = remain[p] <= 0;
          const active = selectedPiece === p;
          return (
            <button
              key={p}
              disabled={disabled || ready}
              onClick={() => onSelect(active ? null : p)}
              className={[
                "border p-2 text-center flex flex-col items-center",
                active ? "border-terminal-bright bg-terminal/20" : "border-border",
                (disabled || ready) && "opacity-30 cursor-not-allowed",
              ].filter(Boolean).join(" ")}
            >
              <img src={pieceImage(p, playerColor)} alt={p} className="w-10 h-10" />
              <div className="text-[10px] uppercase text-terminal-dim mt-1">{PIECE_NAMES[p]} ×{remain[p]}</div>
            </button>
          );
        })}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <button onClick={onSave} disabled={ready}
          className="border border-terminal text-terminal py-2 uppercase text-xs hover:bg-terminal/10 disabled:opacity-30">
          save
        </button>
        <button onClick={onReady} disabled={ready || !canReady}
          className="border-2 border-terminal-bright text-terminal-bright bg-terminal/10 py-2 uppercase text-xs font-bold hover:bg-terminal hover:text-background disabled:opacity-40">
          {ready ? "✓ ready" : "▶ ready"}
        </button>
      </div>
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
  game, myColor, clockW, clockB, onResign, oppUsername,
}: {
  game: { status: string; turn: string | null; result: string | null; initial_seconds: number };
  myColor: Color;
  clockW: number;
  clockB: number;
  onResign: () => void;
  oppUsername: string;
}) {
  const hasClock = game.initial_seconds > 0;
  const isMyTurn = game.turn === myColor;
  return (
    <div className="space-y-3">
      <div className="term-panel p-4">
        <div className="text-terminal-bright uppercase tracking-widest text-xs mb-3">// clocks</div>
        <div className="space-y-2">
          <ClockRow label={myColor === "b" ? `you (b)` : `${oppUsername} (b)`} ms={clockB} active={game.turn === "b" && game.status === "playing"} hasClock={hasClock} />
          <ClockRow label={myColor === "w" ? `you (w)` : `${oppUsername} (w)`} ms={clockW} active={game.turn === "w" && game.status === "playing"} hasClock={hasClock} />
        </div>
      </div>
      <div className="term-panel p-4">
        <div className="text-terminal-bright uppercase tracking-widest text-xs mb-2">// status</div>
        {game.result ? (
          <div className="text-danger font-bold">{game.result}</div>
        ) : (
          <div className="text-terminal">{isMyTurn ? "> your move" : "> waiting for opponent"}</div>
        )}
        <div className="text-xs text-terminal-dim mt-2">right-click enemy ★ to mark a guess (red).</div>
      </div>
      <div className="grid grid-cols-1 gap-2">
        <button onClick={onResign} disabled={game.status === "over"} className="border border-danger text-danger py-2 uppercase text-xs hover:bg-danger/10 disabled:opacity-30">resign</button>
      </div>
    </div>
  );
}

function ClockRow({ label, ms, active, hasClock }: { label: string; ms: number; active: boolean; hasClock: boolean }) {
  return (
    <div className={`flex items-center justify-between border px-3 py-2 ${active ? "border-terminal-bright bg-terminal/10" : "border-border"}`}>
      <span className="text-xs uppercase text-terminal-dim">{label}</span>
      <span className={`font-bold text-xl tabular-nums ${active ? "text-terminal-bright" : "text-terminal"}`}>
        {hasClock ? fmtClock(ms) : "--:--"}
      </span>
    </div>
  );
}
