import fixtureText from '../../test-files/parity/mesh-config-source-oracle.json?raw';
import { MeshConfigSource, resolveMeshConfigSource } from './meshConfigSource';

const fixture = JSON.parse(fixtureText) as {
  cases: {
    label: string;
    input: {
      path: string;
      container: Record<string, unknown>;
      volumes: unknown[];
      standardName: string;
    };
    nativeGuard?: string;
    expected: { reference: Omit<MeshConfigSource, 'kind'> | null; loadFile: boolean };
  }[];
  argumentCases: {
    label: string;
    args: string[];
    nativeGuard?: string;
    expected: { mesh: string; networks: string };
  }[];
};
it.each(fixture.cases)(
  'checks original Go mesh source: $label %#',
  ({ input, expected, nativeGuard }) => {
    const result = resolveMeshConfigSource(
      { ...input.container, args: ['discovery', '--meshConfig', input.path] },
      input.volumes,
      input.standardName
    );

    if (nativeGuard) {
      expect(result.blocked, nativeGuard).toBe(true);
      expect(result.source, nativeGuard).toBeUndefined();
      return;
    }
    expect(result.blocked).toBe(false);
    expect(result.warnings).toEqual([]);
    expect(result.source).toEqual(
      expected.reference
        ? { ...expected.reference, kind: expected.loadFile ? 'mounted' : 'standard' }
        : { kind: 'standard', name: input.standardName, key: 'mesh' }
    );
  }
);

it.each(fixture.argumentCases)(
  'checks original Go argument parser: $label %#',
  ({ args, expected, nativeGuard }) => {
    const result = resolveMeshConfigSource(
      {
        args,
        volumeMounts: [
          { name: 'mesh', mountPath: expected.mesh, subPath: 'mesh' },
          { name: 'networks', mountPath: expected.networks, subPath: 'networks' },
        ],
      },
      [
        { name: 'mesh', configMap: { name: 'custom-mesh' } },
        { name: 'networks', configMap: { name: 'custom-networks' } },
      ],
      'istio-blue'
    );
    if (nativeGuard) {
      expect(result.blocked, nativeGuard).toBe(true);
      return;
    }
    expect(result).toEqual({
      source: { kind: 'mounted', name: 'custom-mesh', key: 'mesh', path: expected.mesh },
      networksSource: { name: 'custom-networks', key: 'networks', path: expected.networks },
      blocked: false,
      warnings: [],
    });
  }
);
