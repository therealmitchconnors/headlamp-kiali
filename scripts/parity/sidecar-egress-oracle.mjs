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
const checker = 'business/checkers/sidecars/egress_listener_checker.go';
const host = 'kubernetes/host.go';
const registry = 'kubernetes/istio.go';
const sources = {
  [checker]: '52d483c06b19b2d1ac3fe25e4d44ca70c8388c16',
  [host]: '551a684ab15e065be524de46d68aa631c4b7e289',
  [registry]: 'c574a501bb73e9c479c4e5e4e07d87220325d6d3',
  'business/checkers/sidecars_checker.go': '7b3f3c6fb59a1adae5623358cb4fee48ef3dd479',
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
assert.ok(text['business/checkers/sidecars_checker.go'].includes('sidecars.EgressHostChecker{'));
const extract = (file, pattern) => {
  const found = text[file].match(pattern);
  assert.ok(found, `Missing pinned source ${pattern}`);
  return found[0]
    .replaceAll('networking_v1.', '')
    .replaceAll('models.', '')
    .replaceAll('config.', '')
    .replaceAll('kubernetes.', '')
    .replaceAll('core_v1.', '')
    .replaceAll('log.Errorf', 'logErrorf');
};
const code = [
  ...['EgressHostChecker', 'HostWithIndex'].map(name =>
    extract(checker, new RegExp(`^type ${name} struct \\{[\\s\\S]*?^\\}`, 'm'))
  ),
  ...['Check', 'getHosts', 'validateHost', 'HasMatchingService'].map(name =>
    extract(checker, new RegExp(`^func \\(elc EgressHostChecker\\) ${name}\\([\\s\\S]*?^\\}`, 'm'))
  ),
  ...['getHostComponents', 'buildCheck'].map(name =>
    extract(checker, new RegExp(`^func ${name}\\([\\s\\S]*?^\\}`, 'm'))
  ),
  ...['kubeServiceEntry', 'KubeServiceHosts'].map(name =>
    extract(registry, new RegExp(`^type ${name} struct \\{[\\s\\S]*?^\\}`, 'm'))
  ),
  ...['NewKubeServiceHostsWithNamespaceDefaults', 'parseExportToAnnotation', 'IsExportedTo'].map(
    name => extract(registry, new RegExp(`^func ${name}\\([\\s\\S]*?^\\}`, 'm'))
  ),
  extract(registry, /^func \(h KubeServiceHosts\) IsValidForNamespace\([\s\S]*?^\}/m),
  extract(host, /^type Host struct \{[\s\S]*?^\}/m),
  ...['ParseHost', 'HasMatchingServiceEntries'].map(name =>
    extract(host, new RegExp(`^func ${name}\\([\\s\\S]*?^\\}`, 'm'))
  ),
  ...['String', 'IsWildcard'].map(name =>
    extract(host, new RegExp(`^func \\(h Host\\) ${name}\\([\\s\\S]*?^\\}`, 'm'))
  ),
];
const descriptor = text['models/istio_validation.go'].match(
  /"sidecar.egress.servicenotfound": \{\s*Code:\s*"([^"]+)",\s*Message:\s*"([^"]+)",\s*Severity:\s*WarningSeverity,/
);
assert.ok(descriptor);
const cases = [];
for (const domain of ['svc.cluster.local', 'svc.example.test'])
  for (const namespace of ['bookinfo', 'other'])
    for (const annotation of [
      undefined,
      '',
      '*',
      '.',
      '~',
      'other',
      ' \u0085.\u0085 ',
      '\ufeff.\ufeff',
    ])
      for (const defaults of [[], ['.'], ['*']])
        for (const entries of [[], ['*.example.test'], ['api.example.test']])
          cases.push({
            domain,
            namespace,
            defaults,
            entries,
            services: [
              {
                name: 'reviews',
                namespace: 'bookinfo',
                annotations:
                  annotation === undefined ? {} : { 'networking.istio.io/exportTo': annotation },
              },
            ],
            hosts: [
              './reviews',
              'other/reviews',
              '*/reviews.bookinfo',
              '*/reviews.bookinfo.svc',
              `*/reviews.bookinfo.${domain}`,
              '*/missing',
              '*/*',
              `./*.${namespace}.${domain}`,
              '*/api.example.test',
              '*/notapi.example.test',
              '*/api.external.test',
            ],
          });
const directory = await mkdtemp(join(tmpdir(), 'kiali-sidecar-egress-oracle-'));
let output;
try {
  await writeFile(
    join(directory, 'main.go'),
    `package main
import ("encoding/json"; "fmt"; "os"; "strings")
type Config struct {}
type Service struct { Name string; Namespace string; Annotations map[string]string }
type Egress struct { Hosts []string }
type Sidecar struct { Namespace string; Spec struct { Egress []*Egress } }
type IstioCheck struct { Code string; Message string; Severity string; Path string }
const ExportToAnnotation="networking.istio.io/exportTo"
func logErrorf(format string,args ...interface{}) {panic(fmt.Sprintf(format,args...))}
func Build(code,path string) IstioCheck {
 if code!="sidecar.egress.servicenotfound" {panic(code)}
 return IstioCheck{${JSON.stringify(descriptor[1])},${JSON.stringify(descriptor[2])},"warning",path}
}
${code.join('\n\n')}
func main() {
 var inputs []struct { Domain string; Namespace string; Defaults []string; Entries []string; Services []Service; Hosts []string }
 if err:=json.NewDecoder(os.Stdin).Decode(&inputs);err!=nil {panic(err)}
 results:=[][]*IstioCheck{}
 for _,in:=range inputs {
  sidecar:=&Sidecar{Namespace:in.Namespace};sidecar.Spec.Egress=[]*Egress{{Hosts:in.Hosts}}
  entries:=map[string][]string{};for _,host:=range in.Entries {entries[host]=[]string{}}
  hosts:=NewKubeServiceHostsWithNamespaceDefaults(in.Services,in.Domain,map[string][]string{"bookinfo":in.Defaults})
  checks,valid:=(EgressHostChecker{IdentityDomain:in.Domain,KubeServiceHosts:hosts,ServiceEntries:entries,Sidecar:sidecar}).Check()
  if !valid {panic("Egress warnings do not invalidate configuration")}
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
const path = 'test-files/parity/sidecar-egress-oracle.json';
if (values.check) assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), document);
else await writeFile(path, JSON.stringify(document, null, 2) + '\n');
console.log(
  `${values.check ? 'Verified' : 'Generated'} ${
    cases.length
  } original-Go Sidecar egress and Service registry cases.`
);
