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
const checker = 'business/checkers/destinationrules/traffic_policy_checker.go';
const defaults = 'business/checkers/destinationrules/multi_match_checker.go';
const sources = {
  [checker]: '6d3133c9c64f632dd31b81d064d8ef8571fa100f',
  [defaults]: 'e91bf464b354f2d9d3da8908bb6228f7abe4c81f',
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
    .replaceAll('networking_v1.', '')
    .replaceAll('config.', '');
};
const code = [
  extract(checker, /^type TrafficPolicyChecker struct \{[\s\S]*?^\}/m),
  ...['Check', 'drsWithNonLocalmTLSEnabled'].map(name =>
    extract(checker, new RegExp(`^func \\(t TrafficPolicyChecker\\) ${name}\\([\\s\\S]*?^\\}`, 'm'))
  ),
  ...[
    'sameHostDestinationRules',
    'hasTrafficPolicy',
    'hasTLSSettings',
    'hasPortTLS',
    'hasTrafficPolicyTLS',
    'buildDestinationRuleValidation',
  ].map(name => extract(checker, new RegExp(`^func ${name}\\([\\s\\S]*?^\\}`, 'm'))),
  ...['isNonLocalmTLSForServiceEnabled', 'ismTLSEnabled'].map(name =>
    extract(defaults, new RegExp(`^func ${name}\\([\\s\\S]*?^\\}`, 'm'))
  ),
  extract('kubernetes/host.go', /^type Host struct \{[\s\S]*?^\}/m),
  extract('kubernetes/host.go', /^func ParseHost\([\s\S]*?^\}/m),
  extract('kubernetes/host.go', /^func \(h Host\) String\([\s\S]*?^\}/m),
  ...[
    'DestinationRuleHasMeshWideMTLSEnabled',
    'DestinationRuleHasNamespaceWideMTLSEnabled',
    'DestinationRuleHasMTLSEnabledForHost',
    'DestinationRuleHasMTLSEnabled',
  ].map(name => extract('kubernetes/istio.go', new RegExp(`^func ${name}\\([\\s\\S]*?^\\}`, 'm'))),
];
const record = (name, namespace, host, policy) => ({
  name,
  namespace,
  spec: { host, ...(policy === undefined ? {} : { trafficPolicy: policy }) },
});
const cases = [];
const policies = [
  undefined,
  null,
  {},
  { loadBalancer: { simple: 'ROUND_ROBIN' } },
  { tls: {} },
  { tls: { mode: 'DISABLE' } },
  { tls: { mode: 'ISTIO_MUTUAL' } },
  { portLevelSettings: [{ port: { number: 80 } }] },
  { portLevelSettings: [{ tls: {} }] },
  { portLevelSettings: [{ tls: { mode: 'SIMPLE' } }, { port: { number: 90 } }] },
];
for (const host of [
  'reviews',
  'reviews.bookinfo',
  'reviews.bookinfo.svc.cluster.local',
  'api.example.test',
  '*.bookinfo.svc.cluster.local',
])
  for (const policy of policies)
    for (const namespace of ['bookinfo', 'other'])
      for (const peer of [
        '*.local',
        '*.bookinfo.svc.cluster.local',
        '*.other.svc.cluster.local',
        'reviews',
        'reviews.bookinfo.svc.cluster.local',
        'api.example.test',
      ])
        for (const mode of [undefined, 'ISTIO_MUTUAL', 'MUTUAL'])
          cases.push({
            domain: 'svc.cluster.local',
            records: [
              record('selected', 'bookinfo', host, policy),
              record('peer', namespace, peer, mode ? { tls: { mode } } : undefined),
            ],
          });
const directory = await mkdtemp(join(tmpdir(), 'kiali-destination-tls-oracle-'));
let output;
try {
  await writeFile(
    join(directory, 'main.go'),
    `package main
import ("encoding/json"; "fmt"; "os"; "strings"; "sort")
type Mode string
func (m Mode) String() string { if m=="" {return "DISABLE"};return string(m) }
type TLS struct { Mode Mode }
type PortPolicy struct { Tls *TLS }
type TrafficPolicy struct { Tls *TLS; PortLevelSettings []*PortPolicy }
type DestinationRule struct { Name string; Namespace string; Spec struct { Host string; TrafficPolicy *TrafficPolicy } }
type Config struct {}
type MTLSDetails struct { DestinationRules []*DestinationRule }
type IstioCheck struct { Code string; Path string }
type IstioValidationKey struct { ObjectGVK string; Name string; Namespace string; Cluster string }
type IstioValidation struct { Cluster string; Name string; ObjectGVK string; Valid bool; Checks []*IstioCheck; References []IstioValidationKey }
type IstioValidations map[IstioValidationKey]*IstioValidation
const DestinationRules="DestinationRule"
func Build(code,path string) IstioCheck { return IstioCheck{code,path} }
func BuildKey(kind,name,namespace,cluster string) IstioValidationKey { return IstioValidationKey{kind,name,namespace,cluster} }
func (v IstioValidations) MergeValidations(other IstioValidations) { for key,value:=range other {v[key]=value} }
${code.join('\n\n')}
func main() {
 var inputs []struct { Domain string; Records []*DestinationRule }
 if err:=json.NewDecoder(os.Stdin).Decode(&inputs);err!=nil {panic(err)}
 results:=[][][]int{}
 for _,in:=range inputs {
  output:=(TrafficPolicyChecker{Cluster:"test",DestinationRules:in.Records,IdentityDomain:in.Domain,MTLSDetails:MTLSDetails{in.Records}}).Check()
  owners:=[][]int{}
  for _,record:=range in.Records {
   indices:=map[int]bool{}
   if found:=output[BuildKey(DestinationRules,record.Name,record.Namespace,"test")];found!=nil {
    for _,reference:=range found.References {
     for i,peer:=range in.Records { if reference.Name==peer.Name && reference.Namespace==peer.Namespace {indices[i]=true} }
    }
   }
   refs:=[]int{};for index:=range indices {refs=append(refs,index)};sort.Ints(refs);owners=append(owners,refs)
  }
  results=append(results,owners)
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
const path = 'test-files/parity/destination-tls-oracle.json';
if (values.check) assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), document);
else await writeFile(path, JSON.stringify(document, null, 2) + '\n');
console.log(
  `${values.check ? 'Verified' : 'Generated'} ${
    cases.length
  } original-Go DestinationRule TLS override cases.`
);
