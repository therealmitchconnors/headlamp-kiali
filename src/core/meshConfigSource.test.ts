import { resolveMeshConfigSource } from './meshConfigSource';

const path = '/etc/istio/config/mesh';
const mount = { name: 'mesh-volume', mountPath: '/etc/istio/config' };
const volume = { name: 'mesh-volume', configMap: { name: 'custom' } };
const resolve = (container: Record<string, unknown> = {}, volumes: unknown = undefined) =>
  resolveMeshConfigSource(container, volumes, 'istio-blue');
const mounted = (mounts: unknown = [mount], volumes: unknown = [volume], args?: unknown) =>
  resolve({ volumeMounts: mounts, args }, volumes);
const expectBlocked = (result: ReturnType<typeof resolve>) => {
  expect(result.blocked).toBe(true);
  expect(result.source).toBeUndefined();
  expect(result.warnings.length).toBeGreaterThan(0);
};

it('uses the conventional source only for the unresolved default path, without inventing a mount', () => {
  expect(resolve()).toEqual({
    source: { kind: 'standard', name: 'istio-blue', key: 'mesh' },
    blocked: false,
    warnings: [],
  });
  expectBlocked(resolve({ args: ['--meshConfig=/custom/mesh'] }));
});

it.each([undefined, null, []].map(value => ({ value })))(
  'distinguishes absent/null/empty list evidence from malformed arrays %#',
  ({ value }) => {
    expect(resolve({ args: value, volumeMounts: value, envFrom: value }, value).blocked).toBe(
      false
    );
  }
);

it.each(['broken', {}, 4, [null], [{}], Array(1001).fill('')].map(value => ({ value })))(
  'blocks malformed or oversized argument/mount/volume evidence %#',
  ({ value }) => {
    expectBlocked(resolve({ args: value }));
    expectBlocked(resolve({ volumeMounts: value }));
    expectBlocked(resolve({}, value));
  }
);

it.each([undefined, null, []].map(items => ({ items })))(
  'accepts omitted or empty items as all-keys projections %#',
  ({ items }) => {
    expect(mounted([mount], [{ ...volume, configMap: { ...volume.configMap, items } }])).toEqual({
      source: { kind: 'mounted', name: 'custom', key: 'mesh', path },
      networksSource: {
        name: 'custom',
        key: 'meshNetworks',
        path: '/etc/istio/config/meshNetworks',
      },
      blocked: false,
      warnings: [],
    });
  }
);

it('recognizes a conventional name/key mount as equivalent to the standard source', () => {
  expect(mounted([mount], [{ ...volume, configMap: { name: 'istio-blue' } }]).source).toEqual({
    kind: 'standard',
    name: 'istio-blue',
    key: 'mesh',
    path,
  });
  expect(
    mounted(
      [{ ...mount, mountPath: '/alternate' }],
      [{ ...volume, configMap: { name: 'istio-blue' } }],
      ['--meshConfig=/alternate/mesh']
    ).source
  ).toEqual({ kind: 'standard', name: 'istio-blue', key: 'mesh', path: '/alternate/mesh' });
  expect(
    mounted(
      [mount],
      [{ ...volume, configMap: { name: 'istio-blue', items: [{ key: 'other', path: 'mesh' }] } }]
    ).source?.kind
  ).toBe('mounted');
});

it.each(
  [
    ['discovery', '--meshConfig', '/etc/istio/config/mesh'],
    ['discovery', '--meshConfig=/etc/istio/config/mesh'],
    ['--meshConfig=/discarded', '--meshConfig', path],
    ['--unknown', 'discarded', '--meshConfig', path],
    ['--unknown=', '--meshConfig', path],
    ['--unknown', '--meshConfig', path],
    ['-x', 'discarded', '--meshConfig', path],
    ['-xy', 'discarded', 'also-discarded', '--meshConfig', path],
    ['-x=value', '--meshConfig', path],
    ['--monitoringAddr', ':15014', '--networksConfigFile', '/other', '--meshConfig', path],
    ['--monitoringAddr=malformed', '--meshConfig', path],
    ['--meshConfigFile', '/not-the-registered-flag'],
    ['--meshConfigFile=/not-the-registered-flag'],
    ['discovery', '--', '--meshConfig=/ignored'],
    ['discovery', '-', '--meshConfig', path],
    ['--unknown', '', '--meshConfig', path],
  ].map(args => ({ args }))
)('follows pinned recognized and ignored argument consumption %#', ({ args }) => {
  expect(mounted([mount], [volume], args)).toMatchObject({
    source: { kind: 'mounted', name: 'custom', key: 'mesh', path },
    blocked: false,
    warnings: [],
  });
});

