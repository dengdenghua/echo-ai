import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { AgentAvatar } from "./agent-avatar";
import { Button } from "@/components/ui/button";
import { authHeaders } from "@/core/auth/api";
import { getBackendBaseURL } from "@/core/config";
import type { Team } from "@/core/teams/api";

export function TeamWelcomeCard({ teamId, onLoaded }: { teamId: string; onLoaded?: (team: Team) => void }) {
  const query = useQuery({
    queryKey: ["team-welcome", teamId],
    queryFn: async ({ signal }): Promise<Team> => {
      const response = await fetch(`${getBackendBaseURL()}/api/teams/${encodeURIComponent(teamId)}`, { headers: authHeaders(), signal });
      if (!response.ok) throw new Error("团队信息加载失败");
      return response.json() as Promise<Team>;
    },
    staleTime: 30_000,
    retry: false,
  });
  useEffect(() => { if (query.data) onLoaded?.(query.data); }, [query.data, onLoaded]);
  if (query.isPending) return <p role="status" className="p-4 text-sm text-muted-foreground">正在加载团队…</p>;
  if (!query.data) return <div role="alert" className="p-4 text-sm">团队信息暂时无法加载。<Button variant="ghost" onClick={() => void query.refetch()}>重新加载</Button></div>;
  const team = query.data;
  return <section aria-label="建群欢迎" className="mb-4 rounded-xl border bg-background p-4 text-left">
    <p className="text-xs text-muted-foreground">团队已创建 · {team.members.length} 位成员</p>
    <h2 className="mt-1 text-lg font-semibold">欢迎来到 {team.name}</h2>
    <div className="my-3 flex flex-wrap gap-2">{team.members.map(member => <span key={member.name} className="flex items-center gap-1.5 text-xs"><AgentAvatar agent={member} />{member.display_name || member.name}{member.name === team.leaderId ? " · 队长" : ""}</span>)}</div>
    <details className="text-sm"><summary className="cursor-pointer text-muted-foreground">认识成员 · 查看能力介绍</summary><ul className="mt-2 space-y-2">{team.members.map(member => <li key={member.name}><strong>{member.display_name || member.name}</strong><p className="text-xs text-muted-foreground">{member.description || "这位成员尚未填写能力介绍。"}</p></li>)}</ul><p className="mt-2 text-xs text-muted-foreground">以上来自成员资料。</p></details>
    <p className="mt-3 text-sm">你想和我们一起做什么？</p>
    <p className="mt-1 text-xs text-muted-foreground">在下方描述任务，也可以先上传参考资料。</p>
  </section>;
}
