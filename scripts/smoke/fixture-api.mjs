import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';

const fixtures = JSON.parse(
  readFileSync(new URL('../../test-files/smoke/fixtures.json', import.meta.url), 'utf8')
);

const TOKEN = 'smoke-fixture-token';
const groups = {
  'apiextensions.k8s.io': ['v1'],
  'admissionregistration.k8s.io': ['v1'],
  apps: ['v1'],
  'authorization.k8s.io': ['v1'],
  'metrics.k8s.io': ['v1beta1'],
  'networking.istio.io': ['v1'],
};

const resources = {
  'apiextensions.k8s.io/v1': [
    { name: 'customresourcedefinitions', kind: 'CustomResourceDefinition', namespaced: false },
  ],
  'admissionregistration.k8s.io/v1': [
    {
      name: 'mutatingwebhookconfigurations',
      kind: 'MutatingWebhookConfiguration',
      namespaced: false,
    },
    {
      name: 'validatingwebhookconfigurations',
      kind: 'ValidatingWebhookConfiguration',
      namespaced: false,
    },
  ],
  'apps/v1': [
    { name: 'deployments', kind: 'Deployment', namespaced: true },
    { name: 'replicasets', kind: 'ReplicaSet', namespaced: true },
    { name: 'statefulsets', kind: 'StatefulSet', namespaced: true },
    { name: 'daemonsets', kind: 'DaemonSet', namespaced: true },
  ],
  'authorization.k8s.io/v1': [
    { name: 'selfsubjectaccessreviews', kind: 'SelfSubjectAccessReview', namespaced: false },
    { name: 'selfsubjectrulesreviews', kind: 'SelfSubjectRulesReview', namespaced: false },
  ],
  'metrics.k8s.io/v1beta1': [
    { name: 'nodes', kind: 'NodeMetrics', namespaced: false },
    { name: 'pods', kind: 'PodMetrics', namespaced: true },
  ],
  'networking.istio.io/v1': [
    { name: 'gateways', kind: 'Gateway', namespaced: true },
    { name: 'workloadgroups', kind: 'WorkloadGroup', namespaced: true },
    { name: 'workloadentries', kind: 'WorkloadEntry', namespaced: true },
    { name: 'virtualservices', kind: 'VirtualService', namespaced: true },
    { name: 'destinationrules', kind: 'DestinationRule', namespaced: true },
    { name: 'serviceentries', kind: 'ServiceEntry', namespaced: true },
    { name: 'sidecars', kind: 'Sidecar', namespaced: true },
    { name: 'envoyfilters', kind: 'EnvoyFilter', namespaced: true },
    { name: 'authorizationpolicies', kind: 'AuthorizationPolicy', namespaced: true },
    { name: 'peerauthentications', kind: 'PeerAuthentication', namespaced: true },
    { name: 'requestauthentications', kind: 'RequestAuthentication', namespaced: true },
    { name: 'wasmplugins', kind: 'WasmPlugin', namespaced: true },
    { name: 'telemetries', kind: 'Telemetry', namespaced: true },
  ],
};

const response = (res, status, value) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(value));
};

function list(kind, apiVersion, items, resourceVersion = '100') {
  return {
    apiVersion,
    kind: `${kind}List`,
    metadata: { resourceVersion },
    items,
  };
}

function groupDiscovery(name, versions) {
  return {
    apiVersion: 'apiregistration.k8s.io/v1',
    kind: 'APIGroup',
    name,
    versions: versions.map(version => ({
      groupVersion: `${name}/${version}`,
      version,
    })),
    preferredVersion: {
      groupVersion: `${name}/${versions[0]}`,
      version: versions[0],
    },
  };
}

function apiResourceList(groupVersion) {
  return {
    apiVersion: 'v1',
    groupVersion,
    resources: resources[groupVersion] ?? [],
  };
}

function coreResourceList() {
  return {
    apiVersion: 'v1',
    groupVersion: 'v1',
    resources: [
      { name: 'namespaces', kind: 'Namespace', namespaced: false },
      { name: 'pods', kind: 'Pod', namespaced: true },
      { name: 'services', kind: 'Service', namespaced: true },
      { name: 'configmaps', kind: 'ConfigMap', namespaced: true },
      { name: 'events', kind: 'Event', namespaced: true },
      { name: 'nodes', kind: 'Node', namespaced: false },
      { name: 'serviceaccounts', kind: 'ServiceAccount', namespaced: true },
    ],
  };
}

