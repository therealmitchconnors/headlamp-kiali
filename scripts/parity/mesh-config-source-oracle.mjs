import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: { source: { type: 'string' }, check: { type: 'boolean', default: false } },
});
const commit = '0e8be887b8217bbcac5e3ae0bfcd258073949cca';
const sources = { 'istio/discovery.go': '60f6f7ab41a65acc5f40ca1095ce279433e62dce' };
const texts = {};
for (const [path, blob] of Object.entries(sources)) {
  let bytes;
  if (values.source) bytes = await readFile(join(values.source, path));
  else {
    const response = await fetch(`https://raw.githubusercontent.com/kiali/kiali/${commit}/${path}`);
    assert.ok(response.ok, `Unable to fetch pinned ${path}`);
    bytes = Buffer.from(await response.arrayBuffer());
  }
  assert.equal(
    createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'),
    blob
  );
  texts[path] = bytes.toString('utf8');
}
const names = [
  'isValidContainerPath',
  'cleanContainerPath',
  'findMeshConfigFile',
  'shouldLoadMeshConfigFile',
];
const helpers = names.map(name => {
  const helper = texts['istio/discovery.go'].match(
    new RegExp(`^func ${name}\\([\\s\\S]*?^\\}`, 'm')
  )?.[0];
  assert.ok(helper, `Missing pinned helper ${name}`);
  return helper.replaceAll('corev1.', '').replaceAll('models.', '');
});

const defaultPath = '/etc/istio/config/mesh';
const standardName = 'istio-blue';
const cases = [];
const add = (label, path, mounts, volumes, nativeGuard) =>
  cases.push({
    label,
    input: { path, container: { volumeMounts: mounts }, volumes, standardName },
    ...(nativeGuard ? { nativeGuard } : {}),
  });
for (const path of [defaultPath, '/etc//istio/config/./mesh', './etc/istio/config/mesh']) {
  for (const mountPath of [
    '/etc/istio/config',
    '/etc/istio/config/',
    '/etc//istio/config',
    defaultPath,
  ]) {
    for (const name of [standardName, 'custom']) {
      for (const items of [
        undefined,
        [],
        [{ path: 'mesh', key: 'mesh' }],
        [{ path: 'mesh', key: 'settings' }],
      ]) {
        add(
          'direct/default/exact/normalized',
          path,
          [{ name: 'volume', mountPath }],
          [{ name: 'volume', configMap: { name, items } }]
        );
      }
    }
  }
}
for (const path of ['/custom/mesh', '/custom/nested/mesh', '/mesh']) {
  for (const subPath of ['mesh', 'nested/settings.yaml']) {
    for (const key of ['mesh', 'settings']) {
      add(
        'exact subPath remapping',
        path,
        [{ name: 'volume', mountPath: path, subPath }],
        [{ name: 'volume', configMap: { name: 'custom', items: [{ path: subPath, key }] } }]
      );
    }
  }
}
for (const items of [
  [{ path: 'config/mesh', key: 'mesh' }],
  [
    { path: 'config/mesh', key: 'first' },
    { path: 'config/./mesh', key: 'second' },
  ],
  [
    { path: 'other', key: 'ignored' },
    { path: './config//mesh', key: 'settings' },
  ],
]) {
  add(
    'items mapping order',
    defaultPath,
    [{ name: 'volume', mountPath: '/etc/istio' }],
    [{ name: 'volume', configMap: { name: 'custom', items } }]
  );
}
add(
  'root mount',
  defaultPath,
  [{ name: 'volume', mountPath: '/' }],
  [
    {
      name: 'volume',
      configMap: { name: 'custom', items: [{ path: 'etc/istio/config/mesh', key: 'settings' }] },
    },
  ]
);
add('default without file reference', defaultPath, [], []);
add(
  'prefix sibling is not a mount',
  defaultPath,
  [{ name: 'volume', mountPath: '/etc/istio/configuration' }],
  [{ name: 'volume', configMap: { name: 'custom' } }]
);
const shorter = { name: 'shorter', mountPath: '/etc/istio' };
const longer = { name: 'longer', mountPath: '/etc/istio/config' };
const shortVolume = {
  name: 'shorter',
  configMap: { name: 'shorter', items: [{ path: 'config/mesh', key: 'short' }] },
};
const longVolume = { name: 'longer', configMap: { name: 'longer' } };
for (const mounts of [
  [shorter, longer],
  [longer, shorter],
]) {
  add('longest mount order', defaultPath, mounts, [shortVolume, longVolume]);
  for (const source of [
    { secret: { secretName: 'unread' } },
    { projected: { sources: [{ configMap: { name: 'unread' } }] } },
    { emptyDir: {} },
    { hostPath: { path: '/unread' } },
    { csi: { driver: 'unread' } },
    { configMap: { name: 'unmapped', items: [{ path: 'other', key: 'mesh' }] } },
  ]) {
    add(
      'unsupported longer mask',
      defaultPath,
      mounts,
      [shortVolume, { name: 'longer', ...source }],
      'Native guard: do not fall through a masking unsupported/unmapped mount to a shorter valid source.'
    );
  }
}
add(
  'equal mount ambiguity',
  defaultPath,
  [longer, { name: 'other', mountPath: longer.mountPath }],
  [longVolume, { name: 'other', configMap: { name: 'other' } }],
  'Native guard: reject equal-path mount ambiguity instead of selecting the first mount.'
);
add(
  'duplicate volume ambiguity',
  defaultPath,
  [longer],
  [longVolume, longVolume],
  'Native guard: reject duplicate volume identities instead of selecting the first volume.'
);
add(
  'unresolved subPathExpr',
  defaultPath,
  [{ ...longer, subPathExpr: '$(PATH)' }],
  [longVolume],
  'Native guard: reject unresolved subPathExpr, which the pinned helper does not inspect.'
);
add(
  'directory subPath masks shorter mount',
  defaultPath,
  [shorter, { ...longer, subPath: 'nested' }],
  [shortVolume, longVolume],
  'Native guard: reject a covering directory subPath instead of skipping it.'
);
add(
  'missing volume',
  defaultPath,
  [longer],
  [],
  'Native guard: a declared covering mount must resolve, not fall back to standard.'
);
add(
  'unknown explicit path',
  '/custom/mesh',
  [],
  [],
  'Native guard: a nondefault path requires an auditable direct ConfigMap mount.'
);
for (const path of ['', '/', '/a/../mesh', 'relative/mesh', '/etc/istio/config/..mesh']) {
  add(
    'invalid file path',
    path,
    [longer],
    [longVolume],
    'Native guard: reject invalid paths instead of the caller defaulting or helper returning no source.'
  );
}
add(
  'invalid unprojected key',
  '/etc/istio/config/nested/mesh',
  [longer],
  [longVolume],
  'Native guard: reject a relative path containing slash as an invalid ConfigMap data key.'
);
add(
  'item traversal',
  defaultPath,
  [longer],
  [
    {
      name: 'longer',
      configMap: { name: 'custom', items: [{ path: 'nested/../mesh', key: 'mesh' }] },
    },
  ],
  'Native guard: reject traversal before cleaning an item path.'
);

