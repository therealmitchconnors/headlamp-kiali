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
  'business/checkers/common/sidecar_import_scope.go': '6fe83a172a217bce37cc7bd35e87d2530cec6774',
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
function extract(file, pattern) {
  const match = text[file].match(pattern);
  assert.ok(match, `Missing pinned source: ${pattern}`);
  return match[0];
}
const host = 'kubernetes/host.go';
const scope = 'business/checkers/common/sidecar_import_scope.go';
const functions = [
  extract(host, /^type Host struct \{[\s\S]*?^\}/m),
  ...['ParseHost', 'GetHost', 'includes', 'HostWithinWildcardHost'].map(name =>
    extract(host, new RegExp(`^func ${name}\\([\\s\\S]*?^\\}`, 'm'))
  ),
  ...['String', 'IsWildcard'].map(name =>
    extract(host, new RegExp(`^func \\(h Host\\) ${name}\\([\\s\\S]*?^\\}`, 'm'))
  ),
  ...['ImportScope', 'egressEntry'].map(name =>
    extract(scope, new RegExp(`^type ${name} struct \\{[\\s\\S]*?^\\}`, 'm'))
  ),
  ...[
    'NewImportScope',
    'EffectiveSidecar',
    'selectorLessSidecarIn',
    'parseEgressEntries',
    'parseEgressHost',
    'egressMatchesHost',
    'namespaceMatches',
    'dnsMatches',
  ].map(name => extract(scope, new RegExp(`^func ${name}\\([\\s\\S]*?^\\}`, 'm'))),
  ...['IsLimited', 'ImportsHost'].map(name =>
    extract(scope, new RegExp(`^func \\(s ImportScope\\) ${name}\\([\\s\\S]*?^\\}`, 'm'))
  ),
  extract('kubernetes/istio.go', /^func IsExportedTo\([\s\S]*?^\}/m),
].map(source =>
  source.replaceAll('networking_v1.Sidecar', 'Sidecar').replaceAll('kubernetes.', '')
);
const sidecar = (namespace, hosts, selector) => ({
  name: `${namespace}-sidecar`,
  namespace,
  spec: {
    egress: hosts === null ? [] : [{ hosts }],
    ...(selector ? { workloadSelector: { labels: selector } } : {}),
  },
});
const cases = [];
const hostLists = [
  [],
  ['./*'],
  ['bookinfo/*'],
  ['*/*'],
  ['~/*'],
  ['*/*', '~bookinfo/*'],
  ['*/*', '~./*'],
  ['bookinfo/reviews.bookinfo.svc.cluster.local'],
  ['*/reviews'],
  ['*/*.example.test'],
  ['external/*'],
  ['./*', 'istio-system/*'],
  ['invalid'],
  ['bookinfo/'],
  ['*/reviews.bookinfo'],
  ['*/*', '~/reviews.bookinfo.svc.cluster.local'],
];
const hosts = [
  ['', 'bookinfo'],
  ['reviews', 'bookinfo'],
  ['reviews.bookinfo', 'preview'],
  ['reviews.bookinfo.svc', 'preview'],
  ['reviews.bookinfo.svc.cluster.local', 'preview'],
  ['ratings.bookinfo.svc.cluster.local', 'bookinfo'],
  ['*.bookinfo.svc.cluster.local', 'bookinfo'],
  ['*.vault.svc.cluster.local', 'bookinfo'],
  ['api.example.test', 'external'],
  ['api.example.test', 'bookinfo'],
  ['reviews.preview', 'preview'],
];
for (const imports of hostLists)
  for (const placement of ['local', 'root', 'selected', 'override']) {
    const sidecars =
      placement === 'local'
        ? [sidecar('bookinfo', imports)]
        : placement === 'root'
        ? [sidecar('istio-system', imports)]
        : placement === 'selected'
        ? [sidecar('bookinfo', imports, { app: 'reviews' })]
        : [sidecar('istio-system', ['*/*']), sidecar('bookinfo', imports)];
    for (const [hostname, configNamespace] of hosts)
      cases.push({
        operation: 'import',
        workloadNamespace: 'bookinfo',
        rootNamespace: 'istio-system',
        sidecars,
        namespaces: ['bookinfo', 'preview', 'istio-system', 'external', 'vault'],
        identityDomain: 'svc.cluster.local',
        hostname,
        configNamespace,
      });
  }
for (const workloadNamespace of ['', 'bookinfo'])
  for (const sidecars of [
    [],
    [null],
    [sidecar('bookinfo', null)],
    [sidecar('bookinfo', ['~/*']), sidecar('bookinfo', ['*/*'])],
  ])
    cases.push({
      operation: 'import',
      workloadNamespace,
      rootNamespace: '',
      sidecars,
      namespaces: [],
      identityDomain: 'svc.custom.test',
      hostname: 'reviews',
      configNamespace: 'bookinfo',
    });
for (const exports of [
  [],
  ['*'],
  ['.'],
  ['~'],
  ['bookinfo'],
  ['preview'],
  ['.', 'preview'],
  ['~', '*'],
])
  for (const resourceNamespace of ['bookinfo', 'preview'])
    for (const viewerNamespace of ['bookinfo', 'preview', 'external'])
      cases.push({ operation: 'export', exports, resourceNamespace, viewerNamespace });

const directory = await mkdtemp(join(tmpdir(), 'kiali-import-scope-oracle-'));
let output;
try {
  await writeFile(
    join(directory, 'main.go'),
    `package main
import ("encoding/json"; "fmt"; "strings"; "os")
type Sidecar struct { Name string; Namespace string; Spec SidecarSpec }
type SidecarSpec struct { WorkloadSelector *WorkloadSelector; Egress []*Egress }
type WorkloadSelector struct { Labels map[string]string }
type Egress struct { Hosts []string }
${functions.join('\n\n')}
type Input struct { Operation string; WorkloadNamespace string; RootNamespace string; Sidecars []*Sidecar; Namespaces []string; IdentityDomain string; Hostname string; ConfigNamespace string; Exports []string; ResourceNamespace string; ViewerNamespace string }
func main() {
 var inputs []Input
 if err:=json.NewDecoder(os.Stdin).Decode(&inputs); err!=nil { panic(err) }
 results:=[]any{}
 for _, in:=range inputs {
  if in.Operation=="export" { results=append(results, IsExportedTo(in.Exports,in.ResourceNamespace,in.ViewerNamespace)); continue }
  scope:=NewImportScope(in.WorkloadNamespace,in.RootNamespace,in.Sidecars,in.Namespaces,in.IdentityDomain)
  results=append(results,map[string]bool{"limited":scope.IsLimited(),"imports":scope.ImportsHost(in.Hostname,in.ConfigNamespace)})
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
const path = 'test-files/parity/import-scope-oracle.json';
const serialized = JSON.stringify(artifact, null, 2) + '\n';
if (values.check)
  assert.equal(await readFile(path, 'utf8'), serialized, 'Import-scope oracle drift');
else await writeFile(path, serialized);
console.log(`Verified ${cases.length} independent Sidecar-import and export cases`);
