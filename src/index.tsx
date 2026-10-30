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

import { Icon } from '@iconify/react';
import {
  registerKindIcon,
  registerMapSource,
  registerPluginSettings,
  registerRoute,
  registerSidebarEntry,
} from '@kinvolk/headlamp-plugin/lib';
import Applications from './components/Applications';
import ClusterComparison from './components/ClusterComparison';
import Configuration, {
  ConfigurationDetail,
  ConfigurationList,
} from './components/configuration/Configuration';
import CustomDashboards from './components/CustomDashboards';
import Diagnostics from './components/Diagnostics';
import Histograms from './components/Histograms';
import Mesh from './components/Mesh';
import Mtls from './components/Mtls';
import Overview from './components/Overview';
import { Namespaces, Services, Workloads } from './components/Resources';
import ServiceTrafficWizard from './components/ServiceTrafficWizard';
import Settings from './components/Settings';
import Topology from './components/Topology';
import Traces from './components/Traces';
import Traffic from './components/Traffic';
import TrafficSignals from './components/TrafficSignals';
import WorkloadDashboards from './components/WorkloadDashboards';
import WorkloadHealth from './components/WorkloadHealth';
import { kialiConfigurationSource } from './mapView';
import { configurationDefinitions } from './resources/registry';

registerSidebarEntry({
  name: 'kiali',
  label: 'Kiali',
  url: '/kiali/overview',
  icon: 'mdi:graph-outline',
});

const pages = [
  { name: 'overview', label: 'Overview', component: Overview },
  { name: 'clusters', label: 'Cluster comparison', component: ClusterComparison },
  { name: 'applications', label: 'Applications', component: Applications },
  { name: 'mesh', label: 'Mesh inventory', component: Mesh },
  { name: 'mtls', label: 'mTLS configuration', component: Mtls },
  { name: 'traces', label: 'Traces', component: Traces },
  { name: 'diagnostics', label: 'Pod diagnostics', component: Diagnostics },
  { name: 'configuration', label: 'Mesh configuration', component: Configuration },
  { name: 'traffic', label: 'Traffic metrics', component: Traffic },
  { name: 'histograms', label: 'Traffic histograms', component: Histograms },
  { name: 'signals', label: 'Traffic signals', component: TrafficSignals },
  { name: 'dashboards', label: 'Custom dashboards', component: CustomDashboards },
  { name: 'graph', label: 'Traffic graph', component: Topology },
  { name: 'health', label: 'Health', component: WorkloadHealth },
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
registerRoute({
  name: 'kiali-workload-dashboards',
  path: '/kiali/workload-dashboards',
  sidebar: 'kiali-workloads',
  exact: true,
  component: WorkloadDashboards,
});
registerRoute({
  name: 'kiali-service-traffic',
  path: '/kiali/service-traffic',
  sidebar: 'kiali-services',
  exact: true,
  component: ServiceTrafficWizard,
});

for (const definition of configurationDefinitions) {
  registerRoute({
    name: definition.resourceClass.listRoute,
    path: `/kiali/configuration/${definition.id}`,
    sidebar: 'kiali-configuration',
    exact: true,
    component: () => <ConfigurationList definition={definition} />,
  });
  registerRoute({
    name: definition.resourceClass.detailsRoute,
    path: `/kiali/configuration/${definition.id}/${
      definition.resourceClass.isNamespaced ? ':namespace/' : ''
    }:name`,
    sidebar: 'kiali-configuration',
    exact: true,
    component: () => <ConfigurationDetail definition={definition} />,
  });
  // Gateway is also a built-in Gateway API kind; leave its global icon unchanged.
  if (definition.kind !== 'Gateway')
    registerKindIcon(definition.kind, {
      icon: <Icon icon="mdi:routes" width="70%" height="70%" />,
      color: 'rgb(50,108,229)',
    });
}
registerMapSource(kialiConfigurationSource);