it('does not recognize meshConfigFile as a meshConfig alias', () => {
  expect(mounted([mount], [volume], ['--meshConfigFile=/elsewhere/mesh']).source?.path).toBe(path);
  expect(
    mounted([mount], [volume], ['--meshConfig=/elsewhere/mesh', '--meshConfigFile', path]).blocked
  ).toBe(true);
});

it.each(
  [
    ['--meshConfig'],
    ['--monitoringAddr'],
    ['--networksConfigFile'],
    ['--meshConfig='],
    ['--meshConfig', '--another-flag'],
    ['---meshConfig=/mesh'],
    ['--=value'],
    ['--help'],
    ['-h'],
    ['-xh'],
    ['--meshConfig=$(PATH)'],
    ['--meshConfig=${PATH}'],
    ['--unknown=$(PATH)'],
    ['--meshConfigFile=$(PATH)'],
    ['--', '$(PATH)'],
    [null],
    [1],
    ['--meshConfig=\u0000bad'],
  ].map(args => ({ args }))
)('blocks parse errors and unresolved arguments instead of choosing a fallback %#', ({ args }) => {
  expectBlocked(mounted([mount], [volume], args));
});

it('uses the longest covering mount regardless of declaration order', () => {
  const shorter = { name: 'shorter', mountPath: '/etc/istio' };
  const volumes = [
    {
      name: 'shorter',
      configMap: { name: 'shorter', items: [{ key: 'mesh', path: 'config/mesh' }] },
    },
    volume,
  ];
  for (const mounts of [
    [shorter, mount],
    [mount, shorter],
  ])
    expect(mounted(mounts, volumes).source?.name).toBe('custom');
});

it.each([
  { projected: { sources: [{ configMap: { name: 'masked' } }] } },
  { secret: { secretName: 'masked' } },
  { hostPath: { path: '/etc' } },
  { csi: { driver: 'fixture' } },
  { emptyDir: {} },
  { unknown: {} },
  { configMap: { name: 'masked' }, secret: { secretName: 'also' } },
])('does not fall through a masking unsupported volume to a shorter valid ConfigMap %#', source => {
  const shorter = { name: 'shorter', mountPath: '/etc/istio' };
  const volumes = [
    {
      name: 'shorter',
      configMap: { name: 'shorter', items: [{ key: 'mesh', path: 'config/mesh' }] },
    },
    { name: mount.name, ...source },
  ];
  for (const mounts of [
    [shorter, mount],
    [mount, shorter],
  ])
    expectBlocked(mounted(mounts, volumes));
});

it('ignores unrelated unsupported mounts, but not malformed mount identities or paths', () => {
  expect(
    mounted(
      [mount, { name: 'unrelated', mountPath: '/etc/istio/configuration' }],
      [volume, { name: 'unrelated', secret: { secretName: 'not-read' } }]
    ).blocked
  ).toBe(false);
  expectBlocked(mounted([mount, { name: 'unrelated' }], [volume]));
  expectBlocked(mounted([mount], [{ ...volume, configMap: { name: '../invalid' } }]));
});

it.each(
  [
    [mount, { ...mount, name: 'other' }],
    [mount, { ...mount, mountPath: '/etc//istio/config/' }],
  ].map(mounts => ({ mounts }))
)(
  'rejects equal/normalized duplicate covering mounts rather than first-wins ambiguity %#',
  ({ mounts }) => {
    expectBlocked(mounted(mounts, [volume, { name: 'other', configMap: { name: 'other' } }]));
  }
);

it('requires exactly one volume identity even when an earlier match is valid', () => {
  expectBlocked(mounted([mount], []));
  expectBlocked(mounted([mount], [volume, volume]));
});

it('maps projected relative paths to the first matching item key, not the basename or last key', () => {
  const items = [
    { path: 'elsewhere', key: 'ignored' },
    { path: './nested//mesh', key: 'first' },
    { path: 'nested/mesh', key: 'second' },
  ];
  expect(
    mounted(
      [mount],
      [{ ...volume, configMap: { name: 'custom', items } }],
      ['--meshConfig=/etc/istio/config/nested/mesh']
    ).source
  ).toEqual({
    kind: 'mounted',
    name: 'custom',
    key: 'first',
    path: '/etc/istio/config/nested/mesh',
  });
});

