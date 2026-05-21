import type { StreamHubStreamDefinition } from './types';

import { useWebSocketStore } from '#/store/websocket';

export type StreamHubRoomResourceId = number | string;

export interface StreamHubRoomRegistryOptions<
  TResourceId extends StreamHubRoomResourceId = StreamHubRoomResourceId,
> {
  validateResourceId?: (resourceId: TResourceId) => boolean;
}

export interface StreamHubRoomRegistry<
  TResourceId extends StreamHubRoomResourceId = StreamHubRoomResourceId,
> {
  refresh: () => void;
  release: (resourceId: TResourceId) => void;
  retain: (resourceId: TResourceId) => void;
}

function streamPayload(
  stream: StreamHubStreamDefinition,
  resourceId: StreamHubRoomResourceId,
) {
  return stream.idKey ? { [stream.idKey]: resourceId } : {};
}

export function createStreamHubRoomRegistry<
  TResourceId extends StreamHubRoomResourceId = StreamHubRoomResourceId,
>(
  stream: StreamHubStreamDefinition,
  options: StreamHubRoomRegistryOptions<TResourceId> = {},
): StreamHubRoomRegistry<TResourceId> {
  const refs = new Map<TResourceId, number>();

  function isValid(resourceId: TResourceId) {
    return options.validateResourceId?.(resourceId) ?? true;
  }

  function retain(resourceId: TResourceId) {
    if (!isValid(resourceId)) {
      return;
    }
    const count = refs.get(resourceId) || 0;
    refs.set(resourceId, count + 1);
    if (count === 0) {
      useWebSocketStore().emit(
        stream.events.subscribe,
        streamPayload(stream, resourceId),
      );
    }
  }

  function release(resourceId: TResourceId) {
    if (!isValid(resourceId)) {
      return;
    }
    const count = refs.get(resourceId) || 0;
    if (count === 0) {
      return;
    }
    if (count > 1) {
      refs.set(resourceId, count - 1);
      return;
    }
    refs.delete(resourceId);
    useWebSocketStore().emit(
      stream.events.unsubscribe,
      streamPayload(stream, resourceId),
    );
  }

  function refresh() {
    const wsStore = useWebSocketStore();
    for (const resourceId of refs.keys()) {
      wsStore.emit(stream.events.subscribe, streamPayload(stream, resourceId));
    }
  }

  return {
    refresh,
    release,
    retain,
  };
}
