import { beforeEach, describe, expect, it, vi } from 'vitest';

const streamHubMocks = vi.hoisted(() => {
  const stop = vi.fn();
  const handle = {
    refresh: vi.fn(),
    resourceId: 'file-1',
    stop,
  };
  const logStream = {
    logs: { value: [] },
    status: { value: 'connected' },
    subscribe: vi.fn(() => Promise.resolve(handle)),
  };

  return {
    handle,
    logStream,
    stop,
    useStreamHubLogStream: vi.fn(() => logStream),
  };
});

const apiMocks = vi.hoisted(() => ({
  followLogFileApi: vi.fn(),
  getLogFileTailApi: vi.fn(),
  heartbeatLogFileFollowApi: vi.fn(),
  unfollowLogFileApi: vi.fn(),
}));

vi.mock('../use-stream-hub-log-stream', () => ({
  useStreamHubLogStream: streamHubMocks.useStreamHubLogStream,
}));

vi.mock('../api/log-file', () => ({
  followLogFileApi: apiMocks.followLogFileApi,
  getLogFileTailApi: apiMocks.getLogFileTailApi,
  heartbeatLogFileFollowApi: apiMocks.heartbeatLogFileFollowApi,
  unfollowLogFileApi: apiMocks.unfollowLogFileApi,
}));

async function loadComposable() {
  vi.resetModules();
  return import('./stream-hub-file-log');
}

function resetMocks() {
  vi.clearAllMocks();
  streamHubMocks.logStream.logs.value = [];
  streamHubMocks.logStream.status.value = 'connected';
  streamHubMocks.logStream.subscribe.mockResolvedValue(streamHubMocks.handle);
  apiMocks.followLogFileApi.mockResolvedValue({
    fileId: 'file-1',
    following: true,
    leaseExpiresIn: 30,
    leaseId: 'lease-1',
    watcherCount: 1,
  });
  apiMocks.getLogFileTailApi.mockResolvedValue({
    exists: true,
    fileId: 'file-1',
    limit: 500,
    lines: [],
    truncated: false,
  });
  apiMocks.heartbeatLogFileFollowApi.mockResolvedValue({
    fileId: 'file-1',
    following: true,
    leaseExpiresIn: 30,
    leaseId: 'lease-1',
    watcherCount: 1,
  });
  apiMocks.unfollowLogFileApi.mockResolvedValue(undefined);
}

