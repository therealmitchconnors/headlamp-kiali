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
  'kubernetes/istio.go': 'c574a501bb73e9c479c4e5e4e07d87220325d6d3',
  'business/checkers/k8sgateways/status_checker.go': '03323c9cf6179f3c173327951a096286293a8b26',
};
const texts = {};
for (const [path, hash] of Object.entries(sources)) {
  const bytes = await readFile(join(values.source, path));
  assert.equal(
    createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'),
    hash
  );
  texts[path] = bytes.toString('utf8');
}
const gateway = 'business/checkers/k8sgateways/status_checker.go';
function extract(file, pattern) {
  const match = texts[file].match(pattern);
  assert.ok(match, `Missing pinned function ${pattern}`);
  return match[0]
    .replaceAll('metav1.ConditionStatus', 'string')
    .replaceAll('metav1.ConditionFalse', '"False"')
    .replaceAll('metav1.Condition', 'Condition');
}
const code = [
  extract('kubernetes/istio.go', /^func MatchPortNameRule\([\s\S]*?^\}/m),
  ...['K8sGatewayConditionStatus', 'K8sGatewayListenersStatus'].map(name =>
    extract(gateway, new RegExp(`^var ${name} = map\\[string\\]string\\{[\\s\\S]*?^\\}`, 'm'))
  ),
  ...[
    'isProblematicGatewayCondition',
    'isProblematicListenerCondition',
    'isProblematicCondition',
    'isBenignPositiveConditionFalse',
  ].map(name => extract(gateway, new RegExp(`^func ${name}\\([\\s\\S]*?^\\}`, 'm'))),
];
const matcher = texts['kubernetes/istio.go'].match(
  /portNameMatcher = regexp.MustCompile\(`([^`]+)`\)/
);
assert.ok(matcher);
const cases = [];
for (const name of [
  '',
  'http',
  'http-api',
  'http-',
  'HTTP',
  'api-http',
  'http2',
  'grpc-web',
  'tcp',
  'custom',
  'mongo-db',
  'https-api',
])
  for (const protocol of [
    '',
    'HTTP',
    'http',
    'HTTP2',
    'HTTPS',
    'GRPC',
    'GRPC-WEB',
    'TCP',
    'UDP',
    'MONGO',
    'custom',
  ])
    cases.push({ operation: 'port', name, protocol });
for (const type of [
  'Accepted',
  'Programmed',
  'Ready',
  'Scheduled',
  'ResolvedRefs',
  'Conflicted',
  'Detached',
  'Vendor',
])
  for (const status of ['True', 'False', 'Unknown'])
    for (const reason of [
      'Invalid',
      'Pending',
      'ListenersNotValid',
      'ListenerSetsNotValid',
      'AddressNotAssigned',
      'NoResources',
    ])
      for (const message of ['Invalid configuration', 'Address Pending for gateway', 'Waiting'])
        cases.push({ operation: 'condition', condition: { type, status, reason, message } });
const directory = await mkdtemp(join(tmpdir(), 'kiali-local-checks-oracle-'));
let output;
try {
  await writeFile(
    join(directory, 'main.go'),
    `package main
import ("encoding/json"; "os"; "strings"; "regexp")
type Condition struct { Type string; Status string; Reason string; Message string }
var portNameMatcher = regexp.MustCompile(\`${matcher[1]}\`)
${code.join('\n\n')}
type Input struct { Operation string; Name string; Protocol string; Condition Condition }
func main() {
 var inputs []Input
 if err:=json.NewDecoder(os.Stdin).Decode(&inputs); err!=nil { panic(err) }
 results:=[]any{}
 for _, in:=range inputs {
  if in.Operation=="port" { results=append(results,MatchPortNameRule(in.Name,in.Protocol)) } else {
   results=append(results,map[string]bool{"gateway":isProblematicGatewayCondition(in.Condition),"listener":isProblematicListenerCondition(in.Condition)})
  }
 }
 if err:=json.NewEncoder(os.Stdout).Encode(results); err!=nil { panic(err) }
}
`
  );
  output = JSON.parse(
    execFileSync('go', ['run', 'main.go'], {
      cwd: directory,
      input: JSON.stringify(cases),
      encoding: 'utf8',
      env: { ...process.env, GO111MODULE: 'off', GOPROXY: 'off', GOTOOLCHAIN: 'local' },
      maxBuffer: 8 * 1024 * 1024,
    })
  );
} finally {
  await rm(directory, { recursive: true });
}
const artifact = {
  version: 'v2.33.0',
  commit: '0e8be887b8217bbcac5e3ae0bfcd258073949cca',
  sources,
  cases: cases.map((input, index) => ({ input, expected: output[index] })),
};
const path = 'test-files/parity/local-checks-oracle.json';
const serialized = JSON.stringify(artifact, null, 2) + '\n';
if (values.check)
  assert.equal(await readFile(path, 'utf8'), serialized, 'Local checker oracle drift');
else await writeFile(path, serialized);
console.log(`Verified ${cases.length} independent port/condition cases`);
