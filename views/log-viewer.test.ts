import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';

import LogViewer from './log-viewer.vue';

const mocks = vi.hoisted(() => ({
  clearLocal: vi.fn(),
  downloadLogFileApi: vi.fn(),
  downloadFileFromBlobPart: vi.fn(),
  following: { value: false },
  getLogFilesApi: vi.fn(),
  getLogFileTailApi: vi.fn(),
  liveLogs: [] as Array<{ message: string }>,
  logs: { value: [] as Array<{ message: string }> },
  start: vi.fn(),
  stop: vi.fn(),
}));

vi.mock('../api/log-file', () => ({
  downloadLogFileApi: mocks.downloadLogFileApi,
  getLogFilesApi: mocks.getLogFilesApi,
  getLogFileTailApi: mocks.getLogFileTailApi,
}));

vi.mock('../composables/stream-hub-file-log', async () => {
  const { ref } = await import('vue');
  mocks.logs = ref([]);

  return {
    useStreamHubFileLogFollow: () => ({
      clearLocal: mocks.clearLocal,
      following: mocks.following,
      logs: mocks.logs,
      start: mocks.start,
      stop: mocks.stop,
    }),
  };
});

vi.mock('../components/log-stream-viewer.vue', () => ({
  default: {
    props: ['following', 'keyword', 'lines', 'maxLines'],
    template:
      '<section data-test="log-stream-viewer">{{ lines.map((line) => line.message).join("\\n") }}</section>',
  },
}));

vi.mock('@vben/common-ui', async () => {
  const { defineComponent } = await import('vue');
  return {
    ColPage: defineComponent({
      props: ['class', 'contentClass'],
      template:
        '<main :class="$props.class" :data-content-class="contentClass"><aside><slot name="left" /></aside><section><slot /></section></main>',
    }),
  };
});

vi.mock('@vben/locales', () => ({ $t: (key: string) => key }));
vi.mock('#/locales', () => ({ $t: (key: string) => key }));
vi.mock('@vben/utils', () => ({
  downloadFileFromBlobPart: mocks.downloadFileFromBlobPart,
}));
vi.mock('antdv-next', () => ({
  message: {
    error: vi.fn(),
  },
}));

function mountLogViewer() {
  return mount(LogViewer, {
    global: {
      stubs: {
        'a-button': {
          props: ['danger', 'disabled', 'loading', 'type'],
          template:
            '<button :disabled="disabled" type="button" @click="$emit(\'click\')"><slot /></button>',
        },
        'a-empty': {
          props: ['description'],
          template: '<div>{{ description }}</div>',
        },
        'a-input': {
          props: ['allowClear', 'placeholder', 'value'],
          template: '<input :placeholder="placeholder" :value="value" />',
        },
        'a-input-search': {
          props: ['allowClear', 'placeholder', 'value'],
          template: '<input :placeholder="placeholder" :value="value" />',
        },
        'a-segmented': {
          props: ['options', 'value'],
          template: '<div></div>',
        },
        'a-spin': {
          props: ['spinning'],
          template: '<div><slot /></div>',
        },
        'a-tree': defineComponent({
          props: ['expandedKeys', 'selectedKeys', 'titleRender', 'treeData'],
          emits: ['select'],
          setup(props, { emit }) {
            function renderNode(node: any) {
              const isFile = node.type === 'file';
              const title = props.titleRender?.(node) ?? node.title;
              return h('li', { key: node.key }, [
                h(
                  'button',
                  {
                    'data-test': isFile ? 'log-file-item' : 'log-dir-node',
                    onClick: () => emit('select', [node.key], { node }),
                    type: 'button',
                  },
                  [title],
                ),
                node.children?.length
                  ? h('ul', node.children.map(renderNode))
                  : null,
              ]);
            }

            return () => h('ul', props.treeData?.map(renderNode) ?? []);
          },
        }),
      },
    },
  });
}

