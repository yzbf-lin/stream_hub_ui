# stream_hub 前端插件使用指南

`stream_hub` 前端插件负责消费后端流式事件中心。业务页面只需要定义 stream schema，然后通过 composable 订阅事件；页面不需要手写 Socket.IO 事件名、room 名或订阅引用计数。

插件的核心能力是 stream schema、订阅 composable、共享 room 管理和日志 append 合并。日志控制台页面只是一个内置示例页面，用来演示如何消费后端日志文件 API、tail、follow 和下载能力；业务系统可以直接复用这个页面，也可以不注册页面，只使用插件提供的底层能力。

前端插件仓库：

```text
git@github.com:yzbf-lin/stream_hub_ui.git
```

后端配套插件仓库：

```text
git@github.com:yzbf-lin/stream_hub.git
```

## 插件入口

核心能力从插件入口导入：

```ts
import {
  createStreamHubRoomRegistry,
  defineStreamHubLogStream,
  defineStreamHubStream,
  useStreamHubLogStream,
  useStreamHubStream,
} from '#/plugins/stream_hub';
```

日志文件 API 和日志文件 follow 属于页面能力，按子路径导入，避免核心入口加载 HTTP client：

```ts
import { getLogFilesApi } from '#/plugins/stream_hub/api';
import { useStreamHubFileLogFollow } from '#/plugins/stream_hub/composables/stream-hub-file-log';
```

## 推荐接入流程

业务页面接入时建议按下面的顺序实现：

1. 在业务模块里用 `defineStreamHubStream` 或 `defineStreamHubLogStream` 定义 schema。
2. 在页面、抽屉或列表组件中调用 `useStreamHubStream` / `useStreamHubLogStream`。
3. 在进入页面或切换资源时 `subscribe()`，在离开页面、关闭抽屉或切换资源前调用 `handle.stop()`。
4. 多个组件共享同一个 room 时，用 `createStreamHubRoomRegistry` 做引用计数。
5. 只需要查看 `backend/log` 文件时，再使用日志控制台页面或 `stream-hub-file-log` composable。

除非业务确实要展示服务器日志文件，否则不需要接入日志控制台页面。

## 普通事件流

建议把 stream schema 集中放在业务自己的 `composables/*-streams.ts` 文件里。

```ts
import { defineStreamHubStream } from '#/plugins/stream_hub';

const runFeatures = ['snapshot', 'status', 'finished'] as const;

export const envTaskRunStream = defineStreamHubStream({
  domain: 'env_task',
  stream: 'run',
  resource: 'run',
  features: runFeatures,
});
```

上面会生成：

```text
订阅事件    env_task_run_subscribe
退订事件    env_task_run_unsubscribe
状态事件    env_task_run_status
资源字段    run_id
```

页面消费：

```ts
import { useStreamHubStream } from '#/plugins/stream_hub';

import { envTaskRunStream } from './env-task-streams';

const streamClient = useStreamHubStream(envTaskRunStream);

const handle = streamClient.subscribe(42, {
  onSnapshot: applySnapshot,
  onStatus: applyStatus,
  onFinished: markFinished,
});

handle.stop();
```

默认行为：

- 自动连接 WebSocket。
- 自动注册 feature 事件监听。
- 自动 emit `*_subscribe`。
- WebSocket 重连后自动重新订阅。
- `stop()` 时自动 emit `*_unsubscribe` 并清理监听。

## 额外订阅参数

订阅时可以传业务参数，例如初始化日志条数：

```ts
const handle = streamClient.subscribe(
  runId,
  { onSnapshot: applySnapshot },
  { payload: { log_limit: 200 } },
);
```

插件会自动合并资源 id，最终 payload 类似：

```ts
{
  run_id: runId,
  log_limit: 200,
}
```

## 共享 room

当列表、抽屉、详情同时订阅同一个资源时，用 `createStreamHubRoomRegistry` 管理引用计数：

```ts
import { createStreamHubRoomRegistry } from '#/plugins/stream_hub';

import { operablePlayerStream } from './operable-player-streams';

const playerRooms = createStreamHubRoomRegistry<number>(
  operablePlayerStream,
  { validateResourceId: (id) => id > 0 },
);

playerRooms.retain(playerId);
playerRooms.release(playerId);
playerRooms.refresh();
```

页面仍可以监听事件，但需要关闭 room 管理：

```ts
const handle = streamClient.subscribe(
  playerId,
  { onStatus: applyStatus },
  { manageRoom: false },
);
```

## 日志流

日志流需要定义 `fetchTail`，用于先读取历史 tail，再合并 append 增量。

```ts
import { defineStreamHubLogStream, useStreamHubLogStream } from '#/plugins/stream_hub';

export const taskRunLogStream = defineStreamHubLogStream({
  domain: 'operable_player',
  stream: 'task_run_log',
  resource: 'trace',
  fetchTail: async (traceId, limit) => {
    const data = await getTaskRunLogsByTraceApi(String(traceId), { limit });
    return data.lines ?? [];
  },
});

const logClient = useStreamHubLogStream(taskRunLogStream);
const handle = await logClient.subscribe(traceId, {
  onAppend: appendLine,
  onBackfill: replaceLines,
});
```

日志合并规则：

- 先订阅 room，再拉取 tail，避免拉取过程丢增量。
- 使用 `stream_seq` 去重和排序。
- 没有 `stream_seq` 的行按接收顺序保留。
- `clearLocal()` 只清理前端本地日志，不影响后端缓存。

## 日志控制台页面

插件内置日志控制台页面：

```text
/monitor/log-console
```

菜单权限：

```text
stream_hub:log:view
```

这个页面的定位是示例演示和轻量运维工具，不是 `stream_hub` 插件的核心使用方式。它展示了如何把日志文件列表、tail、follow、过滤和下载组合成一个页面；业务模块接入普通事件流或业务日志流时，不需要依赖这个页面，也不需要把业务日志强行落到 `backend/log` 文件后再读取。

页面能力：

- 左侧按日志目录结构展示 `backend/log` 下的文件。
- 支持搜索日志文件。
- 支持读取 tail、开始/停止跟随、关键字过滤。
- 支持下载日志文件。
- 跟随时通过 `stream_hub_file_log_append` 接收增量。

## 内存与清理

- `useStreamHubStream` 和 `useStreamHubLogStream` 在组件卸载时会自动退订。
- 手动创建的订阅应在关闭抽屉、切换资源或离开页面时调用 `handle.stop()`。
- 日志文件 follow 会维护 heartbeat；停止跟随后会释放 lease。
- 日志展示组件只持有当前页面需要的行，业务页面不应把无限日志累积到全局状态。

## 发布到插件仓库

按照 FBA 插件分享规范，前端插件仓库名为后端插件名加 `_ui` 后缀。发布时将 `frontend/apps/web-antdv-next/src/plugins/stream_hub` 目录中的所有文件提交到：

```text
git@github.com:yzbf-lin/stream_hub_ui.git
```

注意是复制目录内容，不是把 `stream_hub` 目录本身再套一层。
