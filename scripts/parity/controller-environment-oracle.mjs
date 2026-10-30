import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, rmdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: { source: { type: 'string' }, check: { type: 'boolean', default: false } },
});
assert.ok(values.source, 'Pass --source for the pinned Kiali checkout');
const sources = {
  'istio/discovery.go': '60f6f7ab41a65acc5f40ca1095ce279433e62dce',
  'istio/constants.go': '90de803c8c48862ba48b34fcfcb5c633a12c3956',
  'kubernetes/kubernetes.go': 'b7e149defa6ac6705c089fa3445f0c6c0f388820',
};
const texts = {};
for (const [path, blob] of Object.entries(sources)) {
  const bytes = await readFile(join(values.source, path));
  assert.equal(
    createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'),
    blob
  );
  texts[path] = bytes.toString('utf8');
}
const loop = texts['istio/discovery.go'].match(
  /^\t{4}for _, env := range istiod.Spec.Template.Spec.Containers\[0\].Env \{[\s\S]*?^\t{4}\}/m
)?.[0];
const helper = texts['kubernetes/kubernetes.go'].match(/^func EnvVarIsTrue\([\s\S]*?^\}/m)?.[0];
assert.ok(loop && helper);
const keys = [
  'istiodClusterIDEnvKey',
  'istiodExternalEnvKey',
  'istiodScopeGatewayEnvKey',
  'istiodSharedMeshConfigEnvKey',
];
const constants = Object.fromEntries(
  keys.map(name => {
    const match = texts['istio/constants.go'].match(
      new RegExp(`^\\s*${name}\\s*=\\s*"([^"]*)"`, 'm')
    );
    assert.ok(match);
    return [name, match[1]];
  })
);
const options = [
  ...['blue', 'green', '', undefined].map(value => ({
    name: constants.istiodClusterIDEnvKey,
    value,
  })),
  ...['first', 'second', '', undefined].map(value => ({
    name: constants.istiodSharedMeshConfigEnvKey,
    value,
  })),
  ...['true', 'false', '', undefined].map(value => ({
    name: constants.istiodExternalEnvKey,
    value,
  })),
  { name: constants.istiodScopeGatewayEnvKey, value: 'true' },
  { name: 'UNRELATED', value: 'true' },
];
const cases = [
  [],
  ...options.map(item => [item]),
  ...options.flatMap(first => options.map(second => [first, second])),
].map(env => ({ env }));
const directory = await mkdtemp(join(tmpdir(), 'kiali-controller-env-oracle-'));
let output;
try {
  await writeFile(
    join(directory, 'main.go'),
    `package main
import ("encoding/json"; "os")
${Object.entries(constants)
  .map(([name, value]) => `const ${name} = ${JSON.stringify(value)}`)
  .join('\n')}
type EnvVar struct { Name string; Value string }
type Container struct { Env []EnvVar }
type PodSpec struct { Containers []Container }
type Template struct { Spec PodSpec }
type DeploymentSpec struct { Template Template }
type Deployment struct { Namespace string; Name string; Spec DeploymentSpec }
type ControlPlane struct {
 ID string \`json:"id"\`; SharedMeshConfig string \`json:"shared"\`;
 ManagesExternal bool \`json:"external"\`; IsGatewayToNamespace bool \`json:"gateway"\`
}
type Input struct { Env []EnvVar }
var log = struct{ Infof func(string,...any) }{func(_ string,_ ...any){}}
${helper.replaceAll('core_v1.EnvVar', 'EnvVar')}
func observe(input Input) ControlPlane {
 cluster := struct{ Name string }{"fixture"}
 istiod := Deployment{Spec:DeploymentSpec{Template:Template{Spec:PodSpec{Containers:[]Container{{Env:input.Env}}}}}}
 controlPlane := ControlPlane{}
${loop.replaceAll('kubernetes.EnvVarIsTrue', 'EnvVarIsTrue')}
 return controlPlane
}
func main() {
 var inputs []Input
 if err:=json.NewDecoder(os.Stdin).Decode(&inputs); err!=nil { panic(err) }
 result:=make([]ControlPlane,0,len(inputs))
 for _,input:=range inputs { result=append(result,observe(input)) }
 if err:=json.NewEncoder(os.Stdout).Encode(result); err!=nil { panic(err) }
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
  await rm(join(directory, 'main.go'), { force: true });
  await rmdir(directory);
}
assert.ok(Array.isArray(output) && output.length === cases.length);
const artifact = {
  version: 'v2.33.0',
  commit: '0e8be887b8217bbcac5e3ae0bfcd258073949cca',
  sources,
  cases: cases.map((input, index) => ({ input, expected: output[index] })),
};
const path = 'test-files/parity/controller-environment-oracle.json';
const serialized = JSON.stringify(artifact, null, 2) + '\n';
if (values.check)
  assert.equal(await readFile(path, 'utf8'), serialized, 'Controller environment oracle drift');
else await writeFile(path, serialized);
console.log(`Verified ${cases.length} original-Go controller environment cases`);
