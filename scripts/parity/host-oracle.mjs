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
  'kubernetes/host.go': '551a684ab15e065be524de46d68aa631c4b7e289',
  'kubernetes/filters.go': '1f5c24f5819ff1e633f848d1534b6f29ba53ca2a',
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
  assert.ok(match, `Missing pinned source: ${pattern}`);
  return match[0];
}
const functions = [
  extract('kubernetes/host.go', /^type Host struct \{[\s\S]*?^\}/m),
  ...[
    'ParseHost',
    'GetHost',
    'includes',
    'ParseTwoPartHost',
    'HostWithinWildcardHost',
    'ParseGatewayAsHost',
  ].map(name => extract('kubernetes/host.go', new RegExp(`^func ${name}\\([\\s\\S]*?^\\}`, 'm'))),
  ...['String', 'IsWildcard'].map(name =>
    extract('kubernetes/host.go', new RegExp(`^func \\(h Host\\) ${name}\\([\\s\\S]*?^\\}`, 'm'))
  ),
  ...['FilterByHost', 'NormalizeHost'].map(name =>
    extract('kubernetes/filters.go', new RegExp(`^func ${name}\\([\\s\\S]*?^\\}`, 'm'))
  ),
];
const hosts = [
  'reviews',
  'reviews.bookinfo',
  'reviews.bookinfo.svc',
  'reviews.bookinfo.svc.cluster.local',
  'reviews.bookinfo.svc.custom.test',
  'reviews.preview',
  'reviews.external',
  'api.example.com',
  '*.example.com',
  '*',
  '',
  'reviews.bookinfo.svc.cluster.local.',
  'review.',
  'bookinfo/reviews',
  'edge/public',
  'a.b.c',
];
const cases = [];
for (const host of hosts) {
  for (const namespace of ['bookinfo', 'preview']) {
    cases.push({ operation: 'normalize', host, namespace });
    for (const domain of ['svc.cluster.local', 'svc.custom.test', '']) {
      for (const operation of ['parse', 'get', 'gateway']) {
        cases.push({ operation, host, namespace, domain, namespaces: ['bookinfo', 'preview'] });
      }
      for (const serviceNamespace of ['bookinfo', 'preview']) {
        cases.push({
          operation: 'filter',
          host,
          namespace,
          domain,
          service: 'reviews',
          serviceNamespace,
        });
      }
    }
  }
  for (const wildcard of [
    '*',
    '*.example.com',
    '*.bookinfo.svc.cluster.local',
    '*bookinfo.svc.cluster.local',
    'reviews',
    '',
    '*.svc.custom.test',
  ])
    cases.push({ operation: 'wildcard', host, wildcard });
}
for (const namespaces of [[], ['other'], ['preview']])
  cases.push({
    operation: 'get',
    host: 'reviews.preview',
    namespace: 'bookinfo',
    domain: 'svc.cluster.local',
    namespaces,
  });

const directory = await mkdtemp(join(tmpdir(), 'kiali-host-oracle-'));
let output;
try {
  await writeFile(
    join(directory, 'main.go'),
    `package main
import ("encoding/json"; "fmt"; "strings"; "os")
${functions.join('\n\n')}
type Input struct { Operation string; Host string; Namespace string; Domain string; Namespaces []string; Service string; ServiceNamespace string; Wildcard string }
func main() {
 var inputs []Input
 if err := json.NewDecoder(os.Stdin).Decode(&inputs); err != nil { panic(err) }
 results := []any{}
 for _, in := range inputs {
  var out any
  switch in.Operation {
  case "normalize": namespace, service := NormalizeHost(in.Host,in.Namespace); out=map[string]string{"namespace":namespace,"service":service}
  case "filter": out=FilterByHost(in.Host,in.Namespace,in.Service,in.ServiceNamespace,in.Domain)
  case "wildcard": out=HostWithinWildcardHost(in.Host,in.Wildcard)
  default:
   var host Host
   switch in.Operation { case "parse": host=ParseHost(in.Host,in.Namespace,in.Domain); case "get": host=GetHost(in.Host,in.Namespace,in.Namespaces,in.Domain); case "gateway": host=ParseGatewayAsHost(in.Host,in.Namespace,in.Domain); default: panic("unknown operation") }
   service,namespace:=ParseTwoPartHost(host)
   out=map[string]any{"host":host,"string":host.String(),"wildcard":host.IsWildcard(),"twoPart":map[string]string{"namespace":namespace,"service":service}}
  }
  results=append(results,out)
 }
 if err:=json.NewEncoder(os.Stdout).Encode(results); err!=nil { panic(err) }
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
  await rm(directory, { recursive: true });
}
const document = {
  version: 'v2.33.0',
  commit: '0e8be887b8217bbcac5e3ae0bfcd258073949cca',
  sources,
  cases: cases.map((input, index) => ({ input, expected: output[index] })),
};
const path = 'test-files/parity/host-oracle.json';
const serialized = JSON.stringify(document, null, 2) + '\n';
if (values.check) assert.equal(await readFile(path, 'utf8'), serialized, 'Host oracle drift');
else await writeFile(path, serialized);
console.log(`Verified ${cases.length} independent host semantics cases`);