describe('useStreamHubFileLogFollow', () => {
  beforeEach(() => {
    vi.useRealTimers();
    resetMocks();
  });

  it('subscribes before following and releases lease plus websocket handle on stop', async () => {
    const { useStreamHubFileLogFollow } = await loadComposable();

    const follow = useStreamHubFileLogFollow();
    await follow.start('file-1', { limit: 500 });

    expect(streamHubMocks.logStream.subscribe).toHaveBeenCalledWith(
      'file-1',
      {},
      { limit: 500 },
    );
    expect(apiMocks.followLogFileApi).toHaveBeenCalledWith('file-1');
    expect(
      streamHubMocks.logStream.subscribe.mock.invocationCallOrder[0],
    ).toBeLessThan(apiMocks.followLogFileApi.mock.invocationCallOrder[0]);

    await follow.stop();

    expect(apiMocks.unfollowLogFileApi).toHaveBeenCalledWith(
      'file-1',
      'lease-1',
    );
    expect(streamHubMocks.stop).toHaveBeenCalledTimes(1);
    expect(follow.following.value).toBe(false);
    expect(follow.fileId.value).toBeUndefined();
    expect(follow.leaseId.value).toBeUndefined();
  });

  it('renews the follow lease using the backend lease interval', async () => {
    vi.useFakeTimers();
    const { useStreamHubFileLogFollow } = await loadComposable();

    const follow = useStreamHubFileLogFollow();
    await follow.start('file-1');

    await vi.advanceTimersByTimeAsync(15_000);

    expect(apiMocks.heartbeatLogFileFollowApi).toHaveBeenCalledWith(
      'file-1',
      'lease-1',
    );

    await follow.stop();
    vi.useRealTimers();
  });

  it('ignores stale heartbeat failures after switching to a newer lease', async () => {
    vi.useFakeTimers();
    const secondStop = vi.fn();
    streamHubMocks.logStream.subscribe
      .mockResolvedValueOnce(streamHubMocks.handle)
      .mockResolvedValueOnce({
        refresh: vi.fn(),
        resourceId: 'file-2',
        stop: secondStop,
      });
    apiMocks.followLogFileApi
      .mockResolvedValueOnce({
        fileId: 'file-1',
        following: true,
        leaseExpiresIn: 30,
        leaseId: 'lease-1',
        watcherCount: 1,
      })
      .mockResolvedValueOnce({
        fileId: 'file-2',
        following: true,
        leaseExpiresIn: 30,
        leaseId: 'lease-2',
        watcherCount: 1,
      });
    let rejectHeartbeat: ((error: Error) => void) | undefined;
    apiMocks.heartbeatLogFileFollowApi.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectHeartbeat = reject;
        }),
    );
    const { useStreamHubFileLogFollow } = await loadComposable();

    const follow = useStreamHubFileLogFollow();
    await follow.start('file-1');
    await vi.advanceTimersByTimeAsync(15_000);

    await follow.start('file-2');
    apiMocks.unfollowLogFileApi.mockClear();
    streamHubMocks.stop.mockClear();

    rejectHeartbeat?.(new Error('old heartbeat failed'));
    await Promise.resolve();

    expect(streamHubMocks.stop).not.toHaveBeenCalled();
    expect(secondStop).not.toHaveBeenCalled();
    expect(apiMocks.unfollowLogFileApi).not.toHaveBeenCalledWith(
      'file-2',
      'lease-2',
    );
    expect(follow.fileId.value).toBe('file-2');
    expect(follow.leaseId.value).toBe('lease-2');
    expect(follow.following.value).toBe(true);

    await follow.stop();
    vi.useRealTimers();
  });

  it('stops websocket and clears local state when follow fails without unfollowing', async () => {
    const error = new Error('follow failed');
    apiMocks.followLogFileApi.mockRejectedValueOnce(error);
    const { useStreamHubFileLogFollow } = await loadComposable();

    const follow = useStreamHubFileLogFollow();
    await expect(follow.start('file-1')).rejects.toThrow('follow failed');

    expect(streamHubMocks.stop).toHaveBeenCalledTimes(1);
    expect(apiMocks.unfollowLogFileApi).not.toHaveBeenCalled();
    expect(follow.following.value).toBe(false);
    expect(follow.fileId.value).toBeUndefined();
    expect(follow.leaseId.value).toBeUndefined();
  });

  it('releases the previous file before starting a new follow session', async () => {
    const secondStop = vi.fn();
    streamHubMocks.logStream.subscribe
      .mockResolvedValueOnce(streamHubMocks.handle)
      .mockResolvedValueOnce({
        refresh: vi.fn(),
        resourceId: 'file-2',
        stop: secondStop,
      });
    apiMocks.followLogFileApi
      .mockResolvedValueOnce({
        fileId: 'file-1',
        following: true,
        leaseExpiresIn: 30,
        leaseId: 'lease-1',
        watcherCount: 1,
      })
      .mockResolvedValueOnce({
        fileId: 'file-2',
        following: true,
        leaseExpiresIn: 20,
        leaseId: 'lease-2',
        watcherCount: 1,
      });
    const { useStreamHubFileLogFollow } = await loadComposable();

    const follow = useStreamHubFileLogFollow();
    await follow.start('file-1');
    await follow.start('file-2', { limit: 100 });

    expect(apiMocks.unfollowLogFileApi).toHaveBeenCalledWith(
      'file-1',
      'lease-1',
    );
    expect(streamHubMocks.stop).toHaveBeenCalledTimes(1);
    expect(streamHubMocks.logStream.subscribe).toHaveBeenLastCalledWith(
      'file-2',
      {},
      { limit: 100 },
    );
    expect(apiMocks.followLogFileApi).toHaveBeenLastCalledWith('file-2');
    expect(follow.fileId.value).toBe('file-2');
    expect(follow.leaseId.value).toBe('lease-2');

    await follow.stop();
    expect(secondStop).toHaveBeenCalledTimes(1);
  });

  it('keeps the latest concurrent start and releases stale resources', async () => {
    const firstStop = vi.fn();
    const secondStop = vi.fn();
    let resolveFirstFollow:
      | ((lease: {
          fileId: string;
          following: boolean;
          leaseExpiresIn: number;
          leaseId: string;
          watcherCount: number;
        }) => void)
      | undefined;
    streamHubMocks.logStream.subscribe
      .mockResolvedValueOnce({
        refresh: vi.fn(),
        resourceId: 'file-1',
        stop: firstStop,
      })
      .mockResolvedValueOnce({
        refresh: vi.fn(),
        resourceId: 'file-2',
        stop: secondStop,
      });
    apiMocks.followLogFileApi.mockImplementation((fileId: string) => {
      if (fileId === 'file-1') {
        return new Promise((resolve) => {
          resolveFirstFollow = resolve;
        });
      }

      return Promise.resolve({
        fileId: 'file-2',
        following: true,
        leaseExpiresIn: 20,
        leaseId: 'lease-2',
        watcherCount: 1,
      });
    });
    const { useStreamHubFileLogFollow } = await loadComposable();

    const follow = useStreamHubFileLogFollow();
    const firstStart = follow.start('file-1');
    await vi.waitFor(() =>
      expect(apiMocks.followLogFileApi).toHaveBeenCalledWith('file-1'),
    );
    const secondStart = follow.start('file-2');

    await secondStart;
    expect(follow.fileId.value).toBe('file-2');
    expect(follow.leaseId.value).toBe('lease-2');

    resolveFirstFollow?.({
      fileId: 'file-1',
      following: true,
      leaseExpiresIn: 30,
      leaseId: 'lease-1',
      watcherCount: 1,
    });
    await firstStart;

    expect(follow.fileId.value).toBe('file-2');
    expect(follow.leaseId.value).toBe('lease-2');
    expect(follow.following.value).toBe(true);
    expect(firstStop).toHaveBeenCalledTimes(1);
    expect(apiMocks.unfollowLogFileApi).toHaveBeenCalledWith(
      'file-1',
      'lease-1',
    );
    expect(secondStop).not.toHaveBeenCalled();

    await follow.stop();
    expect(secondStop).toHaveBeenCalledTimes(1);
  });

  it('stops stale handles when an older subscribe resolves after a newer start', async () => {
    const firstStop = vi.fn();
    const secondStop = vi.fn();
    let resolveFirstSubscribe:
      | ((handle: {
          refresh: () => void;
          resourceId: string;
          stop: () => void;
        }) => void)
      | undefined;
    streamHubMocks.logStream.subscribe
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirstSubscribe = resolve;
          }),
      )
      .mockResolvedValueOnce({
        refresh: vi.fn(),
        resourceId: 'file-2',
        stop: secondStop,
      });
    apiMocks.followLogFileApi.mockResolvedValueOnce({
      fileId: 'file-2',
      following: true,
      leaseExpiresIn: 20,
      leaseId: 'lease-2',
      watcherCount: 1,
    });
    const { useStreamHubFileLogFollow } = await loadComposable();

    const follow = useStreamHubFileLogFollow();
    const firstStart = follow.start('file-1');
    await vi.waitFor(() =>
      expect(streamHubMocks.logStream.subscribe).toHaveBeenCalledWith(
        'file-1',
        {},
        { limit: 500 },
      ),
    );
    const secondStart = follow.start('file-2');

    await secondStart;
    expect(follow.fileId.value).toBe('file-2');
    expect(follow.leaseId.value).toBe('lease-2');

    resolveFirstSubscribe?.({
      refresh: vi.fn(),
      resourceId: 'file-1',
      stop: firstStop,
    });
    await firstStart;

    expect(follow.fileId.value).toBe('file-2');
    expect(follow.leaseId.value).toBe('lease-2');
    expect(follow.following.value).toBe(true);
    expect(firstStop).toHaveBeenCalledTimes(1);
    expect(apiMocks.followLogFileApi).not.toHaveBeenCalledWith('file-1');
    expect(secondStop).not.toHaveBeenCalled();

    await follow.stop();
    expect(secondStop).toHaveBeenCalledTimes(1);
  });

  it('keeps the latest start when an older start is waiting for previous stop', async () => {
    const initialStop = vi.fn();
    const firstStop = vi.fn();
    const secondStop = vi.fn();
    const handles: Record<
      string,
      { refresh: () => void; resourceId: string; stop: () => void }
    > = {
      'file-0': { refresh: vi.fn(), resourceId: 'file-0', stop: initialStop },
      'file-1': { refresh: vi.fn(), resourceId: 'file-1', stop: firstStop },
      'file-2': { refresh: vi.fn(), resourceId: 'file-2', stop: secondStop },
    };
    let releaseInitialLease: (() => void) | undefined;

    streamHubMocks.logStream.subscribe.mockImplementation((fileId: string) =>
      Promise.resolve(handles[fileId]),
    );
    apiMocks.followLogFileApi.mockImplementation((fileId: string) =>
      Promise.resolve({
        fileId,
        following: true,
        leaseExpiresIn: 30,
        leaseId: `lease-${fileId}`,
        watcherCount: 1,
      }),
    );
    apiMocks.unfollowLogFileApi.mockImplementation((fileId: string) => {
      if (fileId === 'file-0') {
        return new Promise((resolve) => {
          releaseInitialLease = () => resolve(undefined);
        });
      }

      return Promise.resolve();
    });
    const { useStreamHubFileLogFollow } = await loadComposable();

    const follow = useStreamHubFileLogFollow();
    await follow.start('file-0');

    const firstStart = follow.start('file-1');
    await vi.waitFor(() => expect(initialStop).toHaveBeenCalledTimes(1));
    const secondStart = follow.start('file-2');

    await secondStart;
    expect(follow.fileId.value).toBe('file-2');
    expect(follow.leaseId.value).toBe('lease-file-2');

    releaseInitialLease?.();
    await firstStart;

    expect(apiMocks.followLogFileApi).not.toHaveBeenCalledWith('file-1');
    expect(firstStop).not.toHaveBeenCalled();
    expect(secondStop).not.toHaveBeenCalled();
    expect(follow.fileId.value).toBe('file-2');
    expect(follow.leaseId.value).toBe('lease-file-2');

    await follow.stop();
    expect(secondStop).toHaveBeenCalledTimes(1);
  });
});

describe('streamHubFileLogStream', () => {
  beforeEach(() => {
    resetMocks();
  });

  it('defines the file log stream and fetches tail lines from the log file API', async () => {
    apiMocks.getLogFileTailApi.mockResolvedValueOnce({
      exists: true,
      fileId: 'file-1',
      limit: 50,
      lines: [{ message: 'tail' }],
      truncated: false,
    });
    const { streamHubFileLogStream } = await loadComposable();

    expect(streamHubFileLogStream).toMatchObject({
      domain: 'stream_hub',
      idKey: 'fileId',
      resource: 'file',
      stream: 'file_log',
    });
    expect(streamHubFileLogStream.events.append).toBe(
      'stream_hub_file_log_append',
    );

    const lines = await streamHubFileLogStream.fetchTail('file-1', 50);

    expect(apiMocks.getLogFileTailApi).toHaveBeenCalledWith('file-1', {
      limit: 50,
    });
    expect(lines).toEqual([{ message: 'tail' }]);
  });
});
