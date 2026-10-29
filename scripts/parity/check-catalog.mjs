import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const upstream = JSON.parse(await readFile('test-files/parity/upstream.json', 'utf8'));
const frontend = JSON.parse(await readFile('test-files/parity/frontend.json', 'utf8'));
const health = JSON.parse(await readFile('test-files/parity/health-oracle.json', 'utf8'));
const labels = JSON.parse(await readFile('test-files/correlation/label-oracle.json', 'utf8'));
const calculator = JSON.parse(await readFile('test-files/parity/health-calculator.json', 'utf8'));
const hosts = JSON.parse(await readFile('test-files/parity/host-oracle.json', 'utf8'));
const mtls = JSON.parse(await readFile('test-files/parity/mtls-oracle.json', 'utf8'));
const imports = JSON.parse(await readFile('test-files/parity/import-scope-oracle.json', 'utf8'));
const localChecks = JSON.parse(
  await readFile('test-files/parity/local-checks-oracle.json', 'utf8')
);
const reporters = JSON.parse(
  await readFile('test-files/parity/health-reporters-oracle.json', 'utf8')
);
const proxySummaries = JSON.parse(
  await readFile('test-files/parity/proxy-summary-oracle.json', 'utf8')
);
const authorization = JSON.parse(
  await readFile('test-files/parity/authorization-oracle.json', 'utf8')
);
const authorizationHosts = JSON.parse(
  await readFile('test-files/parity/authorization-host-oracle.json', 'utf8')
);
const topology = JSON.parse(await readFile('test-files/parity/topology-oracle.json', 'utf8'));
const serviceEntries = JSON.parse(
  await readFile('test-files/parity/service-entry-oracle.json', 'utf8')
);
const validationAnnotations = JSON.parse(
  await readFile('test-files/parity/validation-annotations-oracle.json', 'utf8')
);
const destinationRules = JSON.parse(
  await readFile('test-files/parity/destination-rule-oracle.json', 'utf8')
);
const destinationTls = JSON.parse(
  await readFile('test-files/parity/destination-tls-oracle.json', 'utf8')
);
const sidecarRoot = JSON.parse(
  await readFile('test-files/parity/sidecar-root-oracle.json', 'utf8')
);
const sidecarEgress = JSON.parse(
  await readFile('test-files/parity/sidecar-egress-oracle.json', 'utf8')
);
const virtualServiceRegistry = JSON.parse(
  await readFile('test-files/parity/virtual-service-registry-oracle.json', 'utf8')
);
const virtualServiceConflicts = JSON.parse(
  await readFile('test-files/parity/virtual-service-conflict-oracle.json', 'utf8')
);
const istioGatewayConflicts = JSON.parse(
  await readFile('test-files/parity/istio-gateway-conflict-oracle.json', 'utf8')
);
const peerSelectorless = JSON.parse(
  await readFile('test-files/parity/peer-selectorless-oracle.json', 'utf8')
);
const virtualWorkloadLabels = JSON.parse(
  await readFile('test-files/parity/virtual-workload-labels-oracle.json', 'utf8')
);
const workloadEntryHealth = JSON.parse(
  await readFile('test-files/parity/workload-entry-health-oracle.json', 'utf8')
);
const customDashboardQueries = JSON.parse(
  await readFile('test-files/parity/custom-dashboard-query-oracle.json', 'utf8')
);
const peerAuthentication = JSON.parse(
  await readFile('test-files/parity/peer-authentication-oracle.json', 'utf8')
);
const destinationPeerPolicy = JSON.parse(
  await readFile('test-files/parity/destination-peer-policy-oracle.json', 'utf8')
);
const gatewayClasses = JSON.parse(
  await readFile('test-files/parity/gateway-class-oracle.json', 'utf8')
);
const gatewayCollisions = JSON.parse(
  await readFile('test-files/parity/gateway-collision-oracle.json', 'utf8')
);
const histograms = JSON.parse(await readFile('test-files/parity/histogram-oracle.json', 'utf8'));
const trafficSignals = JSON.parse(
  await readFile('test-files/parity/traffic-signals-oracle.json', 'utf8')
);
const commit = '0e8be887b8217bbcac5e3ae0bfcd258073949cca';
for (const artifact of [
  upstream,
  frontend,
  health,
  labels,
  calculator,
  hosts,
  mtls,
  imports,
  reporters,
  localChecks,
  proxySummaries,
  authorization,
  authorizationHosts,
  topology,
  serviceEntries,
  validationAnnotations,
  destinationRules,
  destinationTls,
  sidecarRoot,
  sidecarEgress,
  virtualServiceRegistry,
  virtualServiceConflicts,
  istioGatewayConflicts,
  peerSelectorless,
  virtualWorkloadLabels,
  workloadEntryHealth,
  customDashboardQueries,
  peerAuthentication,
  destinationPeerPolicy,
  gatewayClasses,
  gatewayCollisions,
  histograms,
  trafficSignals,
]) {
  assert.equal(artifact.commit, commit);
  assert.equal(artifact.version, 'v2.33.0');
}
assert.equal(upstream.sources.length, 508);
assert.equal(upstream.features.length, 616);
assert.equal(frontend.routes.length, 21);
assert.equal(frontend.declarations.length, 216);

