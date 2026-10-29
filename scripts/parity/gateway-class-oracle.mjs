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
const checker = 'business/checkers/k8sgateways/gatewayclass_checker.go';
const caller = 'business/checkers/k8sgateway_checker.go';
const sources = {
  [checker]: '48ad008a33df77598f509706ac9491fd58fcab27',
  [caller]: '325feda97b07a084ddc33b8c0372bec3de078d7e',
  'cache/cache.go': 'b3bc1b4280ab51d78efbd1be2fdebfbe2774f09b',
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
assert.ok(text[caller].includes('k8sgateways.GatewayClassChecker{'));
assert.ok(
  text['cache/cache.go'].includes(
    'strings.HasPrefix(string(class.Spec.ControllerName), "istio.io") || len(labelSelector) > 0'
  )
);
const extract = pattern => {
  const match = text[checker].match(pattern);
  assert.ok(match, `Missing pinned source ${pattern}`);
  return match[0]
    .replaceAll('models.', '')
    .replaceAll('config.', '')
    .replaceAll('k8s_networking_v1.', '');
};
const code = [
  extract(/^type GatewayClassChecker struct \{[\s\S]*?^\}/m),
  extract(/^func \(s GatewayClassChecker\) Check\([\s\S]*?^\}/m),
  extract(/^func \(s GatewayClassChecker\) hasMatchingGatewayClass\([\s\S]*?^\}/m),
];
const descriptor = text['models/istio_validation.go'].match(
  /"k8sgateways.gatewayclassnotfound": \{\s*Code:\s*"([^"]+)",\s*Message:\s*"([^"]+)",\s*Severity:\s*ErrorSeverity,/
);
assert.ok(descriptor);
const cases = [];
for (const gatewayClassName of [
  'istio',
  'istio-remote',
  'istio-east-west',
  'istio-waypoint',
  'custom',
  'other',
  'missing',
  'class.with.dots',
])
  for (const classes of [
    [],
    ['istio'],
    ['custom'],
    ['istio', 'istio-remote'],
    ['istio-east-west', 'istio-waypoint'],
    ['class.with.dots'],
    ['custom', 'custom'],
    ['other', 'custom', 'istio'],
  ])
    cases.push({
      gatewayClassName,
      classes: classes.map((className, index) => ({
        name: index % 2 ? className : `Display ${index}`,
        className,
      })),
    });
const directory = await mkdtemp(join(tmpdir(), 'kiali-gateway-class-oracle-'));
let output;
try {
  await writeFile(
    join(directory, 'main.go'),
    `package main
import ("encoding/json"; "os")
type Gateway struct { Spec struct { GatewayClassName string } }
type GatewayAPIClass struct { Name string; ClassName string }
type IstioCheck struct { Code string; Message string; Severity string; Path string }
func Build(code,path string) IstioCheck {
 if code!="k8sgateways.gatewayclassnotfound" {panic(code)}
 return IstioCheck{${JSON.stringify(descriptor[1])},${JSON.stringify(descriptor[2])},"error",path}
}
${code.join('\n\n')}
func main() {
 var inputs []struct { GatewayClassName string; Classes []GatewayAPIClass }
 if err:=json.NewDecoder(os.Stdin).Decode(&inputs);err!=nil {panic(err)}
 results:=[][]*IstioCheck{}
 for _,in:=range inputs {
  gw:=&Gateway{}; gw.Spec.GatewayClassName=in.GatewayClassName
  checks,valid:=(GatewayClassChecker{K8sGateway:gw,GatewayClasses:in.Classes}).Check()
  if valid!=(len(checks)==0) {panic("Incorrect validity result")}
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
const path = 'test-files/parity/gateway-class-oracle.json';
if (values.check) assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), document);
else await writeFile(path, JSON.stringify(document, null, 2) + '\n');
console.log(
  `${values.check ? 'Verified' : 'Generated'} ${
    cases.length
  } original-Go Gateway class membership cases.`
);
