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
const checker = 'business/checkers/k8sgateways/multi_match_checker.go';
const caller = 'business/checkers/k8sgateway_checker.go';
const model = 'models/istio_validation.go';
const sources = {
  [checker]: '25ff60b04609a6b721ea2bd80a84f28c5cf2ec63',
  [caller]: '325feda97b07a084ddc33b8c0372bec3de078d7e',
  [model]: 'd13e0b576e9392cb7e19578c05a07f2641efc054',
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
assert.ok(text[caller].includes('k8sgateways.MultiMatchChecker{'));
const extract = (path, pattern) => {
  const match = text[path].match(pattern);
  assert.ok(match, `Missing pinned source ${pattern}`);
  return match[0]
    .replaceAll('models.', '')
    .replaceAll('k8s_networking_v1.', '')
    .replaceAll('kubernetes.K8sGateways', '"Gateway"');
};
const code = [
  extract(checker, /^type MultiMatchChecker struct \{[\s\S]*?^\}/m),
  ...['Check', 'findMatch', 'findMatchIP'].map(method =>
    extract(checker, new RegExp(`^func \\(m MultiMatchChecker\\) ${method}\\([\\s\\S]*?^\\}`, 'm'))
  ),
  extract(checker, /^func createError\([\s\S]*?^\}/m),
  extract(model, /^func \(iv IstioValidations\) MergeValidations\([\s\S]*?^\}/m),
];
const descriptors = {};
for (const key of [
  'k8sgateways.multimatch.ip',
  'k8sgateways.multimatch.listener',
  'k8sgateways.unique.listener',
]) {
  const match = text[model].match(
    new RegExp(
      `"${key.replaceAll(
        '.',
        '\\.'
      )}": \\{\\s*Code:\\s*"([^"]+)",\\s*Message:\\s*"([^"]+)",\\s*Severity:\\s*(WarningSeverity|ErrorSeverity),`
    )
  );
  assert.ok(match);
  descriptors[key] = {
    Code: match[1],
    Message: match[2],
    Severity: match[3] === 'WarningSeverity' ? 'warning' : 'error',
  };
}
const cases = [];
const add = (spec, peerSpec, name = 'other', namespace = 'edge') =>
  cases.push({
    gateways: [
      { name: 'selected', namespace: 'bookinfo', uid: 'selected-uid', labels: {}, spec },
      { name, namespace, uid: 'other-uid', labels: {}, spec: peerSpec },
    ],
  });
for (const host of [null, 'example.com', '*.example.com'])
  for (const peerHost of [null, 'example.com', '*.example.com'])
    for (const port of [80, 443])
      for (const peerPort of [80, 443])
        for (const protocol of ['HTTP', 'HTTPS'])
          for (const peerProtocol of ['HTTP', 'HTTPS'])
            for (const name of ['selected', 'other'])
              for (const namespace of ['bookinfo', 'edge']) {
                if (name === 'selected' && namespace === 'bookinfo') continue;
                add(
                  { listeners: [{ name: 'http', hostname: host, port, protocol }] },
                  {
                    listeners: [
                      { name: 'peer', hostname: peerHost, port: peerPort, protocol: peerProtocol },
                    ],
                  },
                  name,
                  namespace
                );
              }
const addresses = [
  { value: '10.0.0.1' },
  { type: 'IPAddress', value: '10.0.0.1' },
  { type: 'IPAddress', value: '10.0.0.2' },
  { type: 'Hostname', value: 'gateway.example' },
  { type: 'Hostname', value: '' },
];
for (const address of addresses)
  for (const peerAddress of addresses)
    for (const name of ['selected', 'other'])
      for (const namespace of ['bookinfo', 'edge']) {
        if (name === 'selected' && namespace === 'bookinfo') continue;
        add({ addresses: [address] }, { addresses: [peerAddress] }, name, namespace);
      }
add(
  {
    addresses: [addresses[1], addresses[1]],
    listeners: [
      { name: 'first', hostname: 'example.com', port: 80, protocol: 'HTTP' },
      { name: 'second', hostname: 'example.com', port: 80, protocol: 'HTTP' },
    ],
  },
  {
    addresses: [addresses[1]],
    listeners: [{ name: 'peer', hostname: 'example.com', port: 80, protocol: 'HTTP' }],
  }
);
const directory = await mkdtemp(join(tmpdir(), 'kiali-gateway-collision-oracle-'));
let output;
try {
  await writeFile(
    join(directory, 'main.go'),
    `package main
import("encoding/json";"os";"fmt")
type GatewaySpecAddress struct {Type *string;Value string}
type Listener struct {Name string;Hostname *string;Port int;Protocol string}
type GatewaySpec struct {Addresses []GatewaySpecAddress;Listeners []Listener}
type Gateway struct {Name string;Namespace string;Spec GatewaySpec}
type IstioValidationKey struct {Name string;Namespace string;ObjectGVK string;Cluster string}
type IstioCheck struct {Code string;Message string;Severity string;Path string}
type IstioValidation struct {Cluster string;Name string;ObjectGVK string;Valid bool;Checks []*IstioCheck;References []IstioValidationKey}
type IstioValidations map[IstioValidationKey]*IstioValidation
var descriptors map[string]IstioCheck
func Build(code,path string) IstioCheck {value,ok:=descriptors[code];if !ok{panic(code)};value.Path=path;return value}
${code.join('\n\n')}
func main(){
 if err:=json.Unmarshal([]byte(${JSON.stringify(
   JSON.stringify(descriptors)
 )}),&descriptors);err!=nil{panic(err)}
 var inputs []struct{Gateways []*Gateway}
 if err:=json.NewDecoder(os.Stdin).Decode(&inputs);err!=nil{panic(err)}
 type result struct {Checks []*IstioCheck;References []IstioValidationKey}
 results:=[]result{}
 for _,in:=range inputs{
  validations:=(MultiMatchChecker{Cluster:"alpha",K8sGateways:in.Gateways}).Check()
  value:=validations[IstioValidationKey{Name:"selected",Namespace:"bookinfo",ObjectGVK:"Gateway",Cluster:"alpha"}]
  r:=result{Checks:[]*IstioCheck{},References:[]IstioValidationKey{}}
  if value!=nil {r.Checks=value.Checks;if value.References!=nil{r.References=value.References}}
  results=append(results,r)
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
  cases: cases.map((input, index) => ({
    input,
    expected: output[index].Checks.map(check => ({
      code: check.Code,
      message: check.Message,
      severity: check.Severity,
      path: check.Path,
    })),
    references: [
      ...new Set(output[index].References.map(ref => JSON.stringify([ref.Namespace, ref.Name]))),
    ].map(value => JSON.parse(value)),
  })),
};
const path = 'test-files/parity/gateway-collision-oracle.json';
if (values.check) assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), document);
else await writeFile(path, JSON.stringify(document, null, 2) + '\n');
console.log(
  `${values.check ? 'Verified' : 'Generated'} ${cases.length} original-Go Gateway collision cases.`
);
