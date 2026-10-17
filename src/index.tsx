/*
 * Copyright 2025 The Kubernetes Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {
  registerPluginSettings,
  registerRoute,
  registerSidebarEntry,
} from '@kinvolk/headlamp-plugin/lib';
import Applications from './components/Applications';
import Overview from './components/Overview';
import { Namespaces, Services, Workloads } from './components/Resources';
import Settings from './components/Settings';

registerSidebarEntry({
  name: 'kiali',
  label: 'Kiali',
  url: '/kiali/overview',
  icon: 'mdi:graph-outline',
});

const pages = [
  { name: 'overview', label: 'Overview', component: Overview },
  { name: 'applications', label: 'Applications', component: Applications },
  { name: 'namespaces', label: 'Namespaces', component: Namespaces },
  { name: 'services', label: 'Services', component: Services },
  { name: 'workloads', label: 'Workloads', component: Workloads },
  { name: 'settings', label: 'Connection settings', component: Settings },
];

for (const page of pages) {
  const name = `kiali-${page.name}`;
  registerSidebarEntry({ parent: 'kiali', name, label: page.label, url: `/kiali/${page.name}` });
  registerRoute({
    name,
    path: `/kiali/${page.name}`,
    sidebar: name,
    exact: true,
    component: page.component,
  });
}

registerPluginSettings('kiali', Settings, false);
