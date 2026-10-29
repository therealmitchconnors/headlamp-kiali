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
  'business/checkers/serviceentries/multi_match_checker.go':
    'aa11fd0e2607cea9a4d62d769f74dff14fe1d3af',
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
const checker = 'business/checkers/serviceentries/multi_match_checker.go';
function extract(pattern) {
  const match = text[checker].match(pattern);
  assert.ok(match, `Missing pinned source ${pattern}`);
  return match[0].replaceAll('models.', '').replaceAll('networking_v1.', '');
}
const descriptors = {};
for (const key of ['serviceentries.multimatch', 'serviceentries.port.protocol.conflict']) {
  const entry = text['models/istio_validation.go'].match(
    new RegExp(`"${key.replaceAll('.', '\\.')}": \\{([^}]+)\\}`)
  );
  assert.ok(entry);
  assert.match(entry[1], /Severity:\s+WarningSeverity/);
  descriptors[key] = {
    code: entry[1].match(/Code:\s+"([^"]+)"/)[1],
    message: entry[1].match(/Message:\s+"([^"]+)"/)[1],
    severity: 'warning',
  };
}
const record = (name, namespace, hosts, ports) => ({ name, namespace, spec: { hosts, ports } });
const cases = [];
for (const namespace of ['bookinfo', 'other'])
  for (const host of [
    'api.example.test',
    'API.EXAMPLE.TEST',
    '*.example.test',
    'other.example.test',
  ])
    for (const a of ['HTTP', 'http', 'TCP', ''])
      for (const b of ['HTTP', 'http', 'TCP', ''])
        for (const number of [80, 443, 0])
          cases.push({
            records: [
              record('first', 'bookinfo', ['api.example.test'], [{ number: 80, protocol: a }]),
              record('second', namespace, [host], [{ number, protocol: b }]),
            ],
          });
cases.push({ records: [] });
for (const hosts of [[], ['api.example.test'], ['api.example.test', 'API.EXAMPLE.TEST']])
  for (const ports of [
    [],
    [null],
    [{}],
    [
      { number: 80, protocol: 'HTTP' },
      { number: 80, protocol: 'TCP' },
    ],
  ])
    cases.push({ records: [record('single', 'bookinfo', hosts, ports)] });
cases.push({
  records: [
    record(
      'one',
      'a',
      ['api.example.test', 'other.example.test'],
      [null, { number: 80, protocol: 'http' }]
    ),
    record(
      'two',
      'b',
      ['API.EXAMPLE.TEST', 'other.example.test'],
      [{ number: 80, protocol: 'HTTP' }]
    ),
    record('three', 'c', ['api.example.test'], [{ number: 80, protocol: 'TCP' }]),
  ],
});
const directory = await mkdtemp(join(tmpdir(), 'kiali-service-entry-oracle-'));
let output;
try {
  await writeFile(
    join(directory, 'main.go'),
    `package main
import ("encoding/json"; "os"; "strings"; "sort"; "strconv")
type Port struct { Number uint32; Protocol string }
type ServiceEntry struct { Name string; Namespace string; Spec struct { Hosts []string; Ports []*Port } }
${extract(/^type MultiMatchChecker struct \{[\s\S]*?^\}/m)}
${extract(/^type hostPortKey struct \{[\s\S]*?^\}/m)}
${extract(/^type sePortEntry struct \{[\s\S]*?^\}/m)}
type Group struct { CheckID string \`json:"checkID"\`; Members []sePortEntry \`json:"members"\` }
type IstioValidations map[string]Group
${extract(/^func \(m MultiMatchChecker\) Check\([\s\S]*?^\}/m)}
${extract(/^func hasProtocolConflict\([\s\S]*?^\}/m)}
func (m MultiMatchChecker) addValidations(out IstioValidations, entries []sePortEntry, checkID string) {
 out[strconv.Itoa(len(out))] = Group{checkID, entries}
}
func jsonString(value interface{}) string { bytes,err:=json.Marshal(value); if err!=nil {panic(err)};return string(bytes) }
func main() {
 var inputs []struct { Records []*ServiceEntry }
 if err:=json.NewDecoder(os.Stdin).Decode(&inputs);err!=nil {panic(err)}
 results:=[][]Group{}
 for _,in:=range inputs {
  values:=(MultiMatchChecker{Cluster:"test",ServiceEntries:in.Records}).Check()
  groups:=[]Group{}
  for _,group:=range values {
   sort.Slice(group.Members,func(i,j int)bool{return jsonString(group.Members[i])<jsonString(group.Members[j])})
   groups=append(groups,group)
  }
  sort.Slice(groups,func(i,j int)bool{return jsonString(groups[i])<jsonString(groups[j])})
  results=append(results,groups)
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
  descriptors,
  cases: cases.map((input, index) => ({ input, expected: output[index] })),
};
const path = 'test-files/parity/service-entry-oracle.json';
if (values.check) assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), document);
else await writeFile(path, JSON.stringify(document, null, 2) + '\n');
console.log(
  `${values.check ? 'Verified' : 'Generated'} ${
    cases.length
  } original-Go ServiceEntry grouping cases.`
);
