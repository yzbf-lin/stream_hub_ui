import { describe, expect, it } from 'vitest';

import { defineStreamHubLogStream, defineStreamHubStream } from './define-stream';

describe('defineStreamHubStream', () => {
  it('derives events and id field', () => {
    const stream = defineStreamHubStream({
      domain: 'env_task',
      stream: 'run',
      resource: 'run',
      features: ['snapshot', 'status', 'finished'],
    });

    expect(stream.events.subscribe).toBe('env_task_run_subscribe');
    expect(stream.events.unsubscribe).toBe('env_task_run_unsubscribe');
    expect(stream.events.snapshot).toBe('env_task_run_snapshot');
    expect(stream.events.status).toBe('env_task_run_status');
    expect(stream.idKey).toBe('run_id');
  });

  it('derives log append event', () => {
    const stream = defineStreamHubLogStream({
      domain: 'operable_player',
      stream: 'task_log',
      resource: 'trace',
      fetchTail: async () => [],
    });

    expect(stream.events.append).toBe('operable_player_task_log_append');
    expect(stream.idKey).toBe('trace_id');
  });

  it('uses explicit idKey while preserving the resource room payload', () => {
    const stream = defineStreamHubLogStream({
      domain: 'stream_hub',
      stream: 'file_log',
      resource: 'file',
      idKey: 'fileId',
      fetchTail: async () => [],
    });

    expect(stream.idKey).toBe('fileId');
    expect(stream.resource).toBe('file');
    expect(stream.events.subscribe).toBe('stream_hub_file_log_subscribe');
    expect(stream.events.append).toBe('stream_hub_file_log_append');
  });

  it('rejects invalid stream names', () => {
    expect(() =>
      defineStreamHubStream({
        domain: 'env-task',
        stream: 'run',
        resource: 'run',
        features: ['snapshot'],
      }),
    ).toThrow(Error);
  });

  it('rejects empty resource names', () => {
    expect(() =>
      defineStreamHubStream({
        domain: 'env_task',
        stream: 'run',
        resource: '',
        features: [],
      }),
    ).toThrow(Error);
  });
});
