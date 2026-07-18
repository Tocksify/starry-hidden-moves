import { Chess, type Move } from "chess.js";

const VALUES: Record<string, number> = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 20000 };

export type Difficulty = 1 | 2 | 3 | 4 | 5;

export const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  1: "Beginner",
  2: "Easy",
  3: "Medium",
  4: "Hard",
  5: "Expert",
};

function evaluate(chess: Chess): number {
  // From white's perspective.
  let score = 0;
  const b = chess.board();
  for (const row of b) {
    for (const cell of row) {
      if (!cell) continue;
      const v = VALUES[cell.type] ?? 0;
      score += cell.color === "w" ? v : -v;
    }
  }
  return score;
}

function minimax(chess: Chess, depth: number, alpha: number, beta: number, maximizing: boolean): number {
  if (depth === 0 || chess.isGameOver()) return evaluate(chess);
  const moves = chess.moves({ verbose: true }) as Move[];
  if (maximizing) {
    let best = -Infinity;
    for (const m of moves) {
      chess.move(m);
      const v = minimax(chess, depth - 1, alpha, beta, false);
      chess.undo();
      if (v > best) best = v;
      if (v > alpha) alpha = v;
      if (beta <= alpha) break;
    }
    return best;
  } else {
    let best = Infinity;
    for (const m of moves) {
      chess.move(m);
      const v = minimax(chess, depth - 1, alpha, beta, true);
      chess.undo();
      if (v < best) best = v;
      if (v < beta) beta = v;
      if (beta <= alpha) break;
    }
    return best;
  }
}

export function pickAiMove(chess: Chess, difficulty: Difficulty): Move | null {
  const moves = chess.moves({ verbose: true }) as Move[];
  if (moves.length === 0) return null;
  const turn = chess.turn();
  const maximizing = turn === "w";

  if (difficulty === 1) {
    return moves[Math.floor(Math.random() * moves.length)];
  }
  if (difficulty === 2) {
    // Prefer captures.
    const caps = moves.filter((m) => m.captured);
    const pool = caps.length ? caps : moves;
    return pool[Math.floor(Math.random() * pool.length)];
  }
  const depth = difficulty === 3 ? 1 : difficulty === 4 ? 2 : 3;
  let best: Move | null = null;
  let bestVal = maximizing ? -Infinity : Infinity;
  // Shuffle for variety among equal moves.
  const shuffled = [...moves].sort(() => Math.random() - 0.5);
  for (const m of shuffled) {
    chess.move(m);
    const v = minimax(chess, depth - 1, -Infinity, Infinity, !maximizing);
    chess.undo();
    if (maximizing ? v > bestVal : v < bestVal) {
      bestVal = v;
      best = m;
    }
  }
  return best ?? moves[0];
}
