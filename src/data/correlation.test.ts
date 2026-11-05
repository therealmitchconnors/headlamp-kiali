import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import { namespaceScope } from '../core/scope';
import {
  CORRELATION_SOURCES,
  CorrelationSource,
  decodeCorrelationResource,
  DEPLOYMENT_CONFIG_ACCOUNT_SOURCE,
  loadCorrelationSnapshot,
  readCorrelationSource,
} from './correlation';

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  ApiProxy: { request: vi.fn() },
  K8s: { cluster: { KubeObject: class {} } },
}));

const scope = namespaceScope('alpha', 'bookinfo');
const source = (kind: string) =>
  CORRELATION_SOURCES.find(source => source.kind === kind) ??
  (kind === 'DeploymentConfig' ? DEPLOYMENT_CONFIG_ACCOUNT_SOURCE : undefined)!;

function object(
  kind: string,
  name = 'one',
  labels: Record<string, string> = { app: 'metadata-app' }
) {
  return {
    kind,
    apiVersion: source(kind).apiVersion,
    metadata: {
      name,
      namespace: 'bookinfo',
      uid: `${kind}-${name}`,
      labels,
    },
    spec: { template: { metadata: { labels: { app: 'template-app' } } } },
  };
}

function list(source: CorrelationSource, items: unknown[] = [], continuation = '', version = '17') {
  return {
    kind: `${source.kind}List`,
    apiVersion: source.apiVersion,
    metadata: { resourceVersion: version, continue: continuation },
    items,
  };
}

beforeEach(() => {
  vi.mocked(ApiProxy.request).mockReset();
});

