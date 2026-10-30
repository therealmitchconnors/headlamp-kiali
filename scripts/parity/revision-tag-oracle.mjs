import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, rmdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
const { values } = parseArgs({
  options: { source: { type: 'string' }, check: { type: 'boolean', default: false } },
});
assert.ok(values.source, 'Pass --source for the pinned Kiali checkout');
const sources = {
  'istio/discovery.go': '60f6f7ab41a65acc5f40ca1095ce279433e62dce',
  'models/mesh.go': '518a4242407e27452bb199b91344456d89908ad4',
  'config/config.go': 'fbde570684b760495782fce1df801d9c0046723e',
};
const texts = {};
for (const [path, blob] of Object.entries(sources)) {
  const bytes = await readFile(join(values.source, path));
  assert.equal(
    createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'),
    blob
  );
  texts[path] = bytes.toString('utf8');
}
const method = texts['istio/discovery.go'].match(
  /^func \(in \*Discovery\) setTags\([\s\S]*?^\}/m
)?.[0];
assert.ok(method);
const collect = method.match(/^\t\tfor _, webhook := range webhooks.Items \{[\s\S]*?^\t\t\}/m)?.[0];
const assign = method.match(/^\tfor i := range controlPlanes \{[\s\S]*?^\t\}/m)?.[0];
assert.ok(collect && assign);
const constant = (file, name) => {
  const match = texts[file].match(new RegExp(`^\\s*${name}\\s*=\\s*"([^"]*)"`, 'm'));
  assert.ok(match);
  return match[1];
};
const tagKey = constant('models/mesh.go', 'IstioTagLabel');
const revisionKey = constant('config/config.go', 'IstioRevisionLabel');
const code = value =>
  value
    .replaceAll('models.Tag', 'Tag')
    .replaceAll('models.IstioTagLabel', 'IstioTagLabel')
    .replaceAll('config.IstioRevisionLabel', 'IstioRevisionLabel');
const options = [
  ['stable', 'blue'],
  ['canary', 'blue'],
  ['stable', 'green'],
  ['', 'blue'],
  ['default', ''],
  ['', ''],
  ['blue', 'blue'],
  ['same', 'default'],
  ['default', undefined],
].map(([tag, revision], index) => ({
  name: `webhook-${index}`,
  labels: {
    [tagKey]: tag,
    ...(revision === undefined ? {} : { [revisionKey]: revision }),
  },
}));
const lists = [
  [],
  ...options.map(item => [item]),
  ...options.flatMap(first => options.map(second => [first, second])),
];
const cases = ['', 'blue', 'green', 'default'].flatMap(revision =>
  lists.map(webhooks => ({ revision, webhooks }))
);
const directory = await mkdtemp(join(tmpdir(), 'kiali-revision-tag-oracle-'));
let output;
try {
  await writeFile(
    join(directory, 'main.go'),
    `package main
import ("encoding/json"; "os")
const IstioTagLabel = ${JSON.stringify(tagKey)}
const IstioRevisionLabel = ${JSON.stringify(revisionKey)}
type Tag struct { Cluster string \`json:"cluster"\`; Name string \`json:"name"\`; Revision string \`json:"revision"\` }
type Webhook struct { Name string; Namespace string; Labels map[string]string }
type Cluster struct { Name string }
type ControlPlane struct { Revision string; ManagedClusters []Cluster; Tag *Tag }
type Input struct { Revision string; Webhooks []Webhook }
var log = struct{ Tracef func(string,...any); Debugf func(string,...any) }{
 func(_ string,_ ...any){}, func(_ string,_ ...any){},
}
func pick(input Input) *Tag {
 cluster := "fixture"
 tagsByClusterRev := map[string]*Tag{}
 webhooks := struct{ Items []Webhook }{Items:input.Webhooks}
${code(collect)}
 controlPlanes := []ControlPlane{{Revision:input.Revision, ManagedClusters:[]Cluster{{Name:cluster}}}}
${code(assign)}
 return controlPlanes[0].Tag
}
func main() {
 var inputs []Input
 if err:=json.NewDecoder(os.Stdin).Decode(&inputs); err!=nil { panic(err) }
 result:=make([]*Tag,0,len(inputs))
 for _,input:=range inputs { result=append(result,pick(input)) }
 if err:=json.NewEncoder(os.Stdout).Encode(result); err!=nil { panic(err) }
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
  await rm(join(directory, 'main.go'), { force: true });
  await rmdir(directory);
}
assert.ok(Array.isArray(output) && output.length === cases.length);
const artifact = {
  version: 'v2.33.0',
  commit: '0e8be887b8217bbcac5e3ae0bfcd258073949cca',
  sources,
  cases: cases.map((input, index) => ({ input, expected: output[index] })),
};
const path = 'test-files/parity/revision-tag-oracle.json';
const serialized = JSON.stringify(artifact, null, 2) + '\n';
if (values.check)
  assert.equal(await readFile(path, 'utf8'), serialized, 'Revision tag oracle drift');
else await writeFile(path, serialized);
console.log(`Verified ${cases.length} independent same-context tag-selection cases`);
