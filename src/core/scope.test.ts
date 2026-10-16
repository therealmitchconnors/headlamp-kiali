import { clusterScope, resourceKey } from './scope';

describe('explicit cluster identity', () => {
  it('does not infer a cluster or mutate kubeconfig', () => {
    expect(() => clusterScope('')).toThrow('A cluster must be selected');
    expect(() => clusterScope('  ')).toThrow();
    expect(clusterScope('team / east')).toEqual({ cluster: 'team / east' });
    expect(Object.isFrozen(clusterScope('alpha'))).toBe(true);
  });

  it('includes cluster, group, kind, namespace, name and UID without delimiter collisions', () => {
    const resource = { cluster: 'a:b', group: '', kind: 'Service', namespace: 'c', name: 'api' };
    const variants = [
      resource,
      { ...resource, cluster: 'a', namespace: 'b:c' },
      { ...resource, cluster: 'other' },
      { ...resource, group: 'networking.istio.io' },
      { ...resource, kind: 'Gateway' },
      { ...resource, namespace: 'other' },
      { ...resource, name: 'other' },
      { ...resource, uid: 'replacement' },
    ];
    expect(new Set(variants.map(resourceKey)).size).toBe(variants.length);
  });
});