describe('normalized correlation resources', () => {
  it('keeps dashboard annotation errors local to Pod evidence without losing the resource', () => {
    const raw = {
      ...object('Pod'),
      metadata: {
        ...object('Pod').metadata,
        annotations: { 'kiali.io/runtimes': 'go', 'kiali.io/dashboards': 42 },
      },
      spec: { containers: [{ name: 'app' }] },
    };
    const resource = decodeCorrelationResource(raw, source('Pod'), scope);
    expect(resource.identity.name).toBe('one');
    expect(resource.dashboardRefs).toMatchObject({ ok: false });
    expect(
      decodeCorrelationResource(
        { ...raw, metadata: { ...raw.metadata, annotations: {} } },
        source('Pod'),
        scope
      ).dashboardRefs
    ).toEqual({ ok: true, refs: [], bytes: 0 });
  });
  it('captures account names only from the actual Pod spec without defaulting missing or malformed names', () => {
    const raw = {
      ...object('Pod'),
      spec: { containers: [{ name: 'app' }], serviceAccountName: 'observed-account' },
    };
    const resource = decodeCorrelationResource(raw, source('Pod'), scope);
    raw.spec.serviceAccountName = 'changed';
    expect(resource.podAccount).toEqual({ ok: true, name: 'observed-account' });
    expect(
      decodeCorrelationResource(
        { ...raw, spec: { containers: [{ name: 'app' }] } },
        source('Pod'),
        scope
      ).podAccount
    ).toMatchObject({ ok: false, message: expect.stringContaining('no default') });
    expect(
      decodeCorrelationResource(
        { ...raw, spec: { containers: [{ name: 'app' }], serviceAccountName: 1 } },
        source('Pod'),
        scope
      ).podAccount
    ).toMatchObject({ ok: false, message: expect.stringContaining('malformed') });
    expect(
      decodeCorrelationResource(object('Deployment'), source('Deployment'), scope).podAccount
    ).toBeUndefined();
  });
  it('fills kind identity from the list contract when item TypeMeta is omitted', () => {
    const item = object('Deployment');
    const decoded = decodeCorrelationResource(
      { metadata: item.metadata, spec: item.spec },
      source('Deployment'),
      scope
    );
    expect(decoded.identity.kind).toBe('Deployment');
    expect(decoded.identity.group).toBe('apps');
  });
  it('uses pod-template labels for Deployments but metadata labels for Jobs and CronJobs', () => {
    expect(
      decodeCorrelationResource(object('Deployment'), source('Deployment'), scope).workloadLabels
    ).toEqual({ app: 'template-app' });
    for (const kind of ['Job', 'CronJob']) {
      expect(decodeCorrelationResource(object(kind), source(kind), scope).workloadLabels).toEqual({
        app: 'metadata-app',
      });
    }
  });

  it('does not fall back to controller metadata when template labels are absent', () => {
    const input = { ...object('Deployment'), spec: { template: { metadata: {} } } };
    expect(decodeCorrelationResource(input, source('Deployment'), scope).workloadLabels).toEqual(
      {}
    );
  });

  it('preserves a valid ReplicationController with no pod template as unlabelled', () => {
    expect(
      decodeCorrelationResource(
        { ...object('ReplicationController'), spec: {} },
        source('ReplicationController'),
        scope
      ).workloadLabels
    ).toEqual({});
  });

  it.each([
    [{ containers: [{ name: 'app' }, { name: 'istio-proxy' }] }, 'sidecar'],
    [
      {
        containers: [{ name: 'app' }],
        initContainers: [{ name: 'istio-proxy', restartPolicy: 'Always' }],
      },
      'native-sidecar',
    ],
    [{ containers: [{ name: 'app' }], initContainers: [{ name: 'istio-proxy' }] }, 'none'],
  ])('distinguishes live proxy container forms %j', (spec, expected) => {
    expect(
      decodeCorrelationResource({ ...object('Pod'), spec }, source('Pod'), scope).proxyMode
    ).toBe(expected);
  });

  it('rejects missing pod data instead of reporting no proxy', () => {
    expect(() =>
      decodeCorrelationResource({ ...object('Pod'), spec: {} }, source('Pod'), scope)
    ).toThrow('Missing pod containers');
  });

  it('rejects wrong scope, kind, malformed labels and missing UID', () => {
    const valid = object('Deployment');
    for (const input of [
      { ...valid, kind: 'Service' },
      { ...valid, metadata: { ...valid.metadata, namespace: 'other' } },
      { ...valid, metadata: { ...valid.metadata, uid: '' } },
      { ...valid, metadata: { ...valid.metadata, labels: { app: 42 } } },
    ]) {
      expect(() => decodeCorrelationResource(input, source('Deployment'), scope)).toThrow();
    }
  });

  it('accepts 256 bounded labels and rejects oversized maps and owner lists', () => {
    const labels = Object.fromEntries(
      Array.from({ length: 256 }, (_, index) => [`label-${index}`, 'value'])
    );
    expect(
      decodeCorrelationResource(object('Job', 'bounded', labels), source('Job'), scope).labels
    ).toEqual(labels);
    expect(
      decodeCorrelationResource(
        object('Job', 'bounded-text', { label: 'x'.repeat(1024) }),
        source('Job'),
        scope
      ).labels.label
    ).toHaveLength(1024);
    expect(() =>
      decodeCorrelationResource(
        object('Job', 'oversized', { ...labels, extra: 'value' }),
        source('Job'),
        scope
      )
    ).toThrow('256 entries');
    expect(() =>
      decodeCorrelationResource(
        object('Job', 'long-value', { label: 'x'.repeat(1025) }),
        source('Job'),
        scope
      )
    ).toThrow('bounded strings');
    const ownerReferences = Array.from({ length: 20 }, (_, index) => ({
      apiVersion: 'apps/v1',
      kind: 'Deployment',
      name: `owner-${index}`,
      uid: `owner-${index}`,
    }));
    const valid = {
      ...object('ReplicaSet'),
      metadata: { ...object('ReplicaSet').metadata, ownerReferences },
    };
    expect(decodeCorrelationResource(valid, source('ReplicaSet'), scope).owners).toHaveLength(20);
    expect(() =>
      decodeCorrelationResource(
        {
          ...valid,
          metadata: {
            ...valid.metadata,
            ownerReferences: [...ownerReferences, ownerReferences[0]],
          },
        },
        source('ReplicaSet'),
        scope
      )
    ).toThrow('20 entries');
  });

  it('retains owner UID, group, kind and controller flag', () => {
    const input = {
      ...object('ReplicaSet'),
      metadata: {
        ...object('ReplicaSet').metadata,
        ownerReferences: [
          {
            apiVersion: 'apps/v1beta1',
            kind: 'Deployment',
            name: 'owner',
            uid: 'owner-id',
            controller: true,
          },
        ],
      },
    };
    expect(decodeCorrelationResource(input, source('ReplicaSet'), scope).owners).toEqual([
      {
        apiVersion: 'apps/v1beta1',
        group: 'apps',
        kind: 'Deployment',
        name: 'owner',
        uid: 'owner-id',
        controller: true,
      },
    ]);
  });
});