it('supports exact file mounts/subPath keys, including items remapping', () => {
  expect(mounted([{ ...mount, mountPath: path }]).source?.key).toBe('mesh');
  const file = { ...mount, mountPath: path, subPath: 'nested/settings.yaml' };
  expect(
    mounted(
      [file],
      [
        {
          ...volume,
          configMap: { name: 'custom', items: [{ key: 'values', path: 'nested/settings.yaml' }] },
        },
      ]
    ).source?.key
  ).toBe('values');
  expect(mounted([{ ...file, subPath: 'values' }]).source?.key).toBe('values');
});

it('maps root mounts through items without confusing prefix siblings', () => {
  expect(
    mounted(
      [{ ...mount, mountPath: '/' }],
      [
        {
          ...volume,
          configMap: { name: 'root', items: [{ key: 'mesh', path: 'etc/istio/config/mesh' }] },
        },
      ]
    ).source?.name
  ).toBe('root');
  expect(mounted([{ ...mount, mountPath: '/etc/istio/configuration' }]).source?.kind).toBe(
    'standard'
  );
});

it.each([{ subPath: 'nested' }, { subPath: {} }, { subPathExpr: '$(PATH)' }, { subPathExpr: {} }])(
  'blocks unsupported directory subPaths and unresolved expressions on masking mounts %#',
  fields => {
    expectBlocked(mounted([{ ...mount, ...fields }]));
  }
);

it.each(
  [
    'broken',
    {},
    [null],
    [{ path: 'mesh' }],
    [{ key: 'value' }],
    [{ path: 'other', key: 'value' }],
  ].map(items => ({ items }))
)('blocks malformed or nonmatching items rather than falling through %#', ({ items }) => {
  expectBlocked(mounted([mount], [{ ...volume, configMap: { name: 'custom', items } }]));
});

it.each([
  '',
  '/',
  'relative/mesh',
  '/a/../mesh',
  '/a/..mesh',
  '/mesh\\name',
  '/mesh\u0000',
  '$(PATH)',
])('rejects invalid mesh file paths rather than normalizing/falling back: %j', value =>
  expectBlocked(mounted([mount], [volume], [`--meshConfig=${value}`]))
);

it.each(['/absolute', '../mesh', 'dir/../mesh', 'dir\\mesh', '$(PATH)', '', '.'])(
  'rejects invalid item/subPath paths: %j',
  value => {
    expectBlocked(
      mounted(
        [mount],
        [{ ...volume, configMap: { name: 'custom', items: [{ key: 'mesh', path: value }] } }]
      )
    );
    if (value !== '') expectBlocked(mounted([{ ...mount, mountPath: path, subPath: value }]));
  }
);

it.each(['', '../key', 'dir/key', 'bad key', '.', '..', 'x'.repeat(254)])(
  'rejects invalid API ConfigMap keys: %j',
  key =>
    expectBlocked(
      mounted(
        [mount],
        [{ ...volume, configMap: { name: 'custom', items: [{ key, path: 'mesh' }] } }]
      )
    )
);

it('normalizes safe absolute and source-supported ./ paths without changing the source key', () => {
  for (const file of ['/etc//istio/config/./mesh', './etc/istio/config/mesh'])
    expect(mounted([mount], [volume], ['--meshConfig', file]).source).toEqual({
      kind: 'mounted',
      name: 'custom',
      key: 'mesh',
      path,
    });
});

const networksPath = '/etc/istio/config/meshNetworks';
const networkMount = { name: 'networks', mountPath: '/etc/istio/config' };
const networkVolume = { name: 'networks', configMap: { name: 'network-config' } };
const withNetworks = (
  mounts: unknown[] = [networkMount],
  volumes: unknown[] = [networkVolume],
  args: string[] = []
) =>
  mounted(
    [{ ...mount, mountPath: '/custom/mesh' }, ...mounts],
    [volume, ...volumes],
    ['discovery', '--meshConfig=/custom/mesh', ...args]
  );

it('captures the default same-map networks dependency only for mounted mesh selection', () => {
  expect(mounted().networksSource).toEqual({
    name: 'custom',
    key: 'meshNetworks',
    path: networksPath,
  });
  expect(withNetworks()).toMatchObject({
    source: { name: 'custom', key: 'mesh', kind: 'mounted' },
    networksSource: { name: 'network-config', key: 'meshNetworks', path: networksPath },
    blocked: false,
  });
});

it('permits absent network mounts and absent item mapping without manufacturing a dependency', () => {
  for (const result of [
    withNetworks([], []),
    withNetworks([networkMount], [networkVolume], ['--networksConfigFile=/unmounted/file']),
    withNetworks(
      [networkMount],
      [
        {
          ...networkVolume,
          configMap: { name: 'network-config', items: [{ path: 'mesh', key: 'mesh' }] },
        },
      ]
    ),
  ]) {
    expect(result.blocked).toBe(false);
    expect(result.networksSource).toBeUndefined();
    expect(result.source?.kind).toBe('mounted');
  }
});

