## Fog-of-War Chess — Build Plan

A chess.com-style app where opponent pieces are hidden (shown as ★) and can be right-click marked with guessed piece types. CLI-inspired green-on-black theme.

### Stack
- TanStack Start (already scaffolded) + Lovable Cloud (Supabase) for auth, DB, realtime.
- `chess.js` for move legality + FEN, custom board rendering.
- Realtime via Supabase channels for challenges, friend requests, moves, clocks.

### Milestone 1 — Foundation (this turn)
1. Enable Lovable Cloud.
2. Design system: CLI green (#00ff66) on black, monospace font (JetBrains Mono), ASCII-flavored borders/buttons.
3. Auth: email/password + Google. `profiles` table (username, elo). `user_roles` unused for now.
4. Root layout with terminal header + session-aware nav.
5. Landing / auth pages.

### Milestone 2 — Chess core + local vs AI
1. `chess.js` install + board component (8×8, custom setup phase support).
2. Setup phase (30s): drag pieces from a palette onto own two ranks.
   - **Placement validation at pickup/drop time** (no post-submit errors):
     - King → back rank only.
     - All other pieces (including pawns) → any square in own 2 home ranks.
     - Invalid squares are visually disabled and drops are rejected.
   - "Ready" button; auto-start when both ready or timer hits 0.
3. AI opponent (Stockfish WASM in Web Worker) with skill levels 1–20 mapped to "Beginner → Grandmaster".
4. Fog of war: opponent pieces render as ★. Right-click cycles through mark options (♛♜♝♞♟♔ / clear). Marks are local-only visual state.
5. Time controls: 1+0 bullet, 3+0 / 3+2 blitz, 5+0 blitz, 10+0 rapid, 15+10 rapid, custom.
6. End states: checkmate, timeout, stalemate, resignation, draw offer.
7. **Game-start fix**: after both-ready, transition state deterministically (single source of truth: `game.status = 'active'` + `started_at`) and render the board from that. Current "starts but doesn't start" bug is caused by client-only readiness not writing to the shared game row.

### Milestone 3 — Online: friends, search, challenges
1. Tables (all with proper GRANTs + RLS):
   - `profiles(id, username unique, elo, created_at)`
   - `friendships(id, requester_id, addressee_id, status, created_at)` with `UNIQUE(least(requester,addressee), greatest(...))` via generated columns → prevents duplicate requests either direction.
   - `challenges(id, from_id, to_id, time_control jsonb, status, created_at)` — includes time control so recipient sees "3+2 Blitz" in the toast.
   - `games(id, white_id, black_id, time_control, status, fen, setup_white, setup_black, ready_white, ready_black, clock_white_ms, clock_black_ms, last_move_at, winner_id, end_reason)`
   - `moves(game_id, ply, uci, san, clock_ms_after)`
2. **RLS fix for the "new row violates RLS" error on challenge accept**: policy on `games` must allow INSERT when `auth.uid() IN (white_id, black_id)`. Accepting a challenge runs a `createServerFn` with `requireSupabaseAuth` that inserts the game as the accepting user — matching that policy.
3. Username search:
   - Case-insensitive, includes yourself.
   - Explicit "Play yourself" allowed (opens two-tab game via session tokens).
4. **Prevent duplicate friend requests**: unique index on the unordered pair + server-side check that returns existing request instead of inserting.
5. **Live notifications** (Supabase Realtime):
   - Subscribe on login to `friendships` and `challenges` filtered by `to_id = auth.uid()`.
   - Toast on incoming challenge showing sender + time control + Accept/Decline.
   - Toast on incoming friend request + inline Accept/Decline.
   - No polling; no page refresh needed.

### Milestone 4 — Online gameplay
1. Move sync via realtime + server fn that validates with chess.js server-side.
2. Server-authoritative clocks (compute from `last_move_at` + stored ms; never trust client).
3. Setup phase runs the same rules as vs-AI, then server writes both setups into `games.setup_white/black` and flips status to `active`.

### Fixes explicitly addressed
- **"Invalid FEN: some pawns are on the edge rows"**: we don't build FEN from arbitrary setups. Instead we validate placement rules ourselves (king back rank; all pieces within own 2 ranks) and store the setup as a piece-list JSON, converting to a legal internal position only when both setups are locked. `chess.js` is only used for the mid-game position after setup, so its FEN rank restrictions never apply to the placement phase.
- **King back-rank rule**: enforced at pickup/drop; king square highlighted if a non-king piece is dropped there? No — king can be placed on any back-rank square, other pieces can also go on back rank. Only rule: king MUST be on back rank; pawns and others may be anywhere in the two home ranks.
- **Territory restriction**: drops outside your 2 home ranks are blocked at drag time (target squares grayed out), so no "invalid later" errors.
- **AI game never starts**: shared readiness state lives in a single `useGameState` store; `status === 'active'` is the only render gate, set atomically when both flags are true or timer expires.
- **Challenge toast shows time control**.
- **Search includes self**.
- **Duplicate friend requests collapsed**.

### Delivery order this session
Milestone 1 + 2 (auth + local vs AI game with all setup rules, fog of war, time controls, right-click marking, CLI theme). Milestones 3 & 4 in follow-up turns since online realtime + all RLS is a substantial second pass.

### Non-goals (for now)
- Ranked elo calculations, tournaments, spectating, chat, mobile-optimized touch drag.

Shall I proceed with Milestone 1 + 2?
