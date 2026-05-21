import { beforeEach, describe, expect, it, vi } from 'vitest';

const emit = vi.fn();

vi.mock('#/store/websocket', () => ({
  useWebSocketStore: () => ({
    emit,
  }),
}));

async function loadRegistry() {
  vi.resetModules();
  emit.mockClear();
  const [{ defineStreamHubStream }, { createStreamHubRoomRegistry }] =
    await Promise.all([import('./define-stream'), import('./room-registry')]);
  return { createStreamHubRoomRegistry, defineStreamHubStream };
}

describe('createStreamHubRoomRegistry', () => {
  beforeEach(() => {
    emit.mockClear();
  });

  it('keeps a room subscribed until all consumers release it', async () => {
    const { createStreamHubRoomRegistry, defineStreamHubStream } =
      await loadRegistry();
    const stream = defineStreamHubStream({
      domain: 'env_task',
      resource: 'run',
      stream: 'run',
    });
    const registry = createStreamHubRoomRegistry<number>(stream, {
      validateResourceId: (id) => id > 0,
    });

    registry.retain(7);
    registry.retain(7);
    registry.release(7);

    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith('env_task_run_subscribe', {
      run_id: 7,
    });

    registry.release(7);

    expect(emit).toHaveBeenCalledTimes(2);
    expect(emit).toHaveBeenLastCalledWith('env_task_run_unsubscribe', {
      run_id: 7,
    });
  });

  it('refreshes active rooms using the stream id key', async () => {
    const { createStreamHubRoomRegistry, defineStreamHubStream } =
      await loadRegistry();
    const stream = defineStreamHubStream({
      domain: 'operable_player',
      resource: 'player',
      stream: 'player',
    });
    const registry = createStreamHubRoomRegistry<number>(stream, {
      validateResourceId: (id) => id > 0,
    });

    registry.retain(9);
    emit.mockClear();
    registry.refresh();

    expect(emit).toHaveBeenCalledWith('operable_player_player_subscribe', {
      player_id: 9,
    });
  });

  it('ignores invalid resource ids', async () => {
    const { createStreamHubRoomRegistry, defineStreamHubStream } =
      await loadRegistry();
    const stream = defineStreamHubStream({
      domain: 'operable_player',
      resource: 'trace',
      stream: 'task_run_log',
    });
    const registry = createStreamHubRoomRegistry<string>(stream, {
      validateResourceId: (id) => id.startsWith('op-player-'),
    });

    registry.retain('env-task-trace');
    registry.release('env-task-trace');
    registry.refresh();

    expect(emit).not.toHaveBeenCalled();
  });
});
