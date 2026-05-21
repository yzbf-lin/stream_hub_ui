<script setup lang="ts">
import type { LogFileLine } from '../api/log-file';

import { computed, nextTick, ref, watch } from 'vue';

const props = withDefaults(
  defineProps<{
    following?: boolean;
    keyword?: string;
    lines: LogFileLine[];
    maxLines?: number;
  }>(),
  {
    following: false,
    keyword: '',
    maxLines: 5000,
  },
);

const emit = defineEmits<{
  scrollBottom: [];
}>();

const scrollerRef = ref<HTMLElement>();

const safeMaxLines = computed(() => Math.max(0, Math.floor(props.maxLines)));
const visibleLines = computed(() => {
  if (safeMaxLines.value === 0) {
    return [];
  }

  return props.lines.slice(-safeMaxLines.value);
});
const truncated = computed(() => props.lines.length > safeMaxLines.value);

function lineText(line: LogFileLine) {
  return line.message || line.line || '';
}

function levelClass(level?: string) {
  switch (level?.toUpperCase()) {
    case 'ERROR':
      return 'log-line--error';
    case 'SYSTEM':
      return 'log-line--system';
    case 'WARNING':
    case 'WARN':
      return 'log-line--warning';
    default:
      return 'log-line--info';
  }
}

function escapeRegex(input: string) {
  return input.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}

function highlightedParts(message: string) {
  const keyword = props.keyword.trim();
  if (!keyword) {
    return [{ highlighted: false, text: message }];
  }

  const pattern = new RegExp(`(${escapeRegex(keyword)})`, 'gi');
  return message
    .split(pattern)
    .filter((text) => text.length > 0)
    .map((text) => ({
      highlighted: text.toLowerCase() === keyword.toLowerCase(),
      text,
    }));
}

async function scrollToBottom() {
  await nextTick();
  const scroller = scrollerRef.value;
  if (!scroller) {
    return;
  }

  scroller.scrollTop = scroller.scrollHeight;
  emit('scrollBottom');
}

watch(
  () => [props.following, props.lines.length] as const,
  ([following]) => {
    if (following) {
      void scrollToBottom();
    }
  },
);
</script>

<template>
  <section class="log-stream-viewer" aria-label="日志输出">
    <div class="log-stream-viewer__toolbar">
      <span class="log-stream-viewer__status">
        {{ following ? '跟随中' : '只读' }}
      </span>
      <span
        v-if="truncated"
        class="log-stream-viewer__truncated"
        data-test="log-truncated"
      >
        仅显示最近 {{ maxLines }} 行
      </span>
    </div>

    <div ref="scrollerRef" class="log-stream-viewer__body">
      <div
        v-for="(line, index) in visibleLines"
        :key="`${index}-${line.stream_seq ?? lineText(line)}`"
        class="log-stream-viewer__line"
        :class="levelClass(line.level)"
      >
        <span class="log-stream-viewer__line-number">
          {{ props.lines.length - visibleLines.length + index + 1 }}
        </span>
        <span class="log-stream-viewer__message">
          <template
            v-for="(part, partIndex) in highlightedParts(lineText(line))"
            :key="`${index}-${partIndex}`"
          >
            <mark v-if="part.highlighted" data-test="log-highlight">
              {{ part.text }}
            </mark>
            <span v-else>{{ part.text }}</span>
          </template>
        </span>
      </div>

      <div v-if="visibleLines.length === 0" class="log-stream-viewer__empty">
        暂无日志
      </div>
    </div>
  </section>
</template>

<style scoped>
.log-stream-viewer {
  display: grid;
  grid-template-rows: auto 1fr;
  min-block-size: 360px;
  overflow: hidden;
  border: 1px solid hsl(var(--border));
  background: hsl(var(--background));
}

.log-stream-viewer__toolbar {
  display: flex;
  min-block-size: 36px;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 0 12px;
  border-block-end: 1px solid hsl(var(--border));
  background: hsl(var(--muted) / 55%);
  color: hsl(var(--muted-foreground));
  font-size: 12px;
}

.log-stream-viewer__status {
  font-weight: 600;
}

.log-stream-viewer__truncated {
  color: hsl(var(--warning, 38 92% 50%));
}

.log-stream-viewer__body {
  block-size: 100%;
  max-block-size: 58vh;
  min-block-size: 320px;
  overflow: auto;
  background: hsl(var(--background));
  font-family:
    ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono',
    monospace;
  font-size: 12px;
  line-height: 1.65;
}

.log-stream-viewer__line {
  display: grid;
  grid-template-columns: 64px minmax(0, 1fr);
  min-block-size: 24px;
  border-block-end: 1px solid hsl(var(--border) / 35%);
  white-space: pre-wrap;
  word-break: break-word;
}

.log-stream-viewer__line-number {
  position: sticky;
  inset-inline-start: 0;
  padding: 2px 10px;
  border-inline-end: 1px solid hsl(var(--border));
  background: hsl(var(--muted) / 35%);
  color: hsl(var(--muted-foreground));
  text-align: right;
  user-select: none;
}

.log-stream-viewer__message {
  min-inline-size: 0;
  padding: 2px 12px;
}

.log-stream-viewer__message mark {
  border-radius: 2px;
  background: hsl(var(--warning, 38 92% 50%) / 24%);
  color: hsl(var(--foreground));
}

.log-line--error .log-stream-viewer__message {
  color: hsl(var(--destructive));
}

.log-line--warning .log-stream-viewer__message {
  color: hsl(var(--warning, 38 92% 50%));
}

.log-line--system .log-stream-viewer__message {
  color: hsl(var(--primary));
}

.log-line--info .log-stream-viewer__message {
  color: hsl(var(--foreground));
}

.log-stream-viewer__empty {
  display: grid;
  min-block-size: 280px;
  place-items: center;
  color: hsl(var(--muted-foreground));
  font-size: 13px;
}

@media (max-width: 640px) {
  .log-stream-viewer__line {
    grid-template-columns: 48px minmax(0, 1fr);
  }

  .log-stream-viewer__line-number {
    padding-inline: 6px;
  }

  .log-stream-viewer__message {
    padding-inline: 8px;
  }
}
</style>