const directory = resolve('scripts/parity', `.mesh-config-oracle-${randomUUID()}`);
await mkdir(directory);
await mkdir(join(directory, 'build'));
let output;
try {
  await writeFile(
    join(directory, 'main.go'),
    `package main
import ("encoding/json"; "os"; "path"; "strings")
type KeyToPath struct { Key string; Path string }
type ConfigMapVolumeSource struct { Name string; Items []KeyToPath }
type Volume struct { Name string; ConfigMap *ConfigMapVolumeSource }
type VolumeMount struct { Name string; MountPath string; SubPath string }
type Container struct { VolumeMounts []VolumeMount }
type MeshConfigFileReference struct {
 ConfigMapName string \`json:"name"\`; ConfigMapKey string \`json:"key"\`; Path string \`json:"path"\`
}
type Cluster struct { Name string }
type ControlPlane struct { ID string; Cluster Cluster; MeshConfigFile *MeshConfigFileReference }
${helpers.join('\n')}
type Input struct { Path string; Container Container; Volumes []Volume; StandardName string }
type Output struct { Reference *MeshConfigFileReference \`json:"reference"\`; LoadFile bool \`json:"loadFile"\` }
func main() {
 var inputs []Input
 if err:=json.NewDecoder(os.Stdin).Decode(&inputs); err!=nil { panic(err) }
 results:=make([]Output,0,len(inputs))
 for _,input:=range inputs {
  reference:=findMeshConfigFile(input.Container,input.Volumes,input.Path)
  cp:=ControlPlane{ID:"local",Cluster:Cluster{Name:"local"},MeshConfigFile:reference}
  results=append(results,Output{reference,shouldLoadMeshConfigFile(&cp,input.StandardName)})
 }
 if err:=json.NewEncoder(os.Stdout).Encode(results); err!=nil { panic(err) }
}
`
  );
  output = JSON.parse(
    execFileSync('go', ['run', 'main.go'], {
      cwd: directory,
      input: JSON.stringify(cases.map(test => test.input)),
      encoding: 'utf8',
      env: {
        ...process.env,
        GO111MODULE: 'off',
        GOPROXY: 'off',
        GOTOOLCHAIN: 'local',
        GOTMPDIR: join(directory, 'build'),
        TMPDIR: join(directory, 'build'),
      },
      maxBuffer: 8 * 1024 * 1024,
    })
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}
assert.equal(output.length, cases.length);
const artifact = {
  version: 'v2.33.0',
  commit,
  sources,
  helpers: names,
  scope:
    'Original-Go path/reference and same-context shouldLoad helpers only; argument parsing, transport and merge are not covered.',
  cases: cases.map((test, index) => ({ ...test, expected: output[index] })),
};
const artifactPath = 'test-files/parity/mesh-config-source-oracle.json';
const serialized = JSON.stringify(artifact, null, 2) + '\n';
if (values.check)
  assert.equal(await readFile(artifactPath, 'utf8'), serialized, 'Mesh source oracle drift');
else await writeFile(artifactPath, serialized);
console.log(
  `Verified ${cases.length} original-Go mesh source cases (${
    cases.filter(test => test.nativeGuard).length
  } explicitly stricter native guards)`
);
