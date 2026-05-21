import { beforeEach, describe, expect, it, vi } from 'vitest';

import { defineStreamHubStream } from './define-stream';

const connect = vi.fn();
const emit = vi.fn();
const on = vi.fn();
const onReconnect = vi.fn();

vi.mock('#/store/websocket', () => ({
  useWebSocketStore: () => ({
    connect,
    emit,
    isConnected: true,
    on,
    onReconnect,
  }),
}));

async function loadComposable() {
  vi.resetModules();
  const cleanups: Array<() => void> = [];
  const listeners = new Map<string, (payload: unknown) => void>();
  const reconnectCleanup = vi.fn();

  connect.mockClear();
  emit.mockClear();
  on.mockReset();
  onReconnect.mockReset();

  on.mockImplementation(
    (event: string, callback: (payload: unknown) => void) => {
      listeners.set(event, callback);
      const cleanup = vi.fn(() => listeners.delete(event));
      cleanups.push(cleanup);
      return cleanup;
    },
  );
  onReconnect.mockImplementation(() => reconnectCleanup);

  return {
    ...(await import('./use-stream-hub-stream')),
    cleanups,
    listeners,
    reconnectCleanup,
  };
}

describe('useStreamHubStream', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('subscribes, filters feature events, and unsubscribes run resources', async () => {
    const { cleanups, listeners, useStreamHubStream } = await loadComposable();
    const stream = defineStreamHubStream({
      domain: 'env_task',
      features: ['snapshot', 'status', 'finished'],
      resource: 'run',
      stream: 'run',
    });
    const handlers = {
      onFinished: vi.fn(),
      onSnapshot: vi.fn(),
      onStatus: vi.fn(),
    };

    const streamClient = useStreamHubStream(stream);
    const handle = streamClient.subscribe(7, handlers);

    expect(connect).toHaveBeenCalledTimes(1);
    expect(on).toHaveBeenCalledWith(
      'env_task_run_snapshot',
      expect.any(Function),
    );
    expect(on).toHaveBeenCalledWith(
      'env_task_run_status',
      expect.any(Function),
    );
    expect(on).toHaveBeenCalledWith(
      'env_task_run_finished',
      expect.any(Function),
    );
    expect(emit).toHaveBeenCalledWith('env_task_run_subscribe', { run_id: 7 });

    listeners.get('env_task_run_status')?.({ run_id: 8, status: 'running' });
    listeners.get('env_task_run_status')?.({ run_id: 7, status: 'done' });
    expect(handlers.onStatus).toHaveBeenCalledTimes(1);
    expect(handlers.onStatus).toHaveBeenCalledWith({
      run_id: 7,
      status: 'done',
    });

    handle.stop();

    expect(emit).toHaveBeenLastCalledWith('env_task_run_unsubscribe', {
      run_id: 7,
    });
    expect(cleanups).toHaveLength(3);
    for (const cleanup of cleanups) {
      expect(cleanup).toHaveBeenCalledTimes(1);
    }
  });

  it('re-emits active subscriptions after websocket reconnect', async () => {
    const { useStreamHubStream } = await loadComposable();
    const stream = defineStreamHubStream({
      domain: 'env_task',
      features: ['snapshot'],
      resource: 'run',
      stream: 'run',
    });

    const streamClient = useStreamHubStream(stream);
    streamClient.subscribe(7, {});
    emit.mockClear();

    const reconnectCallback = onReconnect.mock.calls[0]?.[0];
    reconnectCallback();

    expect(emit).toHaveBeenCalledWith('env_task_run_subscribe', { run_id: 7 });
  });

  it('includes extra subscribe payload and preserves it on refresh and reconnect', async () => {
    const { useStreamHubStream } = await loadComposable();
    const stream = defineStreamHubStream({
      domain: 'env_task',
      features: ['snapshot'],
      resource: 'run',
      stream: 'run',
    });

    const streamClient = useStreamHubStream(stream);
    const handle = streamClient.subscribe(7, {}, { payload: { log_limit: 25 } });

    expect(emit).toHaveBeenCalledWith('env_task_run_subscribe', {
      log_limit: 25,
      run_id: 7,
    });

    emit.mockClear();
    handle.refresh();
    expect(emit).toHaveBeenCalledWith('env_task_run_subscribe', {
      log_limit: 25,
      run_id: 7,
    });

    emit.mockClear();
    const reconnectCallback = onReconnect.mock.calls[0]?.[0];
    reconnectCallback();
    expect(emit).toHaveBeenCalledWith('env_task_run_subscribe', {
      log_limit: 25,
      run_id: 7,
    });

    handle.stop();
    expect(emit).toHaveBeenLastCalledWith('env_task_run_unsubscribe', {
      run_id: 7,
    });
  });

  it('can bind feature events without managing the socket room', async () => {
    const { cleanups, listeners, useStreamHubStream } = await loadComposable();
    const stream = defineStreamHubStream({
      domain: 'operable_player',
      features: ['status'],
      resource: 'player',
      stream: 'player',
    });
    const onStatus = vi.fn();

    const streamClient = useStreamHubStream(stream);
    const handle = streamClient.subscribe(7, { onStatus }, { manageRoom: false });

    expect(connect).toHaveBeenCalledTimes(1);
    expect(on).toHaveBeenCalledWith(
      'operable_player_player_status',
      expect.any(Function),
    );
    expect(emit).not.toHaveBeenCalled();
    expect(onReconnect).not.toHaveBeenCalled();

    listeners.get('operable_player_player_status')?.({
      player_id: 7,
      status: 'online',
    });
    expect(onStatus).toHaveBeenCalledWith({
      player_id: 7,
      status: 'online',
    });

    handle.refresh();
    handle.stop();

    expect(emit).not.toHaveBeenCalled();
    expect(cleanups[0]).toHaveBeenCalledTimes(1);
  });

  it('keeps externally managed subscriptions out of reconnect resubscribe', async () => {
    const { reconnectCleanup, useStreamHubStream } = await loadComposable();
    const stream = defineStreamHubStream({
      domain: 'operable_player',
      features: ['status'],
      resource: 'player',
      stream: 'player',
    });

    const streamClient = useStreamHubStream(stream);
    const managed = streamClient.subscribe(7, {});
    streamClient.subscribe(8, {}, { manageRoom: false });
    emit.mockClear();

    const reconnectCallback = onReconnect.mock.calls[0]?.[0];
    reconnectCallback();

    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith('operable_player_player_subscribe', {
      player_id: 7,
    });

    managed.stop();
    expect(reconnectCleanup).toHaveBeenCalledTimes(1);
  });

  it('disposes reconnect listener when the last subscription stops', async () => {
    const { reconnectCleanup, useStreamHubStream } = await loadComposable();
    const stream = defineStreamHubStream({
      domain: 'env_task',
      features: ['snapshot'],
      resource: 'run',
      stream: 'run',
    });

    const streamClient = useStreamHubStream(stream);

    expect(onReconnect).not.toHaveBeenCalled();

    const first = streamClient.subscribe(7, {});
    const second = streamClient.subscribe(8, {});

    expect(onReconnect).toHaveBeenCalledTimes(1);

    first.stop();
    expect(reconnectCleanup).not.toHaveBeenCalled();

    second.stop();
    expect(reconnectCleanup).toHaveBeenCalledTimes(1);
  });

  it('rejects duplicate fixed-room subscriptions in the same composable', async () => {
    const { useStreamHubStream } = await loadComposable();
    const stream = defineStreamHubStream({
      domain: 'env_task',
      features: ['snapshot'],
      fixedRoom: true,
      stream: 'active',
    });
    const streamClient = useStreamHubStream(stream);

    streamClient.subscribe('active', {});

    expect(() => streamClient.subscribe('active-again', {})).toThrow(
      /fixed-room stream already has an active subscription/i,
    );
    expect(on).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith('env_task_active_subscribe', {});
  });
});
