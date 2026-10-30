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
  'istio/kubernetes.go': '1ae3f6611d27f964da9d3024ee339615cddd9f5b',
  'config/config.go': 'fbde570684b760495782fce1df801d9c0046723e',
  'models/mesh.go': '518a4242407e27452bb199b91344456d89908ad4',
  'models/namespace.go': '0f5b43473ce9fe7f7de6592d405d9997515278da',
};
const texts = {};
for (const [path, blob] of Object.entries(sources)) {
  const bytes = await readFile(join(values.source, path));
  assert.equal(
    createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'),
    blob,
    path
  );
  texts[path] = bytes.toString('utf8');
}
const constant = (file, name) => {
  const match = texts[file].match(new RegExp(`^\\s*${name}\\s*=\\s*"([^"]*)"`, 'm'));
  assert.ok(match, `Missing pinned constant ${name}`);
  return match[1];
};
const constants = Object.fromEntries(
  [
    'IstioRevisionLabel',
    'IstioInjectionLabelName',
    'IstioAmbientNamespaceLabel',
    'IstioAmbientNamespaceLabelValue',
  ].map(name => [name, constant('config/config.go', name)])
);
constants.IstioInjectionEnabledLabelValue = constant(
  'models/mesh.go',
  'IstioInjectionEnabledLabelValue'
);
const revision = texts['istio/kubernetes.go'].match(
  /^func GetRevision\(namespace models\.Namespace\) string \{[\s\S]*?^\}/m
)?.[0];
assert.ok(revision, 'Missing pinned GetRevision');
const ambient = texts['models/namespace.go'].match(
  /\tif label, hasLabel := ns\.Labels\[config\.IstioAmbientNamespaceLabel\]; hasLabel && label == config\.IstioAmbientNamespaceLabelValue \{\n\t\tnamespace\.IsAmbient = true\n\t\}/
)?.[0];
assert.ok(ambient, 'Missing pinned namespace ambient projection');
const qualify = value =>
  value
    .replaceAll('models.Namespace', 'Namespace')
    .replaceAll('config.', '')
    .replaceAll('models.IstioInjectionEnabledLabelValue', 'IstioInjectionEnabledLabelValue');
const member = revision.match(/const maistraMemberOfLabel = "([^"]+)"/)?.[1];
const ignore = revision.match(/const maistraIgnoreNamespaceLabel = "([^"]+)"/)?.[1];
assert.ok(member && ignore);
const cases = [{ labels: null }, { labels: { unrelated: 'value' } }];
for (const rev of [undefined, '', 'default', 'blue'])
  for (const injection of [undefined, '', 'enabled', 'disabled', 'Enabled', 'unexpected'])
    for (const ambient of [undefined, '', 'ambient', 'none'])
      for (const membership of [undefined, '', 'mesh', 'other'])
        for (const ignored of [undefined, '', 'true', 'false']) {
          const labels = Object.fromEntries(
            [
              [constants.IstioRevisionLabel, rev],
              [constants.IstioInjectionLabelName, injection],
              [constants.IstioAmbientNamespaceLabel, ambient],
              [member, membership],
              [ignore, ignored],
            ].filter(([, value]) => value !== undefined)
          );
          cases.push({ labels });
        }
const directory = await mkdtemp(join(tmpdir(), 'kiali-namespace-revision-oracle-'));
let output;
try {
  await writeFile(
    join(directory, 'main.go'),
    `package main
import ("encoding/json"; "os")
type Namespace struct { Labels map[string]string; IsAmbient bool }
${Object.entries(constants)
  .map(([name, value]) => `const ${name} = ${JSON.stringify(value)}`)
  .join('\n')}
${qualify(revision)}
func cast(labels map[string]string) Namespace {
 ns := Namespace{Labels:labels}
 namespace := ns
${qualify(ambient)}
 return namespace
}
type Input struct { Labels map[string]string }
func main() {
 var inputs []Input
 if err:=json.NewDecoder(os.Stdin).Decode(&inputs); err!=nil { panic(err) }
 result:=make([]string,0,len(inputs))
 for _,input:=range inputs { result=append(result,GetRevision(cast(input.Labels))) }
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
assert.ok(output.every(value => typeof value === 'string'));
const artifact = {
  version: 'v2.33.0',
  commit: '0e8be887b8217bbcac5e3ae0bfcd258073949cca',
  sources,
  cases: cases.map((input, index) => ({ input, expected: output[index] })),
};
const path = 'test-files/parity/namespace-revision-oracle.json';
const serialized = JSON.stringify(artifact, null, 2) + '\n';
if (values.check)
  assert.equal(await readFile(path, 'utf8'), serialized, 'Namespace revision oracle drift');
else await writeFile(path, serialized);
console.log(`Verified ${cases.length} independent namespace revision cases`);
