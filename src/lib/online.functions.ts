import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { Chess } from "chess.js";
import { isSetupComplete, buildGame, randomSetup, type BoardMap, type PieceType } from "@/lib/chess-engine";

// ---------- Search ----------
export const searchUsers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => z.object({ q: z.string().min(1).max(20) }).parse(raw))
  .handler(async ({ data, context }) => {
    const { data: rows } = await context.supabase
      .from("profiles")
      .select("id, username")
      .ilike("username", `%${data.q}%`)
      .limit(20);
    return rows ?? [];
  });

export const getMyProfile = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase.from("profiles").select("id, username").eq("id", context.userId).maybeSingle();
    return data;
  });

// ---------- Friends ----------
export const sendFriendRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => z.object({ toId: z.string().uuid() }).parse(raw))
  .handler(async ({ data, context }) => {
    if (data.toId === context.userId) throw new Error("You can't friend yourself.");
    const [a, b] = context.userId < data.toId ? [context.userId, data.toId] : [data.toId, context.userId];
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: existing } = await supabaseAdmin.from("friendships").select("*").eq("user_a", a).eq("user_b", b).maybeSingle();
    if (existing) {
      if (existing.status === "accepted") return { status: "already_friends" as const };
      if (existing.status === "pending") return { status: "already_pending" as const };
      await supabaseAdmin.from("friendships").update({
        status: "pending", requested_by: context.userId, updated_at: new Date().toISOString(),
      }).eq("id", existing.id);
      return { status: "sent" as const };
    }
    const { error } = await supabaseAdmin.from("friendships").insert({
      user_a: a, user_b: b, requested_by: context.userId, status: "pending",
    });
    if (error) throw new Error(error.message);
    return { status: "sent" as const };
  });

export const respondFriend = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => z.object({ id: z.string().uuid(), accept: z.boolean() }).parse(raw))
  .handler(async ({ data, context }) => {
    const { data: f } = await context.supabase.from("friendships").select("*").eq("id", data.id).maybeSingle();
    if (!f) throw new Error("Not found");
    if (f.requested_by === context.userId) throw new Error("Cannot self-accept a request you sent.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("friendships").update({
      status: data.accept ? "accepted" : "declined",
      updated_at: new Date().toISOString(),
    }).eq("id", data.id);
    return { ok: true };
  });

export const removeFriend = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => z.object({ id: z.string().uuid() }).parse(raw))
  .handler(async ({ data, context }) => {
    const { data: f } = await context.supabase.from("friendships").select("*").eq("id", data.id).maybeSingle();
    if (!f || (f.user_a !== context.userId && f.user_b !== context.userId)) throw new Error("Not found");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("friendships").delete().eq("id", data.id);
    return { ok: true };
  });

// ---------- Challenges ----------
export const createChallenge = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => z.object({
    toId: z.string().uuid(),
    tcName: z.string().min(1).max(40),
    initialSeconds: z.number().int().min(0).max(3600),
    incrementSeconds: z.number().int().min(0).max(60),
    color: z.enum(["w", "b", "r"]),
  }).parse(raw))
  .handler(async ({ data, context }) => {
    if (data.toId === context.userId) {
      // self-challenge allowed (user asked for it)
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await supabaseAdmin.from("challenges").insert({
      from_id: context.userId,
      to_id: data.toId,
      tc_name: data.tcName,
      initial_seconds: data.initialSeconds,
      increment_seconds: data.incrementSeconds,
      color: data.color,
      status: "pending",
    }).select().single();
    if (error) throw new Error(error.message);
    return row;
  });

export const respondChallenge = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => z.object({ id: z.string().uuid(), accept: z.boolean() }).parse(raw))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: ch } = await supabaseAdmin.from("challenges").select("*").eq("id", data.id).maybeSingle();
    if (!ch) throw new Error("Not found");
    if (ch.to_id !== context.userId && ch.from_id !== context.userId) throw new Error("Not yours");
    if (ch.status !== "pending") return { gameId: ch.game_id };
    if (!data.accept) {
      await supabaseAdmin.from("challenges").update({ status: ch.from_id === context.userId ? "cancelled" : "declined" }).eq("id", data.id);
      return { gameId: null };
    }
    if (ch.to_id !== context.userId) throw new Error("Only recipient can accept");

    let whiteId: string, blackId: string;
    if (ch.color === "w") { whiteId = ch.from_id; blackId = ch.to_id; }
    else if (ch.color === "b") { whiteId = ch.to_id; blackId = ch.from_id; }
    else {
      if (Math.random() < 0.5) { whiteId = ch.from_id; blackId = ch.to_id; }
      else { whiteId = ch.to_id; blackId = ch.from_id; }
    }
    // For self-challenge, both sides = same user; that's fine.
    const now = new Date();
    const deadline = new Date(now.getTime() + 30_000);
    const { data: game, error } = await supabaseAdmin.from("games").insert({
      white_id: whiteId, black_id: blackId,
      tc_name: ch.tc_name,
      initial_seconds: ch.initial_seconds,
      increment_seconds: ch.increment_seconds,
      status: "setup",
      white_clock_ms: ch.initial_seconds * 1000,
      black_clock_ms: ch.initial_seconds * 1000,
      setup_deadline: deadline.toISOString(),
    }).select().single();
    if (error) throw new Error(error.message);
    await supabaseAdmin.from("challenges").update({ status: "accepted", game_id: game.id }).eq("id", data.id);
    return { gameId: game.id as string };
  });

