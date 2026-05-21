<script setup lang="ts">
import type { LogFileItem, LogFileLine } from '../api/log-file';

import { computed, h, onMounted, ref, watch } from 'vue';

import { ColPage } from '@vben/common-ui';
import { $t } from '@vben/locales';
import { downloadFileFromBlobPart } from '@vben/utils';

import { message } from 'antdv-next';

import {
  downloadLogFileApi,
  getLogFilesApi,
  getLogFileTailApi,
} from '../api/log-file';
import LogStreamViewer from '../components/log-stream-viewer.vue';
import { useStreamHubFileLogFollow } from '../composables/stream-hub-file-log';

const ROW_LIMIT_OPTIONS = [200, 500, 1000];
const LOG_ROOT_TITLE = 'backend/log';

interface LogFileTreeNode {
  children?: LogFileTreeNode[];
  file?: LogFileItem;
  key: string;
  title: string;
  type: 'dir' | 'file';
}

const loadingFiles = ref(false);
const loadingTail = ref(false);
const downloading = ref(false);
const keyword = ref('');
const fileSearch = ref('');
const rowLimit = ref(500);
const files = ref<LogFileItem[]>([]);
const selectedFileId = ref<string>();
const tailLines = ref<LogFileLine[]>([]);
const expandedTreeKeys = ref<string[]>([]);
let selectRequestSeq = 0;
let tailRequestSeq = 0;

const fileFollow = useStreamHubFileLogFollow();

const selectedFile = computed(() =>
  files.value.find((file) => file.fileId === selectedFileId.value),
);

const filteredFiles = computed(() => {
  const query = fileSearch.value.trim().toLowerCase();
  const sorted = [...files.value].sort(
    (left, right) =>
      new Date(right.mtime).getTime() - new Date(left.mtime).getTime(),
  );

  if (!query) {
    return sorted;
  }

  return sorted.filter((file) =>
    [file.name, file.relativePath, file.group].some((value) =>
      value.toLowerCase().includes(query),
    ),
  );
});

const logFileTree = computed(() => buildLogFileTree(filteredFiles.value));
const treeFileByKey = computed(() => {
  const fileMap = new Map<string, LogFileItem>();
  collectFileNodes(logFileTree.value, fileMap);
  return fileMap;
});
const allDirectoryTreeKeys = computed(() =>
  collectDirectoryKeys(logFileTree.value),
);
const selectedTreeKeys = computed(() =>
  selectedFileId.value ? [fileTreeKey(selectedFileId.value)] : [],
);

const displayLines = computed(() => [
  ...tailLines.value,
  ...fileFollow.logs.value,
]);

function renderTreeTitle(node: unknown) {
  const treeNode = node as LogFileTreeNode;
  return h(
    'span',
    {
      class: [
        'log-console-tree-title',
        `log-console-tree-title--${treeNode.type}`,
      ],
    },
    treeNode.title,
  );
}

function directoryTreeKey(path: string) {
  return `dir:${path || LOG_ROOT_TITLE}`;
}

function fileTreeKey(fileId: string) {
  return `file:${fileId}`;
}

function createDirectoryNode(title: string, path: string): LogFileTreeNode {
  return {
    children: [],
    key: directoryTreeKey(path),
    title,
    type: 'dir',
  };
}

function sortTreeNodes(nodes: LogFileTreeNode[]) {
  nodes.sort((left, right) => {
    if (left.type !== right.type) {
      return left.type === 'dir' ? -1 : 1;
    }

    if (left.type === 'file' && right.type === 'file') {
      const leftTime = new Date(left.file?.mtime ?? 0).getTime();
      const rightTime = new Date(right.file?.mtime ?? 0).getTime();
      if (leftTime !== rightTime) {
        return rightTime - leftTime;
      }
    }

    return left.title.localeCompare(right.title);
  });

  for (const node of nodes) {
    if (node.children?.length) {
      sortTreeNodes(node.children);
    }
  }
}

function buildLogFileTree(logFiles: LogFileItem[]) {
  if (logFiles.length === 0) {
    return [];
  }

  const root = createDirectoryNode(LOG_ROOT_TITLE, '');

  for (const file of logFiles) {
    const parts = file.relativePath.split('/').filter(Boolean);
    let currentNode = root;
    let currentPath = '';

    for (const directory of parts.slice(0, -1)) {
      currentPath = currentPath ? `${currentPath}/${directory}` : directory;
      let directoryNode = currentNode.children?.find(
        (node) =>
          node.type === 'dir' && node.key === directoryTreeKey(currentPath),
      );
      if (!directoryNode) {
        directoryNode = createDirectoryNode(directory, currentPath);
        currentNode.children?.push(directoryNode);
      }
      currentNode = directoryNode;
    }

    currentNode.children?.push({
      file,
      key: fileTreeKey(file.fileId),
      title: file.name,
      type: 'file',
    });
  }

  sortTreeNodes(root.children ?? []);
  return [root];
}

