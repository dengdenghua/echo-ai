import type { Agent } from '@/core/agents/types';
import type { CloudExpertAgent } from '@/core/agents/agent-world-api';
import type { Profession } from '@/core/agents/profession-catalog';
import { builtinPersonaDisplayName } from '@/core/agents/persona-display';
import { selectDigitalEmployees } from './digital-employee-catalog';
import { canonicalAgentId } from '@/core/agents/aliases';

export type RoleEntry = { id: string; title: string; description: string; kind: 'agent' | 'employee' | 'team'; local?: Agent; cloud?: CloudExpertAgent; profession?: Profession };

function catalogIdentity(name: string): string {
  const normalized = name.trim().toLowerCase();
  // The fictional ``echo_*`` shell and the real-world persona share one
  // conversation identity. Keep the runtime ids intact; only the catalog is
  // deduplicated for display.
  return canonicalAgentId(normalized.replace(/^echo_/, ''));
}

function preferLocal(candidate: RoleEntry, current: RoleEntry): RoleEntry {
  const candidateId = candidate.local?.name ?? candidate.id;
  const currentId = current.local?.name ?? current.id;
  const candidateScore = candidateId === catalogIdentity(candidateId) ? 0 : candidateId.startsWith('echo_') ? 2 : 1;
  const currentScore = currentId === catalogIdentity(currentId) ? 0 : currentId.startsWith('echo_') ? 2 : 1;
  return candidateScore < currentScore ? candidate : current;
}

export function mergeRoleCatalog(local: Agent[], cloud: CloudExpertAgent[], professions: Profession[]): RoleEntry[] {
  const entries: RoleEntry[] = [];
  const byIdentity = new Map<string, RoleEntry>();
  for (const agent of local) {
    const entry = { id: agent.name, title: builtinPersonaDisplayName(agent.name) || agent.display_name || agent.name, description: agent.description, kind: agent.name.startsWith('twin_') ? 'employee' as const : 'agent' as const, local: agent };
    const identity = catalogIdentity(agent.name);
    const existing = byIdentity.get(identity);
    if (existing) {
      const preferred = preferLocal(entry, existing);
      if (preferred !== existing) {
        entries[entries.indexOf(existing)] = preferred;
        byIdentity.set(identity, preferred);
      }
    } else {
      entries.push(entry);
      byIdentity.set(identity, entry);
    }
  }
  const byId = new Map(entries.map(entry => [entry.id, entry]));
  const cloudEntries = cloud.filter(expert => expert.source === 'echo-catalog');
  for (const expert of new Map([...selectDigitalEmployees(cloud, true), ...cloudEntries].map(expert => [expert.id, expert])).values()) {
    const slug = expert.id.replace(/^wb_/, '').replace(/[^a-zA-Z0-9]+/g, '_').toLowerCase();
    const existing = byId.get(expert.id) || byId.get(slug) || byIdentity.get(catalogIdentity(slug)) || (expert.id === 'wb_believe-in-light' ? byId.get('industry_research_lead') : undefined);
    if (existing) { existing.cloud = expert; existing.kind = expert.is_team ? 'team' : existing.kind; continue; }
    const entry: RoleEntry = { id: expert.id, title: expert.display_name, description: expert.description, kind: expert.is_team ? 'team' : expert.source === 'echo-catalog' && expert.id.startsWith('twin_') ? 'employee' : 'agent', cloud: expert };
    entries.push(entry);
    byId.set(expert.id, entry);
  }
  for (const profession of professions) {
    // Only occupational templates are exact matches; reusable expert candidates aren't installations.
    const matches = profession.candidates.filter(candidate => candidate.role_id.startsWith('twin_')).map(candidate => byId.get(candidate.role_id)).filter((entry): entry is RoleEntry => !!entry);
    if (matches.length) { for (const entry of matches) { entry.profession = profession; entry.kind = 'employee'; } continue; }
    entries.push({ id: `profession:${profession.id}`, title: profession.name, description: profession.boundary, kind: 'employee', profession });
  }
  return entries;
}
