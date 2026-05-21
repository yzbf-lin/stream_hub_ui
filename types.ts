export type StreamHubStreamFeature = string;

export type StreamHubStreamEvents<TFeature extends string = string> = {
  subscribe: string;
  unsubscribe: string;
} & Record<TFeature, string>;

export interface DefineStreamHubStreamOptions<
  TFeature extends string = StreamHubStreamFeature,
> {
  domain: string;
  features?: readonly TFeature[];
  fixedRoom?: boolean;
  idKey?: string;
  resource?: string;
  stream: string;
}

export interface StreamHubStreamDefinition<
  TFeature extends string = StreamHubStreamFeature,
> {
  domain: string;
  events: StreamHubStreamEvents<TFeature>;
  features: readonly TFeature[];
  fixedRoom: boolean;
  idKey: string | undefined;
  resource: string | undefined;
  stream: string;
}

export type StreamHubLogTailFetcher<TLogLine = unknown> = (
  resourceId: number | string,
  limit?: number,
) => Promise<readonly TLogLine[]>;

export type StreamHubLogStreamEvents<TFeature extends string = string> =
  StreamHubStreamEvents<TFeature> & {
    append: string;
  };

export interface DefineStreamHubLogStreamOptions<
  TLogLine = unknown,
  TFeature extends string = StreamHubStreamFeature,
> extends DefineStreamHubStreamOptions<TFeature> {
  fetchTail: StreamHubLogTailFetcher<TLogLine>;
}

export interface StreamHubLogStreamDefinition<
  TLogLine = unknown,
  TFeature extends string = StreamHubStreamFeature,
> extends Omit<StreamHubStreamDefinition<TFeature>, 'events'> {
  events: StreamHubLogStreamEvents<TFeature>;
  fetchTail: StreamHubLogTailFetcher<TLogLine>;
}
