import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState, useCallback } from "react";
import { Chess, type Move, type Square, type Color } from "chess.js";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { ChessBoard, nextMark, type Marks } from "@/components/ChessBoard";
import { pieceImage } from "@/lib/pieces";
import { sfx } from "@/lib/sounds";
import {
  type BoardMap, type PieceType,
  remainingPieces, isSetupComplete, buildGame, boardFromChess,
} from "@/lib/chess-engine";

const searchSchema = z.object({
  tc:  z.string().default("3+0 Blitz"),
  i:   z.coerce.number().default(180),
  inc: z.coerce.number().default(0),
});

export const Route = createFileRoute("/_authenticated/online/$gameId")({
  validateSearch: searchSchema,
  head: () => ({ meta: [{ title: "fog.chess — online" }] }),
  component: OnlineGame,
});

// ─── Types ───────────────────────────────────────────────────────────────────

interface Presence { userId: string; username: string; joinedAt: number }

interface ColorAssign {
  whiteId: string; blackId: string;
  whiteUsername: string; blackUsername: string;
  tcName: string; initialMs: number; incrementMs: number;
}

type Phase = "connecting" | "waiting" | "setup" | "play" | "over";
const PIECE_NAMES: Record<PieceType, string> = { k:"king",q:"queen",r:"rook",b:"bishop",n:"knight",p:"pawn" };
const PROMO: PieceType[] = ["q","r","b","n"];
const SETUP_SECONDS = 30;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function autoFill(board: BoardMap, color: Color): BoardMap {
  const filled = { ...board };
  const rem = { ...remainingPieces(filled, color) };
  const backRank = color === "w" ? 1 : 8;
  const ranks = color === "w" ? [1,2] : [7,8];
  const empties: Square[] = [];
  for (const rank of ranks)
    for (let f = 0; f < 8; f++) {
      const s = `${"abcdefgh"[f]}${rank}` as Square;
      if (!filled[s]) empties.push(s);
    }
  empties.sort(() => Math.random() - 0.5);
  for (const t of ["k","q","r","b","n","p"] as PieceType[]) {
    while (rem[t] > 0 && empties.length) {
      if (t === "k") {
        const idx = empties.findIndex(s => Number(s[1]) === backRank);
        if (idx === -1) break;
        const [sq] = empties.splice(idx, 1);
        filled[sq] = { type:"k", color };
      } else {
        const [sq] = empties.splice(0, 1);
        filled[sq] = { type:t, color };
      }
      rem[t]--;
    }
  }
  return filled;
}

function fmtClock(ms: number) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(s / 60), sec = s % 60;
  if (ms < 20000) {
    const t = Math.max(0, Math.floor((ms % 1000) / 100));
    return `${String(m).padStart(2,"0")}:${String(sec).padStart(2,"0")}.${t}`;
  }
  return `${String(m).padStart(2,"0")}:${String(sec).padStart(2,"0")}`;
}

// ─── Component ───────────────────────────────────────────────────────────────

