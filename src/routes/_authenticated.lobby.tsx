import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/lobby")({
  head: () => ({ meta: [{ title: "fog.chess — lobby" }] }),
  component: Lobby,
});

const TIME_CONTROLS = [
  { name: "1+0 Bullet",   initial: 60,  increment: 0  },
  { name: "3+0 Blitz",    initial: 180, increment: 0  },
  { name: "3+2 Blitz",    initial: 180, increment: 2  },
  { name: "5+0 Blitz",    initial: 300, increment: 0  },
  { name: "10+0 Rapid",   initial: 600, increment: 0  },
  { name: "15+10 Rapid",  initial: 900, increment: 10 },
  { name: "Unlimited",    initial: 0,   increment: 0  },
];

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function genCode() {
  return Array.from({ length: 6 }, () =>
    CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]
  ).join("");
}

function Lobby() {
  const navigate = useNavigate();
  const { session } = useAuth();
  const [tcIdx, setTcIdx] = useState(1);
  const [joinCode, setJoinCode] = useState("");
  const [creating, setCreating] = useState(false);

  const tc = TIME_CONTROLS[tcIdx];
  const username =
    session?.user?.user_metadata?.username ??
    session?.user?.email?.split("@")[0] ??
    "player";

  const createGame = async () => {
    setCreating(true);
    const code = genCode();
    // Navigate to the game room; time control is passed as query params
    navigate({
      to: `/online/$gameId` as never,
      params: { gameId: code } as never,
      search: { tc: tc.name, i: tc.initial, inc: tc.increment } as never,
    });
  };

  const joinGame = () => {
    const code = joinCode.trim().toUpperCase();
    if (code.length < 4) return;
    navigate({
      to: `/online/$gameId` as never,
      params: { gameId: code } as never,
      search: {} as never,
    });
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/" });
  };

  return (
    <div className="min-h-screen p-4 md:p-6 max-w-xl mx-auto">
      <div className="text-xs text-terminal-dim mb-1">~ / fog.chess / lobby $</div>
      <div className="flex items-baseline justify-between mb-6">
        <h1 className="text-2xl text-terminal-bright font-bold">lobby_</h1>
        <div className="flex items-center gap-3 text-xs text-terminal-dim">
          <span>{username}</span>
          <button onClick={signOut} className="hover:text-danger uppercase tracking-widest">
            sign_out
          </button>
        </div>
      </div>

      {/* Create game */}
      <div className="term-panel p-5 mb-4">
        <div className="text-terminal-bright uppercase tracking-widest text-xs mb-3">
          // create game
        </div>
        <div className="text-[10px] uppercase text-terminal-dim mb-2">time control</div>
        <div className="grid grid-cols-2 gap-1 mb-4">
          {TIME_CONTROLS.map((t, i) => (
            <button
              key={t.name}
              onClick={() => setTcIdx(i)}
              className={[
                "border px-3 py-2 text-xs text-left transition-colors",
                i === tcIdx
                  ? "border-terminal-bright bg-terminal/10 text-terminal-bright"
                  : "border-border text-terminal hover:border-terminal",
              ].join(" ")}
            >
              {t.name}
            </button>
          ))}
        </div>
        <button
          onClick={createGame}
          disabled={creating}
          className="w-full py-3 border-2 border-terminal-bright text-terminal-bright bg-terminal/10 uppercase tracking-widest font-bold hover:bg-terminal hover:text-background transition-colors disabled:opacity-40"
          style={{ boxShadow: "0 0 16px var(--color-terminal)" }}
        >
          {creating ? "…" : "▶ create game"}
        </button>
      </div>

      {/* Join game */}
      <div className="term-panel p-5 mb-4">
        <div className="text-terminal-bright uppercase tracking-widest text-xs mb-3">
          // join game
        </div>
        <div className="text-[10px] uppercase text-terminal-dim mb-2">room code</div>
        <div className="flex gap-2">
          <input
            className="flex-1 bg-background border border-border px-3 py-2 text-terminal uppercase tracking-[0.3em] text-center text-lg focus:outline-none focus:border-terminal-bright"
            placeholder="ABC123"
            value={joinCode}
            maxLength={6}
            onChange={(e) => setJoinCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
            onKeyDown={(e) => e.key === "Enter" && joinGame()}
            autoComplete="off"
          />
          <button
            onClick={joinGame}
            disabled={joinCode.trim().length < 4}
            className="border border-terminal text-terminal px-5 py-2 uppercase text-xs hover:bg-terminal/10 disabled:opacity-30 transition-colors"
          >
            join
          </button>
        </div>
      </div>

      <div className="text-xs text-terminal-dim">
        <Link to="/" className="hover:text-terminal-bright">← play vs AI</Link>
      </div>
    </div>
  );
}
