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
const directoryPrefix = 'business/checkers/peerauthentications/';
const sources = {
  [`${directoryPrefix}disabled_meshwide_checker.go`]: 'bfc9df54ff6ea31406348bedd7dc610a2c340c04',
  [`${directoryPrefix}disabled_namespacewide_checker.go`]:
    '4070c15be2e5e991f0b7a2e11eacdaac24841e7d',
  [`${directoryPrefix}mesh_mtls_checker.go`]: 'bc3b8975d35f4e1fef6522b2fd6a274379e0db64',
  [`${directoryPrefix}namespace_mtls_checker.go`]: 'cefa55a3714ef445cf4e2423d2c8032d250dc693',
  'business/checkers/peer_authentication_checker.go': 'd4ba5a8ac74729061f72400d0fd8ab61c29ec472',
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
  ['disabled_meshwide_checker.go', 'DisabledMeshWideChecker', 'c'],
  ['disabled_namespacewide_checker.go', 'DisabledNamespaceWideChecker', 'c'],
  ['mesh_mtls_checker.go', 'MeshMtlsChecker', 't'],
  ['namespace_mtls_checker.go', 'NamespaceMtlsChecker', 't'],
]) {
  assert.ok(
    text['business/checkers/peer_authentication_checker.go'].includes(
      `peerauthentications.${name}{`
    )
  );
  code.push(
    extract(directoryPrefix + file, new RegExp(`^type ${name} struct \\{[\\s\\S]*?^\\}`, 'm')),
    extract(
      directoryPrefix + file,
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
const keys = [
  'peerauthentication.mtls.destinationrulemissing',
  'peerauthentications.mtls.destinationrulemissing',
  'peerauthentications.mtls.disabledestinationrulemissing',
  'peerauthentications.mtls.disablemeshdestinationrulemissing',
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
function input(namespace, domain, autoMtls, spec, rules) {
  return { namespace, root: 'istio-system', domain, autoMtls, spec, rules };
}
for (const mtls of [
  undefined,
  null,
  {},
  { mode: 'UNSET' },
  { mode: 'PERMISSIVE' },
  { mode: 'STRICT' },
  { mode: 'DISABLE' },
])
  for (const selector of [
    undefined,
    null,
    {},
    { matchLabels: {} },
    { matchLabels: { app: 'reviews' } },
  ])
    for (const namespace of ['istio-system', 'bookinfo'])
      for (const auto of [true, false])
        cases.push(
          input(
            namespace,
            'svc.cluster.local',
            auto,
            {
              ...(mtls === undefined ? {} : { mtls }),
              ...(selector === undefined ? {} : { selector }),
            },
            []
          )
        );
for (const namespace of ['istio-system', 'bookinfo'])
  for (const domain of ['svc.cluster.local', 'svc.example.test'])
    for (const auto of [true, false])
      for (const mode of ['STRICT', 'DISABLE']) {
        const rule = (host, tlsMode) => ({
          namespace: 'istio-system',
          spec: { host, trafficPolicy: { tls: tlsMode === undefined ? {} : { mode: tlsMode } } },
        });
        const mesh = tls => rule('*.local', tls);
        const local = tls => rule(`*.${namespace}.${domain}`, tls);
        const profiles = [
          [],
          [mesh('ISTIO_MUTUAL')],
          [local('ISTIO_MUTUAL')],
          [mesh('MUTUAL')],
          [local('MUTUAL')],
          [mesh('ISTIO_MUTUAL'), local('DISABLE')],
          [local('DISABLE'), local('ISTIO_MUTUAL')],
          [local('ISTIO_MUTUAL'), local('DISABLE')],
          [mesh('DISABLE')],
          [local(undefined)],
          [
            {
              namespace: 'istio-system',
              spec: {
                host: '*.local',
                trafficPolicy: { portLevelSettings: [{ tls: { mode: 'ISTIO_MUTUAL' } }] },
              },
            },
          ],
          [
            {
              namespace: 'istio-system',
              spec: {
                host: '*.local',
                subsets: [{ name: 'v1', trafficPolicy: { tls: { mode: 'ISTIO_MUTUAL' } } }],
              },
            },
          ],
          [rule(`reviews.${namespace}.${domain}`, 'ISTIO_MUTUAL')],
        ];
        for (const rules of profiles)
          cases.push(input(namespace, domain, auto, { mtls: { mode } }, rules));
      }
const directory = await mkdtemp(join(tmpdir(), 'kiali-peer-authentication-'));
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
type PeerSpec struct { Mtls *struct {Mode PeerMode}; Selector *Selector }
type PeerAuthentication struct { Namespace string; Spec PeerSpec }
type DestinationRule struct { Namespace string; Spec struct {Host string; TrafficPolicy *struct { Tls *struct {Mode ClientMode} } } }
type MTLSDetails struct { DestinationRules []*DestinationRule; EnabledAutoMtls bool }
type IstioCheck struct { Code string; Message string; Severity string; Path string }
var descriptors=map[string]IstioCheck{${descriptors}}
func Build(code,path string) IstioCheck {check,ok:=descriptors[code];if !ok {panic(code)};check.Path=path;return check}
${code.join('\n\n')}
func main() {
 var inputs []struct { Namespace string; Root string; Domain string; AutoMtls bool; Spec PeerSpec; Rules []*DestinationRule }
 if err:=json.NewDecoder(os.Stdin).Decode(&inputs);err!=nil {panic(err)}
 results:=[][]*IstioCheck{}
 for _,in:=range inputs {
  peer:=&PeerAuthentication{Namespace:in.Namespace,Spec:in.Spec}
  details:=MTLSDetails{DestinationRules:in.Rules,EnabledAutoMtls:in.AutoMtls}
  var a,b []*IstioCheck;var av,bv bool
  if in.Namespace==in.Root {
   a,av=(DisabledMeshWideChecker{PeerAuthn:peer,DestinationRules:in.Rules}).Check()
   b,bv=(MeshMtlsChecker{MeshPolicy:peer,MTLSDetails:details,IsServiceMesh:false}).Check()
  } else {
   a,av=(DisabledNamespaceWideChecker{PeerAuthn:peer,DestinationRules:in.Rules,IdentityDomain:in.Domain}).Check()
   b,bv=(NamespaceMtlsChecker{PeerAuthn:peer,MTLSDetails:details,IdentityDomain:in.Domain}).Check()
  }
  checks:=append(a,b...)
  if (av&&bv)!=(len(checks)==0) {panic("Unexpected checker validity")}
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
const path = 'test-files/parity/peer-authentication-oracle.json';
if (values.check) assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), document);
else await writeFile(path, JSON.stringify(document, null, 2) + '\n');
console.log(
  `${values.check ? 'Verified' : 'Generated'} ${
    cases.length
  } original-Go PeerAuthentication checker cases.`
);