// ---------- Game setup / play ----------
const boardSchema = z.record(z.string(), z.object({
  type: z.enum(["k", "q", "r", "b", "n", "p"]),
  color: z.enum(["w", "b"]),
}));

async function loadGame(id: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin.from("games").select("*").eq("id", id).maybeSingle();
  return data;
}

async function startIfBothReady(gameId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const g = await loadGame(gameId);
  if (!g || g.status !== "setup") return;
  const { data: setups } = await supabaseAdmin.from("game_setups").select("*").eq("game_id", gameId);
  const w = setups?.find((s) => s.color === "w")?.board as BoardMap | undefined;
  const b = setups?.find((s) => s.color === "b")?.board as BoardMap | undefined;
  if (!w || !b) return;
  const wReady = setups?.find((s) => s.color === "w")?.ready;
  const bReady = setups?.find((s) => s.color === "b")?.ready;
  const deadlinePassed = g.setup_deadline && new Date(g.setup_deadline).getTime() < Date.now();
  if (!((wReady && bReady) || deadlinePassed)) return;
  const chess = buildGame(w, b);
  const now = new Date().toISOString();
  await supabaseAdmin.from("games").update({
    status: "playing", fen: chess.fen(), turn: chess.turn(),
    started_at: now, last_move_at: now,
  }).eq("id", gameId);
}

export const submitSetup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => z.object({
    gameId: z.string().uuid(),
    board: boardSchema,
    ready: z.boolean(),
  }).parse(raw))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const g = await loadGame(data.gameId);
    if (!g) throw new Error("Game not found");
    if (context.userId !== g.white_id && context.userId !== g.black_id) throw new Error("Not a participant");
    if (g.status !== "setup") throw new Error("Setup closed");
    const color: "w" | "b" = context.userId === g.white_id ? "w" : "b";
    const board = data.board as BoardMap;
    for (const [sqk, p] of Object.entries(board)) {
      if (p.color !== color) throw new Error("Wrong piece color");
      const rank = Number(sqk[1]);
      const homeOk = color === "w" ? (rank === 1 || rank === 2) : (rank === 7 || rank === 8);
      if (!homeOk) throw new Error("Piece outside home ranks");
      if (p.type === "k" && ((color === "w" && rank !== 1) || (color === "b" && rank !== 8))) {
        throw new Error("King must be on back rank");
      }
    }
    if (data.ready && !isSetupComplete(board, color)) throw new Error("Setup incomplete");
    await supabaseAdmin.from("game_setups").upsert({
      game_id: data.gameId, player_id: context.userId, color,
      board: data.board, ready: data.ready, submitted_at: new Date().toISOString(),
    }, { onConflict: "game_id,player_id" });
    await startIfBothReady(data.gameId);
    return { ok: true };
  });

export const tickSetup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => z.object({ gameId: z.string().uuid() }).parse(raw))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const g = await loadGame(data.gameId);
    if (!g) throw new Error("nope");
    if (context.userId !== g.white_id && context.userId !== g.black_id) throw new Error("nope");
    if (g.status !== "setup") return { ok: true };
    if (!g.setup_deadline || new Date(g.setup_deadline).getTime() >= Date.now()) return { ok: true };
    const { data: setups } = await supabaseAdmin.from("game_setups").select("*").eq("game_id", data.gameId);
    for (const col of ["w", "b"] as const) {
      const existing = setups?.find((s) => s.color === col);
      if (!existing || !existing.ready) {
        const pid = col === "w" ? g.white_id : g.black_id;
        const board = existing?.board as BoardMap | undefined ?? randomSetup(col);
        // If incomplete, auto-fill missing by re-generating.
        await supabaseAdmin.from("game_setups").upsert({
          game_id: data.gameId, player_id: pid, color: col,
          board, ready: true, submitted_at: new Date().toISOString(),
        }, { onConflict: "game_id,player_id" });
      }
    }
    await startIfBothReady(data.gameId);
    return { ok: true };
  });

