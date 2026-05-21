import { requestClient } from '#/api/request';

const BASE = '/api/v1/stream-hub/log-files';

export interface LogFileItem {
  fileId: string;
  group: string;
  mtime: string;
  name: string;
  relativePath: string;
  size: number;
  suffix: string;
}

export interface LogFileLine {
  code?: string;
  fileId?: string;
  level?: string;
  line?: string;
  message: string;
  stream_seq?: number;
}

export interface LogFileTailResponse {
  exists: boolean;
  fileId: string;
  limit: number;
  lines: LogFileLine[];
  truncated: boolean;
}

export interface LogFileFollowResponse {
  fileId: string;
  following: boolean;
  leaseExpiresIn: number;
  leaseId: string;
  watcherCount: number;
}

export interface LogFileTailParams {
  limit?: number;
}

export async function getLogFilesApi() {
  return requestClient.get<LogFileItem[]>(BASE);
}

export async function getLogFileTailApi(
  fileId: string,
  params: LogFileTailParams = {},
) {
  return requestClient.get<LogFileTailResponse>(`${BASE}/${fileId}/tail`, {
    params,
  });
}

export async function downloadLogFileApi(fileId: string) {
  return requestClient.download<Blob>(`${BASE}/${fileId}/download`);
}

export async function followLogFileApi(fileId: string) {
  return requestClient.post<LogFileFollowResponse>(`${BASE}/${fileId}/follow`);
}

export async function heartbeatLogFileFollowApi(
  fileId: string,
  leaseId: string,
) {
  return requestClient.post<LogFileFollowResponse>(
    `${BASE}/${fileId}/follow/${leaseId}/heartbeat`,
  );
}

export async function unfollowLogFileApi(fileId: string, leaseId: string) {
  return requestClient.delete<void>(`${BASE}/${fileId}/follow/${leaseId}`);
}
