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
const checker = 'business/checkers/sidecars/global_checker.go';
const caller = 'business/checkers/sidecars_checker.go';
const sources = {
  [checker]: 'db53f17f9300e68fc10d8b0bc2875dc20d733fc6',
  [caller]: '7b3f3c6fb59a1adae5623358cb4fee48ef3dd479',
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
  text[caller].includes('sidecars.NewGlobalChecker(s.RootNamespaces[sidecar.Namespace], sidecar)')
);
const extract = pattern => {
  const match = text[checker].match(pattern);
  assert.ok(match, `Missing pinned source ${pattern}`);
  return match[0].replaceAll('models.', '').replaceAll('networking_v1.', '');
};
const code = [
  extract(/^type GlobalChecker struct \{[\s\S]*?^\}/m),
  extract(/^func \(gc GlobalChecker\) Check\([\s\S]*?^\}/m),
];
const descriptor = text['models/istio_validation.go'].match(
  /"sidecar.global.selector": \{\s*Code:\s*"([^"]+)",\s*Message:\s*"([^"]+)",\s*Severity:\s*WarningSeverity,/
);
assert.ok(descriptor);
const cases = [];
for (const rootNamespace of ['istio-system', 'mesh-root', 'bookinfo'])
  for (const namespace of ['istio-system', 'mesh-root', 'bookinfo'])
    for (const workloadSelector of [
      undefined,
      null,
      {},
      { labels: null },
      { labels: {} },
      { labels: { app: 'reviews' } },
      { labels: { app: '' } },
      { labels: { app: 'reviews', version: 'v1' } },
    ])
      cases.push({
        rootNamespace,
        namespace,
        spec: workloadSelector === undefined ? {} : { workloadSelector },
      });
const directory = await mkdtemp(join(tmpdir(), 'kiali-sidecar-root-oracle-'));
let output;
try {
  await writeFile(
    join(directory, 'main.go'),
    `package main
import ("encoding/json"; "os")
type Sidecar struct { Namespace string; Spec struct { WorkloadSelector *struct { Labels map[string]string } } }
type IstioCheck struct { Code string; Message string; Severity string; Path string }
func Build(code,path string) IstioCheck {
 if code!="sidecar.global.selector" {panic(code)}
 return IstioCheck{${JSON.stringify(descriptor[1])},${JSON.stringify(descriptor[2])},"warning",path}
}
${code.join('\n\n')}
func main() {
 var inputs []struct { RootNamespace string; Namespace string; Spec struct { WorkloadSelector *struct { Labels map[string]string } } }
 if err:=json.NewDecoder(os.Stdin).Decode(&inputs);err!=nil {panic(err)}
 results:=[][]*IstioCheck{}
 for _,in:=range inputs {
  checks,valid:=(GlobalChecker{RootNamespace:in.RootNamespace,Sidecar:&Sidecar{Namespace:in.Namespace,Spec:in.Spec}}).Check()
  if !valid {panic("Root selector warning must not invalidate configuration")}
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
      maxBuffer: 1024 * 1024,
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
const path = 'test-files/parity/sidecar-root-oracle.json';
if (values.check) assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), document);
else await writeFile(path, JSON.stringify(document, null, 2) + '\n');
console.log(
  `${values.check ? 'Verified' : 'Generated'} ${
    cases.length
  } original-Go Sidecar root-selector cases.`
);