it.each([
  { args: ['--networksConfigFile', '/networks/nested/file'] },
  { args: ['--networksConfigFile=/networks/nested/file'] },
  { args: ['--networksConfigFile=/ignored', '--networksConfigFile=/networks/nested/file'] },
])('captures custom network paths and ordered first matching item keys %#', ({ args }) => {
  expect(
    withNetworks(
      [{ ...networkMount, mountPath: '/networks' }],
      [
        {
          ...networkVolume,
          configMap: {
            name: 'network-config',
            items: [
              { path: './nested//file', key: 'first' },
              { path: 'nested/file', key: 'second' },
            ],
          },
        },
      ],
      args
    ).networksSource
  ).toEqual({ name: 'network-config', key: 'first', path: '/networks/nested/file' });
});

it('supports exact network file subPaths including items mapping', () => {
  expect(
    withNetworks(
      [{ ...networkMount, mountPath: networksPath, subPath: 'nested/networks.yaml' }],
      [
        {
          ...networkVolume,
          configMap: {
            name: 'network-config',
            items: [{ path: 'nested/networks.yaml', key: 'network-values' }],
          },
        },
      ]
    ).networksSource
  ).toEqual({ name: 'network-config', key: 'network-values', path: networksPath });
});

it.each([
  { secret: { secretName: 'not-read' } },
  { projected: { sources: [{ configMap: { name: 'not-read' } }] } },
  { csi: { driver: 'not-read' } },
  { hostPath: { path: '/not-read' } },
  { emptyDir: {} },
])(
  'blocks unsupported network mounts instead of falling through to a shorter source %#',
  source => {
    const result = withNetworks(
      [{ name: 'shorter', mountPath: '/etc/istio' }, networkMount],
      [
        {
          name: 'shorter',
          configMap: { name: 'shorter', items: [{ path: 'config/meshNetworks', key: 'networks' }] },
        },
        { name: networkMount.name, ...source },
      ]
    );
    expect(result.blocked).toBe(true);
    expect(result.source?.kind).toBe('mounted');
    expect(result.networksSource).toBeUndefined();
    expect(result.warnings[0]).toMatch(/networks dependency/);
  }
);

it('blocks ambiguous network mounts, missing volumes and unresolved expressions', () => {
  for (const result of [
    withNetworks([networkMount, { ...networkMount }]),
    withNetworks([networkMount], [networkVolume, networkVolume]),
    withNetworks([networkMount], []),
    withNetworks([{ ...networkMount, subPathExpr: '$(PATH)' }]),
    withNetworks([{ ...networkMount, subPath: 'directory' }]),
  ]) {
    expect(result.blocked).toBe(true);
    expect(result.networksSource).toBeUndefined();
    expect(result.warnings[0]).toMatch(/networks dependency/);
  }
});

it('does not interpret absent items on a longer network mount as permission to read a shorter source', () => {
  const result = withNetworks(
    [{ name: 'shorter', mountPath: '/etc/istio' }, networkMount],
    [
      {
        name: 'shorter',
        configMap: { name: 'shorter', items: [{ path: 'config/meshNetworks', key: 'networks' }] },
      },
      { ...networkVolume, configMap: { name: 'longer', items: [{ path: 'other', key: 'other' }] } },
    ]
  );
  expect(result.blocked).toBe(true);
  expect(result.networksSource).toBeUndefined();
});

it.each(['', '/', 'relative', '/bad/../path', '/file\u0000'])(
  'blocks invalid network paths only when the mounted-file pipeline needs them: %j',
  networkPath => {
    const args = [`--networksConfigFile=${networkPath}`];
    expect(withNetworks([], [], args).blocked).toBe(true);
    // Control characters are a general argument-shape guard, not path semantics.
    if (!networkPath.includes('\u0000'))
      expect(
        mounted([mount], [{ ...volume, configMap: { name: 'istio-blue' } }], args).blocked
      ).toBe(false);
  }
);

it('leaves the standard-config pipeline unchanged even when the network file mount is unsupported', () => {
  const result = mounted(
    [mount, { name: 'networks', mountPath: networksPath }],
    [
      { ...volume, configMap: { name: 'istio-blue' } },
      { name: 'networks', secret: { secretName: 'unread' } },
    ]
  );
  expect(result).toEqual({
    source: { kind: 'standard', name: 'istio-blue', key: 'mesh', path },
    blocked: false,
    warnings: [],
  });
  expect(result.networksSource).toBeUndefined();
});