describe('StreamHubStreamLogViewer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.liveLogs = [];
    mocks.logs.value = mocks.liveLogs;
    mocks.following.value = false;
  });

  it('loads files and tails selected file', async () => {
    mocks.getLogFilesApi.mockResolvedValue([
      {
        fileId: 'file-1',
        group: 'backend/log',
        mtime: '2026-05-20T00:00:00+08:00',
        name: 'fba_error.log',
        relativePath: 'fba_error.log',
        size: 10,
        suffix: '.log',
      },
    ]);
    mocks.getLogFileTailApi.mockResolvedValue({
      lines: [{ message: 'tail' }],
    });

    const wrapper = mountLogViewer();
    await flushPromises();
    await wrapper.get('[data-test="log-file-item"]').trigger('click');
    await flushPromises();

    expect(mocks.getLogFilesApi).toHaveBeenCalled();
    expect(mocks.getLogFileTailApi).toHaveBeenCalledWith('file-1', {
      limit: 500,
    });
    expect(wrapper.text()).toContain('tail');
  });

  it('starts follow and downloads the selected file', async () => {
    mocks.getLogFilesApi.mockResolvedValue([
      {
        fileId: 'file-1',
        group: 'backend/log',
        mtime: '2026-05-20T00:00:00+08:00',
        name: 'fba_error.log',
        relativePath: 'fba_error.log',
        size: 10,
        suffix: '.log',
      },
    ]);
    mocks.getLogFileTailApi.mockResolvedValue({ lines: [] });
    mocks.downloadLogFileApi.mockResolvedValue(new Blob(['log']));

    const wrapper = mountLogViewer();
    await flushPromises();
    await wrapper.get('[data-test="log-file-item"]').trigger('click');
    await flushPromises();
    await wrapper.get('[data-test="log-follow"]').trigger('click');
    await wrapper.get('[data-test="log-download"]').trigger('click');

    expect(mocks.start).toHaveBeenCalledWith('file-1', { limit: 500 });
    expect(mocks.downloadLogFileApi).toHaveBeenCalledWith('file-1');
    expect(mocks.downloadFileFromBlobPart).toHaveBeenCalledWith({
      fileName: 'fba_error.log',
      source: expect.any(Blob),
    });
  });

  it('renders log files as a directory tree and selects nested files', async () => {
    mocks.getLogFilesApi.mockResolvedValue([
      {
        fileId: 'root-file',
        group: 'backend/log',
        mtime: '2026-05-20T00:00:00+08:00',
        name: 'fba_access.log',
        relativePath: 'fba_access.log',
        size: 10,
        suffix: '.log',
      },
      {
        fileId: 'nested-file',
        group: 'celery_tasks',
        mtime: '2026-05-20T00:01:00+08:00',
        name: 'worker.log',
        relativePath: 'celery_tasks/worker/worker.log',
        size: 20,
        suffix: '.log',
      },
    ]);
    mocks.getLogFileTailApi.mockResolvedValue({
      lines: [{ message: 'nested-tail' }],
    });

    const wrapper = mountLogViewer();
    await flushPromises();

    expect(
      wrapper.findAll('[data-test="log-dir-node"]').length,
    ).toBeGreaterThan(1);
    expect(wrapper.text()).toContain('backend/log');
    expect(wrapper.text()).toContain('celery_tasks');
    expect(wrapper.text()).toContain('worker');
    expect(wrapper.text()).toContain('worker.log');
    expect(wrapper.text()).not.toContain('worker.log20 B · .log');

    const nestedFileButton = wrapper
      .findAll('[data-test="log-file-item"]')
      .find((item) => item.text().includes('worker.log'));
    await nestedFileButton?.trigger('click');
    await flushPromises();

    expect(mocks.getLogFileTailApi).toHaveBeenCalledWith('nested-file', {
      limit: 500,
    });
    expect(wrapper.text()).toContain('nested-tail');
  });

  it('keeps the left log tree in an independently scrollable panel', async () => {
    mocks.getLogFilesApi.mockResolvedValue([
      {
        fileId: 'file-1',
        group: 'backend/log',
        mtime: '2026-05-20T00:00:00+08:00',
        name: 'fba_error.log',
        relativePath: 'fba_error.log',
        size: 10,
        suffix: '.log',
      },
    ]);

    const wrapper = mountLogViewer();
    await flushPromises();

    expect(
      wrapper.get('.log-console-colpage').attributes('data-content-class'),
    ).toBe('log-console-colpage__content');
    expect(wrapper.get('.log-console-sidebar__body').classes()).toContain(
      'log-console-sidebar__body--scroll',
    );
  });

  it('replaces local tail with follow backfill instead of duplicating history', async () => {
    mocks.getLogFilesApi.mockResolvedValue([
      {
        fileId: 'file-1',
        group: 'backend/log',
        mtime: '2026-05-20T00:00:00+08:00',
        name: 'fba_error.log',
        relativePath: 'fba_error.log',
        size: 10,
        suffix: '.log',
      },
    ]);
    mocks.getLogFileTailApi.mockResolvedValue({
      lines: [{ message: 'tail' }],
    });
    mocks.start.mockImplementation(async () => {
      mocks.logs.value = [{ message: 'tail' }];
    });

    const wrapper = mountLogViewer();
    await flushPromises();
    await wrapper.get('[data-test="log-file-item"]').trigger('click');
    await flushPromises();
    await wrapper.get('[data-test="log-follow"]').trigger('click');
    await flushPromises();

    const viewerText = wrapper.get('[data-test="log-stream-viewer"]').text();
    expect(viewerText.match(/tail/g) ?? []).toHaveLength(1);
  });

  it('clears stale live logs when switching files', async () => {
    mocks.getLogFilesApi.mockResolvedValue([
      {
        fileId: 'file-1',
        group: 'backend/log',
        mtime: '2026-05-20T00:00:00+08:00',
        name: 'one.log',
        relativePath: 'one.log',
        size: 10,
        suffix: '.log',
      },
      {
        fileId: 'file-2',
        group: 'backend/log',
        mtime: '2026-05-20T00:01:00+08:00',
        name: 'two.log',
        relativePath: 'two.log',
        size: 10,
        suffix: '.log',
      },
    ]);
    mocks.getLogFileTailApi
      .mockResolvedValueOnce({ lines: [{ message: 'tail-two' }] })
      .mockResolvedValueOnce({ lines: [{ message: 'tail-one' }] });
    mocks.clearLocal.mockImplementation(() => {
      mocks.liveLogs = [];
      mocks.logs.value = mocks.liveLogs;
    });
    const wrapper = mountLogViewer();
    await flushPromises();

    await wrapper.findAll('[data-test="log-file-item"]')[0].trigger('click');
    await flushPromises();
    mocks.liveLogs.push({ message: 'live-two' });
    mocks.logs.value = mocks.liveLogs;
    await wrapper.findAll('[data-test="log-file-item"]')[1].trigger('click');
    await flushPromises();

    expect(mocks.clearLocal).toHaveBeenCalled();
    expect(wrapper.text()).toContain('tail-one');
    expect(wrapper.text()).not.toContain('live-two');
  });

  it('ignores stale tail responses after fast file switching', async () => {
    let resolveFirstTail:
      | ((value: { lines: Array<{ message: string }> }) => void)
      | undefined;
    mocks.getLogFilesApi.mockResolvedValue([
      {
        fileId: 'file-1',
        group: 'backend/log',
        mtime: '2026-05-20T00:00:00+08:00',
        name: 'one.log',
        relativePath: 'one.log',
        size: 10,
        suffix: '.log',
      },
      {
        fileId: 'file-2',
        group: 'backend/log',
        mtime: '2026-05-20T00:01:00+08:00',
        name: 'two.log',
        relativePath: 'two.log',
        size: 10,
        suffix: '.log',
      },
    ]);
    mocks.getLogFileTailApi
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirstTail = resolve;
          }),
      )
      .mockResolvedValueOnce({ lines: [{ message: 'tail-one' }] });
    const wrapper = mountLogViewer();
    await flushPromises();

    void wrapper.findAll('[data-test="log-file-item"]')[0].trigger('click');
    await vi.waitFor(() =>
      expect(mocks.getLogFileTailApi).toHaveBeenCalledWith('file-2', {
        limit: 500,
      }),
    );
    await wrapper.findAll('[data-test="log-file-item"]')[1].trigger('click');
    await flushPromises();

    resolveFirstTail?.({ lines: [{ message: 'stale-two' }] });
    await flushPromises();

    expect(wrapper.text()).not.toContain('stale-two');
    expect(wrapper.text()).toContain('tail-one');
  });

  it('keeps the latest selected file when an older switch is waiting for stop', async () => {
    let releaseFirstStop: (() => void) | undefined;
    mocks.getLogFilesApi.mockResolvedValue([
      {
        fileId: 'file-1',
        group: 'backend/log',
        mtime: '2026-05-20T00:00:00+08:00',
        name: 'one.log',
        relativePath: 'one.log',
        size: 10,
        suffix: '.log',
      },
      {
        fileId: 'file-2',
        group: 'backend/log',
        mtime: '2026-05-20T00:01:00+08:00',
        name: 'two.log',
        relativePath: 'two.log',
        size: 10,
        suffix: '.log',
      },
    ]);
    mocks.stop.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseFirstStop = () => resolve(undefined);
        }),
    );
    mocks.getLogFileTailApi.mockImplementation((fileId: string) =>
      Promise.resolve({ lines: [{ message: `tail-${fileId}` }] }),
    );
    const wrapper = mountLogViewer();
    await flushPromises();

    void wrapper.findAll('[data-test="log-file-item"]')[0].trigger('click');
    await vi.waitFor(() => expect(mocks.stop).toHaveBeenCalledTimes(1));
    await wrapper.findAll('[data-test="log-file-item"]')[1].trigger('click');
    await flushPromises();

    releaseFirstStop?.();
    await flushPromises();

    expect(wrapper.text()).toContain('one.log');
    expect(wrapper.text()).toContain('tail-file-1');
    expect(wrapper.text()).not.toContain('tail-file-2');
  });
});
