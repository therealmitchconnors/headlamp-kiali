import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: { source: { type: 'string' }, check: { type: 'boolean', default: false } },
});
assert.ok(values.source, 'Pass --source with the pinned Kiali checkout');
const commit = '0e8be887b8217bbcac5e3ae0bfcd258073949cca';
const sources = {
  'config/config.go': 'fbde570684b760495782fce1df801d9c0046723e',
  'models/workload.go': '8070c2c4423dee1ef6629e94ffd299e57c03c843',
  'business/apps.go': '9c2d919d2629fefb5d2719fcc6212a91fb55731c',
  'kubernetes/filters.go': '1f5c24f5819ff1e633f848d1534b6f29ba53ca2a',
};
const contents = new Map();
for (const [path, expected] of Object.entries(sources)) {
  const bytes = await readFile(join(values.source, path));
  const actual = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
  assert.equal(actual, expected, `Changed upstream source: ${path}`);
  contents.set(path, bytes.toString('utf8'));
}
const config = contents.get('config/config.go');
function extract(pattern) {
  const match = config.match(pattern);
  assert.ok(match, `Pinned source section missing: ${pattern}`);
  return match[0];
}
const methods = ['GetAppLabelName', 'GetVersionLabelName'].map(name =>
  extract(new RegExp(`^func \\(config \\*Config\\) ${name}[\\s\\S]*?^\\}`, 'm'))
);
const initializer = extract(/^\tif appLabelNames == nil \{[\s\S]*?^\t\}/m);
const constants = ['IstioServiceCanonicalName', 'IstioServiceCanonicalRevision'].map(name =>
  extract(new RegExp(`\\b${name}\\s*=\\s*"[^"]+"`))
);
const keys = [
  'service.istio.io/canonical-name',
  'app.kubernetes.io/name',
  'app',
  'service.istio.io/canonical-revision',
  'app.kubernetes.io/version',
  'version',
];
const all = Object.fromEntries(keys.map((key, index) => [key, `value-${index}`]));
const inputs = [];
for (let mask = 0; mask < 64; mask++) {
  inputs.push({
    labels: Object.fromEntries(
      keys.filter((_, index) => mask & (1 << index)).map(key => [key, all[key]])
    ),
    override: { app: '', version: '' },
  });
}
for (const key of keys) {
  inputs.push({ labels: { ...all, [key]: '' }, override: { app: '', version: '' } });
}
for (const override of [
  { app: 'team/app', version: 'team/version' },
  { app: 'team/app', version: '' },
  { app: '', version: 'team/version' },
]) {
  inputs.push({ labels: { ...all, 'team/app': 'custom', 'team/version': 'v2' }, override });
}
inputs.push({ labels: all, override: { app: 'team/app', version: 'team/version' } });
inputs.push({
  labels: { ...all, 'team/app': '', 'team/version': '' },
  override: { app: 'team/app', version: 'team/version' },
});

const directory = await mkdtemp(join(tmpdir(), 'kiali-label-oracle-'));
let cases;
try {
  await writeFile(
    join(directory, 'main.go'),
    `package main
import ("encoding/json"; "os")
type Config struct { IstioLabels struct { AppLabelName string; VersionLabelName string } }
var appLabelNames, versionLabelNames []string
const (${constants.join('\n')})
${methods.join('\n')}
func initialize(conf *Config) {
${initializer}
}
func main() {
 var inputs []struct { Labels map[string]string \`json:"labels"\`; Override struct { App string \`json:"app"\`; Version string \`json:"version"\` } \`json:"override"\` }
 if err := json.NewDecoder(os.Stdin).Decode(&inputs); err != nil { panic(err) }
 results := []any{}
 for _, input := range inputs {
  appLabelNames = nil
  versionLabelNames = nil
  conf := &Config{}
  conf.IstioLabels.AppLabelName = input.Override.App
  conf.IstioLabels.VersionLabelName = input.Override.Version
  initialize(conf)
  var app, version any
  if key, found := conf.GetAppLabelName(input.Labels); found { app = map[string]string{"key":key,"value":input.Labels[key]} }
  if key, found := conf.GetVersionLabelName(input.Labels); found { version = map[string]string{"key":key,"value":input.Labels[key]} }
  results = append(results, map[string]any{"input":input,"expected":map[string]any{"app":app,"version":version}})
 }
 if err := json.NewEncoder(os.Stdout).Encode(results); err != nil { panic(err) }
}
`
  );
  cases = JSON.parse(
    execFileSync('go', ['run', join(directory, 'main.go')], {
      input: JSON.stringify(inputs),
      encoding: 'utf8',
      env: { ...process.env, GO111MODULE: 'off', GOPROXY: 'off', GOTOOLCHAIN: 'local' },
    })
  );
} finally {
  await rm(directory, { recursive: true });
}
assert.equal(cases.length, 75);
const output =
  JSON.stringify(
    {
      version: 'v2.33.0',
      commit,
      sources,
      executed: [
        'Config.GetAppLabelName',
        'Config.GetVersionLabelName',
        'label initialization block',
      ],
      cases,
    },
    null,
    2
  ) + '\n';
const path = 'test-files/correlation/label-oracle.json';
if (values.check) assert.equal(await readFile(path, 'utf8'), output, 'Label oracle drift');
else {
  await mkdir('test-files/correlation', { recursive: true });
  await writeFile(path, output);
}
console.log(`Verified ${cases.length} independent Kiali label-resolution cases`);
