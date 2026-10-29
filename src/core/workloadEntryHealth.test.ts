import oracleText from '../../test-files/parity/workload-entry-health-oracle.json?raw';
import {
  readWorkloadEntryHealth,
  WORKLOAD_ENTRY_HEALTH_ANNOTATION,
  workloadEntryHealthEvidence,
} from './workloadEntryHealth';

const oracle: { cases: { input: { annotations: unknown; status: unknown }; expected: boolean }[] } =
  JSON.parse(oracleText);
it.each(oracle.cases)('matches original WorkloadEntry health helper %#', ({ input, expected }) => {
  expect(workloadEntryHealthEvidence(input.annotations, input.status).kialiAvailable).toBe(
    expected
  );
});
const enabled = { [WORKLOAD_ENTRY_HEALTH_ANNOTATION]: 'true' };
it('preserves first-condition order and separates reported status from assumptions', () => {
  const status = {
    conditions: [
      { type: 'Healthy', status: 'False' },
      { type: 'Healthy', status: 'True' },
    ],
  };
  expect(workloadEntryHealthEvidence(enabled, status)).toMatchObject({
    basis: 'condition',
    kialiAvailable: false,
    condition: { status: 'False' },
  });
  expect(workloadEntryHealthEvidence({}, status)).toMatchObject({
    basis: 'disabled-checks',
    kialiAvailable: true,
  });
  expect(
    workloadEntryHealthEvidence({ [WORKLOAD_ENTRY_HEALTH_ANNOTATION]: 'true ' }, status)
  ).toMatchObject({ basis: 'invalid-annotation', kialiAvailable: true });
  expect(workloadEntryHealthEvidence(enabled, {})).toMatchObject({
    basis: 'missing-condition',
    kialiAvailable: false,
  });
  expect(
    workloadEntryHealthEvidence(enabled, { conditions: [{ type: 'Healthy', status: 'Unknown' }] })
  ).toMatchObject({ basis: 'unknown-condition', kialiAvailable: false });
});
it('retains the first reported condition evidence without asserting timestamp freshness', () => {
  expect(
    workloadEntryHealthEvidence(enabled, {
      conditions: [
        {
          type: 'Healthy',
          status: 'True',
          reason: 'ProbeSucceeded',
          message: 'reported by agent',
          lastProbeTime: '2020-01-01T00:00:00Z',
          lastTransitionTime: '2019-12-31T23:59:59Z',
        },
      ],
    })
  ).toEqual({
    annotation: 'true',
    basis: 'condition',
    kialiAvailable: true,
    condition: {
      status: 'True',
      reason: 'ProbeSucceeded',
      message: 'reported by agent',
      lastProbeTime: '2020-01-01T00:00:00Z',
      lastTransitionTime: '2019-12-31T23:59:59Z',
    },
  });
});
it.each([
  [[], {}],
  [{ [WORKLOAD_ENTRY_HEALTH_ANNOTATION]: 1 }, {}],
  [{ [WORKLOAD_ENTRY_HEALTH_ANNOTATION]: 'x'.repeat(1025) }, {}],
  [enabled, []],
  [enabled, { conditions: [null] }],
  [enabled, { conditions: [{}, { type: 1 }] }],
  [enabled, { conditions: [{ type: 'Healthy', status: true }] }],
  [enabled, { conditions: [{ type: 'Healthy', status: 'True', message: 'x'.repeat(4097) }] }],
])('surfaces malformed probe evidence without claiming availability %#', (annotations, status) => {
  expect(readWorkloadEntryHealth(annotations, status)).toMatchObject({
    ok: false,
    message: expect.any(String),
  });
});
it('checks exact condition-count/text budgets and does not parse unused disabled status', () => {
  expect(
    workloadEntryHealthEvidence(enabled, { conditions: Array(100).fill({ type: 'X', status: '' }) })
      .basis
  ).toBe('missing-condition');
  expect(() => workloadEntryHealthEvidence(enabled, { conditions: Array(101).fill({}) })).toThrow(
    '100 conditions'
  );
  expect(
    workloadEntryHealthEvidence(enabled, {
      conditions: Array(100).fill({ type: 'x'.repeat(100), status: 'y'.repeat(100) }),
    }).basis
  ).toBe('missing-condition');
  expect(() =>
    workloadEntryHealthEvidence(enabled, {
      conditions: Array(100).fill({ type: 'x'.repeat(101), status: 'y'.repeat(100) }),
    })
  ).toThrow('20000');
  expect(workloadEntryHealthEvidence({}, { conditions: [null] }).basis).toBe('disabled-checks');
});
