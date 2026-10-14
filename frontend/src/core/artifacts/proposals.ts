import { EchoAPIError, untypedApi } from "@/core/api/request";
import { ArtifactSaveError, sha256Text } from "./save";
import { urlOfArtifactRevision } from "./utils";

export type ArtifactProposal = {
  proposal_id: string;
  status: "pending" | "accepted" | "rejected" | "interrupted";
  created_at: number;
  base_sha256: string;
  candidate_path?: string;
  current_sha256?: string;
};
export type ArtifactProposalContent = ArtifactProposal & {
  base_content: string;
  candidate_content: string;
  candidate_sha256: string;
  changed: boolean;
  conflict: boolean;
};
type Scope = { filepath: string; threadId: string; signal?: AbortSignal };
async function request<T>(
  scope: Scope,
  proposalId?: string,
  body?: Record<string, unknown>,
): Promise<T> {
  const source = urlOfArtifactRevision(scope);
  if (!source) throw new ArtifactSaveError("此产物暂不支持待审修改。", 415);
  const url = new URL(
    source.replace("/output-revisions/", "/output-proposals/"),
    location.href,
  );
  if (proposalId) url.searchParams.set("proposal_id", proposalId);
  const options = {
    reason:
      "the URL is derived from urlOfArtifactRevision; artifact_path keeps its '/' separators unencoded",
    baseUrl: "",
    signal: scope.signal,
    body,
  };
  try {
    return await (body
      ? untypedApi.post<T>(url.toString(), options)
      : untypedApi.get<T>(url.toString(), options));
  } catch (error) {
    if (error instanceof EchoAPIError) {
      throw new ArtifactSaveError(
        error.status === 409
          ? "文件或工作副本已变化，请重新比较。本次操作未覆盖内容。"
          : "暂时无法处理修改，请重试。",
        error.status,
      );
    }
    throw error;
  }
}
export async function createArtifactProposal(
  scope: Scope & { expectedContent: string },
) {
  const expected = await sha256Text(scope.expectedContent);
  if (!expected) throw new ArtifactSaveError("无法校验当前版本。", 0);
  return request<ArtifactProposal>(scope, undefined, {
    action: "create",
    expected_sha256: expected,
  });
}
export async function listArtifactProposals(scope: Scope) {
  const result = await request<{ proposals: ArtifactProposal[] }>(scope);
  if (!Array.isArray(result.proposals))
    throw new ArtifactSaveError("修改记录暂时无法读取。", 502);
  return result;
}
export function readArtifactProposal(scope: Scope & { proposalId: string }) {
  return request<ArtifactProposalContent>(scope, scope.proposalId);
}
export function decideArtifactProposal(
  scope: Scope & {
    proposalId: string;
    action: "accept" | "reject";
    reviewedSha256?: string;
  },
) {
  return request<ArtifactProposal>(scope, undefined, {
    action: scope.action,
    proposal_id: scope.proposalId,
    reviewed_sha256: scope.reviewedSha256,
  });
}
