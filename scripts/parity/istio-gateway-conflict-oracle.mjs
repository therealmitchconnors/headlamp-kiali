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
const checker = 'business/checkers/gateways/multi_match_checker.go';
const caller = 'business/checkers/gateway_checker.go';
const model = 'models/istio_validation.go';
const sources = {
  [checker]: '4f751c9978b1b94daf9c99ac1e45dc1074d41e8a',
  [caller]: 'f12fc368f401076f10a084662f66ef778e427da1',
  [model]: 'd13e0b576e9392cb7e19578c05a07f2641efc054',
  'config/config.go': 'fbde570684b760495782fce1df801d9c0046723e',
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
assert.ok(text[caller].includes('gateways.MultiMatchChecker{'));
assert.ok(text['config/config.go'].includes('SkipWildcardGatewayHosts bool'));
const extract = (path, pattern) => {
  const match = text[path].match(pattern);
  assert.ok(match, `Missing pinned source ${pattern}`);
  return match[0]
    .replaceAll('models.', '')
    .replaceAll('networking_v1.', '')
    .replaceAll('config.', '')
    .replaceAll('kubernetes.Gateways', '"Gateway"')
    .replaceAll('labels.Set(gw.Spec.Selector).String()', 'selectorString(gw.Spec.Selector)');
};
const code = [
  extract(checker, /^type MultiMatchChecker struct \{[\s\S]*?^\}/m),
  extract(checker, /^const \([\s\S]*?^\)/m),
  extract(checker, /^type Host struct \{[\s\S]*?^\}/m),
  extract(checker, /^type hostMatchKey = struct \{[\s\S]*?^\}/m),
  extract(checker, /^type hostMatchMap .+$/m),
  ...['Check', 'findMatch'].map(method =>
    extract(checker, new RegExp(`^func \\(m MultiMatchChecker\\) ${method}\\([\\s\\S]*?^\\}`, 'm'))
  ),
  ...['newValidationError', 'regexpFromHostname'].map(name =>
    extract(checker, new RegExp(`^func ${name}\\([\\s\\S]*?^\\}`, 'm'))
  ),
  ...['MergeValidations', 'MergeReferences'].map(method =>
    extract(model, new RegExp(`^func \\(iv IstioValidations\\) ${method}\\([\\s\\S]*?^\\}`, 'm'))
  ),
];
const descriptor = text[model].match(
  /"gateways.multimatch": \{\s*Code:\s*"([^"]+)",\s*Message:\s*"([^"]+)",\s*Severity:\s*WarningSeverity,/
);
assert.ok(descriptor);
const gateway = (name, namespace, hosts, selector = { istio: 'ingress' }, port = 80) => ({
  name,
  namespace,
  spec: { selector, servers: [{ port: { number: port }, hosts }] },
});
const cases = [];
for (const skip of [false, true])
  for (const host of [
    'example.com',
    '*.example.com',
    '*',
    './example.com',
    'other/example.com',
    '*/example.com',
  ])
    for (const peerHost of [
      'example.com',
      'EXAMPLE.COM',
      'api.example.com',
      '*.example.com',
      '*.sub.example.com',
      '*',
    ])
      for (const namespace of ['bookinfo', 'other'])
        for (const selector of [{ istio: 'ingress' }, { istio: 'other' }])
          cases.push({
            skip,
            records: [
              gateway('selected', 'bookinfo', [host]),
              gateway('peer', namespace, [peerHost], selector),
            ],
          });
for (const skip of [false, true])
  for (const reverse of [false, true])
    for (const records of [
      [gateway('selected', 'bookinfo', ['example.com', 'example.com', 'example.com'])],
      [gateway('selected', 'bookinfo', ['*.example.com', 'api.example.com'])],
      [gateway('selected', 'bookinfo', ['*.example.com', '*.sub.example.com'])],
      [
        gateway('selected', 'bookinfo', ['bookinfo/example.com/ignored']),
        gateway('peer', 'other', ['./example.com']),
      ],
      [
        gateway('selected', 'bookinfo', ['example.com']),
        gateway('peer', 'bookinfo', ['example.com', 'example.com']),
        gateway('third', 'other', ['example.com']),
      ],
      [
        gateway('selected', 'bookinfo', ['example.com'], {}),
        gateway('peer', 'other', ['example.com'], null),
      ],
      [
        gateway('selected', 'bookinfo', ['example.com'], { a: 'b', c: 'd' }),
        gateway('peer', 'other', ['example.com'], { c: 'd', a: 'b' }),
      ],
      [
        gateway('selected', 'bookinfo', ['example.com'], {}, 80),
        gateway('peer', 'other', ['example.com'], {}, 443),
      ],
      [
        gateway('selected', 'bookinfo', ['example.com'], {}, 0),
        { name: 'peer', namespace: 'other', spec: { servers: [null, { hosts: ['example.com'] }] } },
      ],
      [
        gateway('selected', 'bookinfo', ['foo[0-9].example.com']),
        gateway('peer', 'bookinfo', ['foo1.example.com']),
      ],
    ])
      cases.push({ skip, records: reverse ? [...records].reverse() : records });
const directory = await mkdtemp(join(tmpdir(), 'kiali-istio-gateway-conflict-oracle-'));
let output;
try {
  await writeFile(
    join(directory, 'main.go'),
    `package main
import("encoding/json";"os";"regexp";"strconv";"strings";"sort")
type Config struct { KialiFeatureFlags struct { Validations struct { SkipWildcardGatewayHosts bool } } }
type Port struct {Number uint32}
type Server struct {Hosts []string;Port *Port}
type Gateway struct {Name string;Namespace string;Spec struct {Selector map[string]string;Servers []*Server}}
type IstioValidationKey struct {Name string;Namespace string;ObjectGVK string;Cluster string}
type IstioCheck struct {Code string;Message string;Severity string;Path string}
type IstioValidation struct {Cluster string;Name string;ObjectGVK string;Valid bool;Checks []*IstioCheck;References []IstioValidationKey}
type IstioValidations map[IstioValidationKey]*IstioValidation
func Build(code,path string) IstioCheck {if code!="gateways.multimatch" {panic(code)}; return IstioCheck{Code:${JSON.stringify(
      descriptor[1]
    )},Message:${JSON.stringify(descriptor[2])},Severity:"warning",Path:path}}
func selectorString(values map[string]string) string {keys:=[]string{};for k:=range values{keys=append(keys,k)};sort.Strings(keys);parts:=[]string{};for _,k:=range keys{parts=append(parts,k+"="+values[k])};return strings.Join(parts,",")}
${code.join('\n\n')}
func main(){
 var inputs []struct{Skip bool;Records []*Gateway}
 if err:=json.NewDecoder(os.Stdin).Decode(&inputs);err!=nil{panic(err)}
 type result struct {Paths []string \`json:"paths"\`;References []int \`json:"references"\`}
 results:=[][]result{}
 for _,in:=range inputs{
  conf:=Config{};conf.KialiFeatureFlags.Validations.SkipWildcardGatewayHosts=in.Skip
  validations:=(MultiMatchChecker{Cluster:"alpha",Gateways:in.Records,Conf:&conf}).Check()
  row:=[]result{}
  for _,gateway:=range in.Records{
   value:=validations[IstioValidationKey{Name:gateway.Name,Namespace:gateway.Namespace,ObjectGVK:"Gateway",Cluster:"alpha"}]
   r:=result{Paths:[]string{},References:[]int{}}
   if value!=nil{
    for _,check:=range value.Checks{r.Paths=append(r.Paths,check.Path)}
    for i,peer:=range in.Records{for _,ref:=range value.References{if ref.Name==peer.Name&&ref.Namespace==peer.Namespace{r.References=append(r.References,i);break}}}
   }
   sort.Strings(r.Paths);row=append(row,r)
  };results=append(results,row)
 }
 if err:=json.NewEncoder(os.Stdout).Encode(results);err!=nil{panic(err)}
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
const path = 'test-files/parity/istio-gateway-conflict-oracle.json';
if (values.check) assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), document);
else await writeFile(path, JSON.stringify(document, null, 2) + '\n');
console.log(
  `${values.check ? 'Verified' : 'Generated'} ${
    cases.length
  } original-Go Istio Gateway conflict cases.`
);
