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
const prefix = 'business/checkers/destinationrules/';
const sources = {
  [`${prefix}disabled_meshwide_mtls_checker.go`]: 'c2232003cddd8088518753412df3ce74e36403c6',
  [`${prefix}disabled_namespacewide_mtls_checker.go`]: '964ca1d390dff870ff89f91238a17bdd72094b58',
  [`${prefix}meshwide_mtls_checker.go`]: 'c8de9b68c4733c60fb11f5bfec366209ae255c06',
  [`${prefix}namespacewide_mtls_checker.go`]: '2ff9d06a37d6d77ddc6a8ee60c4a38876585a7cb',
  'business/checkers/destination_rules_checker.go': '4a87b3f2633835f89f009a607da01c898b631ea1',
  'business/istio_validations.go': 'ef416a10be244b84b86e017203b4e76869ae1889',
  'kubernetes/istio.go': 'c574a501bb73e9c479c4e5e4e07d87220325d6d3',
  'models/istio_validation.go': 'd13e0b576e9392cb7e19578c05a07f2641efc054',
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
  const found = text[file].match(pattern);
  assert.ok(found, `Missing pinned source ${pattern}`);
  return found[0]
    .replaceAll('networking_v1.', '')
    .replaceAll('security_v1.', '')
    .replaceAll('models.', '')
    .replaceAll('config.', '')
    .replaceAll('kubernetes.', '');
};
const code = [];
for (const [file, name, receiver] of [
  ['disabled_meshwide_mtls_checker.go', 'DisabledMeshWideMTLSChecker', 'c'],
  ['disabled_namespacewide_mtls_checker.go', 'DisabledNamespaceWideMTLSChecker', 'm'],
  ['meshwide_mtls_checker.go', 'MeshWideMTLSChecker', 'm'],
  ['namespacewide_mtls_checker.go', 'NamespaceWideMTLSChecker', 'm'],
]) {
  assert.ok(
    text['business/checkers/destination_rules_checker.go'].includes(`destinationrules.${name}{`)
  );
  code.push(
    extract(prefix + file, new RegExp(`^type ${name} struct \\{[\\s\\S]*?^\\}`, 'm')),
    extract(
      prefix + file,
      new RegExp(`^func \\(${receiver} ${name}\\) Check\\([\\s\\S]*?^\\}`, 'm')
    )
  );
}
for (const name of [
  'PeerAuthnHasStrictMTLS',
  'PeerAuthnHasMTLSEnabled',
  'PeerAuthnMTLSMode',
  'DestinationRuleHasMeshWideMTLSEnabled',
  'DestinationRuleHasNamespaceWideMTLSEnabled',
  'DestinationRuleHasMTLSEnabledForHost',
  'DestinationRuleHasMTLSEnabled',
])
  code.push(extract('kubernetes/istio.go', new RegExp(`^func ${name}\\([\\s\\S]*?^\\}`, 'm')));
code.push(
  extract(
    'business/istio_validations.go',
    /^func \(in \*IstioValidationsService\) filterPeerAuths\([\s\S]*?^\}/m
  )
);
const keys = [
  'destinationrules.mtls.meshpolicymissing',
  'destinationrules.mtls.nspolicymissing',
  'destinationrules.mtls.policymtlsenabled',
  'destinationrules.mtls.meshpolicymtlsenabled',
];
const descriptors = keys
  .map(key => {
    const found = text['models/istio_validation.go'].match(
      new RegExp(
        `"${key.replaceAll(
          '.',
          '\\.'
        )}": \\{\\s*Code:\\s*"([^"]+)",\\s*Message:\\s*"([^"]+)",\\s*Severity:\\s*ErrorSeverity,`
      )
    );
    assert.ok(found);
    return `${JSON.stringify(key)}:{Code:${JSON.stringify(found[1])},Message:${JSON.stringify(
      found[2]
    )},Severity:"error"}`;
  })
  .join(',');
