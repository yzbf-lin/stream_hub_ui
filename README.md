# stream_hub

`stream_hub` 是流式事件中心前端插件，提供 stream schema 定义、Socket.IO 订阅 composable、共享 room 管理和日志 append 合并能力

日志控制台页面是示例演示和轻量运维工具，业务可以直接复用，也可以只使用底层 stream 能力

## Plugin Type

Frontend plugin

## Configuration

`plugin.toml` 的 `[plugin]` 中包含以下内容

```toml
name = 'stream_hub'
summary = '流式事件中心'
version = '0.0.1'
description = '统一事件通道、日志 tail 与日志文件查看页'
author = 'pd-qa-backend'
tags = ['task', 'other']
```

前端插件不需要额外 `backend/core/conf.py` 字段

## Usage

1. 在业务模块中使用 `defineStreamHubStream` 或 `defineStreamHubLogStream` 定义 schema
2. 在页面、抽屉或列表组件中使用 `useStreamHubStream` 或 `useStreamHubLogStream` 订阅事件
3. 在进入页面或切换资源时创建订阅，在离开页面、关闭抽屉或切换资源前停止订阅
4. 多个组件共享同一个资源订阅时，使用 `createStreamHubRoomRegistry` 管理引用计数
5. 只需要查看服务器日志文件时，复用日志控制台页面或日志文件 follow composable

## Uninstall

移除插件目录，清理业务模块中对 `stream_hub` 的 schema、composable、room registry 和日志组件引用

清理菜单、路由、i18n 和页面集成

移除后端配套插件或替换为其他事件流实现

## Contact

Author: pd-qa-backend
