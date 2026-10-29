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
const checker = 'business/checkers/destinationrules/multi_match_checker.go';
const sources = {
  [checker]: 'e91bf464b354f2d9d3da8908bb6228f7abe4c81f',
  'kubernetes/host.go': '551a684ab15e065be524de46d68aa631c4b7e289',
  'kubernetes/istio.go': 'c574a501bb73e9c479c4e5e4e07d87220325d6d3',
};
const text = {};
for (const [path, hash] of Object.entries(sources)) {
  const bytes = await readFile(join(values.source, path));
  assert.equal(
    createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'),
    hash
  );
  text[path] = bytes.toString('utf8');
}
const extract = (file, pattern) => {
  const match = text[file].match(pattern);
  assert.ok(match, `Missing pinned source ${pattern}`);
  return match[0]
    .replaceAll('models.', '')
    .replaceAll('kubernetes.', '')
    .replaceAll('networking_v1.', '');
};
const code = [
  ...['MultiMatchChecker', 'subset', 'rule'].map(name =>
    extract(checker, new RegExp(`^type ${name} struct \\{[\\s\\S]*?^\\}`, 'm'))
  ),
  extract(checker, /^func \(m MultiMatchChecker\) Check\([\s\S]*?^\}/m),
  ...['hostsOverlap', 'extractSubsets', 'checkCollisions', 'isNonLocalmTLSForServiceEnabled'].map(
    name => extract(checker, new RegExp(`^func ${name}\\([\\s\\S]*?^\\}`, 'm'))
  ),
  extract('kubernetes/host.go', /^type Host struct \{[\s\S]*?^\}/m),
  ...['GetHost', 'ParseHost', 'includes', 'HostWithinWildcardHost'].map(name =>
    extract('kubernetes/host.go', new RegExp(`^func ${name}\\([\\s\\S]*?^\\}`, 'm'))
  ),
  extract('kubernetes/host.go', /^func \(h Host\) String\([\s\S]*?^\}/m),
  ...[
    'DestinationRuleHasMeshWideMTLSEnabled',
    'DestinationRuleHasNamespaceWideMTLSEnabled',
    'DestinationRuleHasMTLSEnabledForHost',
    'DestinationRuleHasMTLSEnabled',
  ].map(name => extract('kubernetes/istio.go', new RegExp(`^func ${name}\\([\\s\\S]*?^\\}`, 'm'))),
];
const rule = (name, namespace, host, subsets, mode) => ({
  name,
  namespace,
  spec: {
    host,
    ...(subsets ? { subsets: subsets.map(name => ({ name })) } : {}),
    ...(mode ? { trafficPolicy: { tls: { mode } } } : {}),
  },
});
const cases = [];
for (const host of [
  'reviews',
  'reviews.bookinfo',
  'reviews.bookinfo.svc',
  'reviews.bookinfo.svc.cluster.local',
  '*.bookinfo.svc.cluster.local',
  '*.other.svc.cluster.local',
  '*.local',
  '*',
  'api.example.test',
  '*.example.test',
])
  for (const namespace of ['bookinfo', 'other'])
    for (const a of [undefined, ['v1'], ['v1', 'v2']])
      for (const b of [undefined, [], ['v1'], ['v2'], ['~'], ['~', 'v2']])
        for (const mode of [undefined, 'ISTIO_MUTUAL', 'MUTUAL'])
          cases.push({
            domain: 'svc.cluster.local',
            namespaces: ['bookinfo', 'other', 'vault'],
            records: [rule('a', 'bookinfo', 'reviews', a), rule('b', namespace, host, b, mode)],
          });
for (const domain of ['svc.cluster.local', 'svc.custom.test'])
  for (const reverse of [false, true]) {
    const records = [
      rule('a', 'bookinfo', `*.vault.${domain}`, undefined, 'ISTIO_MUTUAL'),
      rule('b', 'vault', `reviews.vault.${domain}`, ['v1']),
      rule('c', 'bookinfo', '*.local', undefined, 'ISTIO_MUTUAL'),
    ];
    cases.push({
      domain,
      namespaces: ['bookinfo', 'vault'],
      records: reverse ? [...records].reverse() : records,
    });
  }
for (const reverse of [false, true]) {
  const records = [
    rule('a', 'bookinfo', 'reviews', ['~', 'v2']),
    rule('b', 'bookinfo', 'reviews', ['v3']),
  ];
  cases.push({
    domain: 'svc.cluster.local',
    namespaces: ['bookinfo'],
    records: reverse ? [...records].reverse() : records,
  });
}
cases.push({
  domain: 'svc.cluster.local',
  namespaces: ['bookinfo'],
  records: [rule('self', 'bookinfo', 'reviews', ['v1', 'v1'])],
});
const directory = await mkdtemp(join(tmpdir(), 'kiali-destination-rule-oracle-'));
let output;
try {
  await writeFile(
    join(directory, 'main.go'),
    `package main
import ("encoding/json"; "fmt"; "os"; "strings"; "sort")
type Mode string
func (m Mode) String() string { if m=="" {return "DISABLE"}; return string(m) }
type TLS struct { Mode Mode }
type TrafficPolicy struct { Tls *TLS }
type Subset struct { Name string }
type DestinationRule struct { Name string; Namespace string; Spec struct { Host string; Subsets []*Subset; TrafficPolicy *TrafficPolicy } }
type IstioValidations map[string][2]int
var positions map[string]int
func key(namespace,name string) string { bytes,_:=json.Marshal([]string{namespace,name});return string(bytes) }
func addError(out IstioValidations,namespaces,names []string,cluster string) IstioValidations {
 a,b:=positions[key(namespaces[0],names[0])],positions[key(namespaces[1],names[1])]
 if a>b {a,b=b,a}; out[fmt.Sprintf("%d:%d",a,b)]=[2]int{a,b};return out
}
${code.join('\n\n')}
func main() {
 var inputs []struct { Domain string; Namespaces []string; Records []*DestinationRule }
 if err:=json.NewDecoder(os.Stdin).Decode(&inputs);err!=nil {panic(err)}
 results:=[][][2]int{}
 for _,in:=range inputs {
  positions=map[string]int{}
  for i,record:=range in.Records { positions[key(record.Namespace,record.Name)]=i }
  output:=(MultiMatchChecker{Cluster:"test",DestinationRules:in.Records,IdentityDomain:in.Domain,Namespaces:in.Namespaces}).Check()
  pairs:=[][2]int{}
  for _,pair:=range output {pairs=append(pairs,pair)}
  sort.Slice(pairs,func(i,j int)bool { if pairs[i][0]!=pairs[j][0] {return pairs[i][0]<pairs[j][0]};return pairs[i][1]<pairs[j][1] })
  results=append(results,pairs)
 }
 if err:=json.NewEncoder(os.Stdout).Encode(results);err!=nil {panic(err)}
}`
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
const document = {
  version: 'v2.33.0',
  commit: '0e8be887b8217bbcac5e3ae0bfcd258073949cca',
  sources,
  cases: cases.map((input, index) => ({ input, expected: output[index] })),
};
const path = 'test-files/parity/destination-rule-oracle.json';
if (values.check) assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), document);
else await writeFile(path, JSON.stringify(document, null, 2) + '\n');
console.log(
  `${values.check ? 'Verified' : 'Generated'} ${
    cases.length
  } original-Go DestinationRule conflict cases.`
);
