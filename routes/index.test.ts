import { describe, expect, it, vi } from 'vitest';

vi.mock('#/locales', () => ({ $t: (key: string) => key }));

describe('stream hub routes', () => {
  it('mounts log console under system monitor', async () => {
    const routes = await import('./index').then((module) => module.default);

    expect(routes).toHaveLength(1);
    expect(routes[0]?.name).toBe('PluginStreamHubLogConsole');
    expect(routes[0]?.path).toBe('/monitor/log-console');
  });
});
