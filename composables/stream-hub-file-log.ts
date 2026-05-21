import type { LogFileLine } from '../api/log-file';

import { computed, getCurrentInstance, onBeforeUnmount, ref } from 'vue';

import {
  followLogFileApi,
  getLogFileTailApi,
  heartbeatLogFileFollowApi,
  unfollowLogFileApi,
} from '../api/log-file';
import { defineStreamHubLogStream } from '../define-stream';
import { useStreamHubLogStream } from '../use-stream-hub-log-stream';

type StreamHandle = {
  refresh: () => void;
  resourceId: number | string;
  stop: () => void;
};

interface StartFileLogFollowOptions {
  limit?: number;
}

const DEFAULT_LOG_LIMIT = 500;
const DEFAULT_HEARTBEAT_SECONDS = 15;
const MIN_HEARTBEAT_SECONDS = 5;

function resolveHeartbeatIntervalMs(leaseExpiresIn?: number) {
  if (
    typeof leaseExpiresIn === 'number' &&
    Number.isFinite(leaseExpiresIn) &&
    leaseExpiresIn > 0
  ) {
    return (
      Math.max(MIN_HEARTBEAT_SECONDS, Math.floor(leaseExpiresIn / 2)) * 1000
    );
  }

  return DEFAULT_HEARTBEAT_SECONDS * 1000;
}

export const streamHubFileLogStream = defineStreamHubLogStream<LogFileLine>(
  {
    domain: 'stream_hub',
    fetchTail: async (fileId, limit) =>
      (await getLogFileTailApi(String(fileId), { limit })).lines ?? [],
    idKey: 'fileId',
    resource: 'file',
    stream: 'file_log',
  },
);

export function useStreamHubFileLogFollow() {
  const streamClient = useStreamHubLogStream<LogFileLine>(
    streamHubFileLogStream,
  );
  const currentFileId = ref<string>();
  const currentLeaseId = ref<string>();
  const isFollowing = ref(false);

  let sessionSeq = 0;
  let handle: null | StreamHandle = null;
  let heartbeatTimer: null | ReturnType<typeof setInterval> = null;

  const following = computed(() => isFollowing.value);

  function nextSession() {
    sessionSeq += 1;
    return sessionSeq;
  }

  function isCurrentSession(session: number) {
    return session === sessionSeq;
  }

  function clearHeartbeat() {
    if (!heartbeatTimer) {
      return;
    }

    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }

  async function heartbeat(session: number) {
    if (!isCurrentSession(session)) {
      return;
    }

    const fileId = currentFileId.value;
    const leaseId = currentLeaseId.value;

    if (!fileId || !leaseId) {
      return;
    }

    try {
      const lease = await heartbeatLogFileFollowApi(fileId, leaseId);
      if (!isCurrentSession(session)) {
        return;
      }
      currentFileId.value = lease.fileId || fileId;
      currentLeaseId.value = lease.leaseId;
      isFollowing.value = lease.following;
      scheduleHeartbeat(session, lease.leaseExpiresIn);
    } catch {
      if (isCurrentSession(session)) {
        await stop();
      }
    }
  }

  function scheduleHeartbeat(session: number, leaseExpiresIn?: number) {
    if (!isCurrentSession(session)) {
      return;
    }

    clearHeartbeat();
    heartbeatTimer = setInterval(() => {
      void heartbeat(session);
    }, resolveHeartbeatIntervalMs(leaseExpiresIn));
  }

  async function releaseLease(fileId: string, leaseId: string) {
    try {
      await unfollowLogFileApi(fileId, leaseId);
    } catch {
      // stop 应保持幂等，释放失败留给后端 lease 过期兜底。
    }
  }

  async function start(
    fileId: string,
    options: StartFileLogFollowOptions = {},
  ) {
    const session = nextSession();
    await stopActiveSession();
    if (!isCurrentSession(session)) {
      return;
    }

    const nextFileId = String(fileId);
    let nextHandle: null | StreamHandle = null;
    let registeredHandle = false;

    try {
      nextHandle = await streamClient.subscribe(
        nextFileId,
        {},
        { limit: options.limit ?? DEFAULT_LOG_LIMIT },
      );
      if (!isCurrentSession(session)) {
        nextHandle.stop();
        return;
      }

      handle = nextHandle;
      registeredHandle = true;
      currentFileId.value = nextFileId;

      const lease = await followLogFileApi(nextFileId);
      if (!isCurrentSession(session)) {
        if (!registeredHandle || handle === nextHandle) {
          nextHandle.stop();
        }
        await releaseLease(lease.fileId || nextFileId, lease.leaseId);
        return;
      }

      currentFileId.value = lease.fileId || nextFileId;
      currentLeaseId.value = lease.leaseId;
      isFollowing.value = lease.following;
      scheduleHeartbeat(session, lease.leaseExpiresIn);
    } catch (error) {
      if (nextHandle && (!registeredHandle || handle === nextHandle)) {
        nextHandle.stop();
      }

      if (!isCurrentSession(session)) {
        return;
      }

      if (nextHandle && handle === nextHandle) {
        handle = null;
      }
      clearHeartbeat();
      currentFileId.value = undefined;
      currentLeaseId.value = undefined;
      isFollowing.value = false;
      throw error;
    }
  }

  async function stopActiveSession() {
    clearHeartbeat();

    const activeHandle = handle;
    const fileId = currentFileId.value;
    const leaseId = currentLeaseId.value;

    handle = null;
    currentFileId.value = undefined;
    currentLeaseId.value = undefined;
    isFollowing.value = false;

    activeHandle?.stop();

    if (!fileId || !leaseId) {
      return;
    }

    await releaseLease(fileId, leaseId);
  }

  async function stop() {
    nextSession();
    await stopActiveSession();
  }

  if (getCurrentInstance()) {
    onBeforeUnmount(() => {
      void stop();
    });
  }

  return {
    clearLocal: streamClient.clearLocal,
    fileId: computed(() => currentFileId.value),
    following,
    leaseId: computed(() => currentLeaseId.value),
    logs: streamClient.logs,
    start,
    status: streamClient.status,
    stop,
  };
}