export function createFixtureApi() {
  const requests = [];
  let scenario = 'positive';
  let serviceReads = 0;
  let gatewayReads = 0;

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://fixture.invalid');
    const record = {
      method: req.method ?? '',
      path: `${url.pathname}${url.search}`,
      scenario,
      authenticated: req.headers.authorization === 'Bearer ' + TOKEN,
    };
    res.on('finish', () => {
      record.status = res.statusCode;
    });
    requests.push(record);

    if (!record.authenticated) {
      response(res, 401, {
        apiVersion: 'v1',
        kind: 'Status',
        status: 'Failure',
        reason: 'Unauthorized',
        message: 'Synthetic fixture authentication is required',
        code: 401,
      });
      return;
    }

    if (
      req.method === 'POST' &&
      url.pathname === '/apis/authorization.k8s.io/v1/selfsubjectrulesreviews'
    ) {
      let body = '';
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 16384) {
          response(res, 413, { status: 'Failure', reason: 'RequestEntityTooLarge', code: 413 });
          return;
        }
      }
      let review;
      try {
        review = JSON.parse(body);
      } catch {
        response(res, 400, { status: 'Failure', reason: 'BadRequest', code: 400 });
        return;
      }
      if (typeof review?.spec?.namespace !== 'string') {
        response(res, 400, { status: 'Failure', reason: 'BadRequest', code: 400 });
        return;
      }
      response(res, 200, {
        apiVersion: 'authorization.k8s.io/v1',
        kind: 'SelfSubjectRulesReview',
        spec: review.spec,
        status: {
          resourceRules: [{ verbs: ['get', 'list', 'watch'], apiGroups: ['*'], resources: ['*'] }],
          nonResourceRules: [],
          incomplete: false,
        },
      });
      return;
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      response(res, 405, {
        apiVersion: 'v1',
        kind: 'Status',
        status: 'Failure',
        reason: 'MethodNotAllowed',
        message: 'The smoke Kubernetes API is read-only',
        code: 405,
      });
      return;
    }

    if (
      scenario === 'denied' &&
      url.pathname === '/api/v1/namespaces' &&
      url.searchParams.get('limit') === '250' &&
      !url.searchParams.has('watch')
    ) {
      response(res, 403, {
        apiVersion: 'v1',
        kind: 'Status',
        status: 'Failure',
        reason: 'Forbidden',
        message: 'Synthetic namespace list denied',
        code: 403,
      });
      return;
    }

    if (url.pathname === '/version') {
      response(res, 200, { major: '1', minor: '30', gitVersion: 'v1.30.0-smoke' });
      return;
    }
    if (url.pathname === '/healthz') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('ok');
      return;
    }
    if (url.pathname === '/api') {
      response(res, 200, { apiVersion: 'v1', kind: 'APIVersions', versions: ['v1'] });
      return;
    }
    if (url.pathname === '/api/v1') {
      response(res, 200, coreResourceList());
      return;
    }
    if (url.pathname === '/apis') {
      const discovered = Object.entries(groups).map(([name, versions]) =>
        groupDiscovery(name, versions)
      );
      response(res, 200, {
        apiVersion: 'v1',
        kind: 'APIGroupList',
        groups: discovered,
      });
      return;
    }
    if (url.pathname.startsWith('/apis/')) {
      const suffix = url.pathname.slice('/apis/'.length);
      if (groups[suffix]) {
        response(res, 200, groupDiscovery(suffix, groups[suffix]));
        return;
      }
      if (resources[suffix]) {
        response(res, 200, apiResourceList(suffix));
        return;
      }
    }
    if (url.pathname === '/apis/apiextensions.k8s.io/v1/customresourcedefinitions') {
      response(res, 200, list('CustomResourceDefinition', 'apiextensions.k8s.io/v1', []));
      return;
    }

    if (url.pathname === '/api/v1/namespaces') {
      response(res, 200, list('Namespace', 'v1', fixtures.namespaces));
      return;
    }
    if (url.pathname === '/api/v1/namespaces/bookinfo') {
      response(res, 200, fixtures.namespaces[0]);
      return;
    }
    if (/^\/api\/v1\/(?:namespaces\/[^/]+\/)?events$/.test(url.pathname)) {
      response(res, 200, list('Event', 'v1', []));
      return;
    }
    if (url.pathname === '/api/v1/nodes') {
      response(res, 200, list('Node', 'v1', []));
      return;
    }
    if (url.pathname === '/api/v1/namespaces/istio-system/configmaps/istio-1-30') {
      response(res, 200, fixtures.meshConfig);
      return;
    }
    if (url.pathname === '/api/v1/namespaces/istio-system/configmaps/istio-sidecar-injector-1-30') {
      response(res, 200, fixtures.injectorConfig);
      return;
    }
    if (url.pathname === '/apis/admissionregistration.k8s.io/v1/mutatingwebhookconfigurations') {
      response(
        res,
        200,
        list('MutatingWebhookConfiguration', 'admissionregistration.k8s.io/v1', [])
      );
      return;
    }
    if (url.pathname === '/apis/apps/v1/deployments') {
      const items =
        url.searchParams.get('labelSelector') === 'app=istiod'
          ? [fixtures.controller]
          : [fixtures.controller, fixtures.reviewsDeployment];
      response(res, 200, list('Deployment', 'apps/v1', items));
      return;
    }
    if (url.pathname === '/apis/metrics.k8s.io/v1beta1/nodes') {
      response(res, 200, list('NodeMetrics', 'metrics.k8s.io/v1beta1', []));
      return;
    }
    if (url.pathname === '/apis/metrics.k8s.io/v1beta1/pods') {
      response(res, 200, list('PodMetrics', 'metrics.k8s.io/v1beta1', []));
      return;
    }
    if (
      url.pathname === '/api/v1/pods' ||
      /^\/api\/v1\/namespaces\/[^/]+\/pods$/.test(url.pathname)
    ) {
      const podItems =
        url.pathname === '/api/v1/pods' || url.pathname === '/api/v1/namespaces/bookinfo/pods'
          ? [fixtures.pod]
          : [];
      const value = list('Pod', 'v1', podItems);
      if (scenario === 'incomplete' && url.searchParams.get('limit') === '250')
        delete value.metadata.resourceVersion;
      response(res, 200, value);
      return;
    }
    if (url.pathname === '/apis/apps/v1/replicasets') {
      response(res, 200, list('ReplicaSet', 'apps/v1', []));
      return;
    }
    if (url.pathname === '/apis/apps/v1/statefulsets') {
      response(res, 200, list('StatefulSet', 'apps/v1', []));
      return;
    }
    if (url.pathname === '/apis/apps/v1/daemonsets') {
      response(res, 200, list('DaemonSet', 'apps/v1', []));
      return;
    }
    if (url.pathname === '/apis/networking.istio.io/v1/workloadgroups') {
      response(res, 200, list('WorkloadGroup', 'networking.istio.io/v1', []));
      return;
    }
    if (url.pathname === '/apis/networking.istio.io/v1/workloadentries') {
      response(res, 200, list('WorkloadEntry', 'networking.istio.io/v1', []));
      return;
    }
    if (url.pathname === '/apis/networking.istio.io/v1/virtualservices') {
      response(res, 200, list('VirtualService', 'networking.istio.io/v1', []));
      return;
    }
    if (url.pathname === '/apis/networking.istio.io/v1/gateways') {
      response(res, 200, list('Gateway', 'networking.istio.io/v1', [fixtures.gateway]));
      return;
    }
    if (url.pathname === '/apis/networking.istio.io/v1/namespaces/bookinfo/gateways') {
      response(res, 200, list('Gateway', 'networking.istio.io/v1', [fixtures.gateway]));
      return;
    }
    if (
      url.pathname === '/apis/networking.istio.io/v1/namespaces/bookinfo/gateways/smoke-gateway'
    ) {
      gatewayReads++;
      const gateway = structuredClone(fixtures.gateway);
      if (scenario === 'stale' && gatewayReads > 0) gateway.metadata.resourceVersion = '41';
      response(res, 200, gateway);
      return;
    }
    if (url.pathname === '/api/v1/namespaces/bookinfo/services/reviews') {
      serviceReads++;
      const service = structuredClone(fixtures.service);
      if (scenario === 'stale' && serviceReads > 1) service.metadata.resourceVersion = '51';
      response(res, 200, service);
      return;
    }
    if (url.pathname === '/api/v1/services') {
      response(res, 200, list('Service', 'v1', [fixtures.service]));
      return;
    }
    if (url.pathname.includes('/proxy/api/v1/status/buildinfo')) {
      response(res, 200, fixtures.prometheusBuildInfo);
      return;
    }

    response(res, 404, {
      apiVersion: 'v1',
      kind: 'Status',
      status: 'Failure',
      reason: 'NotFound',
      message: `Synthetic API path not found: ${url.pathname}`,
      code: 404,
    });
  });

  return {
    requests,
    server,
    setScenario(next) {
      scenario = next;
      serviceReads = 0;
      gatewayReads = 0;
      return requests.length;
    },
    async listen() {
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
      });
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Fixture API did not bind');
      return `http://127.0.0.1:${address.port}`;
    },
  };
}

export { TOKEN as fixtureToken };
