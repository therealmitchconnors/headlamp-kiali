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
const path = 'models/istio_validation.go';
const bytes = await readFile(join(values.source, path));
const blob = 'd13e0b576e9392cb7e19578c05a07f2641efc054';
assert.equal(createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'), blob);
const source = bytes.toString('utf8');
const extract = pattern => {
  const match = source.match(pattern);
  assert.ok(match, `Missing pinned source ${pattern}`);
  return match[0];
};
const cases = [{ annotations: null }, { annotations: {} }, { annotations: { unrelated: 'value' } }];
const inputs = [
  '',
  'KIA0004',
  'KIA1107,GWAPI',
  'KIA0004,KIA0004',
  'KIA0004,,GWAPI',
  ',',
  ' KIA0004 , KIA1107 ',
  'kia0004',
  'KIA0004\nmiddle',
  'KIA0004,',
  '\ufeff',
  '\u180e',
];
for (const whitespace of [
  '\t',
  '\n',
  '\v',
  '\f',
  '\r',
  ' ',
  '\u0085',
  '\u00a0',
  '\u1680',
  '\u2000',
  '\u2001',
  '\u200a',
  '\u2028',
  '\u2029',
  '\u202f',
  '\u205f',
  '\u3000',
  '\ufeff',
  '\u180e',
])
  for (const value of ['', 'KIA0004', 'KIA0004,GWAPI'])
    inputs.push(`${whitespace}${value}${whitespace}`);
for (const value of inputs) cases.push({ annotations: { 'kiali.io/ignore-validations': value } });
const directory = await mkdtemp(join(tmpdir(), 'kiali-validation-annotations-'));
let output;
try {
  await writeFile(
    join(directory, 'main.go'),
    `package main
import ("encoding/json"; "os"; "strings")
${extract(/^const IgnoreValidationsAnnotation = .*$/m)}
${extract(/^type IgnoreValidationsRule struct \{[\s\S]*?^\}/m)}
${extract(/^func ParseIgnoreValidationsAnnotation\([\s\S]*?^\}/m)}
${extract(/^func shouldIgnoreCheck\([\s\S]*?^\}/m)}
type Input struct { Annotations map[string]string }
type Output struct { Present bool \`json:"present"\`; All bool \`json:"all"\`; Codes []string \`json:"codes"\`; Ignored map[string]bool \`json:"ignored"\` }
func main() {
 var inputs []Input
 if err:=json.NewDecoder(os.Stdin).Decode(&inputs);err!=nil {panic(err)}
 results:=[]Output{}
 for _,in:=range inputs {
  rule,found:=ParseIgnoreValidationsAnnotation(in.Annotations)
  codes:=rule.Codes
  if codes==nil {codes=[]string{}}
  ignored:=map[string]bool{}
  for _,code:=range []string{"KIA0004","KIA1107","GWAPI",""} {ignored[code]=shouldIgnoreCheck(code,nil,found,rule)}
  results=append(results,Output{found,rule.IgnoreAll,codes,ignored})
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
    })
  );
} finally {
  await rm(directory, { recursive: true });
}
const document = {
  version: 'v2.33.0',
  commit: '0e8be887b8217bbcac5e3ae0bfcd258073949cca',
  sources: { [path]: blob },
  cases: cases.map((input, index) => ({ input, expected: output[index] })),
};
const outputPath = 'test-files/parity/validation-annotations-oracle.json';
if (values.check) assert.deepEqual(JSON.parse(await readFile(outputPath, 'utf8')), document);
else await writeFile(outputPath, JSON.stringify(document, null, 2) + '\n');
console.log(
  `${values.check ? 'Verified' : 'Generated'} ${
    cases.length
  } original-Go validation-annotation cases.`
);
