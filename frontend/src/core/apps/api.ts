import { apiGet } from "@/core/api/request";

export interface EchoAppAction {
  name: string;
  description?: string;
  input_schema?: Record<string, unknown>;
  requires_confirmation?: boolean;
}

export interface EchoApp {
  id: string;
  name: string;
  description?: string;
  author?: string | null;
  plugin?: string | null;
  source_plugin?: string | null;
  path?: string;
  route?: string | null;
  entry?: string | null;
  icon?: string | null;
  category?: string | null;
  schema_version?: string | null;
  connector_id?: string | null;
  permissions?: string[];
  actions?: EchoAppAction[];
  action_count?: number;
}

export async function listApps(): Promise<EchoApp[]> {
  return (await apiGet("/api/apps", {
    errorMessage: (failure) => `Failed to load apps: ${failure.statusText}`,
  })) as EchoApp[];
}
