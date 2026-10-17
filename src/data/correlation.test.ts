import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import { namespaceScope } from '../core/scope';
import {
  CORRELATION_SOURCES,
  CorrelationSource,
  decodeCorrelationResource,
  loadCorrelationSnapshot,
  readCorrelationSource,
} from './correlation';

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({ ApiProxy: { request: vi.fn() } }));

const scope = namespaceScope('alpha', 'bookinfo');
const source = (kind: string) => CORRELATION_SOURCES.find(source => source.kind === kind)!;

function object(kind: string, name = 'one') {
  return {
    kind,
    apiVersion: source(kind).apiVersion,
    metadata: {
      name,
      namespace: 'bookinfo',
      uid: `${kind}-${name}`,
      labels: { app: 'metadata-app' },
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
      { group: 'apps', kind: 'Deployment', name: 'owner', uid: 'owner-id', controller: true },
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
    expect(result.sources).toHaveLength(9);
    expect(result.sources.filter(source => source.complete)).toHaveLength(8);
    expect(result.complete).toBe(false);
    expect(result.sources.find(source => source.source.kind === 'Service')?.error?.kind).toBe(
      'forbidden'
    );
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
    controller.abort();
    await expect(result).rejects.toThrow();
    lateResponses.forEach(resolve => resolve({}));
    expect(ApiProxy.request).toHaveBeenCalledTimes(3);
  });
});