function OnlineGame() {
  const { gameId: roomCode } = Route.useParams();
  const { tc: defaultTc, i: defaultI, inc: defaultInc } = Route.useSearch();
  const { session, userId } = useAuth();
  const navigate = useNavigate();

  const username = session?.user?.user_metadata?.username
    ?? session?.user?.email?.split("@")[0] ?? "player";

  // ── Time control (host sets; joiner receives via color_assign) ──
  const [tcName,     setTcName]     = useState(defaultTc);
  const [initialMs,  setInitialMs]  = useState(defaultI * 1000);
  const [incrementMs,setIncrementMs]= useState(defaultInc * 1000);

  // ── Room state ──
  const [phase,       setPhase]       = useState<Phase>("connecting");
  const [myColor,     setMyColor]     = useState<Color | null>(null);
  const [oppUsername, setOppUsername] = useState("");
  const [oppConnected,setOppConnected]= useState(false);

  // ── Setup ──
  const [setupBoard,   setSetupBoard]  = useState<BoardMap>({});
  const [selPiece,     setSelPiece]    = useState<PieceType | null>(null);
  const [myReady,      setMyReady]     = useState(false);
  const [oppReady,     setOppReady]    = useState(false);
  const [setupLeft,    setSetupLeft]   = useState(SETUP_SECONDS);

  // ── Play ──
  const chessRef = useRef<Chess | null>(null);
  const [board,       setBoard]       = useState<BoardMap>({});
  const [turn,        setTurn]        = useState<Color>("w");
  const [selSq,       setSelSq]       = useState<Square | null>(null);
  const [legal,       setLegal]       = useState<Square[]>([]);
  const [lastMove,    setLastMove]    = useState<{from:Square;to:Square}|null>(null);
  const [marks,       setMarks]       = useState<Marks>({});
  const [clockW,      setClockW]      = useState(defaultI * 1000);
  const [clockB,      setClockB]      = useState(defaultI * 1000);
  const [result,      setResult]      = useState<string | null>(null);
  const [promotion,   setPromotion]   = useState<{from:Square;to:Square}|null>(null);
  const [myCaps,      setMyCaps]      = useState<PieceType[]>([]);
  const [oppCaps,     setOppCaps]     = useState<PieceType[]>([]);

  // ── Refs for closures ──
  const channelRef    = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const phaseRef      = useRef<Phase>("connecting");
  const myColorRef    = useRef<Color | null>(null);
  const resultRef     = useRef<string | null>(null);
  const clockWRef     = useRef(defaultI * 1000);
  const clockBRef     = useRef(defaultI * 1000);
  const setupBoardRef = useRef<BoardMap>({});
  const oppBoardRef   = useRef<BoardMap | null>(null);
  const incRef        = useRef(defaultInc * 1000);

  // Keep refs in sync with state
  useEffect(() => { phaseRef.current    = phase;   }, [phase]);
  useEffect(() => { myColorRef.current  = myColor; }, [myColor]);
  useEffect(() => { resultRef.current   = result;  }, [result]);
  useEffect(() => { clockWRef.current   = clockW;  }, [clockW]);
  useEffect(() => { clockBRef.current   = clockB;  }, [clockB]);
  useEffect(() => { setupBoardRef.current = setupBoard; }, [setupBoard]);
  useEffect(() => { incRef.current      = incrementMs; }, [incrementMs]);

  // ── Channel ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!userId) return;

    const ch = supabase.channel(`fog-chess:${roomCode}`, {
      config: {
        broadcast: { self: true, ack: false },
        presence: { key: userId },
      },
    });
    channelRef.current = ch;

    // Presence sync – detect when both players are here
    ch.on("presence", { event: "sync" }, () => {
      const state = ch.presenceState<Presence>();
      const users = Object.values(state).flat();
      const oppHere = users.some(u => u.userId !== userId);
      setOppConnected(oppHere);

      if (users.length >= 2 && phaseRef.current === "waiting") {
        const sorted = [...users].sort((a,b) => a.joinedAt - b.joinedAt);
        const amHost  = sorted[0].userId === userId;
        if (amHost) {
          const [a, b] = sorted;
          const [white, black] = Math.random() > 0.5 ? [a,b] : [b,a];
          ch.send({
            type: "broadcast", event: "color_assign",
            payload: {
              whiteId: white.userId, blackId: black.userId,
              whiteUsername: white.username, blackUsername: black.username,
              tcName: defaultTc, initialMs: defaultI * 1000, incrementMs: defaultInc * 1000,
            } satisfies ColorAssign,
          });
        }
      }
    });

    ch.on("presence", { event: "leave" }, () => {
      const state = ch.presenceState<Presence>();
      const users = Object.values(state).flat();
      const oppHere = users.some(u => u.userId !== userId);
      setOppConnected(oppHere);
      if (!oppHere && phaseRef.current === "play" && !resultRef.current) {
        setResult("Opponent disconnected — you win");
        resultRef.current = "Opponent disconnected";
        setPhase("over"); phaseRef.current = "over";
        sfx.gameEnd();
      }
    });

    // Color assignment (both host and joiner receive this)
    ch.on("broadcast", { event: "color_assign" }, ({ payload }) => {
      const p = payload as ColorAssign;
      const color: Color = p.whiteId === userId ? "w" : "b";
      setMyColor(color); myColorRef.current = color;
      setOppUsername(color === "w" ? p.blackUsername : p.whiteUsername);
      setTcName(p.tcName);
      setInitialMs(p.initialMs);   setIncrementMs(p.incrementMs);
      incRef.current = p.incrementMs;
      setClockW(p.initialMs); clockWRef.current = p.initialMs;
      setClockB(p.initialMs); clockBRef.current = p.initialMs;
      setPhase("setup"); phaseRef.current = "setup";
    });

    // Opponent readied (contains their board)
    ch.on("broadcast", { event: "ready" }, ({ payload }) => {
      const p = payload as { color: Color; board: BoardMap };
      const mc = myColorRef.current;
      if (!mc || p.color === mc) return; // ignore my own echo
      oppBoardRef.current = p.board;
      setOppReady(true);
    });

    // Move from opponent
    ch.on("broadcast", { event: "move" }, ({ payload }) => {
      const p = payload as { from:string; to:string; promotion?:string; clockMs:number; color:Color };
      if (p.color === myColorRef.current) return; // ignore self
      handleOppMove(p);
    });

    ch.on("broadcast", { event: "resign" }, ({ payload }) => {
      const p = payload as { color: Color };
      if (p.color === myColorRef.current) return;
      const winner = p.color === "w" ? "Black" : "White";
      const r = `${winner} wins by resignation`;
      setResult(r); resultRef.current = r;
      setPhase("over"); phaseRef.current = "over";
      sfx.gameEnd();
    });

    ch.on("broadcast", { event: "timeout" }, ({ payload }) => {
      const p = payload as { color: Color };
      if (p.color === myColorRef.current) return;
      const winner = p.color === "w" ? "Black" : "White";
      const r = `${winner} wins on time`;
      setResult(r); resultRef.current = r;
      setPhase("over"); phaseRef.current = "over";
      sfx.gameEnd();
    });

    ch.subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        await ch.track({ userId, username, joinedAt: Date.now() } satisfies Presence);
        setPhase("waiting"); phaseRef.current = "waiting";
      }
    });

    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  // ── Setup countdown ───────────────────────────────────────────────────────
  useEffect(() => {
    if (phase !== "setup") return;
    setSetupLeft(SETUP_SECONDS);
    const id = setInterval(() => setSetupLeft(t => Math.max(0, t - 1)), 1000);
    return () => clearInterval(id);
  }, [phase]);

  useEffect(() => {
    if (phase !== "setup" || setupLeft > 0 || myReady) return;
    doReady(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setupLeft]);

  // ── When both ready → build game ─────────────────────────────────────────
  useEffect(() => {
    if (!myReady || !oppReady || phase !== "setup") return;
    const mc = myColorRef.current;
    const oppBoard = oppBoardRef.current;
    if (!mc || !oppBoard) return;

    let myBoard = setupBoardRef.current;
    if (!isSetupComplete(myBoard, mc)) myBoard = autoFill(myBoard, mc);
    const whiteBoard = mc === "w" ? myBoard : oppBoard;
    const blackBoard = mc === "b" ? myBoard : oppBoard;
    const chess = buildGame(whiteBoard, blackBoard);
    chessRef.current = chess;
    setBoard(boardFromChess(chess));
    setTurn("w");
    setPhase("play"); phaseRef.current = "play";
    sfx.ready();
  }, [myReady, oppReady, phase]);

  // ── Timestamp-based clock ─────────────────────────────────────────────────
  useEffect(() => {
    if (phase !== "play" || result || initialMs === 0) return;
    const startClock = turn === "w" ? clockWRef.current : clockBRef.current;
    const startTime  = Date.now();
    const id = setInterval(() => {
      const elapsed    = Date.now() - startTime;
      const remaining  = Math.max(0, startClock - elapsed);
      if (turn === "w") { setClockW(remaining); clockWRef.current = remaining; }
      else              { setClockB(remaining); clockBRef.current = remaining; }
      if (remaining <= 0 && !resultRef.current && myColorRef.current === turn) {
        const mc = myColorRef.current!;
        channelRef.current?.send({ type:"broadcast", event:"timeout", payload:{ color:mc } });
        const winner = mc === "w" ? "Black" : "White";
        const r = `${winner} wins on time`;
        setResult(r); resultRef.current = r;
        setPhase("over"); phaseRef.current = "over";
        sfx.gameEnd();
      }
    }, 100);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turn, phase, result, initialMs]);

  // ── Opponent move handler ─────────────────────────────────────────────────
  const handleOppMove = useCallback((p: {
    from:string; to:string; promotion?:string; clockMs:number; color:Color;
  }) => {
    const chess = chessRef.current;
    if (!chess) return;
    try {
      const applied = chess.move({ from:p.from, to:p.to, promotion:p.promotion as PieceType|undefined });
      if (!applied) return;
      setBoard(boardFromChess(chess));
      setLastMove({ from:p.from as Square, to:p.to as Square });
      setSelSq(null); setLegal([]);
      // Sync mover clock
      if (p.color === "w") { setClockW(p.clockMs); clockWRef.current = p.clockMs; }
      else                 { setClockB(p.clockMs); clockBRef.current = p.clockMs; }
      // Captures
      if (applied.captured) { setMyCaps(c => [...c, applied.captured as PieceType]); sfx.capture(); }
      else sfx.moveOpp();
      if (chess.inCheck() && !chess.isGameOver()) sfx.check();
      // Migrate marks
      setMarks(prev => {
        const next = { ...prev };
        const mk = next[p.from as Square];
        if (applied.captured) delete next[p.to as Square];
        if (mk !== undefined) {
          delete next[p.from as Square];
          if (applied.promotion) next[p.to as Square] = applied.promotion as PieceType;
          else if (mk) next[p.to as Square] = mk;
        }
        return next;
      });
      if (chess.isGameOver()) { finishGame(chess); return; }
      setTurn(chess.turn());
    } catch(e) { console.error("opp move failed", e); }
  }, []);

  const finishGame = (chess: Chess) => {
    let r = "Draw";
    if (chess.isCheckmate()) r = `${chess.turn() === "w" ? "Black" : "White"} wins by checkmate`;
    else if (chess.isStalemate()) r = "Draw — stalemate";
    setResult(r); resultRef.current = r;
    setPhase("over"); phaseRef.current = "over";
    sfx.gameEnd();
  };

  // ── My move ───────────────────────────────────────────────────────────────
  const tryMove = useCallback((from: Square, to: Square, promoChoice?: PieceType) => {
    const chess = chessRef.current;
    const mc    = myColorRef.current;
    if (!chess || !mc) return;
    if (phaseRef.current !== "play" || resultRef.current) return;

    const moves = chess.moves({ square:from, verbose:true }) as Move[];
    const cands = moves.filter(m => m.to === to);
    if (!cands.length) return;
    if (cands.some(m => m.promotion) && !promoChoice) { setPromotion({ from, to }); return; }

    const chosen = promoChoice ? cands.find(m => m.promotion === promoChoice) ?? cands[0] : cands[0];
    const applied = chess.move(chosen);
    if (!applied) return;

    setBoard(boardFromChess(chess));
    setLastMove({ from:applied.from as Square, to:applied.to as Square });
    setSelSq(null); setLegal([]);

    // Clock: remaining + increment
    const cur  = mc === "w" ? clockWRef.current : clockBRef.current;
    const next = cur + incRef.current;
    if (mc === "w") { setClockW(next); clockWRef.current = next; }
    else            { setClockB(next); clockBRef.current = next; }

    if (applied.captured) { setOppCaps(c => [...c, applied.captured as PieceType]); sfx.capture(); }
    else sfx.move();

    setMarks(prev => {
      const n = { ...prev };
      const mk = n[applied.from as Square];
      if (applied.captured) delete n[applied.to as Square];
      if (mk !== undefined) {
        delete n[applied.from as Square];
        if (applied.promotion && mk === "p") n[applied.to as Square] = applied.promotion as PieceType;
        else if (mk) n[applied.to as Square] = mk;
      }
      return n;
    });

    if (chess.inCheck() && !chess.isGameOver()) sfx.check();

    channelRef.current?.send({
      type:"broadcast", event:"move",
      payload:{ from:applied.from, to:applied.to, promotion:applied.promotion, clockMs:next, color:mc },
    });

    if (chess.isGameOver()) { finishGame(chess); return; }
    setTurn(chess.turn());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSquareClick = useCallback((sq: Square) => {
    const chess = chessRef.current;
    const mc    = myColorRef.current;
    if (!chess || !mc) return;
    if (phaseRef.current !== "play" || resultRef.current) return;
    if (turn !== mc) return;
    const piece = chess.get(sq);
    if (selSq) {
      if (legal.includes(sq)) { tryMove(selSq, sq); return; }
      if (piece && piece.color === mc) {
        setSelSq(sq);
        const ms = chess.moves({ square:sq, verbose:true }) as Move[];
        setLegal(Array.from(new Set(ms.map(m => m.to as Square))));
        return;
      }
      setSelSq(null); setLegal([]);
    } else if (piece && piece.color === mc) {
      setSelSq(sq);
      const ms = chess.moves({ square:sq, verbose:true }) as Move[];
      setLegal(Array.from(new Set(ms.map(m => m.to as Square))));
    }
  }, [turn, selSq, legal, tryMove]);

  const doReady = useCallback((forceAutoFill = false) => {
    const mc = myColorRef.current;
    if (!mc || myReady) return;
    let board = setupBoardRef.current;
    if (forceAutoFill || !isSetupComplete(board, mc)) board = autoFill(board, mc);
    if (!isSetupComplete(board, mc)) return; // shouldn't happen
    setSetupBoard(board); setupBoardRef.current = board;
    channelRef.current?.send({ type:"broadcast", event:"ready", payload:{ color:mc, board } });
    setMyReady(true);
  }, [myReady]);

  const handleResign = () => {
    const mc = myColorRef.current;
    if (!mc || result) return;
    channelRef.current?.send({ type:"broadcast", event:"resign", payload:{ color:mc } });
    const winner = mc === "w" ? "Black" : "White";
    const r = `${winner} wins by resignation`;
    setResult(r); setPhase("over"); sfx.gameEnd();
  };

  // ── Display board ─────────────────────────────────────────────────────────
  const oppColor: Color = myColor === "w" ? "b" : "w";
  const displayBoard: BoardMap = {};
  if (phase === "setup") {
    Object.assign(displayBoard, setupBoard);
  } else if (chessRef.current && myColor) {
    const full = boardFromChess(chessRef.current);
    for (const [sq, piece] of Object.entries(full) as [Square, {type:PieceType;color:Color}][]) {
      if (piece.color === myColor) displayBoard[sq as Square] = piece;
      else displayBoard[sq as Square] = { type:"p", color:oppColor }; // renders as ★
    }
  }

  const inCheck: Square | null = (phase === "play" && chessRef.current?.inCheck())
    ? (() => {
        const b = chessRef.current!.board();
        for (const row of b) for (const cell of row)
          if (cell && cell.type === "k" && cell.color === turn) return cell.square as Square;
        return null;
      })()
    : null;

  const rem       = myColor ? remainingPieces(setupBoard, myColor) : {} as Record<PieceType,number>;
  const setupDone = myColor ? isSetupComplete(setupBoard, myColor) : false;
  const hasClock  = initialMs > 0;

  // ── Waiting / connecting ──────────────────────────────────────────────────
  if (phase === "connecting" || phase === "waiting") {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="term-panel p-6 w-full max-w-md">
          <div className="text-xs text-terminal-dim mb-1">~ / fog.chess / online $</div>
          <h2 className="text-xl text-terminal-bright font-bold mb-4">waiting for opponent_</h2>
          <p className="text-sm text-terminal-dim mb-4">
            {phase === "connecting" ? "> connecting…" : "> share this code with your opponent:"}
          </p>
          <div className="border border-terminal-bright p-5 text-center mb-5"
            style={{ boxShadow:"0 0 24px var(--color-terminal)22" }}>
            <div className="text-[10px] uppercase text-terminal-dim mb-1">room code</div>
            <div className="text-4xl font-bold text-terminal-bright tracking-[0.25em]"
              style={{ textShadow:"0 0 16px var(--color-terminal)" }}>
              {roomCode}
            </div>
          </div>
          <p className="text-xs text-terminal-dim mb-5">
            Your opponent can join from the lobby. Both of you need an account.
          </p>
          <Link to="/lobby" className="text-xs text-terminal-dim hover:text-terminal-bright">← back to lobby</Link>
        </div>
      </div>
    );
  }

  // ── Full game UI ──────────────────────────────────────────────────────────
  return (
    <div className="max-w-6xl mx-auto p-4 md:p-6">
      <div className="flex items-center justify-between mb-4 text-xs text-terminal-dim">
        <Link to="/lobby" className="hover:text-terminal-bright">← lobby</Link>
        <div>
          {tcName} · vs <span className="text-terminal-bright">{oppUsername || "?"}</span>
          {" "}· you are {myColor === "w" ? "white" : "black"}
          {!oppConnected && phase !== "over" && (
            <span className="text-danger ml-2">· opp disconnected</span>
          )}
        </div>
      </div>

      <div className="grid md:grid-cols-[auto_1fr] gap-6 items-start">
        <div className="space-y-2">
          <CaptureRow label={`${oppUsername || "opp"} lost`} pieces={oppCaps} color={oppColor} />
          <ChessBoard
            board={displayBoard}
            playerColor={myColor ?? "w"}
            phase={phase === "over" ? "over" : phase === "setup" ? "setup" : "play"}
            selectedPiece={phase === "setup" ? selPiece : undefined}
            onPlace={(target, piece) => {
              if (!myColor || myReady) return;
              if ((rem[piece] ?? 0) <= 0) return;
              setSetupBoard(b => ({ ...b, [target]:{ type:piece, color:myColor } }));
            }}
            onPickup={(from) => {
              if (myReady) return;
              setSetupBoard(b => { const c={...b}; delete c[from]; return c; });
            }}
            selectedSquare={phase === "play" ? selSq : undefined}
            legalTargets={phase === "play" ? legal : []}
            onSquareClick={handleSquareClick}
            hideOpponent={phase !== "setup"}
            marks={marks}
            onMarkOpponent={(sq) => setMarks(m => ({ ...m, [sq]:nextMark(m[sq]) }))}
            lastMove={lastMove}
            inCheck={inCheck}
          />
          <CaptureRow label="you lost" pieces={myCaps} color={myColor ?? "w"} />
        </div>

        <div className="space-y-4 min-w-[280px]">
          {phase === "setup" ? (
            <SetupPanel
              remain={rem}
              selectedPiece={selPiece}
              onSelect={setSelPiece}
              playerColor={myColor ?? "w"}
              timeLeft={setupLeft}
              ready={myReady}
              oppReady={oppReady}
              onReady={() => doReady(false)}
              canReady={setupDone}
              oppUsername={oppUsername}
            />
          ) : (
            <PlayPanel
              turn={turn}
              myColor={myColor ?? "w"}
              oppUsername={oppUsername}
              clockW={clockW}
              clockB={clockB}
              hasClock={hasClock}
              result={result}
              phase={phase}
              onResign={handleResign}
              onNewGame={() => navigate({ to: "/lobby" })}
            />
          )}
        </div>
      </div>

      {promotion && (
        <PromotionModal
          color={myColor ?? "w"}
          onPick={(p) => {
            const { from, to } = promotion!;
            setPromotion(null);
            tryMove(from, to, p);
          }}
        />
      )}
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function CaptureRow({ label, pieces, color }: { label:string; pieces:PieceType[]; color:Color }) {
  return (
    <div className="flex items-center gap-2 text-xs text-terminal-dim min-h-[28px] px-1">
      <span className="uppercase tracking-widest text-[10px] w-20 shrink-0">{label}</span>
      <div className="flex flex-wrap gap-0.5">
        {pieces.length === 0
          ? <span className="text-terminal-dim/50">—</span>
          : pieces.map((p,i) => <img key={i} src={pieceImage(p,color)} alt={p} className="w-5 h-5" style={{opacity:0.85}} />)}
      </div>
    </div>
  );
}

function PromotionModal({ color, onPick }: { color:Color; onPick:(p:PieceType)=>void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
      <div className="term-panel p-4">
        <div className="text-terminal-bright uppercase tracking-widest text-xs mb-3 text-center">// promote to</div>
        <div className="flex gap-2">
          {PROMO.map(p => (
            <button key={p} onClick={() => onPick(p)}
              className="w-16 h-16 border border-terminal hover:border-terminal-bright hover:bg-terminal/10 flex items-center justify-center">
              <img src={pieceImage(p,color)} alt={p} className="w-12 h-12" />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function SetupPanel({
  remain, selectedPiece, onSelect, playerColor, timeLeft, ready, oppReady,
  onReady, canReady, oppUsername,
}: {
  remain:Record<PieceType,number>; selectedPiece:PieceType|null;
  onSelect:(p:PieceType|null)=>void; playerColor:Color;
  timeLeft:number; ready:boolean; oppReady:boolean;
  onReady:()=>void; canReady:boolean; oppUsername:string;
}) {
  return (
    <div className="term-panel p-4">
      <div className="flex items-baseline justify-between mb-3">
        <div className="text-terminal-bright uppercase tracking-widest text-xs">// setup vs {oppUsername}</div>
        <div className="text-terminal-bright text-2xl font-bold" style={{textShadow:"0 0 10px var(--color-terminal)"}}>
          {String(Math.floor(timeLeft/60)).padStart(2,"0")}:{String(timeLeft%60).padStart(2,"0")}
        </div>
      </div>
      <p className="text-xs text-terminal-dim mb-3">
        Place your 16 pieces in your two home ranks. King on back rank.
        When both ready (or timer hits 0), game starts.
      </p>
      <div className="grid grid-cols-3 gap-2 mb-3">
        {(["k","q","r","b","n","p"] as PieceType[]).map(p => {
          const disabled = remain[p] <= 0;
          const active   = selectedPiece === p;
          return (
            <button key={p} disabled={disabled||ready} onClick={() => onSelect(active ? null : p)}
              className={["border p-2 text-center flex flex-col items-center transition-colors",
                active ? "border-terminal-bright bg-terminal/20" : "border-border",
                (disabled||ready) && "opacity-30 cursor-not-allowed",
                !disabled && !active && !ready && "hover:border-terminal",
              ].filter(Boolean).join(" ")}>
              <img src={pieceImage(p,playerColor)} alt={p} className="w-10 h-10" />
              <div className="text-[10px] uppercase text-terminal-dim mt-1">{PIECE_NAMES[p]} ×{remain[p]}</div>
            </button>
          );
        })}
      </div>
      <div className="flex gap-2 text-xs text-terminal-dim mb-3">
        <span className={ready ? "text-terminal" : "text-terminal-dim"}>you: {ready ? "✓ ready" : "not ready"}</span>
        <span>·</span>
        <span className={oppReady ? "text-terminal" : "text-terminal-dim"}>opp: {oppReady ? "✓ ready" : "waiting…"}</span>
      </div>
      <button onClick={onReady} disabled={ready}
        className={["w-full py-3 border-2 uppercase tracking-widest font-bold transition-colors",
          ready ? "border-terminal-dim text-terminal-dim" : "border-terminal-bright text-terminal-bright bg-terminal/10 hover:bg-terminal hover:text-background",
        ].join(" ")}
        style={!ready ? {boxShadow:"0 0 16px var(--color-terminal)"} : undefined}>
        {ready ? "✓ ready — waiting for opponent" : canReady ? "▶ ready" : "▶ ready (auto-fill)"}
      </button>
    </div>
  );
}

function PlayPanel({
  turn, myColor, oppUsername, clockW, clockB, hasClock, result, phase, onResign, onNewGame,
}: {
  turn:Color; myColor:Color; oppUsername:string;
  clockW:number; clockB:number; hasClock:boolean;
  result:string|null; phase:Phase;
  onResign:()=>void; onNewGame:()=>void;
}) {
  const isMyTurn = turn === myColor;
  return (
    <div className="space-y-3">
      <div className="term-panel p-4">
        <div className="text-terminal-bright uppercase tracking-widest text-xs mb-3">// clocks</div>
        <div className="space-y-2">
          <ClockRow
            label={myColor === "b" ? "you (b)" : `${oppUsername} (b)`}
            ms={clockB} active={turn === "b" && phase === "play"} hasClock={hasClock} />
          <ClockRow
            label={myColor === "w" ? "you (w)" : `${oppUsername} (w)`}
            ms={clockW} active={turn === "w" && phase === "play"} hasClock={hasClock} />
        </div>
      </div>
      <div className="term-panel p-4">
        <div className="text-terminal-bright uppercase tracking-widest text-xs mb-2">// status</div>
        {result
          ? <div className="text-danger font-bold">{result}</div>
          : <div className="text-terminal">{isMyTurn ? "> your move" : `> waiting for ${oppUsername}`}</div>}
        <div className="text-xs text-terminal-dim mt-2">right-click enemy ★ to mark a guess (red).</div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <button onClick={onResign} disabled={phase === "over"}
          className="border border-danger text-danger py-2 uppercase text-xs hover:bg-danger/10 disabled:opacity-30">
          resign
        </button>
        <button onClick={onNewGame}
          className="border border-terminal text-terminal py-2 uppercase text-xs hover:bg-terminal/10">
          new game
        </button>
      </div>
    </div>
  );
}

function ClockRow({ label, ms, active, hasClock }: { label:string; ms:number; active:boolean; hasClock:boolean }) {
  return (
    <div className={`flex items-center justify-between border px-3 py-2 ${active ? "border-terminal-bright bg-terminal/10" : "border-border"}`}>
      <span className="text-xs uppercase text-terminal-dim">{label}</span>
      <span className={`font-bold text-xl tabular-nums ${active ? "text-terminal-bright" : "text-terminal"}`}
        style={active ? {textShadow:"0 0 8px var(--color-terminal)"} : undefined}>
        {hasClock ? fmtClock(ms) : "--:--"}
      </span>
    </div>
  );
}
