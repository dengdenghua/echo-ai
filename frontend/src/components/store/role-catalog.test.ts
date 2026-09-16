import { describe, it, expect } from 'vitest';
import type { Agent } from '@/core/agents/types';
import { mergeRoleCatalog } from './role-catalog';
import type { CloudExpertAgent } from '@/core/agents/agent-world-api';
import { mergeProfessions } from '@/core/agents/profession-catalog';
const agent = (name: string, display_name = name) => ({ name, display_name, description: name }) as Agent;
const catalogRole = (id: string, display_name: string, is_team = false): CloudExpertAgent => ({ id, name: id, display_name, description: display_name, author: 'Echo', category: 'engineering', tags: [], icon: '', source: 'echo-catalog', is_team });
describe('unified role catalog', () => {
  it('deduplicates fictional and real-world shells by shared persona identity', () => {
    const rows = mergeRoleCatalog([agent('echo_eve', 'Eve / Siren'), agent('eve', 'Eve'), agent('echo_kane'), agent('kane')], [], []);
    expect(rows.map(row => row.local?.name)).toEqual(['eve', 'kane']);
  });
  it('keeps unrelated local roles distinct', () => {
    expect(mergeRoleCatalog([agent('echo'), agent('eve')], [], [])).toHaveLength(2);
  });
  it('includes migrated engineering roles in the digital employee filter', () => {
    const roles = [catalogRole('twin_opto_mechanical_engineer', '光机工程师'), catalogRole('twin_electrical_engineer', '电气工程师'), catalogRole('twin_embedded', '嵌入式工程师')];
    const employees = mergeRoleCatalog([], roles, mergeProfessions([])).filter(row => row.kind === 'employee');
    for (const role of roles) expect(employees.find(row => row.id === role.id)).toMatchObject({ title: role.display_name, cloud: role });
    expect(employees.filter(row => row.title.includes('光机'))).toHaveLength(1);
    expect(employees.every(row => !row.local)).toBe(true);
  });
  it('merges installed roles and matching profession templates without duplicates', () => {
    const rows = mergeRoleCatalog([agent('twin_test_engineer')], [catalogRole('twin_test_engineer', '测试工程师')], mergeProfessions([]));
    expect(rows.filter(row => row.id === 'twin_test_engineer')).toHaveLength(1);
    expect(rows.find(row => row.id === 'twin_test_engineer')).toMatchObject({ kind: 'employee', local: { name: 'twin_test_engineer' }, cloud: { id: 'twin_test_engineer' } });
    expect(rows.filter(row => row.profession?.name === '测试工程师')).toHaveLength(1);
  });
  it('keeps catalog teams in the team filter', () => {
    expect(mergeRoleCatalog([], [catalogRole('research_team', '研究团队', true)], [])[0]?.kind).toBe('team');
  });
});
