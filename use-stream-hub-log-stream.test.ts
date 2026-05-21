import { beforeEach, describe, expect, it, vi } from 'vitest';

import { defineStreamHubLogStream } from './define-stream';

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
    ...(await import('./use-stream-hub-log-stream')),
    cleanups,
    listeners,
    reconnectCleanup,
  };
}

describe('useStreamHubLogStream', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('backfills, dedupes append by stream_seq, and cleans up on stop', async () => {
    const { cleanups, listeners, useStreamHubLogStream } =
      await loadComposable();
    const fetchTail = vi.fn().mockResolvedValue([
      { line: 'tail-1', run_id: 7, stream_seq: 1 },
      { line: 'tail-2', run_id: 7, stream_seq: 2 },
    ]);
    const stream = defineStreamHubLogStream({
      domain: 'env_task',
      fetchTail,
      resource: 'run',
      stream: 'run_log',
    });
    const onAppend = vi.fn();
    const onBackfill = vi.fn();

    const streamClient = useStreamHubLogStream(stream);
    const handle = await streamClient.subscribe(
      7,
      { onAppend, onBackfill },
      { limit: 20 },
    );

    expect(connect).toHaveBeenCalledTimes(1);
    expect(on).toHaveBeenCalledWith(
      'env_task_run_log_append',
      expect.any(Function),
    );
    expect(emit).toHaveBeenCalledWith('env_task_run_log_subscribe', {
      run_id: 7,
    });
    expect(fetchTail).toHaveBeenCalledWith(7, 20);
    expect(onBackfill).toHaveBeenCalledWith([
      { line: 'tail-1', run_id: 7, stream_seq: 1 },
      { line: 'tail-2', run_id: 7, stream_seq: 2 },
    ]);

    listeners.get('env_task_run_log_append')?.({
      line: 'duplicate',
      run_id: 7,
      stream_seq: 2,
    });
    listeners.get('env_task_run_log_append')?.({
      line: 'other-run',
      run_id: 8,
      stream_seq: 3,
    });
    listeners.get('env_task_run_log_append')?.({
      line: 'live',
      run_id: 7,
      stream_seq: 3,
    });

    expect(onAppend).toHaveBeenCalledTimes(1);
    expect(onAppend).toHaveBeenCalledWith({
      line: 'live',
      run_id: 7,
      stream_seq: 3,
    });
    expect(streamClient.logs.value).toEqual([
      { line: 'tail-1', run_id: 7, stream_seq: 1 },
      { line: 'tail-2', run_id: 7, stream_seq: 2 },
      { line: 'live', run_id: 7, stream_seq: 3 },
    ]);

    handle.stop();

    expect(emit).toHaveBeenLastCalledWith('env_task_run_log_unsubscribe', {
      run_id: 7,
    });
    expect(cleanups).toHaveLength(1);
    expect(cleanups[0]).toHaveBeenCalledTimes(1);
  });

  it('re-subscribes and backfills active logs after websocket reconnect', async () => {
    const { useStreamHubLogStream } = await loadComposable();
    const fetchTail = vi
      .fn()
      .mockResolvedValueOnce([{ line: 'tail-1', run_id: 7, stream_seq: 1 }])
      .mockResolvedValueOnce([{ line: 'tail-2', run_id: 7, stream_seq: 2 }]);
    const stream = defineStreamHubLogStream({
      domain: 'env_task',
      fetchTail,
      resource: 'run',
      stream: 'run_log',
    });
    const onBackfill = vi.fn();

    const streamClient = useStreamHubLogStream(stream);
    await streamClient.subscribe(7, { onBackfill }, { limit: 20 });
    emit.mockClear();

    const reconnectCallback = onReconnect.mock.calls[0]?.[0];
    reconnectCallback();
    await vi.waitFor(() => expect(fetchTail).toHaveBeenCalledTimes(2));

    expect(emit).toHaveBeenCalledWith('env_task_run_log_subscribe', {
      run_id: 7,
    });
    expect(fetchTail).toHaveBeenLastCalledWith(7, 20);
    expect(onBackfill).toHaveBeenLastCalledWith([
      { line: 'tail-2', run_id: 7, stream_seq: 2 },
    ]);
  });

  it('switches to a single active resource without mixing old logs or appends', async () => {
    const { listeners, useStreamHubLogStream } = await loadComposable();
    const fetchTail = vi
      .fn()
      .mockResolvedValueOnce([{ line: 'run-7-tail', run_id: 7, stream_seq: 1 }])
      .mockResolvedValueOnce([
        { line: 'run-8-tail', run_id: 8, stream_seq: 1 },
      ]);
    const stream = defineStreamHubLogStream({
      domain: 'env_task',
      fetchTail,
      resource: 'run',
      stream: 'run_log',
    });

    const streamClient = useStreamHubLogStream(stream);
    await streamClient.subscribe(7);
    await streamClient.subscribe(8);

    listeners.get('env_task_run_log_append')?.({
      line: 'old-run-live',
      run_id: 7,
      stream_seq: 2,
    });
    listeners.get('env_task_run_log_append')?.({
      line: 'new-run-live',
      run_id: 8,
      stream_seq: 2,
    });

    expect(streamClient.logs.value).toEqual([
      { line: 'run-8-tail', run_id: 8, stream_seq: 1 },
      { line: 'new-run-live', run_id: 8, stream_seq: 2 },
    ]);
    expect(emit).toHaveBeenCalledWith('env_task_run_log_unsubscribe', {
      run_id: 7,
    });
  });

  it('preserves live appends that arrive while backfill is pending', async () => {
    const { listeners, useStreamHubLogStream } = await loadComposable();
    let resolveTail:
      | ((
          logs: Array<{ line: string; run_id: number; stream_seq: number }>,
        ) => void)
      | undefined;
    const fetchTail = vi.fn(
      () =>
        new Promise<
          Array<{ line: string; run_id: number; stream_seq: number }>
        >((resolve) => {
          resolveTail = resolve;
        }),
    );
    const stream = defineStreamHubLogStream({
      domain: 'env_task',
      fetchTail,
      resource: 'run',
      stream: 'run_log',
    });

    const streamClient = useStreamHubLogStream(stream);
    const subscribePromise = streamClient.subscribe(7);

    listeners.get('env_task_run_log_append')?.({
      line: 'live-while-loading',
      run_id: 7,
      stream_seq: 3,
    });
    resolveTail?.([
      { line: 'tail-1', run_id: 7, stream_seq: 1 },
      { line: 'tail-2', run_id: 7, stream_seq: 2 },
    ]);
    await subscribePromise;

    expect(streamClient.logs.value).toEqual([
      { line: 'tail-1', run_id: 7, stream_seq: 1 },
      { line: 'tail-2', run_id: 7, stream_seq: 2 },
      { line: 'live-while-loading', run_id: 7, stream_seq: 3 },
    ]);
  });

  it('keeps file log append events when disk tail uses negative stream sequence', async () => {
    const { listeners, useStreamHubLogStream } = await loadComposable();
    const fetchTail = vi.fn().mockResolvedValue([
      {
        fileId: 'file-1',
        message: 'tail-line',
        stream_seq: -1,
      },
    ]);
    const stream = defineStreamHubLogStream({
      domain: 'stream_hub',
      fetchTail,
      idKey: 'fileId',
      resource: 'file',
      stream: 'file_log',
    });

    const streamClient = useStreamHubLogStream(stream);
    await streamClient.subscribe('file-1');

    listeners.get('stream_hub_file_log_append')?.({
      fileId: 'file-1',
      message: 'live-line',
      stream_seq: 85,
    });

    expect(streamClient.logs.value).toEqual([
      {
        fileId: 'file-1',
        message: 'tail-line',
        stream_seq: -1,
      },
      {
        fileId: 'file-1',
        message: 'live-line',
        stream_seq: 85,
      },
    ]);
  });

  it('disposes reconnect listener when the active subscription stops', async () => {
    const { reconnectCleanup, useStreamHubLogStream } = await loadComposable();
    const fetchTail = vi.fn().mockResolvedValue([]);
    const stream = defineStreamHubLogStream({
      domain: 'env_task',
      fetchTail,
      resource: 'run',
      stream: 'run_log',
    });
    const streamClient = useStreamHubLogStream(stream);

    expect(onReconnect).not.toHaveBeenCalled();

    const handle = await streamClient.subscribe(7);

    expect(onReconnect).toHaveBeenCalledTimes(1);

    handle.stop();

    expect(reconnectCleanup).toHaveBeenCalledTimes(1);
  });
});
