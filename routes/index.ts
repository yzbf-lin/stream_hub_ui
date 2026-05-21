import type { RouteRecordRaw } from 'vue-router';

import { $t } from '#/locales';

const routes: RouteRecordRaw[] = [
  {
    name: 'PluginStreamHubLogConsole',
    path: '/monitor/log-console',
    component: () => import('#/plugins/stream_hub/views/log-viewer.vue'),
    meta: {
      title: $t('stream_hub.log_console_menu'),
      icon: 'lucide:file-text',
    },
  },
];

export default routes;
