// ---------------------------------------------------------------------------
// Types shared by the A2A agents panel and its sections
// ---------------------------------------------------------------------------

export interface AgentSkill {
  id: string;
  name: string;
  description: string;
  tags: string[];
  examples?: string[];
}

export interface AgentCapabilities {
  streaming: boolean;
  pushNotifications: boolean;
  multiTurn: boolean;
}

export interface RemoteAgent {
  agent_id: string;
  base_url: string;
  name: string;
  description: string;
  version: string;
  status: "active" | "unreachable" | "unknown";
  registered_at: string;
  updated_at: string;
  last_health_check: string | null;
  capabilities: AgentCapabilities;
  skills: AgentSkill[];
}

export interface TaskResult {
  id: string;
  local_task_id?: string;
  lifecycle_status?: string;
  status: {
    state: string;
    message?: string;
  };
  messages: Array<{
    role: string;
    parts: Array<{ type: string; text?: string }>;
  }>;
  artifacts: Array<{
    name?: string;
    parts: Array<{
      type: string;
      text?: string;
      raw?: string;
      filename?: string;
      media_type?: string;
    }>;
  }>;
}

export interface RemoteTaskRecord {
  local_task_id: string;
  remote_task_id: string;
  agent_id: string;
  status: string;
  request: { text?: string; context_id?: string };
  result: TaskResult | null;
  error: string | null;
  updated_at: string;
  terminal_at: string | null;
}
