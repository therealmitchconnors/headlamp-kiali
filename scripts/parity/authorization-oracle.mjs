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
  'business/checkers/authorization/namespace_method_checker.go':
    '004170c8ad7e4c2d32f7ac7f5e647f24540d383e',
  'models/namespace.go': '0f5b43473ce9fe7f7de6592d405d9997515278da',
  'util/httputil/http_util.go': '1eec05f92b34b45f492ce4de77b8df52a29586af',
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
  return match[0].replaceAll('httputil.', '');
}
const code = [
  extract(
    'business/checkers/authorization/namespace_method_checker.go',
    /^func validMethod\([\s\S]*?^\}/m
  ),
  extract('util/httputil/http_util.go', /^func HttpMethods\([\s\S]*?^\}/m),
  ...['Includes', 'MatchesPattern'].map(name =>
    extract(
      'models/namespace.go',
      new RegExp(`^func \\(nsn NamespaceNames\\) ${name}\\([\\s\\S]*?^\\}`, 'm')
    )
  ),
  extract('models/namespace.go', /^func namespacePatternMatches\([\s\S]*?^\}/m),
];
const cases = [];
for (const method of [
  'GET',
  'HEAD',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'CONNECT',
  'OPTIONS',
  'TRACE',
]) {
  for (const value of [
    method,
    method.toLowerCase(),
    `\t${method}\r\n`,
    method[0] + method.slice(1).toLowerCase(),
  ])
    cases.push({ operation: 'method', value });
  for (let size = 0; size <= method.length; size++) {
    cases.push({ operation: 'method', value: `${method.slice(0, size)}*` });
    cases.push({ operation: 'method', value: `*${method.slice(method.length - size)}` });
  }
}
for (const value of [
  '',
  ' ',
  '*',
  '**',
  '*GET*',
  'G*T',
  'CUSTOM',
  'grpc.Service/Method',
  '/grpc.Service/Method',
  'CONNECTX',
  'GET ',
  'G E T',
  'get\nx',
  '\ufeffGET',
  '\u0085GET\u0085',
  '*\ufb05',
  'po\u017ft',
  'opt\u0131ons',
])
  cases.push({ operation: 'method', value });
for (const space of [
  '\t',
  '\n',
  '\r',
  ' ',
  '\u0085',
  '\u00a0',
  '\u1680',
  '\u2000',
  '\u2028',
  '\u202f',
  '\u205f',
  '\u3000',
  '\ufeff',
  '\u180e',
])
  for (const word of ['GET', 'BAD'])
    cases.push({ operation: 'method', value: `${space}${word}${space}` });
for (const namespaces of [
  [],
  ['bookinfo'],
  ['bookinfo', 'other'],
  [''],
  ['book*'],
  ['bookinfo', '\u7cfb\u7edf'],
])
  for (const value of [
    '',
    '*',
    'bookinfo',
    'book*',
    '*info',
    '*book*',
    'book**',
    '**info',
    '*missing',
    'missing*',
    ' Book*',
    'bookinfo ',
    'Bookinfo',
    '*\u7cfb\u7edf',
    'book*info',
    '**',
    'other',
    '*other',
  ])
    cases.push({ operation: 'namespace', value, namespaces });

const directory = await mkdtemp(join(tmpdir(), 'kiali-authorization-oracle-'));
let output;
try {
  await writeFile(
    join(directory, 'main.go'),
    `package main
import ("encoding/json"; "net/http"; "strings"; "os")
type NamespaceNames []string
${code.join('\n\n')}
type Input struct { Operation string; Value string; Namespaces NamespaceNames }
func main() {
 var inputs []Input
 if err:=json.NewDecoder(os.Stdin).Decode(&inputs);err!=nil {panic(err)}
 results:=[]bool{}
 for _,in:=range inputs {
  switch in.Operation {
  case "method": results=append(results,validMethod(in.Value))
  case "namespace": results=append(results,in.Namespaces.MatchesPattern(in.Value))
  default: panic("unknown operation")
  }
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
const path = 'test-files/parity/authorization-oracle.json';
if (values.check) assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), document);
else await writeFile(path, JSON.stringify(document, null, 2) + '\n');
console.log(
  `${values.check ? 'Verified' : 'Generated'} ${
    cases.length
  } original-Go authorization pattern cases.`
);