const sources = new Map(upstream.sources.map(source => [source.path, source.blob]));
assert.equal(sources.size, upstream.sources.length);
for (const [path, hash] of sources) {
  assert.match(hash, /^[a-f0-9]{40}$/);
  assert.ok(!path.startsWith('/') && !path.split('/').includes('..'));
}

const counts = {};
const ids = new Set();
for (const entry of upstream.features) {
  assert.ok(!ids.has(entry.id), `Duplicate ID: ${entry.id}`);
  assert.ok(sources.has(entry.source), `Missing source for ${entry.id}`);
  assert.ok(Number.isInteger(entry.line) && entry.line > 0);
  assert.ok(entry.symbol);
  ids.add(entry.id);
  counts[entry.category] = (counts[entry.category] ?? 0) + 1;
}
assert.deepEqual(counts, {
  'api-version': 12,
  api: 88,
  checker: 64,
  'diagnostic-source': 6,
  'frontend-contract': 64,
  'graph-appender': 17,
  'graph-default': 11,
  'graph-option': 20,
  'health-primitive': 7,
  'page-source': 176,
  resource: 34,
  'validation-code': 72,
  'wizard-source': 45,
});
for (const id of [
  'api:GET /api/namespaces/{namespace}/pods/{pod}/config_dump_ztunnel',
  'api:POST /api/namespaces/{namespace}/pods/{pod}/logging',
  'api:GET /api/mesh/graph',
  'resource:TrafficExtensions',
  'resource:K8sInferencePools',
  'resource:K8sGatewayClasses',
  'health-primitive:WorkloadStatusHealth',
]) {
  assert.ok(ids.has(id), `Missing required baseline behavior: ${id}`);
}
for (const entry of [...frontend.routes, ...frontend.declarations]) {
  assert.ok(!ids.has(entry.id), `Duplicate frontend ID: ${entry.id}`);
  assert.ok(sources.has(entry.source));
  assert.ok(Number.isInteger(entry.line) && entry.line > 0);
  ids.add(entry.id);
}
assert.ok(frontend.routes.some(route => route.path === '/namespaces/:namespace/services/:service'));
assert.ok(frontend.routes.some(route => route.path === '/graph/namespaces'));
assert.ok(frontend.routes.some(route => route.path === '/mesh'));
assert.equal(
  frontend.declarations.filter(entry => entry.additionalLines?.length).length,
  3,
  'Preserve duplicate upstream interface declarations without counting fields twice'
);

