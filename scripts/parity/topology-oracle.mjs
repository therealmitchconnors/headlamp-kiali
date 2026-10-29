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
  'graph/types.go': 'b14b55e8a1eed3dc1fba43c0837a35babf5dd57f',
  'graph/util.go': '376f6f9cda95adc509f34e73ad7fea9bf9ff61ee',
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
  return match[0];
}
const constants = [
  'GraphTypeApp',
  'GraphTypeService',
  'GraphTypeVersionedApp',
  'GraphTypeWorkload',
  'NodeTypeApp',
  'NodeTypeService',
  'NodeTypeUnknown',
  'NodeTypeWorkload',
  'Unknown',
].map(name => extract('graph/types.go', new RegExp(`^\\t${name}\\s+string = .*$`, 'm')));
const cases = [];
for (const mode of ['workload', 'app', 'versionedApp', 'service'])
  for (const [namespace, serviceNamespace] of [
    ['bookinfo', 'other'],
    ['unknown', 'bookinfo'],
    ['', 'bookinfo'],
    ['unknown', 'unknown'],
  ])
    for (const workload of ['', 'unknown', 'reviews-v1'])
      for (const app of ['', 'unknown', 'reviews'])
        for (const version of ['', 'unknown', 'latest', 'v1'])
          for (const service of ['', 'unknown', 'reviews'])
            cases.push({
              mode,
              endpoint: {
                cluster: 'east',
                namespace,
                serviceNamespace,
                workload,
                app,
                version,
                service,
              },
            });
const directory = await mkdtemp(join(tmpdir(), 'kiali-topology-oracle-'));
let output;
try {
  await writeFile(
    join(directory, 'main.go'),
    `package main
import ("encoding/json"; "fmt"; "os")
const (
${constants.join('\n')}
)
${extract('graph/types.go', /^func Id\([\s\S]*?^\}/m)}
${extract('graph/util.go', /^func IsOK\([\s\S]*?^\}/m)}
${extract('graph/util.go', /^func IsOKVersion\([\s\S]*?^\}/m)}
type Endpoint struct { Cluster,Namespace,ServiceNamespace,Workload,App,Version,Service string }
type Input struct { Mode string; Endpoint Endpoint }
type Output struct { ID string \`json:"id"\`; Kind string \`json:"kind"\`; Error bool \`json:"error"\` }
func main() {
 var inputs []Input
 if err:=json.NewDecoder(os.Stdin).Decode(&inputs);err!=nil {panic(err)}
 results:=[]Output{}
 for _,in:=range inputs {
  e:=in.Endpoint
  id,kind,err:=Id(e.Cluster,e.ServiceNamespace,e.Service,e.Namespace,e.Workload,e.App,e.Version,in.Mode)
  results=append(results,Output{id,kind,err!=nil})
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
const path = 'test-files/parity/topology-oracle.json';
if (values.check) assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), document);
else await writeFile(path, JSON.stringify(document, null, 2) + '\n');
console.log(
  `${values.check ? 'Verified' : 'Generated'} ${cases.length} original-Go graph identity cases.`
);