export const makeMove = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => z.object({
    gameId: z.string().uuid(),
    from: z.string().min(2).max(2),
    to: z.string().min(2).max(2),
    promotion: z.enum(["q", "r", "b", "n"]).optional(),
  }).parse(raw))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const g = await loadGame(data.gameId);
    if (!g) throw new Error("Game not found");
    if (g.status !== "playing") throw new Error("Not in play");
    const myColor: "w" | "b" | null =
      context.userId === g.white_id ? "w" : context.userId === g.black_id ? "b" : null;
    if (!myColor) throw new Error("Not a participant");
    if (g.turn !== myColor) throw new Error("Not your turn");

    const chess = new Chess();
    try { chess.load(g.fen!); } catch { throw new Error("Bad game state"); }

    const nowMs = Date.now();
    const elapsed = g.last_move_at ? nowMs - new Date(g.last_move_at).getTime() : 0;
    let myClock = (myColor === "w" ? g.white_clock_ms : g.black_clock_ms) ?? 0;
    if (g.initial_seconds > 0) {
      myClock -= elapsed;
      if (myClock <= 0) {
        await supabaseAdmin.from("games").update({
          status: "over",
          result: `${myColor === "w" ? "Black" : "White"} wins on time`,
          ended_at: new Date().toISOString(),
          white_clock_ms: myColor === "w" ? 0 : g.white_clock_ms,
          black_clock_ms: myColor === "b" ? 0 : g.black_clock_ms,
        }).eq("id", data.gameId);
        throw new Error("Time up");
      }
    }
    let applied;
    try {
      applied = chess.move({ from: data.from, to: data.to, promotion: data.promotion });
    } catch { throw new Error("Illegal move"); }
    if (!applied) throw new Error("Illegal move");

    const inc = (g.increment_seconds ?? 0) * 1000;
    const newMyClock = g.initial_seconds > 0 ? myClock + inc : 0;
    let result: string | null = null;
    let status: "playing" | "over" = "playing";
    let endedAt: string | null = null;
    if (chess.isGameOver()) {
      status = "over";
      endedAt = new Date().toISOString();
      if (chess.isCheckmate()) result = `${chess.turn() === "w" ? "Black" : "White"} wins by checkmate`;
      else if (chess.isStalemate()) result = "Draw — stalemate";
      else if (chess.isDraw()) result = "Draw";
      else result = "Game over";
    }
    const { count } = await supabaseAdmin
      .from("game_moves").select("*", { count: "exact", head: true }).eq("game_id", data.gameId);
    const ply = (count ?? 0) + 1;
    await supabaseAdmin.from("game_moves").insert({
      game_id: data.gameId, ply, color: myColor,
      from_sq: applied.from, to_sq: applied.to,
      captured: !!applied.captured,
      captured_type: (applied.captured as PieceType | undefined) ?? null,
      promotion: (applied.promotion as PieceType | undefined) ?? null,
      san: applied.san, is_check: chess.inCheck(),
    });
    await supabaseAdmin.from("games").update({
      fen: chess.fen(),
      turn: chess.turn(),
      white_clock_ms: myColor === "w" ? newMyClock : g.white_clock_ms,
      black_clock_ms: myColor === "b" ? newMyClock : g.black_clock_ms,
      last_move_at: new Date().toISOString(),
      status, result, ended_at: endedAt,
    }).eq("id", data.gameId);
    return { ok: true };
  });

export const resignGame = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => z.object({ gameId: z.string().uuid() }).parse(raw))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const g = await loadGame(data.gameId);
    if (!g) throw new Error("nope");
    const myColor = context.userId === g.white_id ? "w" : context.userId === g.black_id ? "b" : null;
    if (!myColor) throw new Error("nope");
    if (g.status === "over") return { ok: true };
    await supabaseAdmin.from("games").update({
      status: "over",
      result: `${myColor === "w" ? "Black" : "White"} wins by resignation`,
      ended_at: new Date().toISOString(),
    }).eq("id", data.gameId);
    return { ok: true };
  });

// Masked view — never returns fen (leaks types) or opponent piece types.
export const getGameView = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => z.object({ gameId: z.string().uuid() }).parse(raw))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const g = await loadGame(data.gameId);
    if (!g) throw new Error("Game not found");
    const myColor: "w" | "b" | null =
      context.userId === g.white_id ? "w" : context.userId === g.black_id ? "b" : null;
    if (!myColor) throw new Error("Not a participant");

    let myBoard: BoardMap = {};
    const oppSquares: string[] = [];
    if (g.fen) {
      const chess = new Chess();
      try {
        chess.load(g.fen);
        const b = chess.board();
        for (const row of b) for (const cell of row) if (cell) {
          if (cell.color === myColor) {
            myBoard[cell.square as keyof BoardMap] = { type: cell.type as PieceType, color: cell.color };
          } else {
            oppSquares.push(cell.square);
          }
        }
      } catch { /* ignore */ }
    }

    // legal moves for my pieces (only computable while it's my turn)
    let legal: Record<string, string[]> = {};
    if (g.status === "playing" && g.turn === myColor && g.fen) {
      const chess = new Chess();
      chess.load(g.fen);
      for (const sq of Object.keys(myBoard)) {
        const mvs = chess.moves({ square: sq as never, verbose: true }) as Array<{ to: string }>;
        if (mvs.length) legal[sq] = Array.from(new Set(mvs.map((m) => m.to)));
      }
    }

    const { data: profs } = await supabaseAdmin.from("profiles").select("id, username").in("id", [g.white_id, g.black_id]);
    const white = profs?.find((p) => p.id === g.white_id) ?? null;
    const black = profs?.find((p) => p.id === g.black_id) ?? null;

    // strip fen before returning
    const { fen: _fen, ...safeGame } = g;

    return {
      game: safeGame,
      myColor,
      myBoard,
      oppSquares,
      legal,
      white, black,
    };
  });
