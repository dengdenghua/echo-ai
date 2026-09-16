import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { LocalAgentList } from './local-agent-list';
vi.mock('@/core/agents/hooks', () => ({ useAgents: () => ({ agents: [{ name: 'contrarian-investor', display_name: '坤候底 · 逆向投资人', description: '产业分析' }], isLoading: false, error: null, refetch: vi.fn() }) }));
vi.mock('@/components/workspace/agent-avatar', () => ({ AgentAvatar: () => null }));
describe('local roster', () => {
  it('shows locally imported roles without marketplace installation flags and links by actual id', () => {
    render(<LocalAgentList />);
    expect(screen.getByRole('link', { name: /坤候底/ })).toHaveAttribute('href', '#/workspace/realtime/new?agent=contrarian-investor');
  });
  it('distinguishes unmatched search from an empty installation list', () => {
    render(<LocalAgentList queries={['missing']} />);
    expect(screen.getByText('没有匹配的本地角色，请调整搜索词。')).toBeInTheDocument();
  });
});
