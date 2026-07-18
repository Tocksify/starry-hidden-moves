import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { DIFFICULTY_LABELS, type Difficulty } from "@/lib/chess-ai";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "fog.chess — hidden-piece chess with terminal UI" },
      { name: "description", content: "Play fog-of-war chess against an AI. Hide your pieces, guess your opponent's, and outplay them on a terminal-styled board." },
      { property: "og:title", content: "fog.chess" },
      { property: "og:description", content: "Fog-of-war chess in your browser." },
      { property: "og:type", content: "website" },
    ],
  }),
  component: Home,
});

type TC = { name: string; initial: number; increment: number; kind: string };
const TIME_CONTROLS: TC[] = [
  { name: "1+0 Bullet", initial: 60, increment: 0, kind: "bullet" },
  { name: "3+0 Blitz", initial: 180, increment: 0, kind: "blitz" },
  { name: "3+2 Blitz", initial: 180, increment: 2, kind: "blitz" },
  { name: "5+0 Blitz", initial: 300, increment: 0, kind: "blitz" },
  { name: "10+0 Rapid", initial: 600, increment: 0, kind: "rapid" },
  { name: "15+10 Rapid", initial: 900, increment: 10, kind: "rapid" },
  { name: "Unlimited", initial: 0, increment: 0, kind: "casual" },
];

function Home() {
  const navigate = Route.useNavigate();
  const [tc, setTc] = useState(1);
  const [diff, setDiff] = useState<Difficulty>(3);
  const [color, setColor] = useState<"w" | "b" | "r">("w");

  const start = () => {
    const chosen = TIME_CONTROLS[tc];
    const c = color === "r" ? (Math.random() < 0.5 ? "w" : "b") : color;
    navigate({
      to: "/play",
      search: {
        d: diff,
        i: chosen.initial,
        inc: chosen.increment,
        c,
        tc: chosen.name,
      },
    });
  };

  return (
    <div className="min-h-screen p-6 md:p-10 max-w-4xl mx-auto">
      <header className="mb-8">
        <div className="text-xs text-terminal-dim">~ / fog.chess $</div>
        <h1 className="text-4xl md:text-5xl font-bold text-terminal-bright tracking-tight" style={{ textShadow: "0 0 24px var(--color-terminal)" }}>
          fog.chess<span className="animate-pulse text-terminal">_</span>
        </h1>
        <p className="mt-2 text-terminal-dim text-sm">
          hidden-piece chess &middot; set up your army &middot; right-click enemy ★ to mark it
        </p>
      </header>

      <section className="term-panel p-6">
        <div className="text-terminal-bright uppercase tracking-widest text-xs mb-4">// new game vs AI</div>

        <div className="grid md:grid-cols-2 gap-6">
          <div>
            <label className="block text-xs text-terminal-dim uppercase mb-2">Time control</label>
            <div className="space-y-1">
              {TIME_CONTROLS.map((t, i) => (
                <button
                  key={t.name}
                  onClick={() => setTc(i)}
                  className={`w-full text-left px-3 py-2 border text-sm ${tc === i ? "border-terminal-bright bg-terminal/10 text-terminal-bright" : "border-border text-terminal hover:border-terminal"}`}
                >
                  <span className="text-terminal-dim mr-2">[{tc === i ? "x" : " "}]</span>
                  {t.name}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-6">
            <div>
              <label className="block text-xs text-terminal-dim uppercase mb-2">AI difficulty</label>
              <div className="grid grid-cols-5 gap-1">
                {([1,2,3,4,5] as Difficulty[]).map((d) => (
                  <button
                    key={d}
                    onClick={() => setDiff(d)}
                    className={`px-2 py-2 border text-xs ${diff === d ? "border-terminal-bright bg-terminal/10 text-terminal-bright" : "border-border text-terminal hover:border-terminal"}`}
                  >
                    {d}
                  </button>
                ))}
              </div>
              <div className="mt-2 text-xs text-terminal-dim">→ {DIFFICULTY_LABELS[diff]}</div>
            </div>

            <div>
              <label className="block text-xs text-terminal-dim uppercase mb-2">Play as</label>
              <div className="grid grid-cols-3 gap-1">
                {[
                  { v: "w", label: "White" },
                  { v: "b", label: "Black" },
                  { v: "r", label: "Random" },
                ].map((o) => (
                  <button
                    key={o.v}
                    onClick={() => setColor(o.v as "w" | "b" | "r")}
                    className={`px-3 py-2 border text-xs uppercase ${color === o.v ? "border-terminal-bright bg-terminal/10 text-terminal-bright" : "border-border text-terminal hover:border-terminal"}`}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>

            <button
              onClick={start}
              className="w-full py-3 border-2 border-terminal-bright bg-terminal/10 text-terminal-bright uppercase tracking-widest font-bold hover:bg-terminal hover:text-background transition-colors"
              style={{ boxShadow: "0 0 20px var(--color-terminal)" }}
            >
              ▶ start_game
            </button>
          </div>
        </div>
      </section>

      <section className="term-panel p-6 mt-6 text-sm text-terminal-dim leading-relaxed">
        <div className="text-terminal-bright uppercase tracking-widest text-xs mb-3">// rules</div>
        <ul className="space-y-1">
          <li>&gt; 30-second setup phase. Place your 16 pieces on your two home ranks.</li>
          <li>&gt; The king must stay on your back rank. Everything else (including pawns) can go anywhere in your two home ranks.</li>
          <li>&gt; Enemy pieces render as <span className="text-danger">★</span>. Right-click one to cycle a guess mark.</li>
          <li>&gt; Then it's regular chess. Checkmate, timeout, stalemate, resign or draw.</li>
          <li className="text-terminal-dim/70">&gt; Online play, friends, and challenges coming next.</li>
        </ul>
      </section>
    </div>
  );
}