const cases = [];
for (const namespace of ['istio-system', 'bookinfo'])
  for (const domain of ['svc.cluster.local', 'svc.example.test'])
    for (const autoMtls of [true, false]) {
      const peer = (ns, mode, selector) => ({
        namespace: ns,
        spec: { mtls: { mode }, ...(selector === undefined ? {} : { selector }) },
      });
      for (const host of ['*.local', `*.${namespace}.${domain}`, `reviews.${namespace}.${domain}`])
        for (const tls of [
          undefined,
          null,
          {},
          { mode: 'DISABLE' },
          { mode: 'SIMPLE' },
          { mode: 'MUTUAL' },
          { mode: 'ISTIO_MUTUAL' },
        ])
          cases.push({
            namespace,
            root: 'istio-system',
            domain,
            autoMtls,
            spec: { host, trafficPolicy: { ...(tls === undefined ? {} : { tls }) } },
            peers: [],
          });
      const ns = mode => peer(namespace, mode);
      const mesh = mode => peer('istio-system', mode);
      const profiles = [
        [],
        [ns('STRICT')],
        [ns('PERMISSIVE')],
        [ns('DISABLE')],
        [mesh('STRICT')],
        [mesh('PERMISSIVE')],
        [mesh('DISABLE')],
        [peer(namespace, 'STRICT', {})],
        [peer(namespace, 'STRICT', { matchLabels: { app: 'reviews' } })],
        [peer('istio-system', 'STRICT', {})],
        [mesh('STRICT'), ns('DISABLE')],
        [mesh('STRICT'), ns('PERMISSIVE')],
        [ns('PERMISSIVE'), ns('STRICT')],
        [ns('STRICT'), ns('PERMISSIVE')],
        [ns('DISABLE'), ns('STRICT')],
        [mesh('STRICT'), ns('UNSET')],
        [peer('unrelated', 'STRICT')],
      ];
      for (const host of ['*.local', `*.${namespace}.${domain}`])
        for (const tls of [{}, { mode: 'DISABLE' }, { mode: 'ISTIO_MUTUAL' }])
          for (const peers of profiles)
            cases.push({
              namespace,
              root: 'istio-system',
              domain,
              autoMtls,
              spec: { host, trafficPolicy: { tls } },
              peers,
            });
    }
const directory = await mkdtemp(join(tmpdir(), 'kiali-destination-peer-policy-'));
let output;
try {
  await writeFile(
    join(directory, 'main.go'),
    `package main
import ("encoding/json"; "fmt"; "os")
type Config struct {}
type PeerMode string
func (m PeerMode) String() string {if m=="" {return "UNSET"};return string(m)}
type ClientMode string
func (m ClientMode) String() string {if m=="" {return "DISABLE"};return string(m)}
type Selector struct { MatchLabels map[string]string }
type PeerAuthentication struct { Namespace string; Spec struct { Mtls *struct {Mode PeerMode}; Selector *Selector } }
type RuleSpec struct {Host string; TrafficPolicy *struct { Tls *struct {Mode ClientMode} } }
type DestinationRule struct { Namespace string; Spec RuleSpec }
type MTLSDetails struct { PeerAuthentications []*PeerAuthentication; MeshPeerAuthentications []*PeerAuthentication; EnabledAutoMtls bool }
type Namespace struct { Name string }
type clusterInfo struct { rootNamespaces map[string]string }
type namespaceInfo struct { namespace *Namespace }
type validationInfo struct { clusterInfo *clusterInfo; nsInfo *namespaceInfo }
type IstioValidationsService struct {}
type IstioCheck struct { Code string; Message string; Severity string; Path string }
var descriptors=map[string]IstioCheck{${descriptors}}
func Build(code,path string) IstioCheck {check,ok:=descriptors[code];if !ok {panic(code)};check.Path=path;return check}
${code.join('\n\n')}
func main() {
 var inputs []struct { Namespace string; Root string; Domain string; AutoMtls bool; Spec RuleSpec; Peers []*PeerAuthentication }
 if err:=json.NewDecoder(os.Stdin).Decode(&inputs);err!=nil {panic(err)}
 results:=[][]*IstioCheck{}
 for _,in:=range inputs {
  rule:=&DestinationRule{Namespace:in.Namespace,Spec:in.Spec}
  details:=MTLSDetails{EnabledAutoMtls:in.AutoMtls}
  (&IstioValidationsService{}).filterPeerAuths(&validationInfo{
    clusterInfo:&clusterInfo{map[string]string{in.Namespace:in.Root}},
    nsInfo:&namespaceInfo{&Namespace{in.Namespace}},
  },&details,in.Peers)
  checks:=[]*IstioCheck{};valid:=true
  a,av:=(DisabledNamespaceWideMTLSChecker{DestinationRule:rule,IdentityDomain:in.Domain,MTLSDetails:details}).Check()
  b,bv:=(DisabledMeshWideMTLSChecker{DestinationRule:rule,MeshPeerAuthns:details.MeshPeerAuthentications}).Check()
  c,cv:=(NamespaceWideMTLSChecker{DestinationRule:rule,IdentityDomain:in.Domain,MTLSDetails:details}).Check()
  d,dv:=(MeshWideMTLSChecker{DestinationRule:rule,MTLSDetails:details}).Check()
  checks=append(checks,a...);checks=append(checks,b...);checks=append(checks,c...);checks=append(checks,d...)
  valid=av&&bv&&cv&&dv
  if valid!=(len(checks)==0) {panic("Unexpected checker validity")}
  results=append(results,checks)
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
  cases: cases.map((input, index) => ({
    input,
    expected: output[index].map(check => ({
      code: check.Code,
      message: check.Message,
      severity: check.Severity,
      path: check.Path,
    })),
  })),
};
const path = 'test-files/parity/destination-peer-policy-oracle.json';
if (values.check) assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), document);
else await writeFile(path, JSON.stringify(document, null, 2) + '\n');
console.log(
  `${values.check ? 'Verified' : 'Generated'} ${
    cases.length
  } original-Go DestinationRule peer-policy cases.`
);
