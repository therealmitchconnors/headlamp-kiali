import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: { source: { type: 'string' }, check: { type: 'boolean', default: false } },
});
assert.ok(values.source, 'Pass --source for the pinned Kiali checkout');
const sources = {
  'business/health_calculator.go': 'e1deff9aa9d01e57ff610b0d74d5a514a30d5fe9',
  'business/health_config.go': 'ee85266b1b06e5b2d2e1c3f6efd93853da63c680',
  'config/config.go': 'fbde570684b760495782fce1df801d9c0046723e',
  'models/health_status.go': '1aab7bf024eac81f1e8093a85cbad040c4eb6f27',
  'models/health.go': 'd3df3111150fc1143c7678fdf73c3b898a0e0487',
};
const contents = {};
for (const [path, hash] of Object.entries(sources)) {
  const bytes = await readFile(join(values.source, path));
  assert.equal(
    createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'),
    hash,
    `Changed upstream source: ${path}`
  );
  contents[path] = bytes.toString('utf8');
}
function extract(text, regex) {
  const match = text.match(regex);
  assert.ok(match, `Missing pinned source block: ${regex}`);
  return match[0];
}
function struct(file, name) {
  return extract(contents[file], new RegExp(`^type ${name} struct \\{[\\s\\S]*?^\\}`, 'm'));
}
function standalone(text) {
  return text
    .replace(/^package \w+/m, 'package main')
    .replace(/^\s*"github\.com\/kiali\/kiali\/(?:config|models|log)"\s*$/gm, '')
    .replace(/\b(config|models)\./g, '')
    .replace(/\blog\.Warningf/g, 'warn');
}
const inputs = [null];
const replica = { desiredReplicas: 2, currentReplicas: 2, availableReplicas: 2, syncedProxies: 2 };
for (const kind of ['app', 'workload', 'service']) {
  for (const direction of ['inbound', 'outbound']) {
    for (const [protocol, success, failure] of [
      ['http', '200', '503'],
      ['http', '200', '404'],
      ['grpc', '0', '14'],
      ['grpc', '0', '16'],
      ['http', '200', '-'],
    ]) {
      for (const rate of [0, 0.001, 0.1, 1, 5, 10, 20, 100]) {
        inputs.push({
          input: {
            kind,
            namespace: 'bookinfo',
            name: 'reviews',
            requests: { [direction]: { [protocol]: { [success]: 100 - rate, [failure]: rate } } },
            workloadStatuses: [replica],
          },
        });
      }
    }
  }
}
for (const annotation of [
  '',
  '5xx,2,5,http,inbound',
  '4xx,10,20,http,inbound;5xx,0,10,http,outbound',
  'bad',
  '5xx,10,1,http,inbound',
  '5xx,0.1,0.3,http,inbound',
  '[,0,10,http,inbound',
]) {
  inputs.push({
    input: {
      kind: 'service',
      namespace: 'bookinfo',
      name: 'reviews',
      requests: { inbound: { http: { 200: 97, 503: 3 } } },
      annotations: { 'health.kiali.io/rate': annotation },
    },
  });
}
for (const kind of ['app', 'workload', 'service']) {
  for (const requests of [
    {},
    { inbound: { http: { 200: 0 } } },
    { inbound: { tcp: { '': 100 } } },
  ]) {
    inputs.push({
      input: { kind, namespace: 'bookinfo', name: 'reviews', requests, workloadStatuses: [null] },
    });
    inputs.push({
      input: {
        kind,
        namespace: 'bookinfo',
        name: 'reviews',
        requests,
        workloadStatuses: [{ ...replica, availableReplicas: 0 }],
      },
    });
  }
}
const base = {
  kind: 'service',
  namespace: 'production',
  name: 'critical-reviews',
  requests: { inbound: { http: { 200: 97, 503: 3 } } },
};
for (const rules of [
  [],
  [
    {
      namespace: 'production',
      kind: 'service',
      name: 'critical-.*',
      tolerance: [{ code: '5xx', degraded: 1, failure: 5, protocol: 'http', direction: 'inbound' }],
    },
  ],
  [
    {
      namespace: 'other',
      tolerance: [{ code: '5xx', degraded: 1, failure: 5, protocol: 'http', direction: 'inbound' }],
    },
  ],
  [
    {
      namespace: '[',
      tolerance: [{ code: '5xx', degraded: 1, failure: 5, protocol: 'http', direction: 'inbound' }],
    },
  ],
  [
    {
      tolerance: [
        { code: '4xx', degraded: 1, failure: 5, protocol: 'http', direction: 'outbound' },
      ],
    },
  ],
])
  inputs.push({ input: base, rules });

