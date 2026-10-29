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
const checker = 'business/checkers/common/multi_match_selector_checker.go';
const caller = 'business/checkers/peer_authentication_checker.go';
const model = 'models/istio_validation.go';
const sources = {
  [checker]: '3240a2bcb2b74fb589768c3dd06e8c959fdab99d',
  [caller]: 'd4ba5a8ac74729061f72400d0fd8ab61c29ec472',
  [model]: 'd13e0b576e9392cb7e19578c05a07f2641efc054',
  'business/istio_validations.go': 'ef416a10be244b84b86e017203b4e76869ae1889',
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
assert.ok(text[caller].includes('common.PeerAuthenticationMultiMatchChecker('));
assert.ok(text[checker].includes('validations.MergeValidations(m.analyzeSelectorLessSubjects())'));
const extract = (path, pattern) => {
  const match = text[path].match(pattern);
  assert.ok(match, `Missing pinned source ${pattern}`);
  return match[0]
    .replaceAll('models.', '')
    .replaceAll('security_v1.', '')
    .replaceAll('schema.GroupVersionKind', 'string');
};
const code = [
  extract(checker, /^type GenericMultiMatchChecker struct \{[\s\S]*?^\}/m),
  extract(checker, /^type KeyWithIndex struct \{[\s\S]*?^\}/m),
  extract(checker, /^func PeerAuthenticationMultiMatchChecker\([\s\S]*?^\}/m),
  ...[
    'analyzeSelectorLessSubjects',
    'selectorLessSubjects',
    'buildSelectorLessSubjectValidations',
  ].map(method =>
    extract(
      checker,
      new RegExp(`^func \\(m GenericMultiMatchChecker\\) ${method}\\([\\s\\S]*?^\\}`, 'm')
    )
  ),
  extract(checker, /^func extractReferences\([\s\S]*?^\}/m),
  extract(model, /^func \(iv IstioValidations\) MergeValidations\([\s\S]*?^\}/m),
];
const descriptor = text[model].match(
  /"generic.multimatch.selectorless": \{\s*Code:\s*"([^"]+)",\s*Message:\s*"([^"]+)",\s*Severity:\s*ErrorSeverity,/
);
assert.ok(descriptor);
const policy = (name, namespace, selector) => ({
  name,
  namespace,
  spec: selector === undefined ? {} : { selector },
});
const cases = [];
for (const a of [
  undefined,
  null,
  {},
  { matchLabels: null },
  { matchLabels: {} },
  { matchLabels: { app: 'reviews' } },
])
  for (const b of [
    undefined,
    null,
    {},
    { matchLabels: null },
    { matchLabels: {} },
    { matchLabels: { app: 'reviews' } },
    { matchLabels: { app: '' } },
  ])
    for (const namespace of ['bookinfo', 'other'])
      for (const reverse of [false, true]) {
        const records = [policy('a', 'bookinfo', a), policy('b', namespace, b)];
        cases.push({ records: reverse ? [...records].reverse() : records });
      }
for (const records of [
  [policy('a', 'bookinfo'), policy('b', 'bookinfo'), policy('c', 'bookinfo', {})],
  [policy('a', 'bookinfo'), policy('b', 'bookinfo'), policy('c', 'root')],
  [policy('same', 'bookinfo'), policy('same', 'root')],
  [policy('a', 'bookinfo'), policy('b', 'root'), policy('c', 'root')],
])
  for (const reverse of [false, true])
    cases.push({ records: reverse ? [...records].reverse() : records });
const directory = await mkdtemp(join(tmpdir(), 'kiali-peer-selectorless-oracle-'));
let output;
try {
  await writeFile(
    join(directory, 'main.go'),
    `package main
import("encoding/json";"os")
type PeerAuthentication struct {Name string;Namespace string;Spec struct {Selector *struct {MatchLabels map[string]string}}}
type Workloads []struct{}
type IstioValidationKey struct {Name string;Namespace string;ObjectGVK string;Cluster string}
type IstioCheck struct {Code string;Message string;Severity string;Path string}
type IstioValidation struct {Cluster string;Name string;ObjectGVK string;Valid bool;Checks []*IstioCheck;References []IstioValidationKey}
type IstioValidations map[IstioValidationKey]*IstioValidation
func Build(code,path string) IstioCheck {if code!="generic.multimatch.selectorless" {panic(code)};return IstioCheck{Code:${JSON.stringify(
      descriptor[1]
    )},Message:${JSON.stringify(descriptor[2])},Severity:"error",Path:path}}
${code.join('\n\n')}
func main(){
 var inputs []struct{Records []*PeerAuthentication}
 if err:=json.NewDecoder(os.Stdin).Decode(&inputs);err!=nil{panic(err)}
 type result struct {References []int \`json:"references"\`;Checks []*IstioCheck \`json:"checks"\`}
 results:=[][]result{}
 for _,in:=range inputs{
  checker:=PeerAuthenticationMultiMatchChecker("alpha","PeerAuthentication",in.Records,nil)
  if checker.skipSelectorLess{panic("selectorless checker disabled")}
  validations:=checker.analyzeSelectorLessSubjects()
  row:=[]result{}
  for _,policy:=range in.Records{
   value:=validations[IstioValidationKey{Name:policy.Name,Namespace:policy.Namespace,ObjectGVK:"PeerAuthentication",Cluster:"alpha"}]
   r:=result{References:[]int{},Checks:[]*IstioCheck{}}
   if value!=nil{
    r.Checks=value.Checks
    for i,peer:=range in.Records{for _,ref:=range value.References{if ref.Name==peer.Name&&ref.Namespace==peer.Namespace{r.References=append(r.References,i);break}}}
   };row=append(row,r)
  };results=append(results,row)
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
const path = 'test-files/parity/peer-selectorless-oracle.json';
if (values.check) assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), document);
else await writeFile(path, JSON.stringify(document, null, 2) + '\n');
console.log(
  `${values.check ? 'Verified' : 'Generated'} ${
    cases.length
  } original-Go selectorless PeerAuthentication cases.`
);
