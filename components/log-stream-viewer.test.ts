import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import { describe, expect, it } from 'vitest';

import LogStreamViewer from './log-stream-viewer.vue';

describe('LogStreamViewer', () => {
  it('renders line numbers and highlights keyword', () => {
    const wrapper = mount(LogStreamViewer, {
      props: {
        keyword: 'error',
        lines: [
          { level: 'INFO', message: 'hello' },
          { level: 'ERROR', message: 'fatal error' },
        ],
        maxLines: 5000,
      },
    });

    expect(wrapper.text()).toContain('1');
    expect(wrapper.text()).toContain('fatal error');
    expect(wrapper.find('[data-test="log-highlight"]').exists()).toBe(true);
  });

  it('keeps only max lines', () => {
    const wrapper = mount(LogStreamViewer, {
      props: {
        lines: Array.from({ length: 3 }, (_, index) => ({
          message: `line-${index + 1}`,
        })),
        maxLines: 2,
      },
    });

    expect(wrapper.text()).not.toContain('line-1');
    expect(wrapper.text()).toContain('line-2');
    expect(wrapper.text()).toContain('line-3');
    expect(wrapper.find('[data-test="log-truncated"]').exists()).toBe(true);
  });

  it('treats non-positive max lines as zero visible lines', () => {
    const wrapper = mount(LogStreamViewer, {
      props: {
        lines: [{ message: 'line-1' }, { message: 'line-2' }],
        maxLines: 0,
      },
    });

    expect(wrapper.text()).not.toContain('line-1');
    expect(wrapper.text()).not.toContain('line-2');
    expect(wrapper.find('[data-test="log-truncated"]').exists()).toBe(true);
  });

  it('highlights regex metacharacters as plain text', () => {
    const wrapper = mount(LogStreamViewer, {
      props: {
        keyword: '[error]*',
        lines: [{ message: 'literal [error]* token' }],
      },
    });

    expect(wrapper.find('[data-test="log-highlight"]').text()).toBe('[error]*');
  });

  it('emits scrollBottom when following logs change', async () => {
    const wrapper = mount(LogStreamViewer, {
      props: {
        following: true,
        lines: [{ message: 'line-1' }],
      },
    });

    await wrapper.setProps({
      lines: [{ message: 'line-1' }, { message: 'line-2' }],
    });
    await nextTick();

    expect(wrapper.emitted('scrollBottom')).toBeTruthy();
  });

  it('does not emit scrollBottom when not following', async () => {
    const wrapper = mount(LogStreamViewer, {
      props: {
        following: false,
        lines: [{ message: 'line-1' }],
      },
    });

    await wrapper.setProps({
      lines: [{ message: 'line-1' }, { message: 'line-2' }],
    });
    await nextTick();

    expect(wrapper.emitted('scrollBottom')).toBeUndefined();
  });
});
