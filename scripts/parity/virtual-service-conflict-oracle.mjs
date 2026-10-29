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
const checker = 'business/checkers/virtualservices/single_host_checker.go';
const sources = {
  [checker]: '36ea67a0aa0b701ff331af3784413029c62ae181',
  'kubernetes/host.go': '551a684ab15e065be524de46d68aa631c4b7e289',
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
  const match = text[file].match(pattern);
  assert.ok(match, `Missing pinned source ${pattern}`);
  return match[0]
    .replaceAll('models.', '')
    .replaceAll('kubernetes.', '')
    .replaceAll('networking_v1.', '')
    .replaceAll('config.', '');
};
const code = [
  extract(checker, /^type SingleHostChecker struct \{[\s\S]*?^\}/m),
  extract(checker, /^func \(s SingleHostChecker\) Check\([\s\S]*?^\}/m),
  extract(checker, /^func \(s SingleHostChecker\) getHosts\([\s\S]*?^\}/m),
  ...['containsVirtualService', 'storeHost'].map(name =>
    extract(checker, new RegExp(`^func ${name}\\([\\s\\S]*?^\\}`, 'm'))
  ),
  extract('kubernetes/host.go', /^type Host struct \{[\s\S]*?^\}/m),
  ...['GetHost', 'ParseHost', 'includes'].map(name =>
    extract('kubernetes/host.go', new RegExp(`^func ${name}\\([\\s\\S]*?^\\}`, 'm'))
  ),
];
const record = (name, namespace, hosts, gateways) => ({
  name,
  namespace,
  spec: { hosts, ...(gateways === undefined ? {} : { gateways }) },
});
const cases = [];
for (const domain of ['svc.cluster.local', 'svc.custom.test'])
  for (const host of [
    'reviews',
    'reviews.bookinfo',
    'reviews.bookinfo.svc',
    `reviews.bookinfo.${domain}`,
    `*.bookinfo.${domain}`,
    '*',
    'api.example.test',
    '*.example.test',
    'reviews.unknown',
    'REVIEWS',
    '',
    'reviews.bookinfo.svc.cluster.local',
  ])
    for (const namespace of ['bookinfo', 'other'])
      for (const [a, b] of [
        [undefined, undefined],
        [[], ['mesh']],
        [['mesh'], ['mesh']],
        [[], ['no-gateway']],
        [['edge'], ['bookinfo/edge']],
        [['edge', 'other'], ['other']],
        [['mesh', 'mesh'], []],
        [['edge'], ['edge']],
      ])
        cases.push({
          domain,
          namespaces: ['bookinfo', 'other'],
          records: [record('a', 'bookinfo', ['reviews'], a), record('b', namespace, [host], b)],
        });
for (const records of [
  [record('self', 'bookinfo', ['reviews', 'reviews'])],
  [record('self', 'bookinfo', ['reviews', '*'])],
  [record('self', 'bookinfo', ['reviews'], ['mesh', 'mesh'])],
  [
    record('a', 'bookinfo', ['*']),
    record('b', 'bookinfo', ['reviews']),
    record('c', 'bookinfo', ['details']),
  ],
  [record('same', 'bookinfo', ['reviews.bookinfo']), record('same', 'other', ['reviews.bookinfo'])],
  [record('a', 'bookinfo', ['*.example.test']), record('b', 'bookinfo', ['api.example.test'])],
  [
    record('a', 'bookinfo', ['reviews', '*']),
    record('b', 'bookinfo', ['details']),
    record('c', 'bookinfo', ['ratings']),
  ],
  [record('a', 'bookinfo', [], ['mesh']), record('b', 'bookinfo', ['reviews'], [])],
])
  for (const reverse of [false, true])
    cases.push({
      domain: 'svc.cluster.local',
      namespaces: ['bookinfo', 'other'],
      records: reverse ? [...records].reverse() : records,
    });
const directory = await mkdtemp(join(tmpdir(), 'kiali-virtual-service-conflict-oracle-'));
let output;
try {
  await writeFile(
    join(directory, 'main.go'),
    `package main
import ("encoding/json"; "os"; "strings"; "sort")
type Config struct {}
type VirtualService struct { Name string; Namespace string; Spec struct { Hosts []string; Gateways []string } }
type Result struct { Conflict bool \`json:"conflict"\`; References []int \`json:"references"\` }
type IstioValidations map[int]map[int]bool
var positions map[*VirtualService]int
// Diagnostic sink only: preserve the original checker's selected objects and distinct non-self references.
func multipleVirtualServiceCheck(vs *VirtualService, validations IstioValidations, refs []*VirtualService, cluster string) {
 index:=positions[vs]
 if validations[index]==nil {validations[index]=map[int]bool{}}
 for _,ref:=range refs {if ref.Name!=vs.Name || ref.Namespace!=vs.Namespace {validations[index][positions[ref]]=true}}
}
${code.join('\n\n')}
func main() {
 var inputs []struct { Domain string; Namespaces []string; Records []*VirtualService }
 if err:=json.NewDecoder(os.Stdin).Decode(&inputs);err!=nil {panic(err)}
 results:=[][]Result{}
 for _,in:=range inputs {
  positions=map[*VirtualService]int{}
  for i,record:=range in.Records {positions[record]=i}
  output:=(SingleHostChecker{Cluster:"test",VirtualServices:in.Records,IdentityDomain:in.Domain,Namespaces:in.Namespaces}).Check()
  row:=[]Result{}
  for i:=range in.Records {
   refs,found:=output[i]; value:=Result{Conflict:found,References:[]int{}}
   for ref:=range refs {value.References=append(value.References,ref)}
   sort.Ints(value.References);row=append(row,value)
  }
  results=append(results,row)
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
const path = 'test-files/parity/virtual-service-conflict-oracle.json';
if (values.check) assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), document);
else await writeFile(path, JSON.stringify(document, null, 2) + '\n');
console.log(
  `${values.check ? 'Verified' : 'Generated'} ${
    cases.length
  } original-Go VirtualService conflict cases.`
);