describe('bounded, partial-aware snapshot reads', () => {
  it('follows opaque continuation tokens while keeping the cluster and namespace fixed', async () => {
    const deployment = source('Deployment');
    vi.mocked(ApiProxy.request)
      .mockResolvedValueOnce(list(deployment, [object('Deployment', 'first')], 'a/b='))
      .mockResolvedValueOnce(list(deployment, [object('Deployment', 'second')]));
    const signal = new AbortController().signal;
    const result = await readCorrelationSource(scope, deployment, signal);
    expect(result.complete).toBe(true);
    expect(result.resources).toHaveLength(2);
    expect(ApiProxy.request).toHaveBeenNthCalledWith(
      2,
      '/apis/apps/v1/namespaces/bookinfo/deployments?limit=250&continue=a%2Fb%3D',
      { cluster: 'alpha', signal, autoLogoutOnAuthError: false },
      false
    );
  });

  it('marks a capped result incomplete rather than claiming all records were read', async () => {
    const deployment = source('Deployment');
    let page = 0;
    vi.mocked(ApiProxy.request).mockImplementation(async () => {
      page++;
      return list(deployment, [object('Deployment', `item-${page}`)], `next-${page}`);
    });
    const result = await readCorrelationSource(scope, deployment, new AbortController().signal);
    expect(ApiProxy.request).toHaveBeenCalledTimes(4);
    expect(result.complete).toBe(false);
    expect(result.limited).toBe(true);
    expect(result.resources).toHaveLength(4);
  });

  it('allows exactly 20000 source labels and fails incomplete on the next label', async () => {
    const job = source('Job');
    const exact = [
      ...Array.from({ length: 78 }, (_, index) =>
        object(
          'Job',
          `exact-${index}`,
          Object.fromEntries(Array.from({ length: 256 }, (_, label) => [`label-${label}`, 'v']))
        )
      ),
      object(
        'Job',
        'exact-final',
        Object.fromEntries(Array.from({ length: 32 }, (_, i) => [`l${i}`, 'v']))
      ),
    ];
    vi.mocked(ApiProxy.request)
      .mockResolvedValueOnce(list(job, exact))
      .mockResolvedValueOnce(
        list(job, [
          ...exact.slice(0, -1),
          object(
            'Job',
            'over-limit',
            Object.fromEntries(Array.from({ length: 33 }, (_, i) => [`l${i}`, 'v']))
          ),
        ])
      );
    const accepted = await readCorrelationSource(scope, job, new AbortController().signal);
    expect(accepted.complete).toBe(true);
    expect(accepted.resources).toHaveLength(79);
    const rejected = await readCorrelationSource(scope, job, new AbortController().signal);
    expect(rejected.complete).toBe(false);
    expect(rejected.resources).toHaveLength(0);
    expect(rejected.error?.message).toContain('20000 labels');
  });

  it('allows exactly one million label-text characters and rejects additional text', async () => {
    const job = source('Job');
    const items = Array.from({ length: 978 }, (_, index) =>
      object('Job', `label-${index}`, {
        k: 'x'.repeat(index < 976 ? 1023 : index === 976 ? 575 : 0),
      })
    );
    const pages = (values: unknown[]) => {
      const result = [];
      for (let start = 0; start < values.length; start += 250)
        result.push(values.slice(start, start + 250));
      return result;
    };
    const read = async (values: unknown[]) => {
      const pending = pages(values);
      vi.mocked(ApiProxy.request).mockReset();
      vi.mocked(ApiProxy.request).mockImplementation(async () => {
        const page = pending.shift()!;
        return list(job, page, pending.length ? `next-${pending.length}` : '');
      });
      return readCorrelationSource(scope, job, new AbortController().signal);
    };
    const accepted = await read(items.slice(0, 977));
    expect(accepted.complete).toBe(true);
    expect(accepted.resources).toHaveLength(977);
    const rejected = await read(items);
    expect(rejected.complete).toBe(false);
    expect(rejected.error?.message).toContain('1000000 label-text characters');
  });

  it('retains earlier pages with explicit failure when subsequent access fails', async () => {
    const deployment = source('Deployment');
    vi.mocked(ApiProxy.request)
      .mockResolvedValueOnce(list(deployment, [object('Deployment')], 'next'))
      .mockRejectedValueOnce(Object.assign(new Error('Forbidden'), { status: 403 }));
    const result = await readCorrelationSource(scope, deployment, new AbortController().signal);
    expect(result.complete).toBe(false);
    expect(result.resources).toHaveLength(1);
    expect(result.error?.kind).toBe('forbidden');
  });

  it.each(['version', 'token'])('rejects inconsistent pagination: %s', failure => {
    const deployment = source('Deployment');
    vi.mocked(ApiProxy.request)
      .mockResolvedValueOnce(list(deployment, [object('Deployment')], 'next'))
      .mockResolvedValueOnce(
        list(
          deployment,
          [object('Deployment', 'second')],
          failure === 'token' ? 'next' : '',
          failure === 'version' ? '18' : '17'
        )
      );
    return readCorrelationSource(scope, deployment, new AbortController().signal).then(result => {
      expect(result.complete).toBe(false);
      expect(result.resources).toHaveLength(1);
      expect(result.error?.kind).toBe('invalid-response');
    });
  });

  it('collects independent kinds despite a denied Service list and bounds concurrency', async () => {
    let active = 0;
    let maximum = 0;
    vi.mocked(ApiProxy.request).mockImplementation(async path => {
      active++;
      maximum = Math.max(maximum, active);
      if (path === '/apis/networking.istio.io') {
        active--;
        throw { status: 404, message: 'Not installed' };
      }
      const entry = CORRELATION_SOURCES.find(source =>
        String(path).includes(`/${source.plural}?`)
      )!;
      await new Promise(resolve => setTimeout(resolve, 1));
      active--;
      if (entry.kind === 'Service') throw Object.assign(new Error('Forbidden'), { status: 403 });
      return list(entry);
    });
    const result = await loadCorrelationSnapshot(scope, new AbortController().signal);
    expect(maximum).toBeLessThanOrEqual(3);
    expect(result.sources).toHaveLength(10);
    expect(result.sources.filter(source => source.complete)).toHaveLength(9);
    expect(result.sources.find(source => source.source.kind === 'WorkloadGroup')?.notServed).toBe(
      true
    );
    expect(result.complete).toBe(false);
    expect(result.sources.find(source => source.source.kind === 'Service')?.error?.kind).toBe(
      'forbidden'
    );
  });

  it('captures DeploymentConfigs only for the separate account source without changing application resources', async () => {
    vi.mocked(ApiProxy.request).mockImplementation(async path => {
      if (path === '/apis/networking.istio.io') throw { status: 404 };
      if (path === '/apis/apps.openshift.io')
        return {
          name: 'apps.openshift.io',
          versions: [{ groupVersion: 'apps.openshift.io/v1' }],
        };
      if (path === '/apis/apps.openshift.io/v1')
        return {
          groupVersion: 'apps.openshift.io/v1',
          resources: [{ name: 'deploymentconfigs', kind: 'DeploymentConfig', namespaced: true }],
        };
      if (String(path).includes('/deploymentconfigs?'))
        return list(DEPLOYMENT_CONFIG_ACCOUNT_SOURCE, [object('DeploymentConfig', 'reviews-dc')]);
      const current = CORRELATION_SOURCES.find(source =>
        String(path).includes(`/${source.plural}?`)
      )!;
      return list(current);
    });
    const result = await loadCorrelationSnapshot(scope, new AbortController().signal, true);
    expect(result.complete).toBe(true);
    expect(result.sources).toHaveLength(10);
    expect(result.resources.some(resource => resource.identity.kind === 'DeploymentConfig')).toBe(
      false
    );
    expect(result.accountSources?.[0]).toMatchObject({
      source: DEPLOYMENT_CONFIG_ACCOUNT_SOURCE,
      complete: true,
      resourceVersion: '17',
      resources: [{ identity: { kind: 'DeploymentConfig', name: 'reviews-dc' } }],
    });
  });

  it('keeps DeploymentConfig denial local to the account projection and confirms absent APIs', async () => {
    vi.mocked(ApiProxy.request).mockImplementation(async path => {
      if (path === '/apis/networking.istio.io' || path === '/apis/apps.openshift.io')
        throw { status: 404 };
      const current = CORRELATION_SOURCES.find(source =>
        String(path).includes(`/${source.plural}?`)
      )!;
      return list(current);
    });
    const absent = await loadCorrelationSnapshot(scope, new AbortController().signal, true);
    expect(absent.complete).toBe(true);
    expect(absent.accountSources?.[0]).toMatchObject({ complete: true, notServed: true });

    vi.mocked(ApiProxy.request).mockImplementation(async path => {
      if (path === '/apis/networking.istio.io') throw { status: 404 };
      if (path === '/apis/apps.openshift.io') throw { status: 403, message: 'denied' };
      const current = CORRELATION_SOURCES.find(source =>
        String(path).includes(`/${source.plural}?`)
      )!;
      return list(current);
    });
    const denied = await loadCorrelationSnapshot(scope, new AbortController().signal, true);
    expect(denied.complete).toBe(true);
    expect(denied.accountSources?.[0]).toMatchObject({
      complete: false,
      error: { kind: 'forbidden' },
    });
  });

  it('keeps a timed-out optional DeploymentConfig source from rejecting application correlation', async () => {
    vi.useFakeTimers();
    try {
      let accountSignal: AbortSignal | undefined;
      vi.mocked(ApiProxy.request).mockImplementation((path, options) => {
        if (path === '/apis/networking.istio.io') return Promise.reject({ status: 404 });
        if (path === '/apis/apps.openshift.io') {
          accountSignal = options?.signal;
          return new Promise((_resolve, reject) => {
            accountSignal?.addEventListener('abort', () => reject(new Error('cancelled')), {
              once: true,
            });
          });
        }
        const current = CORRELATION_SOURCES.find(source =>
          String(path).includes(`/${source.plural}?`)
        )!;
        return Promise.resolve(list(current));
      });
      const pending = loadCorrelationSnapshot(scope, new AbortController().signal, true);
      for (let attempt = 0; attempt < 20 && !accountSignal; attempt++) await Promise.resolve();
      expect(accountSignal).toBeDefined();
      await vi.advanceTimersByTimeAsync(5000);
      const result = await pending;
      expect(result.complete).toBe(true);
      expect(result.accountSources?.[0]).toMatchObject({
        complete: false,
        error: {
          kind: 'unavailable',
          message: 'DeploymentConfig account source exceeded 5 seconds',
        },
      });
      expect(accountSignal?.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each(['denied', 'truncated', 'malformed', 'stale'])(
    'keeps %s DeploymentConfig account-source evidence unavailable',
    async mode => {
      let page = 0;
      vi.mocked(ApiProxy.request).mockImplementation(async path => {
        if (path === '/apis/networking.istio.io') throw { status: 404 };
        if (path === '/apis/apps.openshift.io')
          return {
            name: 'apps.openshift.io',
            versions: [{ groupVersion: 'apps.openshift.io/v1' }],
          };
        if (path === '/apis/apps.openshift.io/v1')
          return {
            groupVersion: 'apps.openshift.io/v1',
            resources: [{ name: 'deploymentconfigs', kind: 'DeploymentConfig', namespaced: true }],
          };
        if (String(path).includes('/deploymentconfigs?')) {
          if (mode === 'denied') throw { status: 403, message: 'denied' };
          if (mode === 'malformed') return { kind: 'NotADeploymentConfigList' };
          page++;
          return list(
            DEPLOYMENT_CONFIG_ACCOUNT_SOURCE,
            [object('DeploymentConfig', `dc-${page}`)],
            mode === 'truncated' || (mode === 'stale' && page === 1) ? `next-${page}` : '',
            mode === 'stale' && page > 1 ? '18' : '17'
          );
        }
        const current = CORRELATION_SOURCES.find(source =>
          String(path).includes(`/${source.plural}?`)
        )!;
        return list(current);
      });
      const result = await loadCorrelationSnapshot(scope, new AbortController().signal, true);
      const accountSource = result.accountSources?.[0];
      expect(result.complete).toBe(true);
      expect(accountSource?.complete).toBe(false);
      if (mode === 'denied') expect(accountSource?.error?.kind).toBe('forbidden');
      if (mode === 'malformed') expect(accountSource?.error?.kind).toBe('invalid-response');
      if (mode === 'truncated') expect(accountSource?.limited).toBe(true);
      if (mode === 'stale') expect(accountSource?.error?.message).toContain('version changed');
    }
  );

  it('cancels the optional account source with its captured namespace', async () => {
    const controller = new AbortController();
    let accountSignal: AbortSignal | undefined;
    vi.mocked(ApiProxy.request).mockImplementation((path, options) => {
      if (path === '/apis/networking.istio.io') return Promise.reject({ status: 404 });
      if (path === '/apis/apps.openshift.io') {
        accountSignal = options?.signal ?? undefined;
        return new Promise((_resolve, reject) => {
          accountSignal?.addEventListener('abort', () => reject(new Error('cancelled')), {
            once: true,
          });
        });
      }
      const current = CORRELATION_SOURCES.find(source =>
        String(path).includes(`/${source.plural}?`)
      )!;
      return Promise.resolve(list(current));
    });
    const pending = loadCorrelationSnapshot(scope, controller.signal, true);
    await vi.waitFor(() => expect(accountSignal).toBeDefined());
    controller.abort();
    await expect(pending).rejects.toThrow();
    expect(accountSignal?.aborted).toBe(true);
  });

  it('stops scheduling further reads after cancellation', async () => {
    const controller = new AbortController();
    const lateResponses: ((value: unknown) => void)[] = [];
    vi.mocked(ApiProxy.request).mockImplementation(
      (_path, params) =>
        new Promise((resolve, reject) => {
          const signal = params?.signal;
          if (!signal) throw new Error('Missing request signal');
          signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true });
          lateResponses.push(resolve);
        })
    );
    const result = loadCorrelationSnapshot(scope, controller.signal);
    await vi.waitFor(() => expect(ApiProxy.request).toHaveBeenCalledTimes(3));
    controller.abort();
    await expect(result).rejects.toThrow();
    lateResponses.forEach(resolve => resolve({}));
    expect(ApiProxy.request).toHaveBeenCalledTimes(3);
  });
});
