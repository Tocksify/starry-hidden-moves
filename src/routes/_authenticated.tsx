import { createFileRoute, Outlet, useNavigate, Link } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { NotificationsProvider } from "@/hooks/useNotifications";

export const Route = createFileRoute("/_authenticated")({
  component: AuthedLayout,
});

function AuthedLayout() {
  const { session, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && !session) {
      navigate({ to: "/auth", search: { next: window.location.pathname } });
    }
  }, [session, loading, navigate]);

  if (loading) return <div className="p-6 text-terminal-dim">> loading session…</div>;
  if (!session) return null;

  return (
    <div className="min-h-screen">
      <NotificationsProvider />
      <nav className="border-b border-border px-4 py-2 flex items-center justify-between text-xs">
        <div className="flex items-center gap-4">
          <Link to="/" className="text-terminal-dim hover:text-terminal-bright">fog.chess</Link>
          <Link to="/lobby" className="text-terminal hover:text-terminal-bright">lobby</Link>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-terminal-dim">{session.user.email}</span>
          <button
            className="text-terminal-dim hover:text-danger uppercase tracking-widest"
            onClick={async () => { await supabase.auth.signOut(); navigate({ to: "/" }); }}
          >
            sign_out
          </button>
        </div>
      </nav>
      <Outlet />
    </div>
  );
}
