import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const upstream = JSON.parse(await readFile('test-files/parity/upstream.json', 'utf8'));
const frontend = JSON.parse(await readFile('test-files/parity/frontend.json', 'utf8'));
const health = JSON.parse(await readFile('test-files/parity/health-oracle.json', 'utf8'));
const labels = JSON.parse(await readFile('test-files/correlation/label-oracle.json', 'utf8'));
const commit = '0e8be887b8217bbcac5e3ae0bfcd258073949cca';
for (const artifact of [upstream, frontend, health, labels]) {
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
    '21 routes, 216 contract fields, 375 health and 75 label Go oracle cases.'
);
