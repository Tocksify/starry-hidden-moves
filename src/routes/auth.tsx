import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { z } from "zod";

const searchSchema = z.object({ next: z.string().optional() });

export const Route = createFileRoute("/auth")({
  validateSearch: searchSchema,
  head: () => ({ meta: [{ title: "fog.chess — sign in" }] }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const { next } = Route.useSearch();
  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: (next as never) ?? "/lobby" });
    });
  }, [navigate, next]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "up") {
        if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) throw new Error("username = 3–20 chars a-z A-Z 0-9 _");
        const { error } = await supabase.auth.signUp({
          email, password,
          options: { data: { username }, emailRedirectTo: `${window.location.origin}/lobby` },
        });
        if (error) throw error;
        toast.success("account created");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
      navigate({ to: (next as never) ?? "/lobby" });
    } catch (err) {
      toast.error((err as Error).message);
    } finally { setBusy(false); }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="term-panel p-6 w-full max-w-md">
        <div className="text-xs text-terminal-dim mb-1">~ / fog.chess / auth $</div>
        <h1 className="text-2xl text-terminal-bright font-bold mb-4">{mode === "in" ? "sign_in" : "sign_up"}</h1>
        <form onSubmit={submit} className="space-y-3">
          {mode === "up" && (
            <label className="block">
              <div className="text-[10px] uppercase text-terminal-dim mb-1">username</div>
              <input
                className="w-full bg-background border border-border px-3 py-2 text-terminal focus:outline-none focus:border-terminal-bright"
                value={username} onChange={(e) => setUsername(e.target.value)}
                placeholder="player_1" required minLength={3} maxLength={20}
              />
            </label>
          )}
          <label className="block">
            <div className="text-[10px] uppercase text-terminal-dim mb-1">email</div>
            <input type="email" required
              className="w-full bg-background border border-border px-3 py-2 text-terminal focus:outline-none focus:border-terminal-bright"
              value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label className="block">
            <div className="text-[10px] uppercase text-terminal-dim mb-1">password</div>
            <input type="password" required minLength={6}
              className="w-full bg-background border border-border px-3 py-2 text-terminal focus:outline-none focus:border-terminal-bright"
              value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
          <button
            type="submit"
            disabled={busy}
            className="w-full py-2 border-2 border-terminal-bright bg-terminal/10 text-terminal-bright uppercase tracking-widest font-bold hover:bg-terminal hover:text-background transition-colors disabled:opacity-40"
          >
            {busy ? "…" : mode === "in" ? "▶ log_in" : "▶ create_account"}
          </button>
        </form>
        <div className="text-xs text-terminal-dim mt-4 flex justify-between">
          <button className="hover:text-terminal-bright" onClick={() => setMode((m) => (m === "in" ? "up" : "in"))}>
            {mode === "in" ? "> need an account? sign up" : "> have an account? sign in"}
          </button>
          <Link to="/" className="hover:text-terminal-bright">← home</Link>
        </div>
      </div>
    </div>
  );
}
