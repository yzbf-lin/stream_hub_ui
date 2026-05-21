import type { StreamHubStreamDefinition } from './types';

import { computed, getCurrentInstance, onBeforeUnmount } from 'vue';

import { useWebSocketStore } from '#/store/websocket';

type ResourceId = number | string;
type Cleanup = () => void;
type EventPayload = Record<string, unknown>;
type SubscribePayload = Record<string, unknown>;

export type StreamHubStreamStatus = 'connected' | 'connecting' | 'disconnected';

export type StreamHubStreamHandlers<TFeature extends string = string> = Partial<
  Record<`on${Capitalize<TFeature>}`, (event: EventPayload) => void>
>;

export interface StreamHubStreamSubscribeOptions {
  manageRoom?: boolean;
  payload?: SubscribePayload;
}

interface SubscriptionState<TFeature extends string = string> {
  cleanups: Cleanup[];
  handlers: StreamHubStreamHandlers<TFeature>;
  options: StreamHubStreamSubscribeOptions;
  resourceId: ResourceId;
}

function toHandlerName(feature: string): string {
  return `on${feature.charAt(0).toUpperCase()}${feature.slice(1)}`;
}

function isEventPayload(payload: unknown): payload is EventPayload {
  return payload !== null && typeof payload === 'object';
}

function matchesResource(
  idKey: string | undefined,
  resourceId: ResourceId,
  payload: unknown,
): payload is EventPayload {
  if (!idKey) {
    return isEventPayload(payload);
  }
  return isEventPayload(payload) && payload[idKey] === resourceId;
}

function subscriptionPayload(
  idKey: string | undefined,
  resourceId: ResourceId,
  payload?: SubscribePayload,
): SubscribePayload {
  if (!idKey) {
    return payload ?? {};
  }
  return { ...(payload ?? {}), [idKey]: resourceId };
}

function shouldManageRoom(options: StreamHubStreamSubscribeOptions): boolean {
  return options.manageRoom !== false;
}

export function useStreamHubStream<TFeature extends string = string>(
  stream: StreamHubStreamDefinition<TFeature>,
) {
  const wsStore = useWebSocketStore();
  const subscriptions = new Map<ResourceId, SubscriptionState<TFeature>>();
  let cleanupReconnect: Cleanup | undefined;

  const status = computed<StreamHubStreamStatus>(() =>
    wsStore.isConnected ? 'connected' : 'disconnected',
  );

  function emitSubscribe(
    resourceId: ResourceId,
    options: StreamHubStreamSubscribeOptions = {},
  ) {
    wsStore.emit(
      stream.events.subscribe,
      subscriptionPayload(stream.idKey, resourceId, options.payload),
    );
  }

  function emitUnsubscribe(resourceId: ResourceId) {
    wsStore.emit(
      stream.events.unsubscribe,
      subscriptionPayload(stream.idKey, resourceId),
    );
  }

  function cleanupSubscription(resourceId: ResourceId) {
    const state = subscriptions.get(resourceId);
    if (!state) {
      return;
    }

    state.cleanups.forEach((cleanup) => cleanup());
    subscriptions.delete(resourceId);
  }

  function hasManagedSubscriptions() {
    return [...subscriptions.values()].some((state) =>
      shouldManageRoom(state.options),
    );
  }

  function ensureReconnectListener() {
    if (cleanupReconnect) {
      return;
    }

    cleanupReconnect = wsStore.onReconnect?.(() => {
      for (const state of subscriptions.values()) {
        if (!shouldManageRoom(state.options)) {
          continue;
        }
        emitSubscribe(state.resourceId, state.options);
      }
    });
  }

  function disposeReconnectListenerIfIdle() {
    if (hasManagedSubscriptions()) {
      return;
    }

    cleanupReconnect?.();
    cleanupReconnect = undefined;
  }

  function bindListeners(
    resourceId: ResourceId,
    handlers: StreamHubStreamHandlers<TFeature>,
  ): Cleanup[] {
    return stream.features.map((feature) => {
      const eventName = stream.events[feature];
      const handlerName = toHandlerName(feature);

      return wsStore.on(eventName, (payload: unknown) => {
        if (!matchesResource(stream.idKey, resourceId, payload)) {
          return;
        }

        const handler = handlers[
          handlerName as keyof StreamHubStreamHandlers<TFeature>
        ] as undefined | ((event: EventPayload) => void);
        handler?.(payload);
      });
    });
  }

  function subscribe(
    resourceId: ResourceId,
    handlers: StreamHubStreamHandlers<TFeature> = {},
    options: StreamHubStreamSubscribeOptions = {},
  ) {
    if (!stream.idKey && subscriptions.size > 0) {
      throw new Error(
        'Stream hub fixed-room stream already has an active subscription.',
      );
    }

    unsubscribe(resourceId);
    wsStore.connect();

    const state: SubscriptionState<TFeature> = {
      cleanups: bindListeners(resourceId, handlers),
      handlers,
      options,
      resourceId,
    };
    subscriptions.set(resourceId, state);
    if (shouldManageRoom(options)) {
      ensureReconnectListener();
      emitSubscribe(resourceId, options);
    }

    return {
      refresh: () => {
        if (shouldManageRoom(options)) {
          emitSubscribe(resourceId, options);
        }
      },
      resourceId,
      stop: () => unsubscribe(resourceId),
    };
  }

  function unsubscribe(resourceId?: ResourceId) {
    if (resourceId === undefined) {
      for (const activeResourceId of [...subscriptions.keys()]) {
        unsubscribe(activeResourceId);
      }
      return;
    }

    const state = subscriptions.get(resourceId);
    if (!state) {
      return;
    }

    if (shouldManageRoom(state.options)) {
      emitUnsubscribe(resourceId);
    }
    cleanupSubscription(resourceId);
    disposeReconnectListenerIfIdle();
  }

  if (getCurrentInstance()) {
    onBeforeUnmount(() => {
      unsubscribe();
      disposeReconnectListenerIfIdle();
    });
  }

  return {
    status,
    subscribe,
    unsubscribe,
  };
}