function collectDirectoryKeys(nodes: LogFileTreeNode[]) {
  const keys: string[] = [];
  for (const node of nodes) {
    if (node.type === 'dir') {
      keys.push(node.key);
    }
    if (node.children?.length) {
      keys.push(...collectDirectoryKeys(node.children));
    }
  }
  return keys;
}

function collectFileNodes(
  nodes: LogFileTreeNode[],
  fileMap: Map<string, LogFileItem>,
) {
  for (const node of nodes) {
    if (node.type === 'file' && node.file) {
      fileMap.set(node.key, node.file);
    }
    if (node.children?.length) {
      collectFileNodes(node.children, fileMap);
    }
  }
}

async function loadFiles() {
  loadingFiles.value = true;
  try {
    files.value = await getLogFilesApi();
  } finally {
    loadingFiles.value = false;
  }
}

async function loadTail(fileId: string) {
  const requestSeq = ++tailRequestSeq;
  loadingTail.value = true;
  try {
    const response = await getLogFileTailApi(fileId, { limit: rowLimit.value });
    if (requestSeq !== tailRequestSeq || selectedFileId.value !== fileId) {
      return;
    }
    tailLines.value = response.lines ?? [];
  } finally {
    if (requestSeq === tailRequestSeq) {
      loadingTail.value = false;
    }
  }
}

async function selectFile(file: LogFileItem) {
  const selectSeq = ++selectRequestSeq;
  tailRequestSeq += 1;
  selectedFileId.value = file.fileId;
  tailLines.value = [];
  fileFollow.clearLocal();
  await fileFollow.stop();
  if (selectSeq !== selectRequestSeq || selectedFileId.value !== file.fileId) {
    return;
  }
  await loadTail(file.fileId);
}

function onTreeExpand(keys: Array<number | string>) {
  expandedTreeKeys.value = keys.map(String);
}

async function onTreeSelect(keys: Array<number | string>) {
  const key = String(keys[0] ?? '');
  const file = treeFileByKey.value.get(key);
  if (!file) {
    return;
  }

  await selectFile(file);
}

async function refreshSelectedTail() {
  if (!selectedFileId.value) {
    await loadFiles();
    return;
  }

  fileFollow.clearLocal();
  await loadTail(selectedFileId.value);
}

async function startFollow() {
  const fileId = selectedFileId.value;
  const selectSeq = selectRequestSeq;
  if (!fileId) {
    return;
  }

  await fileFollow.start(fileId, { limit: rowLimit.value });
  if (selectSeq !== selectRequestSeq || selectedFileId.value !== fileId) {
    return;
  }
  tailLines.value = [];
}

async function stopFollow() {
  await fileFollow.stop();
}

async function downloadSelectedFile() {
  const file = selectedFile.value;
  if (!file) {
    return;
  }

  downloading.value = true;
  try {
    const blob = await downloadLogFileApi(file.fileId);
    downloadFileFromBlobPart({ fileName: file.name, source: blob });
  } finally {
    downloading.value = false;
  }
}

async function onRowLimitChange() {
  if (selectedFileId.value) {
    fileFollow.clearLocal();
    await loadTail(selectedFileId.value);
  }
}

onMounted(async () => {
  try {
    await loadFiles();
  } catch {
    message.error($t('stream_hub.load_files_failed'));
  }
});

watch(
  allDirectoryTreeKeys,
  (keys) => {
    expandedTreeKeys.value = [...keys];
  },
  { immediate: true },
);
</script>

