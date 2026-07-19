import { useEffect } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useNavigate } from "@tanstack/react-router";
import { respondChallenge, respondFriend } from "@/lib/online.functions";
import { useServerFn } from "@tanstack/react-start";

async function usernameFor(id: string): Promise<string> {
  const { data } = await supabase.from("profiles").select("username").eq("id", id).maybeSingle();
  return data?.username ?? "someone";
}

export function NotificationsProvider() {
  const { userId } = useAuth();
  const navigate = useNavigate();
  const respondChallengeFn = useServerFn(respondChallenge);
  const respondFriendFn = useServerFn(respondFriend);

  useEffect(() => {
    if (!userId) return;

    const ch = supabase
      .channel(`notif:${userId}`)
      // Incoming challenges
      .on("postgres_changes",
        { event: "INSERT", schema: "public", table: "challenges", filter: `to_id=eq.${userId}` },
        async (payload) => {
          const c = payload.new as {
            id: string; from_id: string; tc_name: string;
            initial_seconds: number; increment_seconds: number; color: string;
          };
          const who = await usernameFor(c.from_id);
          toast(`⚔  ${who} challenged you`, {
            description: `${c.tc_name} · you play ${c.color === "r" ? "random" : c.color === "w" ? "black" : "white"}`,
            duration: 30_000,
            action: {
              label: "accept",
              onClick: async () => {
                try {
                  const r = await respondChallengeFn({ data: { id: c.id, accept: true } });
                  if (r.gameId) navigate({ to: "/online/$gameId", params: { gameId: r.gameId } });
                } catch (e) { toast.error((e as Error).message); }
              },
            },
            cancel: {
              label: "decline",
              onClick: async () => {
                try { await respondChallengeFn({ data: { id: c.id, accept: false } }); }
                catch (e) { toast.error((e as Error).message); }
              },
            },
          });
        })
      // Challenge status updates → if we accepted (or challenger sees acceptance) navigate
      .on("postgres_changes",
        { event: "UPDATE", schema: "public", table: "challenges", filter: `from_id=eq.${userId}` },
        async (payload) => {
          const c = payload.new as { status: string; game_id: string | null; to_id: string };
          if (c.status === "accepted" && c.game_id) {
            const who = await usernameFor(c.to_id);
            toast.success(`${who} accepted — starting game`);
            navigate({ to: "/online/$gameId", params: { gameId: c.game_id } });
          } else if (c.status === "declined") {
            const who = await usernameFor(c.to_id);
            toast.info(`${who} declined your challenge`);
          }
        })
      // Incoming friend requests / updates
      .on("postgres_changes",
        { event: "*", schema: "public", table: "friendships" },
        async (payload) => {
          const row = (payload.new ?? payload.old) as { user_a?: string; user_b?: string; requested_by?: string; status?: string; id?: string } | null;
          if (!row || !row.user_a || !row.user_b) return;
          if (row.user_a !== userId && row.user_b !== userId) return;
          if (payload.eventType === "INSERT" && row.requested_by && row.requested_by !== userId && row.status === "pending") {
            const who = await usernameFor(row.requested_by);
            toast(`✚  ${who} sent you a friend request`, {
              duration: 20_000,
              action: {
                label: "accept",
                onClick: async () => {
                  try { await respondFriendFn({ data: { id: row.id!, accept: true } }); toast.success(`friends with ${who}`); }
                  catch (e) { toast.error((e as Error).message); }
                },
              },
              cancel: {
                label: "decline",
                onClick: async () => {
                  try { await respondFriendFn({ data: { id: row.id!, accept: false } }); }
                  catch (e) { toast.error((e as Error).message); }
                },
              },
            });
          } else if (payload.eventType === "UPDATE" && row.status === "accepted") {
            const other = row.user_a === userId ? row.user_b : row.user_a;
            const who = await usernameFor(other!);
            if (row.requested_by === userId) toast.success(`${who} accepted your friend request`);
          }
        })
      .subscribe();

    return () => { supabase.removeChannel(ch); };
  }, [userId, navigate, respondChallengeFn, respondFriendFn]);

  return null;
}
