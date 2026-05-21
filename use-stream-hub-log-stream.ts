import type { StreamHubLogStreamDefinition } from './types';
import type { Ref } from 'vue';

import { computed, getCurrentInstance, onBeforeUnmount, ref } from 'vue';

import { useWebSocketStore } from '#/store/websocket';

type ResourceId = number | string;
type Cleanup = () => void;
type LogPayload = Record<string, unknown> & { stream_seq?: null | number };

export interface StreamHubLogStreamHandlers<TLogLine = unknown> {
  onAppend?: (log: TLogLine) => void;
  onBackfill?: (logs: readonly TLogLine[]) => void;
}

export interface StreamHubLogStreamOptions {
  limit?: number;
}

interface LogSubscriptionState<TLogLine = unknown> {
  closed: boolean;
  cleanup: Cleanup;
  handlers: StreamHubLogStreamHandlers<TLogLine>;
  options: StreamHubLogStreamOptions;
  resourceId: ResourceId;
  seenSeq: Set<number>;
}

function isRecord(payload: unknown): payload is Record<string, unknown> {
  return payload !== null && typeof payload === 'object';
}

function matchesResource(
  idKey: string | undefined,
  resourceId: ResourceId,
  payload: unknown,
): payload is LogPayload {
  if (!isRecord(payload)) {
    return false;
  }
  return !idKey || payload[idKey] === resourceId;
}

function subscriptionPayload(
  idKey: string | undefined,
  resourceId: ResourceId,
): Record<string, ResourceId> | Record<string, never> {
  return idKey ? { [idKey]: resourceId } : {};
}

function markSeen(logs: readonly unknown[], seenSeq: Set<number>) {
  seenSeq.clear();

  for (const log of logs) {
    if (!isRecord(log) || typeof log.stream_seq !== 'number') {
      continue;
    }
    seenSeq.add(log.stream_seq);
  }
}

function getStreamSeq(log: unknown): number | undefined {
  if (!isRecord(log) || typeof log.stream_seq !== 'number') {
    return undefined;
  }

  return log.stream_seq;
}

function mergeLogs<TLogLine>(
  backfillLogs: readonly TLogLine[],
  liveLogs: readonly TLogLine[],
): TLogLine[] {
  const seenSeq = new Set<number>();
  const merged: Array<{ index: number; log: TLogLine }> = [];

  for (const log of [...backfillLogs, ...liveLogs]) {
    const streamSeq = getStreamSeq(log);
    if (streamSeq !== undefined) {
      if (seenSeq.has(streamSeq)) {
        continue;
      }
      seenSeq.add(streamSeq);
    }

    merged.push({ index: merged.length, log });
  }

  return [...merged]
    .sort((left, right) => {
      const leftSeq = getStreamSeq(left.log);
      const rightSeq = getStreamSeq(right.log);

      if (leftSeq !== undefined && rightSeq !== undefined) {
        return leftSeq - rightSeq;
      }

      return left.index - right.index;
    })
    .map((entry) => entry.log);
}

export function useStreamHubLogStream<TLogLine = unknown>(
  stream: StreamHubLogStreamDefinition<TLogLine>,
) {
  const wsStore = useWebSocketStore();
  const logs = ref<TLogLine[]>([]) as Ref<TLogLine[]>;
  let activeState: LogSubscriptionState<TLogLine> | null = null;
  let cleanupReconnect: Cleanup | undefined;

  const status = computed(() =>
    wsStore.isConnected ? 'connected' : 'disconnected',
  );

  function emitSubscribe(resourceId: ResourceId) {
    wsStore.emit(
      stream.events.subscribe,
      subscriptionPayload(stream.idKey, resourceId),
    );
  }

  function emitUnsubscribe(resourceId: ResourceId) {
    wsStore.emit(
      stream.events.unsubscribe,
      subscriptionPayload(stream.idKey, resourceId),
    );
  }

  async function backfill(state: LogSubscriptionState<TLogLine>) {
    const items = await stream.fetchTail(
      state.resourceId,
      state.options.limit,
    );

    if (activeState !== state || state.closed) {
      return;
    }

    logs.value = mergeLogs(items, logs.value);
    markSeen(logs.value, state.seenSeq);
    state.handlers.onBackfill?.(items);
  }

  function appendLog(
    state: LogSubscriptionState<TLogLine>,
    payload: LogPayload,
  ) {
    if (activeState !== state || state.closed) {
      return;
    }

    if (
      typeof payload.stream_seq === 'number' &&
      state.seenSeq.has(payload.stream_seq)
    ) {
      return;
    }

    if (typeof payload.stream_seq === 'number') {
      state.seenSeq.add(payload.stream_seq);
    }

    const log = payload as TLogLine;
    logs.value.push(log);
    state.handlers.onAppend?.(log);
  }

  function ensureReconnectListener() {
    if (cleanupReconnect) {
      return;
    }

    cleanupReconnect = wsStore.onReconnect?.(() => {
      if (!activeState) {
        return;
      }

      emitSubscribe(activeState.resourceId);
      void backfill(activeState);
    });
  }

  function disposeReconnectListenerIfIdle() {
    if (activeState) {
      return;
    }

    cleanupReconnect?.();
    cleanupReconnect = undefined;
  }

  async function subscribe(
    resourceId: ResourceId,
    handlers: StreamHubLogStreamHandlers<TLogLine> = {},
    options: StreamHubLogStreamOptions = {},
  ) {
    unsubscribe();
    clearLocal();
    wsStore.connect();

    const seenSeq = new Set<number>();
    const state: LogSubscriptionState<TLogLine> = {
      closed: false,
      cleanup: () => {},
      handlers,
      options,
      resourceId,
      seenSeq,
    };
    state.cleanup = wsStore.on(stream.events.append, (payload: unknown) => {
      if (!matchesResource(stream.idKey, resourceId, payload)) {
        return;
      }
      appendLog(state, payload);
    });
    activeState = state;
    ensureReconnectListener();

    emitSubscribe(resourceId);
    await backfill(state);

    return {
      refresh: () => backfill(state),
      resourceId,
      stop: () => unsubscribe(resourceId),
    };
  }

  function unsubscribe(resourceId?: ResourceId) {
    if (!activeState) {
      return;
    }

    if (resourceId !== undefined && activeState.resourceId !== resourceId) {
      return;
    }

    const state = activeState;
    state.closed = true;
    emitUnsubscribe(state.resourceId);
    state.cleanup();
    activeState = null;
    disposeReconnectListenerIfIdle();
  }

  function clearLocal() {
    logs.value = [];
    activeState?.seenSeq.clear();
  }

  if (getCurrentInstance()) {
    onBeforeUnmount(() => {
      unsubscribe();
      disposeReconnectListenerIfIdle();
    });
  }

  return {
    clearLocal,
    logs,
    status,
    subscribe,
  };
}
