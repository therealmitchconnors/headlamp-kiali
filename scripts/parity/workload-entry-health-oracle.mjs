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
const path = 'util/healthutil/health_util.go';
const sources = {
  [path]: 'dfe83f57c9876b1a7b01479c93da9e272565029a',
  'models/workload.go': '8070c2c4423dee1ef6629e94ffd299e57c03c843',
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
assert.ok(text['models/workload.go'].includes('healthutil.IsWorkloadEntryHealthy(entry)'));
const extract = pattern => {
  const match = text[path].match(pattern);
  assert.ok(match);
  return match[0].replaceAll('networking_v1.', '').replaceAll('v1alpha1.', '');
};
const code = [
  extract(/^const \([\s\S]*?^\)/m),
  ...['IsWorkloadEntryHealthy', 'parseHealthAnnotation', 'GetBoolCondition', 'GetCondition'].map(
    name => extract(new RegExp(`^func ${name}\\([\\s\\S]*?^\\}`, 'm'))
  ),
];
const condition = status => ({ type: 'Healthy', status });
const cases = [];
for (const annotation of [
  undefined,
  '',
  '0',
  '1',
  'f',
  'F',
  't',
  'T',
  'false',
  'FALSE',
  'False',
  'true',
  'TRUE',
  'True',
  'TrUe',
  'yes',
  ' true',
  'true ',
  'true\n',
])
  for (const conditions of [
    undefined,
    [],
    [condition('True')],
    [condition('False')],
    [condition('Unknown')],
    [condition('true')],
    [condition('')],
    [{ type: 'Ready', status: 'True' }],
    [condition('False'), condition('True')],
    [condition('True'), condition('False')],
    [{ type: 'healthy', status: 'True' }, condition('False')],
    [{ type: 'Ready', status: 'False' }, condition('True')],
  ])
    cases.push({
      annotations:
        annotation === undefined ? {} : { 'proxy.istio.io/health-checks-enabled': annotation },
      status: conditions === undefined ? {} : { conditions },
    });
const directory = await mkdtemp(join(tmpdir(), 'kiali-entry-health-oracle-'));
let output;
try {
  await writeFile(
    join(directory, 'main.go'),
    `package main
import("encoding/json";"os";"strconv")
type IstioCondition struct{Type string;Status string}
type WorkloadEntry struct{Annotations map[string]string;Status struct{Conditions []*IstioCondition}}
${code.join('\n\n')}
func main(){
 var inputs []*WorkloadEntry
 if err:=json.NewDecoder(os.Stdin).Decode(&inputs);err!=nil{panic(err)}
 values:=[]bool{}
 for _,entry:=range inputs{values=append(values,IsWorkloadEntryHealthy(entry))}
 if err:=json.NewEncoder(os.Stdout).Encode(values);err!=nil{panic(err)}
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
const destination = 'test-files/parity/workload-entry-health-oracle.json';
if (values.check) assert.deepEqual(JSON.parse(await readFile(destination, 'utf8')), document);
else await writeFile(destination, JSON.stringify(document, null, 2) + '\n');
console.log(
  `${values.check ? 'Verified' : 'Generated'} ${
    cases.length
  } original-Go WorkloadEntry health cases.`
);
