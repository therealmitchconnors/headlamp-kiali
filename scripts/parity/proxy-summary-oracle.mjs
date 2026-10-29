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
  'models/config_dump.go': '9caa49bf86cc4cb18c4ba3da5929967ce6a1bdd0',
  'kubernetes/envoy.go': '80a3b2f0334c8fd10afb92302adaa1292d985a5b',
  'kubernetes/host.go': '551a684ab15e065be524de46d68aa631c4b7e289',
  'business/proxy_status.go': '0df11d339cca10906b8167ced2666cbfcf92880c',
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
function extract(file, pattern) {
  const match = text[file].match(pattern);
  assert.ok(match, `Missing pinned source ${pattern}`);
  return match[0].replaceAll('kubernetes.', '');
}
const code = [
  extract('kubernetes/host.go', /^type Host struct \{[\s\S]*?^\}/m),
  ...['ParseHost', 'GetHost', 'includes'].map(name =>
    extract('kubernetes/host.go', new RegExp(`^func ${name}\\([\\s\\S]*?^\\}`, 'm'))
  ),
  ...['EnvoyCluster', 'EnvoyMetadata', 'FilterChainMatch'].map(name =>
    extract(
      'kubernetes/envoy.go',
      new RegExp(`^type ${name} struct \\{[\\s\\S]*?^\\}`, 'm')
    ).replaceAll('mapstructure:', 'json:')
  ),
  extract('models/config_dump.go', /^func \(cs \*Cluster\) Parse\([\s\S]*?^\}/m),
  ...['istioMetadata', 'renderConfig', 'getAppDescriptor', 'bestDomainMatch'].map(name =>
    extract('models/config_dump.go', new RegExp(`^func ${name}\\([\\s\\S]*?^\\}`, 'm'))
  ),
  extract('business/proxy_status.go', /^func xdsStatus\([\s\S]*?^\}/m),
];
const cases = [];
const paths = [
  '',
  '/apis/networking.istio.io/v1/namespaces/bookinfo/destinationrules/reviews',
  '/apis/networking.istio.io/v1/namespaces/bookinfo/virtualservices/reviews',
  '/apis/networking.istio.io/v1beta1/namespaces/bookinfo/destinationrules/reviews',
  '/apis/networking.istio.io/v1/namespaces/bookinfo/destinationrules/reviews/extra',
  '/apis/networking.istio.io/v1/namespaces//destinationrules/',
];
for (const name of [
  'PassthroughCluster',
  'BlackHoleCluster',
  '',
  'inbound|9080||',
  'outbound|9080|v1|reviews.bookinfo.svc.cluster.local',
  'outbound_|9080_||reviews.bookinfo.svc.custom.test',
  'outbound|http||external.example',
  'outbound|+080||reviews',
  'outbound|-10||reviews',
  'outbound|0x50||reviews',
  'outbound|10__||reviews',
  'outbound|9223372036854775808||reviews',
  'outbound|-9223372036854775809||reviews',
  'outbound|9080||reviews|extra',
  'outbound|80\n||reviews',
  'outbound|80\r||reviews',
  'outbound| 80||reviews',
  'outbound|80 ||reviews',
]) {
  for (const type of ['', 'EDS', 'STATIC'])
    for (const path of paths)
      for (const domain of ['', 'svc.cluster.local', 'svc.custom.test'])
        cases.push({
          operation: 'cluster',
          cluster: { name, type, metadata: { filter_metadata: { istio: { config: path } } } },
          domain,
        });
}
for (const path of paths) cases.push({ operation: 'reference', path });
for (const protocols of [
  [],
  ['http/1.0', 'http/1.1', 'h2c'],
  ['istio', 'istio-http/1.0', 'istio-http/1.1', 'istio-h2'],
  ['http/1.0', 'http/1.1', 'h2c', 'istio-http/1.0', 'istio-http/1.1', 'istio-h2'],
  ['istio-peer-exchange', 'istio'],
  ['istio', 'istio-peer-exchange'],
  ['custom'],
  ['h2c', 'http/1.1', 'http/1.0'],
  ['http/1.0', 'http/1.1'],
])
  cases.push({ operation: 'protocol', protocols });
for (const domains of [
  [],
  [''],
  ['reviews'],
  ['reviews.bookinfo'],
  ['reviews.bookinfo.svc.cluster.local', 'reviews.bookinfo', '10.0.0.1'],
  ['10.0.0.1', 'reviews'],
  ['0.0.0.0', 'reviews'],
  ['', 'reviews'],
  ['example.com:9080', 'example.com'],
  ['é.example', 'a.example'],
  ['é', 'ab'],
])
  for (const namespaces of [[], ['bookinfo']])
    for (const domain of ['', 'svc.cluster.local'])
      cases.push({ operation: 'domain', domains, namespaces, domain });
for (const sent of ['', 'a', 'b', 'nonce-1'])
  for (const acked of ['', 'a', 'b', 'nonce-1'])
    for (const subscribed of [false, true])
      cases.push({ operation: 'xds', sent, acked, subscribed });

const directory = await mkdtemp(join(tmpdir(), 'kiali-proxy-summary-oracle-'));
let output;
try {
  await writeFile(
    join(directory, 'main.go'),
    `package main
import ("encoding/json"; "fmt"; "strings"; "strconv"; "os")
type Cluster struct { ServiceFQDN Host; Port int; Subset string; Direction string; Type string; DestinationRule string }
${code.join('\n\n')}
type Input struct { Operation string; Cluster EnvoyCluster; Domain string; Path string; Protocols []string; Domains []string; Namespaces []string; Sent string; Acked string; Subscribed bool }
func main() {
 if strconv.IntSize != 64 { panic("proxy oracle requires a 64-bit Go target") }
 var inputs []Input
 if err:=json.NewDecoder(os.Stdin).Decode(&inputs);err!=nil {panic(err)}
 results:=[]any{}
 for _,in:=range inputs {
  var out any
  switch in.Operation {
  case "cluster": cs:=Cluster{}; cs.Parse(in.Cluster,in.Domain); out=map[string]any{"host":cs.ServiceFQDN,"port":strconv.Itoa(cs.Port),"subset":cs.Subset,"direction":cs.Direction,"type":cs.Type,"destinationRule":cs.DestinationRule}
  case "reference": out=renderConfig(in.Path)
  case "protocol": out=getAppDescriptor(&FilterChainMatch{ApplicationProtocols:in.Protocols})
  case "domain": out=bestDomainMatch(in.Domains,in.Namespaces,in.Domain)
  case "xds": out=xdsStatus(in.Sent,in.Acked,in.Subscribed)
  default: panic("unknown operation")
  }
  results=append(results,out)
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
const path = 'test-files/parity/proxy-summary-oracle.json';
if (values.check) assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), document);
else await writeFile(path, JSON.stringify(document, null, 2) + '\n');
console.log(
  `${values.check ? 'Verified' : 'Generated'} ${cases.length} original-Go proxy summary cases.`
);
