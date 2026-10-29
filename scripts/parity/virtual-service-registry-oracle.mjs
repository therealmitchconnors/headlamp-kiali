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
const checker = 'business/checkers/virtualservices/no_host_checker.go';
const host = 'kubernetes/host.go';
const registry = 'kubernetes/istio.go';
const model = 'models/mesh.go';
const policy = 'business/istio_validations.go';
const sources = {
  [checker]: 'b4119c61747339d384fb2f07454fb9e213e95719',
  [host]: '551a684ab15e065be524de46d68aa631c4b7e289',
  [registry]: 'c574a501bb73e9c479c4e5e4e07d87220325d6d3',
  [model]: '518a4242407e27452bb199b91344456d89908ad4',
  [policy]: 'ef416a10be244b84b86e017203b4e76869ae1889',
  'business/checkers/no_service_checker.go': '8c8dbb33261e67faed9445f8493585e15eb58667',
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
assert.ok(
  text['business/checkers/no_service_checker.go'].includes('virtualservices.NoHostChecker{')
);
const extract = (file, pattern) => {
  const found = text[file].match(pattern);
  assert.ok(found, `Missing pinned source ${pattern}`);
  return found[0]
    .replaceAll('networking_v1.', '')
    .replaceAll('models.', '')
    .replaceAll('config.', '')
    .replaceAll('kubernetes.', '')
    .replaceAll('core_v1.', '');
};
const code = [
  extract(checker, /^type NoHostChecker struct \{[\s\S]*?^\}/m),
  ...['Check', 'checkDestination'].map(name =>
    extract(checker, new RegExp(`^func \\(n NoHostChecker\\) ${name}\\([\\s\\S]*?^\\}`, 'm'))
  ),
  ...['kubeServiceEntry', 'KubeServiceHosts'].map(name =>
    extract(registry, new RegExp(`^type ${name} struct \\{[\\s\\S]*?^\\}`, 'm'))
  ),
  ...['NewKubeServiceHostsWithNamespaceDefaults', 'parseExportToAnnotation', 'IsExportedTo'].map(
    name => extract(registry, new RegExp(`^func ${name}\\([\\s\\S]*?^\\}`, 'm'))
  ),
  extract(registry, /^func \(h KubeServiceHosts\) IsValidForNamespace\([\s\S]*?^\}/m),
  extract(host, /^type Host struct \{[\s\S]*?^\}/m),
  ...['ParseHost', 'GetHost', 'includes'].map(name =>
    extract(host, new RegExp(`^func ${name}\\([\\s\\S]*?^\\}`, 'm'))
  ),
  extract(host, /^func \(h Host\) String\([\s\S]*?^\}/m),
  extract(model, /^func NewMeshConfig\([\s\S]*?^\}/m)
    .replaceAll('istiov1alpha1.MeshConfig_OutboundTrafficPolicy', 'OutboundTrafficPolicy')
    .replaceAll('istiov1alpha1.MeshConfig_TLSConfig', 'TLSConfig')
    .replaceAll('istiov1alpha1.ProxyConfig', 'ProxyConfig')
    .replaceAll('istiov1alpha1.MeshConfig', 'APIConfig')
    .replaceAll('wrapperspb.BoolValue', 'BoolValue'),
  extract(
    policy,
    /^func \(in \*IstioValidationsService\) isPolicyAllowAny\([\s\S]*?^\}/m
  ).replaceAll('istiov1alpha1.MeshConfig_OutboundTrafficPolicy', 'OutboundTrafficPolicy'),
];
const descriptor = text['models/istio_validation.go'].match(
  /"virtualservices.nohost.hostnotfound": \{\s*Code:\s*"([^"]+)",\s*Message:\s*"([^"]+)",\s*Severity:\s*ErrorSeverity,/
);
assert.ok(descriptor);
const cases = [];
for (const domain of ['svc.cluster.local', 'svc.example.test'])
  for (const namespace of ['bookinfo', 'other'])
    for (const annotation of [undefined, '', '.', 'other'])
      for (const defaults of [[], ['.'], ['*']])
        for (const entries of [[], ['*.example.test'], ['api.example.test']])
          for (const mode of [undefined, 0, 1, 3]) {
            const route = values => [
              null,
              { route: [null, ...values.map(host => ({ destination: { host } }))] },
            ];
            cases.push({
              domain,
              namespace,
              defaults,
              entries,
              ...(mode === undefined ? {} : { mode }),
              services: [
                {
                  name: 'reviews',
                  namespace: 'bookinfo',
                  annotations:
                    annotation === undefined ? {} : { 'networking.istio.io/exportTo': annotation },
                },
              ],
              spec: {
                http: route(['reviews', 'reviews.bookinfo', `reviews.bookinfo.${domain}`]),
                tcp: route(['reviews.bookinfo.svc', 'missing', 'api.example.test']),
                tls: route([`*.${namespace}.${domain}`, 'notapi.example.test', '']),
              },
            });
          }
const directory = await mkdtemp(join(tmpdir(), 'kiali-virtual-service-registry-'));
let output;
try {
  await writeFile(
    join(directory, 'main.go'),
    `package main
import ("encoding/json"; "fmt"; "os"; "strings")
type Config struct {}
type Service struct { Name string; Namespace string; Annotations map[string]string }
type Destination struct { Host string }
type RouteDestination struct { Destination *Destination }
type Route struct { Route []*RouteDestination }
type Spec struct { Http []*Route; Tcp []*Route; Tls []*Route }
type VirtualService struct { Namespace string; Spec Spec }
type IstioCheck struct { Code string; Message string; Severity string; Path string }
type ProxyConfig struct {}
type BoolValue struct { Value bool }
type TLSConfig struct {}
type OutboundTrafficPolicy struct { Mode int }
const OutboundTrafficPolicy_ALLOW_ANY=1
type APIConfig struct { DefaultConfig *ProxyConfig; EnableAutoMtls *BoolValue; MeshMTLS *TLSConfig; OutboundTrafficPolicy *OutboundTrafficPolicy }
type MeshConfig struct { MeshConfig *APIConfig }
type ControlPlane struct { MeshConfig *APIConfig }
type Mesh struct { ControlPlane *ControlPlane }
func (m *Mesh) ControlPlaneForNamespace(cluster,namespace string) (*ControlPlane,error) {return m.ControlPlane,nil}
type Namespace struct { Name string }
type clusterInfo struct { cluster string }
type namespaceInfo struct { namespace *Namespace }
type validationInfo struct { clusterInfo *clusterInfo; nsInfo *namespaceInfo; mesh *Mesh }
type IstioValidationsService struct {}
const ExportToAnnotation="networking.istio.io/exportTo"
const WarningSeverity="warning"
func Build(code,path string) IstioCheck {
 if code!="virtualservices.nohost.hostnotfound" {panic(code)}
 return IstioCheck{${JSON.stringify(descriptor[1])},${JSON.stringify(descriptor[2])},"error",path}
}
${code.join('\n\n')}
func main() {
 var inputs []struct { Domain string; Namespace string; Defaults []string; Entries []string; Services []Service; Mode *int; Spec Spec }
 if err:=json.NewDecoder(os.Stdin).Decode(&inputs);err!=nil {panic(err)}
 results:=[][]*IstioCheck{}
 for _,in:=range inputs {
  configuration:=NewMeshConfig().MeshConfig
  if in.Mode!=nil {configuration.OutboundTrafficPolicy.Mode=*in.Mode}
  policy,err:=(&IstioValidationsService{}).isPolicyAllowAny(&validationInfo{
    clusterInfo:&clusterInfo{"alpha"},nsInfo:&namespaceInfo{&Namespace{in.Namespace}},
    mesh:&Mesh{&ControlPlane{configuration}},
  })
  if err!=nil {panic(err)}
  entries:=map[string][]string{};for _,host:=range in.Entries {entries[host]=[]string{}}
  hosts:=NewKubeServiceHostsWithNamespaceDefaults(in.Services,in.Domain,map[string][]string{"bookinfo":in.Defaults})
  checks,valid:=(NoHostChecker{IdentityDomain:in.Domain,Namespaces:[]string{"bookinfo","other"},PolicyAllowAny:policy,KubeServiceHosts:hosts,ServiceEntryHosts:entries,VirtualService:&VirtualService{Namespace:in.Namespace,Spec:in.Spec}}).Check()
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
const path = 'test-files/parity/virtual-service-registry-oracle.json';
if (values.check) assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), document);
else await writeFile(path, JSON.stringify(document, null, 2) + '\n');
console.log(
  `${values.check ? 'Verified' : 'Generated'} ${
    cases.length
  } original-Go VirtualService destination registry cases.`
);
