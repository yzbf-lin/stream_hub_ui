import type {
  DefineStreamHubLogStreamOptions,
  DefineStreamHubStreamOptions,
  StreamHubLogStreamDefinition,
  StreamHubStreamDefinition,
  StreamHubStreamEvents,
} from './types';

const NAME_PATTERN = /^[A-Za-z0-9_]+$/;

function assertValidName(name: string, field: string): void {
  if (!NAME_PATTERN.test(name)) {
    throw new Error(
      `Invalid stream hub ${field}: ${name}. Use only [A-Za-z0-9_].`,
    );
  }
}

function toSnakeFeature(feature: string): string {
  return feature
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .toLowerCase();
}

function validateOptions(options: {
  domain: string;
  idKey?: string;
  resource?: string;
  stream: string;
}): void {
  assertValidName(options.domain, 'domain');
  assertValidName(options.stream, 'stream');

  if (options.idKey !== undefined) {
    assertValidName(options.idKey, 'idKey');
  }

  if (options.resource !== undefined) {
    assertValidName(options.resource, 'resource');
  }
}

function resolveIdKey(options: {
  fixedRoom: boolean;
  idKey?: string;
  resource?: string;
}): string | undefined {
  if (options.idKey !== undefined) {
    return options.idKey;
  }

  return options.resource && !options.fixedRoom
    ? `${options.resource}_id`
    : undefined;
}

export function defineStreamHubStream<TFeature extends string = string>(
  options: DefineStreamHubStreamOptions<TFeature>,
): StreamHubStreamDefinition<TFeature> {
  validateOptions(options);

  const { domain, resource, stream } = options;
  const features = options.features ?? [];
  const fixedRoom = options.fixedRoom === true;
  const prefix = `${domain}_${stream}`;
  const events: StreamHubStreamEvents<TFeature> = {
    subscribe: `${prefix}_subscribe`,
    unsubscribe: `${prefix}_unsubscribe`,
  } as StreamHubStreamEvents<TFeature>;

  for (const feature of features) {
    (events as Record<TFeature, string>)[feature] =
      `${prefix}_${toSnakeFeature(feature)}`;
  }

  return {
    domain,
    events,
    features,
    fixedRoom,
    idKey: resolveIdKey({ fixedRoom, idKey: options.idKey, resource }),
    resource,
    stream,
  };
}

export function defineStreamHubLogStream<
  TLogLine = unknown,
  TFeature extends string = string,
>(
  options: DefineStreamHubLogStreamOptions<TLogLine, TFeature>,
): StreamHubLogStreamDefinition<TLogLine, TFeature> {
  const stream = defineStreamHubStream(options);
  const events = {
    ...stream.events,
    append: `${options.domain}_${options.stream}_append`,
  };

  return {
    ...stream,
    events,
    fetchTail: options.fetchTail,
  };
}
