import type * as Party from "partykit/server";

// ─── Types ───────────────────────────────────────────────────────────────────

interface PlayerInfo {
  userId: string;
  username: string;
  joinedAt: number;
  connId: string;
}

// ─── Server ───────────────────────────────────────────────────────────────────
// One instance per room (room ID = 6-char game code).
// Responsibilities:
//  - Track connected players
//  - Assign colors when the 2nd player joins
//  - Relay game messages (ready / move / resign / timeout) to the other player

export default class ChessServer implements Party.Server {
  constructor(readonly room: Party.Room) {}

  // In-memory room state (stays alive while >= 1 connection is open)
  players = new Map<string, PlayerInfo>(); // connId -> info
  gamePhase: "waiting" | "active" = "waiting";

  // Time control -- set from the creator's URL params
  tcName = "3+0 Blitz";
  initialMs = 180_000;
  incrementMs = 0;

  // Connection opened
  async onConnect(conn: Party.Connection, ctx: Party.ConnectionContext) {
    const url = new URL(ctx.request.url);
    const userId   = url.searchParams.get("userId")   ?? conn.id;
    const username = url.searchParams.get("username") ?? "player";
    const i        = Number(url.searchParams.get("i")   ?? 180);
    const inc      = Number(url.searchParams.get("inc") ?? 0);
    const tc       = url.searchParams.get("tc")        ?? "3+0 Blitz";

    // First player sets the time control for the room
    if (this.players.size === 0) {
      this.initialMs   = i * 1000;
      this.incrementMs = inc * 1000;
      this.tcName      = tc;
    }

    this.players.set(conn.id, { userId, username, joinedAt: Date.now(), connId: conn.id });

    // Send current room state to the newly connected player
    conn.send(JSON.stringify({
      type: "room_state",
      players: Array.from(this.players.values()),
    }));

    // When 2 players are present, assign colors and start
    if (this.players.size === 2 && this.gamePhase === "waiting") {
      this.gamePhase = "active";
      const [a, b] = Array.from(this.players.values());
      const [white, black] = Math.random() > 0.5 ? [a, b] : [b, a];
      this.room.broadcast(JSON.stringify({
        type:          "color_assign",
        whiteId:       white.userId,
        blackId:       black.userId,
        whiteUsername: white.username,
        blackUsername: black.username,
        tcName:        this.tcName,
        initialMs:     this.initialMs,
        incrementMs:   this.incrementMs,
      }));
    }
  }

  // Incoming message: relay to all OTHER connections in the room.
  // Game logic lives entirely on the clients; the server is a pure relay.
  async onMessage(message: string, sender: Party.Connection) {
    this.room.broadcast(message, [sender.id]);
  }

  // Connection closed
  async onClose(conn: Party.Connection) {
    const player = this.players.get(conn.id);
    this.players.delete(conn.id);

    if (player && this.gamePhase === "active") {
      this.room.broadcast(JSON.stringify({
        type:   "player_left",
        userId: player.userId,
      }));
    }

    // Reset if room is now empty so it can accept new players
    if (this.players.size === 0) {
      this.gamePhase = "waiting";
    }
  }
}