const directory = await mkdtemp(join(tmpdir(), 'kiali-calculator-oracle-'));
let output;
try {
  await writeFile(
    join(directory, 'calculator.go'),
    standalone(contents['business/health_calculator.go'])
  );
  await writeFile(join(directory, 'matcher.go'), standalone(contents['business/health_config.go']));
  const modelStructs = [
    'WorkloadStatus',
    'RequestHealth',
    'CalculatedHealthStatus',
    'AppHealth',
    'WorkloadHealth',
    'ServiceHealth',
  ]
    .map(name => struct('models/health.go', name))
    .join('\n');
  await writeFile(
    join(directory, 'models.go'),
    standalone(contents['models/health_status.go']) + '\n' + modelStructs
  );
  await writeFile(
    join(directory, 'config.go'),
    `package main
${struct('config/config.go', 'Tolerance')}
${struct('config/config.go', 'Rate')}
type HealthConfig struct { Rate []Rate }
type Config struct { HealthConfig HealthConfig }
${extract(
  contents['config/config.go'],
  /^func \(conf \*Config\) AddHealthDefault\(\) \{[\s\S]*?^\}/m
)}
`
  );
  await writeFile(
    join(directory, 'main.go'),
    `package main
import ("encoding/json"; "fmt"; "os")
var warnings []string
func warn(format string, args ...any) { warnings = append(warnings, fmt.Sprintf(format,args...)) }
type Input struct { Kind string; Namespace string; Name string; Requests RequestHealth; WorkloadStatuses []*WorkloadStatus; Annotations map[string]string }
type Case struct { Input *Input; Rules *[]Rate }
func main() {
 var cases []*Case
 if err := json.NewDecoder(os.Stdin).Decode(&cases); err != nil { panic(err) }
 results := []any{}
 for _, entry := range cases {
  conf := &Config{}
  if entry != nil && entry.Rules != nil { conf.HealthConfig.Rate = *entry.Rules } else { conf.AddHealthDefault() }
  warnings = nil
  calculator := NewHealthCalculator(conf)
  var output CalculatedHealth
  if entry == nil || entry.Input == nil { output = calculator.CalculateServiceHealth("","",nil,nil) } else {
   in := entry.Input
   switch in.Kind {
   case "app": output = calculator.CalculateAppHealth(in.Namespace,in.Name,&AppHealth{Requests:in.Requests,WorkloadStatuses:in.WorkloadStatuses},in.Annotations)
   case "workload":
    var status *WorkloadStatus
    if len(in.WorkloadStatuses)>0 { status=in.WorkloadStatuses[0] }
    output = calculator.CalculateWorkloadHealth(in.Namespace,in.Name,&WorkloadHealth{Requests:in.Requests,WorkloadStatus:status},in.Annotations)
   default: output = calculator.CalculateServiceHealth(in.Namespace,in.Name,&ServiceHealth{Requests:in.Requests},in.Annotations)
   }
  }
  results = append(results,map[string]any{"expected":map[string]any{"status":output.Status,"errorRatio":output.ErrorRatio,"totalRequestRate":output.TotalRequestRate},"warningCount":len(warnings)})
 }
 if err := json.NewEncoder(os.Stdout).Encode(results); err != nil { panic(err) }
}
`
  );
  output = JSON.parse(
    execFileSync(
      'go',
      ['run', 'main.go', 'models.go', 'calculator.go', 'matcher.go', 'config.go'],
      {
        cwd: directory,
        input: JSON.stringify(inputs),
        encoding: 'utf8',
        env: { ...process.env, GO111MODULE: 'off', GOPROXY: 'off', GOTOOLCHAIN: 'local' },
        maxBuffer: 8 * 1024 * 1024,
      }
    )
  );
} finally {
  await rm(directory, { recursive: true });
}
const document = {
  version: 'v2.33.0',
  commit: '0e8be887b8217bbcac5e3ae0bfcd258073949cca',
  sources,
  cases: inputs.map((input, index) => ({ ...input, ...output[index] })),
};
const path = 'test-files/parity/health-calculator.json';
const serialized = JSON.stringify(document, null, 2) + '\n';
if (values.check)
  assert.equal(await readFile(path, 'utf8'), serialized, 'Health calculator oracle drift');
else await writeFile(path, serialized);
console.log(`Verified ${document.cases.length} independent health-calculator cases`);
