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
const sourcePath = 'util/mtls/status.go';
const blob = '730d21872c3fb79d28ecd658ea1e935189fd448b';
const bytes = await readFile(join(values.source, sourcePath));
assert.equal(createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'), blob);
const source = bytes.toString('utf8');
function extract(pattern) {
  const match = source.match(pattern);
  assert.ok(match, `Missing pinned source block ${pattern}`);
  return match[0];
}
const original = [
  extract(/^const \([\s\S]*?^\)/m),
  extract(/^type TlsStatus struct \{[\s\S]*?^\}/m),
  ...['finalStatus', 'OverallMtlsStatus', 'inheritedOverallStatus'].map(name =>
    extract(new RegExp(`^func \\(m MtlsStatus\\) ${name}\\([\\s\\S]*?^\\}`, 'm'))
  ),
  ...[
    'hasDefinedTls',
    'hasPartialTlsConfig',
    'hasHalfTlsConfigDefined',
    'hasNoConfig',
    'hasPartialDisabledConfig',
  ].map(name => extract(new RegExp(`^func \\(t TlsStatus\\) ${name}\\([\\s\\S]*?^\\}`, 'm'))),
].join('\n\n');
const modes = [];
for (const dr of ['', 'DISABLE', 'SIMPLE', 'MUTUAL', 'ISTIO_MUTUAL'])
  for (const pa of ['', 'UNSET', 'DISABLE', 'PERMISSIVE', 'STRICT']) modes.push({ dr, pa });
const cases = [];
for (const autoMtlsEnabled of [false, true])
  for (const allowPermissive of [false, true]) {
    for (const mode of modes)
      cases.push({ operation: 'final', autoMtlsEnabled, allowPermissive, ...mode });
    for (const namespace of modes)
      for (const mesh of modes)
        cases.push({ operation: 'overall', autoMtlsEnabled, allowPermissive, namespace, mesh });
  }
const directory = await mkdtemp(join(tmpdir(), 'kiali-mtls-oracle-'));
let output;
try {
  await writeFile(
    join(directory, 'main.go'),
    `package main
import ("encoding/json"; "os")
type MtlsStatus struct { AllowPermissive bool; AutoMtlsEnabled bool }
${original}
type Modes struct { Dr string; Pa string }
type Input struct { Operation string; AutoMtlsEnabled bool; AllowPermissive bool; Dr string; Pa string; Namespace Modes; Mesh Modes }
func main() {
 var inputs []Input
 if err:=json.NewDecoder(os.Stdin).Decode(&inputs);err!=nil { panic(err) }
 results:=[]any{}
 for _,in:=range inputs {
  m:=MtlsStatus{AutoMtlsEnabled:in.AutoMtlsEnabled,AllowPermissive:in.AllowPermissive}
  if in.Operation=="final" {
   status:=m.finalStatus(in.Dr,in.Pa)
   results=append(results,map[string]string{"destinationRuleStatus":status.DestinationRuleStatus,"peerAuthenticationStatus":status.PeerAuthenticationStatus,"overallStatus":status.OverallStatus})
  } else {
   results=append(results,m.OverallMtlsStatus(m.finalStatus(in.Namespace.Dr,in.Namespace.Pa),m.finalStatus(in.Mesh.Dr,in.Mesh.Pa)))
  }
 }
 if err:=json.NewEncoder(os.Stdout).Encode(results);err!=nil { panic(err) }
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
  sources: { [sourcePath]: blob },
  cases: cases.map((input, index) => ({ input, expected: output[index] })),
};
const path = 'test-files/parity/mtls-oracle.json';
const serialized = JSON.stringify(document, null, 2) + '\n';
if (values.check)
  assert.equal(await readFile(path, 'utf8'), serialized, 'Configured mTLS oracle drift');
else await writeFile(path, serialized);
console.log(`Verified ${cases.length} independent configured mTLS composition cases`);
