import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import {
  searchUsers, sendFriendRequest, respondFriend, removeFriend,
  createChallenge, respondChallenge,
} from "@/lib/online.functions";

export const Route = createFileRoute("/_authenticated/lobby")({
  head: () => ({ meta: [{ title: "fog.chess — lobby" }] }),
  component: Lobby,
});

type TC = { name: string; initial: number; increment: number };
const TIME_CONTROLS: TC[] = [
  { name: "1+0 Bullet", initial: 60, increment: 0 },
  { name: "3+0 Blitz", initial: 180, increment: 0 },
  { name: "3+2 Blitz", initial: 180, increment: 2 },
  { name: "5+0 Blitz", initial: 300, increment: 0 },
  { name: "10+0 Rapid", initial: 600, increment: 0 },
  { name: "15+10 Rapid", initial: 900, increment: 10 },
  { name: "Unlimited", initial: 0, increment: 0 },
];

function Lobby() {
  const { userId } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const searchFn = useServerFn(searchUsers);
  const sendFriendFn = useServerFn(sendFriendRequest);
  const respondFriendFn = useServerFn(respondFriend);
  const removeFriendFn = useServerFn(removeFriend);
  const createChallengeFn = useServerFn(createChallenge);
  const respondChallengeFn = useServerFn(respondChallenge);

  const [q, setQ] = useState("");
  const [challengeFor, setChallengeFor] = useState<{ id: string; username: string } | null>(null);
  const [tcIdx, setTcIdx] = useState(1);
  const [color, setColor] = useState<"w" | "b" | "r">("r");

  // Friendships
  const friendsQ = useQuery({
    queryKey: ["friendships", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data } = await supabase
        .from("friendships")
        .select("*")
        .order("updated_at", { ascending: false });
      return data ?? [];
    },
  });

  // Challenges
  const challengesQ = useQuery({
    queryKey: ["challenges", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data } = await supabase
        .from("challenges")
        .select("*")
        .eq("status", "pending")
        .order("created_at", { ascending: false });
      return data ?? [];
    },
  });

  // Profiles map
  const relevantIds = useMemo(() => {
    const ids = new Set<string>();
    friendsQ.data?.forEach((f) => { ids.add(f.user_a); ids.add(f.user_b); ids.add(f.requested_by); });
    challengesQ.data?.forEach((c) => { ids.add(c.from_id); ids.add(c.to_id); });
    ids.delete("");
    return Array.from(ids);
  }, [friendsQ.data, challengesQ.data]);

  const profilesQ = useQuery({
    queryKey: ["profiles", relevantIds.sort().join(",")],
    enabled: relevantIds.length > 0,
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("id, username").in("id", relevantIds);
      const map: Record<string, string> = {};
      data?.forEach((p) => { map[p.id] = p.username; });
      return map;
    },
  });
  const nameOf = (id: string) => profilesQ.data?.[id] ?? id.slice(0, 6);

  // Search
  const searchQ = useQuery({
    queryKey: ["search", q],
    enabled: q.trim().length > 0,
    queryFn: async () => await searchFn({ data: { q: q.trim() } }),
  });

  // Realtime refresh
  useEffect(() => {
    if (!userId) return;
    const ch = supabase.channel(`lobby:${userId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "friendships" }, () => {
        qc.invalidateQueries({ queryKey: ["friendships", userId] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "challenges" }, () => {
        qc.invalidateQueries({ queryKey: ["challenges", userId] });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [userId, qc]);

  const sendChallenge = async () => {
    if (!challengeFor) return;
    const tc = TIME_CONTROLS[tcIdx];
    try {
      await createChallengeFn({
        data: {
          toId: challengeFor.id,
          tcName: tc.name,
          initialSeconds: tc.initial,
          incrementSeconds: tc.increment,
          color,
        },
      });
      toast.success(`challenge sent to ${challengeFor.username}`);
      setChallengeFor(null);
    } catch (e) { toast.error((e as Error).message); }
  };

  const friends = friendsQ.data?.filter((f) => f.status === "accepted") ?? [];
  const incomingFR = friendsQ.data?.filter((f) => f.status === "pending" && f.requested_by !== userId) ?? [];
  const outgoingFR = friendsQ.data?.filter((f) => f.status === "pending" && f.requested_by === userId) ?? [];
  const incomingCh = challengesQ.data?.filter((c) => c.to_id === userId) ?? [];
  const outgoingCh = challengesQ.data?.filter((c) => c.from_id === userId && c.to_id !== userId) ?? [];

  return (
    <div className="max-w-5xl mx-auto p-4 md:p-6 space-y-6">
      <header>
        <div className="text-xs text-terminal-dim">~ / lobby $</div>
        <h1 className="text-3xl font-bold text-terminal-bright">lobby<span className="animate-pulse text-terminal">_</span></h1>
      </header>

      {/* Incoming challenges */}
      {incomingCh.length > 0 && (
        <section className="term-panel p-4">
          <div className="text-terminal-bright uppercase tracking-widest text-xs mb-3">// incoming challenges</div>
          <ul className="space-y-2">
            {incomingCh.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-2 border border-border px-3 py-2">
                <div>
                  <span className="text-terminal-bright">{nameOf(c.from_id)}</span>
                  <span className="text-terminal-dim"> · {c.tc_name} · you play {c.color === "r" ? "random" : c.color === "w" ? "black" : "white"}</span>
                </div>
                <div className="flex gap-2">
                  <button className="border border-terminal text-terminal px-3 py-1 text-xs uppercase hover:bg-terminal/10"
                    onClick={async () => {
                      try {
                        const r = await respondChallengeFn({ data: { id: c.id, accept: true } });
                        if (r.gameId) navigate({ to: "/online/$gameId", params: { gameId: r.gameId } });
                      } catch (e) { toast.error((e as Error).message); }
                    }}>accept</button>
                  <button className="border border-danger text-danger px-3 py-1 text-xs uppercase hover:bg-danger/10"
                    onClick={async () => {
                      try { await respondChallengeFn({ data: { id: c.id, accept: false } }); }
                      catch (e) { toast.error((e as Error).message); }
                    }}>decline</button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="grid md:grid-cols-2 gap-6">
        {/* Search & challenge */}
        <section className="term-panel p-4">
          <div className="text-terminal-bright uppercase tracking-widest text-xs mb-3">// search players</div>
          <input
            className="w-full bg-background border border-border px-3 py-2 text-terminal focus:outline-none focus:border-terminal-bright"
            placeholder="username…"
            value={q} onChange={(e) => setQ(e.target.value)}
          />
          <ul className="mt-3 space-y-1 max-h-64 overflow-auto">
            {searchQ.data?.map((u) => (
              <li key={u.id} className="flex items-center justify-between border border-border px-3 py-2">
                <span className="text-terminal">{u.username}{u.id === userId && <span className="text-terminal-dim"> (you)</span>}</span>
                <div className="flex gap-2">
                  <button className="text-xs uppercase border border-terminal px-2 py-1 text-terminal hover:bg-terminal/10"
                    onClick={() => setChallengeFor({ id: u.id, username: u.username })}>challenge</button>
                  {u.id !== userId && (
                    <button className="text-xs uppercase border border-border px-2 py-1 text-terminal-dim hover:text-terminal hover:border-terminal"
                      onClick={async () => {
                        try {
                          const r = await sendFriendFn({ data: { toId: u.id } });
                          if (r.status === "sent") toast.success(`friend request sent to ${u.username}`);
                          else if (r.status === "already_pending") toast.info("already pending");
                          else if (r.status === "already_friends") toast.info("already friends");
                        } catch (e) { toast.error((e as Error).message); }
                      }}>+ friend</button>
                  )}
                </div>
              </li>
            ))}
            {q.trim() && searchQ.data && searchQ.data.length === 0 && (
              <li className="text-terminal-dim text-xs px-1">no results</li>
            )}
          </ul>
        </section>

        {/* Friends */}
        <section className="term-panel p-4">
          <div className="text-terminal-bright uppercase tracking-widest text-xs mb-3">// friends</div>
          {incomingFR.length > 0 && (
            <div className="mb-3">
              <div className="text-[10px] uppercase text-terminal-dim mb-1">requests</div>
              <ul className="space-y-1">
                {incomingFR.map((f) => (
                  <li key={f.id} className="flex items-center justify-between border border-border px-3 py-2">
                    <span className="text-terminal">{nameOf(f.requested_by)}</span>
                    <div className="flex gap-1">
                      <button className="text-xs border border-terminal text-terminal px-2 py-1 uppercase hover:bg-terminal/10"
                        onClick={async () => { try { await respondFriendFn({ data: { id: f.id, accept: true } }); } catch (e) { toast.error((e as Error).message); } }}>ok</button>
                      <button className="text-xs border border-danger text-danger px-2 py-1 uppercase hover:bg-danger/10"
                        onClick={async () => { try { await respondFriendFn({ data: { id: f.id, accept: false } }); } catch (e) { toast.error((e as Error).message); } }}>×</button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <ul className="space-y-1">
            {friends.map((f) => {
              const otherId = f.user_a === userId ? f.user_b : f.user_a;
              return (
                <li key={f.id} className="flex items-center justify-between border border-border px-3 py-2">
                  <span className="text-terminal">{nameOf(otherId)}</span>
                  <div className="flex gap-2">
                    <button className="text-xs uppercase border border-terminal px-2 py-1 text-terminal hover:bg-terminal/10"
                      onClick={() => setChallengeFor({ id: otherId, username: nameOf(otherId) })}>challenge</button>
                    <button className="text-xs uppercase border border-border px-2 py-1 text-terminal-dim hover:text-danger hover:border-danger"
                      onClick={async () => { try { await removeFriendFn({ data: { id: f.id } }); } catch (e) { toast.error((e as Error).message); } }}>×</button>
                  </div>
                </li>
              );
            })}
            {friends.length === 0 && incomingFR.length === 0 && (
              <li className="text-terminal-dim text-xs px-1">no friends yet — search a username to add one</li>
            )}
          </ul>
          {outgoingFR.length > 0 && (
            <div className="mt-3 text-[10px] text-terminal-dim">→ pending sent: {outgoingFR.map((f) => nameOf(f.user_a === userId ? f.user_b : f.user_a)).join(", ")}</div>
          )}
        </section>
      </div>

      {outgoingCh.length > 0 && (
        <section className="term-panel p-4">
          <div className="text-terminal-bright uppercase tracking-widest text-xs mb-3">// outgoing challenges</div>
          <ul className="space-y-1">
            {outgoingCh.map((c) => (
              <li key={c.id} className="flex items-center justify-between border border-border px-3 py-2 text-xs">
                <span className="text-terminal">→ {nameOf(c.to_id)} · {c.tc_name}</span>
                <button className="text-danger uppercase" onClick={async () => { try { await respondChallengeFn({ data: { id: c.id, accept: false } }); } catch (e) { toast.error((e as Error).message); } }}>cancel</button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="text-xs text-terminal-dim">
        <Link to="/" className="hover:text-terminal-bright">← play vs AI</Link>
      </div>

      {/* Challenge modal */}
      {challengeFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4">
          <div className="term-panel p-5 w-full max-w-md">
            <div className="text-terminal-bright uppercase tracking-widest text-xs mb-2">// challenge {challengeFor.username}</div>
            <div className="text-[10px] uppercase text-terminal-dim mt-2 mb-1">time control</div>
            <div className="grid grid-cols-2 gap-1 mb-3 max-h-56 overflow-auto">
              {TIME_CONTROLS.map((t, i) => (
                <button key={t.name} onClick={() => setTcIdx(i)}
                  className={`border px-2 py-2 text-xs text-left ${tcIdx === i ? "border-terminal-bright bg-terminal/10 text-terminal-bright" : "border-border text-terminal hover:border-terminal"}`}>
                  {t.name}
                </button>
              ))}
            </div>
            <div className="text-[10px] uppercase text-terminal-dim mb-1">you play</div>
            <div className="grid grid-cols-3 gap-1 mb-4">
              {(["w", "b", "r"] as const).map((c) => (
                <button key={c} onClick={() => setColor(c)}
                  className={`border px-2 py-2 text-xs uppercase ${color === c ? "border-terminal-bright bg-terminal/10 text-terminal-bright" : "border-border text-terminal hover:border-terminal"}`}>
                  {c === "r" ? "random" : c === "w" ? "white" : "black"}
                </button>
              ))}
            </div>
            <div className="flex gap-2 justify-end">
              <button className="text-xs uppercase border border-border px-3 py-2 text-terminal-dim hover:text-terminal" onClick={() => setChallengeFor(null)}>cancel</button>
              <button className="text-xs uppercase border-2 border-terminal-bright text-terminal-bright bg-terminal/10 px-4 py-2 hover:bg-terminal hover:text-background" onClick={sendChallenge}>▶ send</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