<template>
  <ColPage
    auto-content-height
    class="log-console-colpage"
    content-class="log-console-colpage__content"
    :left-max-width="45"
    :left-min-width="18"
    :left-width="28"
    :right-min-width="50"
    :right-width="72"
    :split-line="false"
    split-handle
    :title="$t('stream_hub.log_console_menu')"
  >
    <template #left>
      <aside class="log-console-sidebar">
        <div class="log-console-sidebar__toolbar">
          <a-input-search
            v-model:value="fileSearch"
            :placeholder="$t('stream_hub.search_placeholder')"
            allow-clear
          />
          <a-button :loading="loadingFiles" @click="loadFiles">
            {{ $t('stream_hub.refresh') }}
          </a-button>
        </div>

        <div
          class="log-console-sidebar__body log-console-sidebar__body--scroll"
        >
          <a-spin :spinning="loadingFiles">
            <div v-if="logFileTree.length > 0" class="log-console-file-list">
              <a-tree
                block-node
                class="log-console-file-tree"
                :expanded-keys="expandedTreeKeys"
                :selected-keys="selectedTreeKeys"
                :title-render="renderTreeTitle"
                :tree-data="logFileTree"
                @expand="onTreeExpand"
                @select="onTreeSelect"
              />
            </div>
            <a-empty v-else :description="$t('stream_hub.empty_files')" />
          </a-spin>
        </div>
      </aside>
    </template>

    <section class="log-console-main">
      <header class="log-console-header">
        <div class="log-console-title">
          <h2>
            {{ selectedFile?.name ?? $t('stream_hub.no_file_selected') }}
          </h2>
          <p v-if="selectedFile">{{ selectedFile.relativePath }}</p>
        </div>

        <div class="log-console-actions">
          <a-segmented
            v-model:value="rowLimit"
            :options="ROW_LIMIT_OPTIONS"
            @change="onRowLimitChange"
          />
          <a-input
            v-model:value="keyword"
            :placeholder="$t('stream_hub.keyword_placeholder')"
            allow-clear
          />
          <a-button
            :disabled="!selectedFileId"
            :loading="loadingTail"
            @click="refreshSelectedTail"
          >
            {{ $t('stream_hub.tail') }}
          </a-button>
          <a-button
            v-if="!fileFollow.following.value"
            :disabled="!selectedFileId"
            data-test="log-follow"
            type="primary"
            @click="startFollow"
          >
            {{ $t('stream_hub.follow') }}
          </a-button>
          <a-button v-else danger @click="stopFollow">
            {{ $t('stream_hub.stop_follow') }}
          </a-button>
          <a-button
            :disabled="!selectedFileId"
            :loading="downloading"
            data-test="log-download"
            @click="downloadSelectedFile"
          >
            {{ $t('stream_hub.download') }}
          </a-button>
        </div>
      </header>

      <LogStreamViewer
        :following="fileFollow.following.value"
        :keyword="keyword"
        :lines="displayLines"
        :max-lines="5000"
        data-test="log-stream-viewer"
      />
    </section>
  </ColPage>
</template>

<style scoped>
.log-console-colpage :deep(.log-console-colpage__content) {
  display: flex;
  min-block-size: 0;
  overflow: hidden;
}

.log-console-colpage :deep(.log-console-colpage__content > div),
.log-console-colpage :deep([data-panel-group]) {
  block-size: 100%;
  min-block-size: 0;
  inline-size: 100%;
  min-inline-size: 0;
  overflow: hidden;
}

.log-console-colpage :deep([data-panel]) {
  display: flex;
  flex-direction: column;
  min-block-size: 0;
  min-inline-size: 0;
  overflow: hidden;
}

.log-console-colpage :deep([data-panel] > div) {
  block-size: 100%;
  min-block-size: 0;
}

.log-console-sidebar,
.log-console-main {
  block-size: 100%;
  min-inline-size: 0;
  border: 1px solid hsl(var(--border));
  background: hsl(var(--background));
}

.log-console-sidebar {
  display: grid;
  grid-template-rows: auto 1fr;
  overflow: hidden;
}

.log-console-sidebar__toolbar {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
  padding: 12px;
  border-block-end: 1px solid hsl(var(--border));
}

.log-console-sidebar__body {
  min-block-size: 0;
  overflow: auto;
}

.log-console-sidebar__body :deep(.ant-spin-container),
.log-console-sidebar__body :deep(.ant-spin-nested-loading) {
  min-block-size: 100%;
}

.log-console-sidebar__body :deep(.ant-spin-container) {
  display: flex;
  flex-direction: column;
}

.log-console-sidebar__body--scroll {
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
}

.log-console-sidebar__body--scroll :deep(.ant-spin-nested-loading) {
  min-block-size: 0;
}

.log-console-file-list {
  flex: 1 1 auto;
  min-block-size: 0;
  padding: 10px;
}

.log-console-file-tree {
  background: transparent;
}

.log-console-file-tree :deep(.ant-tree-list-holder-inner) {
  gap: 2px;
}

.log-console-file-tree :deep(.ant-tree-node-content-wrapper) {
  min-inline-size: 0;
}

.log-console-file-tree :deep(.ant-tree-title) {
  display: block;
  min-inline-size: 0;
}

.log-console-tree-title {
  display: block;
  overflow: hidden;
  min-inline-size: 0;
  max-inline-size: 100%;
  color: hsl(var(--foreground));
  text-overflow: ellipsis;
  white-space: nowrap;
}

.log-console-tree-title--dir {
  font-weight: 600;
}

.log-console-tree-title--file {
  font-weight: 500;
}

.log-console-main {
  display: grid;
  grid-template-rows: auto 1fr;
  overflow: hidden;
}

.log-console-header {
  display: grid;
  gap: 12px;
  padding: 14px;
  border-block-end: 1px solid hsl(var(--border));
}

.log-console-title h2 {
  margin: 0;
  font-size: 16px;
  font-weight: 700;
}

.log-console-title p {
  margin: 4px 0 0;
  color: hsl(var(--muted-foreground));
  font-size: 12px;
}

.log-console-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.log-console-actions :deep(.ant-input-affix-wrapper),
.log-console-actions :deep(.ant-input) {
  inline-size: 220px;
}
</style>
