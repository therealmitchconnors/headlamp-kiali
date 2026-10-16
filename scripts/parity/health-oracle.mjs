import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    source: { type: 'string' },
    check: { type: 'boolean', default: false },
  },
});
assert.ok(values.source, 'Pass --source with the pinned Kiali checkout path');
const catalog = JSON.parse(await readFile('test-files/parity/upstream.json', 'utf8'));
assert.equal(catalog.commit, '0e8be887b8217bbcac5e3ae0bfcd258073949cca');

async function verifiedSource(path) {
  const source = catalog.sources.find(source => source.path === path);
  assert.ok(source, `Missing pinned source: ${path}`);
  const bytes = await readFile(join(values.source, path));
  const blob = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
  assert.equal(blob, source.blob, `Upstream source changed: ${path}`);
  return bytes.toString('utf8');
}

const model = await verifiedSource('models/health_status.go');
const types = await verifiedSource('models/health.go');
function struct(name) {
  const match = types.match(new RegExp(`^type ${name} struct \\{[\\s\\S]*?^\\}`, 'm'));
  assert.ok(match, `Missing upstream struct: ${name}`);
  return match[0];
}

const statuses = ['Healthy', 'Degraded', 'Failure', 'Not Ready', 'NA', 'Unknown'];
const workloadInputs = [null];
for (const desiredReplicas of [0, 1, 3, 5]) {
  for (const currentReplicas of [0, 1, 3, 5]) {
    for (const availableReplicas of [0, 1, 3, 5]) {
      for (const syncedProxies of [-1, 0, 1, 3, 5]) {
        workloadInputs.push({
          desiredReplicas,
          currentReplicas,
          availableReplicas,
          syncedProxies,
          name: 'synthetic',
        });
      }
    }
  }
}
const requestInputs = [
  { inbound: null, outbound: null },
  { inbound: {}, outbound: {} },
  { inbound: { http: { 200: 100 } }, outbound: {} },
  { inbound: { http: { 200: 90, 500: 10 } }, outbound: {} },
  { inbound: { http: { 200: 80, 404: 20 } }, outbound: {} },
  { inbound: { http: { 200: 80, 404: 10, 503: 10 } }, outbound: {} },
  { inbound: { http: { 500: 10 } }, outbound: { http: { 200: 90 } } },
  { inbound: { http: { 200: 0, 500: 0 } }, outbound: null },
  { inbound: { grpc: { 0: 12, 14: 3 } }, outbound: {} },
  { inbound: { tcp: { '': 10 } }, outbound: {} },
  { inbound: { http: { 200: 0.75, 404: 0.25 } }, outbound: { http: { 503: 0.5 } } },
  { inbound: null, outbound: { http: { 200: 1, 500: 1 }, grpc: { 0: 3 } } },
];

// Only the package name changes. All evaluated functions and data types come from
// checksum-verified upstream source, not from the TypeScript port.
const directory = await mkdtemp(join(tmpdir(), 'kiali-health-oracle-'));
let output;
try {
  await writeFile(
    join(directory, 'model.go'),
    model.replace(/^package models/m, 'package main') +
      '\n' +
      struct('WorkloadStatus') +
      '\n' +
      struct('RequestHealth') +
      '\n'
  );
  await writeFile(
    join(directory, 'main.go'),
    `package main
import ("encoding/json"; "os")
func main() {
  var inputs struct {
    Statuses []HealthStatus
    Workloads []*WorkloadStatus
    Requests []RequestHealth
  }
  if err := json.NewDecoder(os.Stdin).Decode(&inputs); err != nil { panic(err) }
  priorities := []any{}
  merges := []any{}
  workloads := []any{}
  requests := []any{}
  for _, status := range inputs.Statuses {
    priorities = append(priorities, map[string]any{"input": status, "expected": HealthStatusPriority(status)})
    for _, other := range inputs.Statuses {
      merges = append(merges, map[string]any{"first": status, "second": other, "expected": MergeHealthStatus(status, other)})
    }
  }
  for _, workload := range inputs.Workloads {
    workloads = append(workloads, map[string]any{"input": workload, "expected": WorkloadStatusHealth(workload)})
  }
  for _, request := range inputs.Requests {
    requests = append(requests, map[string]any{"input": request, "expected": map[string]float64{
      "errorRatio": request.GetErrorRatio(), "inbound": request.GetInboundRequestRate(),
      "outbound": request.GetOutboundRequestRate(), "total": request.GetTotalRequestRate(),
    }})
  }
  if err := json.NewEncoder(os.Stdout).Encode(map[string]any{
    "priorities": priorities, "merges": merges, "workloads": workloads, "requests": requests,
  }); err != nil { panic(err) }
}
`
  );
  output = JSON.parse(
    execFileSync('go', ['run', join(directory, 'main.go'), join(directory, 'model.go')], {
      input: JSON.stringify({ statuses, workloads: workloadInputs, requests: requestInputs }),
      encoding: 'utf8',
      env: { ...process.env, GO111MODULE: 'off', GOPROXY: 'off', GOTOOLCHAIN: 'local' },
      maxBuffer: 4 * 1024 * 1024,
    })
  );
} finally {
  await rm(directory, { recursive: true });
}

const fixtures = {
  version: catalog.version,
  commit: catalog.commit,
  sources: catalog.sources.filter(source =>
    ['models/health_status.go', 'models/health.go'].includes(source.path)
  ),
  ...output,
};
const path = 'test-files/parity/health-oracle.json';
const serialized = JSON.stringify(fixtures, null, 2) + '\n';
if (values.check) {
  assert.equal(await readFile(path, 'utf8'), serialized, 'Health oracle drift');
} else {
  await writeFile(path, serialized);
}
console.log(
  `Verified Go oracle: ${fixtures.priorities.length} priorities, ` +
    `${fixtures.merges.length} merges, ${fixtures.workloads.length} workloads, ` +
    `${fixtures.requests.length} request cases`
);
