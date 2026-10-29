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
const model = 'models/workload.go';
const filters = 'kubernetes/filters.go';
const sources = {
  [model]: '8070c2c4423dee1ef6629e94ffd299e57c03c843',
  [filters]: '1f5c24f5819ff1e633f848d1534b6f29ba53ca2a',
  'business/workloads.go': 'e0b704c0b299d19b50fbe9ae1d19cab1272a15cc',
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
  text['business/workloads.go'].includes(
    'labels.Set(wgroups[iFound].Spec.Metadata.Labels).AsSelector()'
  )
);
const fullParser = text[model].match(
  /^func \(workload \*Workload\) ParseWorkloadGroup\([\s\S]*?^\}/m
)?.[0];
assert.ok(fullParser);
const start = fullParser.indexOf('if len(wentries) > 0 {');
const end = fullParser.indexOf('/** Check the labels app and version');
assert.ok(start > 0 && end > start);
const branch = fullParser.slice(start, end);
const filter = text[filters].match(/^func FilterWorkloadEntriesBySelector\([\s\S]*?^\}/m)?.[0];
assert.ok(filter);
const filterCode = filter
  .replaceAll('labels.Selector', 'Selector')
  .replaceAll('labels.Set', 'LabelSet')
  .replaceAll('networking_v1.', '');
const entry = (name, labels) => ({ name, labels });
const cases = [];
for (const selector of [
  null,
  {},
  { app: 'vm' },
  { app: 'vm', version: 'v1' },
  { 'service.istio.io/canonical-name': 'canonical' },
  { zone: '' },
])
  for (const entries of [
    [],
    [entry('empty', null)],
    [entry('other', { app: 'other' })],
    [entry('one', { app: 'vm', version: 'v1' })],
    [entry('one', { app: 'vm', version: 'v1' }), entry('two', { app: 'vm', version: 'v2' })],
    [
      entry('other', { app: 'other' }),
      entry('one', { app: 'vm', version: 'v2', 'service.istio.io/canonical-name': 'canonical' }),
    ],
    [entry('blank', { app: 'vm', version: '', zone: '' }), entry('missing', { app: 'vm' })],
    [
      entry('canonical', {
        'service.istio.io/canonical-name': 'canonical',
        'service.istio.io/canonical-revision': 'v3',
      }),
    ],
  ])
    for (const reverse of [false, true])
      cases.push({ selector, entries: reverse ? [...entries].reverse() : entries });
const directory = await mkdtemp(join(tmpdir(), 'kiali-vm-label-oracle-'));
let output;
try {
  await writeFile(
    join(directory, 'main.go'),
    `package main
import("encoding/json";"os")
type LabelSet map[string]string
type Selector map[string]string
func (s Selector) Empty() bool {return len(s)==0}
func (s Selector) Matches(values LabelSet) bool {for k,v:=range s{actual,ok:=values[k];if !ok||actual!=v{return false}};return true}
type WorkloadEntry struct {Name string;ResourceVersion string;CreationTimestamp struct{Time string};Spec struct{Labels map[string]string}}
type WorkloadGroup struct {Spec struct{Metadata *struct{Labels map[string]string}}}
type Workload struct {Labels map[string]string;CreatedAt string;ResourceVersion string}
func formatTime(value string)string{return value}
${filterCode}
func selectedLabels(wg *WorkloadGroup,wentries []*WorkloadEntry)map[string]string{
 workload:=Workload{Labels:map[string]string{}}
 ${branch}
 if workload.Labels==nil{return map[string]string{}}
 return workload.Labels
}
func main(){
 var inputs []struct{Selector map[string]string;Entries []struct{Name string;Labels map[string]string}}
 if err:=json.NewDecoder(os.Stdin).Decode(&inputs);err!=nil{panic(err)}
 type result struct{Labels map[string]string \`json:"labels"\`;Count int \`json:"count"\`;First string \`json:"first"\`}
 results:=[]result{}
 for _,in:=range inputs{
  wg:=WorkloadGroup{};wg.Spec.Metadata=&struct{Labels map[string]string}{Labels:in.Selector}
  entries:=[]*WorkloadEntry{}
  for _,input:=range in.Entries{entry:=&WorkloadEntry{Name:input.Name};entry.Spec.Labels=input.Labels;entries=append(entries,entry)}
  matches:=FilterWorkloadEntriesBySelector(Selector(in.Selector),entries)
  value:=result{Labels:selectedLabels(&wg,matches),Count:len(matches)}
  if len(matches)>0{value.First=matches[0].Name}
  results=append(results,value)
 }
 if err:=json.NewEncoder(os.Stdout).Encode(results);err!=nil{panic(err)}
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
const path = 'test-files/parity/virtual-workload-labels-oracle.json';
if (values.check) assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), document);
else await writeFile(path, JSON.stringify(document, null, 2) + '\n');
console.log(
  `${values.check ? 'Verified' : 'Generated'} ${
    cases.length
  } original-Go WorkloadGroup label-selection cases.`
);
