import oracleText from '../../test-files/parity/health-oracle.json?raw';
import {
  directionalRequestRate,
  healthStatusPriority,
  mergeHealthStatus,
  RequestHealth,
  simpleRequestErrorRatio,
  totalRequestRate,
  WorkloadStatus,
  workloadStatusHealth,
} from './health';

interface HealthOracle {
  commit: string;
  priorities: { input: string; expected: number }[];
  merges: { first: string; second: string; expected: string }[];
  workloads: { input: WorkloadStatus | null; expected: string }[];
  requests: {
    input: RequestHealth;
    expected: { errorRatio: number; inbound: number; outbound: number; total: number };
  }[];
}

const oracle: HealthOracle = JSON.parse(oracleText);

describe('Kiali v2.33.0 health primitives against the upstream Go oracle', () => {
  it('uses the pinned independent fixture corpus', () => {
    expect(oracle.commit).toBe('0e8be887b8217bbcac5e3ae0bfcd258073949cca');
    expect(oracle.priorities).toHaveLength(6);
    expect(oracle.merges).toHaveLength(36);
    expect(oracle.workloads).toHaveLength(321);
    expect(oracle.requests).toHaveLength(12);
  });

  it.each(oracle.priorities)('preserves priority for $input', ({ input, expected }) => {
    expect(healthStatusPriority(input)).toBe(expected);
  });

  it.each(oracle.merges)('merges $first with $second', ({ first, second, expected }) => {
    expect(mergeHealthStatus(first, second)).toBe(expected);
  });

  it.each(oracle.workloads)('preserves replica and proxy state %#', ({ input, expected }) => {
    expect(workloadStatusHealth(input)).toBe(expected);
  });

  it.each(oracle.requests)('preserves request aggregation %#', ({ input, expected }) => {
    expect(simpleRequestErrorRatio(input)).toBeCloseTo(expected.errorRatio, 12);
    expect(directionalRequestRate(input.inbound)).toBeCloseTo(expected.inbound, 12);
    expect(directionalRequestRate(input.outbound)).toBeCloseTo(expected.outbound, 12);
    expect(totalRequestRate(input)).toBeCloseTo(expected.total, 12);
  });

  it('does not treat unavailable workload status as zero replicas', () => {
    expect(workloadStatusHealth(null)).toBe('NA');
    expect(
      workloadStatusHealth({
        desiredReplicas: 0,
        currentReplicas: 0,
        availableReplicas: 0,
        syncedProxies: -1,
      })
    ).toBe('Not Ready');
  });

  it('does not mistake the simple fallback for protocol-aware gRPC health', () => {
    expect(simpleRequestErrorRatio({ inbound: { grpc: { '14': 1 } } })).toBe(0);
  });
});