for (const source of health.sources) {
  assert.equal(source.blob, sources.get(source.path));
}
assert.equal(health.priorities.length, 6);
assert.equal(health.merges.length, 36);
assert.equal(health.workloads.length, 321);
assert.equal(health.requests.length, 12);
assert.equal(labels.cases.length, 75);
assert.equal(labels.sources['config/config.go'], 'fbde570684b760495782fce1df801d9c0046723e');
assert.equal(Object.keys(labels.sources).length, 4);
assert.equal(health.workloads[0].input, null);
assert.equal(health.workloads[0].expected, 'NA');
assert.equal(calculator.cases.length, 271);
assert.equal(hosts.cases.length, 627);
assert.equal(mtls.cases.length, 2600);
assert.equal(imports.cases.length, 760);
assert.equal(reporters.cases.length, 372);
assert.equal(localChecks.cases.length, 564);
assert.equal(proxySummaries.cases.length, 1063);
assert.equal(authorization.cases.length, 296);
assert.equal(topology.cases.length, 1728);
assert.equal(serviceEntries.cases.length, 398);
assert.equal(validationAnnotations.cases.length, 72);
assert.equal(destinationRules.cases.length, 1087);
assert.equal(destinationTls.cases.length, 1800);
assert.equal(sidecarRoot.cases.length, 72);
assert.equal(sidecarEgress.cases.length, 288);
assert.equal(virtualServiceRegistry.cases.length, 576);
assert.equal(virtualServiceConflicts.cases.length, 400);
assert.equal(istioGatewayConflicts.cases.length, 328);
assert.equal(peerSelectorless.cases.length, 176);
assert.equal(virtualWorkloadLabels.cases.length, 96);
assert.equal(workloadEntryHealth.cases.length, 228);
assert.equal(customDashboardQueries.cases.length, 216);
assert.deepEqual(customDashboardQueries.sources, {
  'prometheus/client.go': 'e0d914d91a981d2963bf59672fdd28293fe0d7ab',
  'prometheus/metrics.go': '941c8de27de564abace6ee0cf717c6b2fb8a1d01',
  'business/dashboards.go': '2707361491dc93e769f363c6bdb9122af230bd20',
  'config/dashboards/dashboards_config.go': '1eace997db22287475c17be2763c838334f1304e',
});
assert.deepEqual(workloadEntryHealth.sources, {
  'util/healthutil/health_util.go': 'dfe83f57c9876b1a7b01479c93da9e272565029a',
  'models/workload.go': '8070c2c4423dee1ef6629e94ffd299e57c03c843',
});
assert.deepEqual(virtualWorkloadLabels.sources, {
  'models/workload.go': '8070c2c4423dee1ef6629e94ffd299e57c03c843',
  'kubernetes/filters.go': '1f5c24f5819ff1e633f848d1534b6f29ba53ca2a',
  'business/workloads.go': 'e0b704c0b299d19b50fbe9ae1d19cab1272a15cc',
});
assert.deepEqual(peerSelectorless.sources, {
  'business/checkers/common/multi_match_selector_checker.go':
    '3240a2bcb2b74fb589768c3dd06e8c959fdab99d',
  'business/checkers/peer_authentication_checker.go': 'd4ba5a8ac74729061f72400d0fd8ab61c29ec472',
  'models/istio_validation.go': 'd13e0b576e9392cb7e19578c05a07f2641efc054',
  'business/istio_validations.go': 'ef416a10be244b84b86e017203b4e76869ae1889',
});
assert.deepEqual(istioGatewayConflicts.sources, {
  'business/checkers/gateways/multi_match_checker.go': '4f751c9978b1b94daf9c99ac1e45dc1074d41e8a',
  'business/checkers/gateway_checker.go': 'f12fc368f401076f10a084662f66ef778e427da1',
  'models/istio_validation.go': 'd13e0b576e9392cb7e19578c05a07f2641efc054',
  'config/config.go': 'fbde570684b760495782fce1df801d9c0046723e',
});
assert.deepEqual(virtualServiceConflicts.sources, {
  'business/checkers/virtualservices/single_host_checker.go':
    '36ea67a0aa0b701ff331af3784413029c62ae181',
  'kubernetes/host.go': '551a684ab15e065be524de46d68aa631c4b7e289',
});
assert.equal(peerAuthentication.cases.length, 348);
assert.equal(destinationPeerPolicy.cases.length, 984);
assert.equal(gatewayClasses.cases.length, 64);
assert.equal(gatewayCollisions.cases.length, 508);
assert.equal(histograms.cases.length, 180);
assert.equal(trafficSignals.cases.length, 108);
assert.deepEqual(trafficSignals.sources, histograms.sources);
assert.equal(authorizationHosts.cases.length, 960);
assert.deepEqual(authorizationHosts.sources, {
  'business/checkers/authorization/no_host_checker.go': '59abfea352bc8a1f13ba815bf1c5f4500f2ce3bf',
  'business/checkers/authorization_policies_checker.go': 'da8bf7417d61b19ca96788c27d37c104567f21f3',
  'kubernetes/host.go': '551a684ab15e065be524de46d68aa631c4b7e289',
  'kubernetes/istio.go': 'c574a501bb73e9c479c4e5e4e07d87220325d6d3',
  'business/istio_validations.go': 'ef416a10be244b84b86e017203b4e76869ae1889',
  'kubernetes/filters.go': '1f5c24f5819ff1e633f848d1534b6f29ba53ca2a',
  'models/istio_validation.go': 'd13e0b576e9392cb7e19578c05a07f2641efc054',
});
assert.deepEqual(histograms.sources, {
  'prometheus/metrics.go': '941c8de27de564abace6ee0cf717c6b2fb8a1d01',
  'business/metrics_definitions.go': '2d9c32a25b1769e44ce927db14e75f7e544544f5',
});
assert.deepEqual(gatewayCollisions.sources, {
  'business/checkers/k8sgateways/multi_match_checker.go':
    '25ff60b04609a6b721ea2bd80a84f28c5cf2ec63',
  'business/checkers/k8sgateway_checker.go': '325feda97b07a084ddc33b8c0372bec3de078d7e',
  'models/istio_validation.go': 'd13e0b576e9392cb7e19578c05a07f2641efc054',
});
assert.deepEqual(gatewayClasses.sources, {
  'business/checkers/k8sgateways/gatewayclass_checker.go':
    '48ad008a33df77598f509706ac9491fd58fcab27',
  'business/checkers/k8sgateway_checker.go': '325feda97b07a084ddc33b8c0372bec3de078d7e',
  'cache/cache.go': 'b3bc1b4280ab51d78efbd1be2fdebfbe2774f09b',
  'models/istio_validation.go': 'd13e0b576e9392cb7e19578c05a07f2641efc054',
});
assert.deepEqual(destinationPeerPolicy.sources, {
  'business/checkers/destinationrules/disabled_meshwide_mtls_checker.go':
    'c2232003cddd8088518753412df3ce74e36403c6',
  'business/checkers/destinationrules/disabled_namespacewide_mtls_checker.go':
    '964ca1d390dff870ff89f91238a17bdd72094b58',
  'business/checkers/destinationrules/meshwide_mtls_checker.go':
    'c8de9b68c4733c60fb11f5bfec366209ae255c06',
  'business/checkers/destinationrules/namespacewide_mtls_checker.go':
    '2ff9d06a37d6d77ddc6a8ee60c4a38876585a7cb',
  'business/checkers/destination_rules_checker.go': '4a87b3f2633835f89f009a607da01c898b631ea1',
  'business/istio_validations.go': 'ef416a10be244b84b86e017203b4e76869ae1889',
  'kubernetes/istio.go': 'c574a501bb73e9c479c4e5e4e07d87220325d6d3',
  'models/istio_validation.go': 'd13e0b576e9392cb7e19578c05a07f2641efc054',
});
assert.deepEqual(peerAuthentication.sources, {
  'business/checkers/peerauthentications/disabled_meshwide_checker.go':
    'bfc9df54ff6ea31406348bedd7dc610a2c340c04',
  'business/checkers/peerauthentications/disabled_namespacewide_checker.go':
    '4070c15be2e5e991f0b7a2e11eacdaac24841e7d',
  'business/checkers/peerauthentications/mesh_mtls_checker.go':
    'bc3b8975d35f4e1fef6522b2fd6a274379e0db64',
  'business/checkers/peerauthentications/namespace_mtls_checker.go':
    'cefa55a3714ef445cf4e2423d2c8032d250dc693',
  'business/checkers/peer_authentication_checker.go': 'd4ba5a8ac74729061f72400d0fd8ab61c29ec472',
  'kubernetes/istio.go': 'c574a501bb73e9c479c4e5e4e07d87220325d6d3',
  'models/istio_validation.go': 'd13e0b576e9392cb7e19578c05a07f2641efc054',
});
assert.deepEqual(virtualServiceRegistry.sources, {
  'business/checkers/virtualservices/no_host_checker.go':
    'b4119c61747339d384fb2f07454fb9e213e95719',
  'kubernetes/host.go': '551a684ab15e065be524de46d68aa631c4b7e289',
  'kubernetes/istio.go': 'c574a501bb73e9c479c4e5e4e07d87220325d6d3',
  'models/mesh.go': '518a4242407e27452bb199b91344456d89908ad4',
  'business/istio_validations.go': 'ef416a10be244b84b86e017203b4e76869ae1889',
  'business/checkers/no_service_checker.go': '8c8dbb33261e67faed9445f8493585e15eb58667',
  'models/istio_validation.go': 'd13e0b576e9392cb7e19578c05a07f2641efc054',
});
assert.deepEqual(sidecarEgress.sources, {
  'business/checkers/sidecars/egress_listener_checker.go':
    '52d483c06b19b2d1ac3fe25e4d44ca70c8388c16',
  'kubernetes/host.go': '551a684ab15e065be524de46d68aa631c4b7e289',
  'kubernetes/istio.go': 'c574a501bb73e9c479c4e5e4e07d87220325d6d3',
  'business/checkers/sidecars_checker.go': '7b3f3c6fb59a1adae5623358cb4fee48ef3dd479',
  'models/istio_validation.go': 'd13e0b576e9392cb7e19578c05a07f2641efc054',
});
assert.deepEqual(sidecarRoot.sources, {
  'business/checkers/sidecars/global_checker.go': 'db53f17f9300e68fc10d8b0bc2875dc20d733fc6',
  'business/checkers/sidecars_checker.go': '7b3f3c6fb59a1adae5623358cb4fee48ef3dd479',
  'models/istio_validation.go': 'd13e0b576e9392cb7e19578c05a07f2641efc054',
});
assert.deepEqual(destinationTls.sources, {
  'business/checkers/destinationrules/traffic_policy_checker.go':
    '6d3133c9c64f632dd31b81d064d8ef8571fa100f',
  'business/checkers/destinationrules/multi_match_checker.go':
    'e91bf464b354f2d9d3da8908bb6228f7abe4c81f',
  'kubernetes/host.go': '551a684ab15e065be524de46d68aa631c4b7e289',
  'kubernetes/istio.go': 'c574a501bb73e9c479c4e5e4e07d87220325d6d3',
});
assert.deepEqual(destinationRules.sources, {
  'business/checkers/destinationrules/multi_match_checker.go':
    'e91bf464b354f2d9d3da8908bb6228f7abe4c81f',
  'kubernetes/host.go': '551a684ab15e065be524de46d68aa631c4b7e289',
  'kubernetes/istio.go': 'c574a501bb73e9c479c4e5e4e07d87220325d6d3',
});
assert.deepEqual(validationAnnotations.sources, {
  'models/istio_validation.go': 'd13e0b576e9392cb7e19578c05a07f2641efc054',
});
assert.deepEqual(serviceEntries.sources, {
  'business/checkers/serviceentries/multi_match_checker.go':
    'aa11fd0e2607cea9a4d62d769f74dff14fe1d3af',
  'models/istio_validation.go': 'd13e0b576e9392cb7e19578c05a07f2641efc054',
});
assert.deepEqual(topology.sources, {
  'graph/types.go': 'b14b55e8a1eed3dc1fba43c0837a35babf5dd57f',
  'graph/util.go': '376f6f9cda95adc509f34e73ad7fea9bf9ff61ee',
});
assert.deepEqual(authorization.sources, {
  'business/checkers/authorization/namespace_method_checker.go':
    '004170c8ad7e4c2d32f7ac7f5e647f24540d383e',
  'models/namespace.go': '0f5b43473ce9fe7f7de6592d405d9997515278da',
  'util/httputil/http_util.go': '1eec05f92b34b45f492ce4de77b8df52a29586af',
});
assert.deepEqual(proxySummaries.sources, {
  'models/config_dump.go': '9caa49bf86cc4cb18c4ba3da5929967ce6a1bdd0',
  'kubernetes/envoy.go': '80a3b2f0334c8fd10afb92302adaa1292d985a5b',
  'kubernetes/host.go': '551a684ab15e065be524de46d68aa631c4b7e289',
  'business/proxy_status.go': '0df11d339cca10906b8167ced2666cbfcf92880c',
});
assert.deepEqual(localChecks.sources, {
  'kubernetes/istio.go': 'c574a501bb73e9c479c4e5e4e07d87220325d6d3',
  'business/checkers/k8sgateways/status_checker.go': '03323c9cf6179f3c173327951a096286293a8b26',
});
assert.deepEqual(reporters.sources, {
  'models/health.go': 'd3df3111150fc1143c7678fdf73c3b898a0e0487',
});
assert.deepEqual(imports.sources, {
  'business/checkers/common/sidecar_import_scope.go': '6fe83a172a217bce37cc7bd35e87d2530cec6774',
  'kubernetes/host.go': '551a684ab15e065be524de46d68aa631c4b7e289',
  'kubernetes/istio.go': 'c574a501bb73e9c479c4e5e4e07d87220325d6d3',
});
assert.deepEqual(mtls.sources, {
  'util/mtls/status.go': '730d21872c3fb79d28ecd658ea1e935189fd448b',
});
assert.deepEqual(hosts.sources, {
  'kubernetes/host.go': '551a684ab15e065be524de46d68aa631c4b7e289',
  'kubernetes/filters.go': '1f5c24f5819ff1e633f848d1534b6f29ba53ca2a',
});
assert.deepEqual(calculator.sources, {
  'business/health_calculator.go': 'e1deff9aa9d01e57ff610b0d74d5a514a30d5fe9',
  'business/health_config.go': 'ee85266b1b06e5b2d2e1c3f6efd93853da63c680',
  'config/config.go': 'fbde570684b760495782fce1df801d9c0046723e',
  'models/health_status.go': '1aab7bf024eac81f1e8093a85cbad040c4eb6f27',
  'models/health.go': 'd3df3111150fc1143c7678fdf73c3b898a0e0487',
});
for (const fixture of health.workloads) {
  if (fixture.input !== null) {
    for (const field of [
      'desiredReplicas',
      'currentReplicas',
      'availableReplicas',
      'syncedProxies',
    ]) {
      assert.ok(Number.isInteger(fixture.input[field]), `Invalid oracle input: ${field}`);
    }
  }
}
console.log(
  'Pinned inventory and oracle consistent: 508 sources, 616 inventory entries, ' +
    '21 routes, 216 contract fields, 375 health-model, 271 health-calculator, 372 reporter, 627 host, 2600 mTLS, 760 import/export, 564 local-check, 1063 proxy-summary, 296 authorization-pattern, 960 authorization-host/visibility, 1728 graph-identity, 398 ServiceEntry grouping, 1087 DestinationRule conflict, 1800 TLS-override, 72 Sidecar root-selector, 288 Sidecar egress/registry, 576 VirtualService registry, 400 VirtualService conflict, 328 Istio Gateway conflict, 176 selectorless PeerAuthentication, 96 VM-label selection, 228 WorkloadEntry health, 348 PeerAuthentication, 984 DestinationRule peer-policy, 64 Gateway class membership, 508 Gateway collision, 180 histogram-query, 108 traffic-signal, 216 custom-dashboard query, 72 validation-exclusion and 75 label Go oracle cases.'
);
