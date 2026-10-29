import { cleanup, render, screen } from '@testing-library/react';
import {
  readWorkloadEntryHealth,
  WORKLOAD_ENTRY_HEALTH_ANNOTATION,
} from '../core/workloadEntryHealth';
import WorkloadEntryHealth from './WorkloadEntryHealth';

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  useTranslation: () => ({
    t: (key: string, values: Record<string, unknown> = {}) =>
      key.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(values[name] ?? '')),
  }),
}));
afterEach(cleanup);
it.each([
  [undefined, 'False', 'Assumed available by Kiali; health checks disabled'],
  [' false', 'False', 'Assumed available by Kiali; unrecognized health annotation'],
  ['true', 'Unknown', 'Not available in Kiali; Healthy condition is not True or False'],
  ['true', 'False', 'Reported Healthy condition: False'],
  ['true', 'True', 'Reported Healthy condition: True'],
] as const)(
  'shows %s/%s evidence without turning assumptions into an observed healthy condition',
  (value, status, message) => {
    const annotations = value === undefined ? {} : { [WORKLOAD_ENTRY_HEALTH_ANNOTATION]: value };
    render(
      <WorkloadEntryHealth
        health={readWorkloadEntryHealth(annotations, { conditions: [{ type: 'Healthy', status }] })}
      />
    );
    expect(screen.getByText(message)).toBeDefined();
    if (value !== 'true') expect(screen.queryByText(/First Healthy condition/)).toBeNull();
  }
);
it('preserves reported probe timestamps/reasons and shows missing condition explicitly', () => {
  const annotations = { [WORKLOAD_ENTRY_HEALTH_ANNOTATION]: 'true' };
  const view = render(<WorkloadEntryHealth health={readWorkloadEntryHealth(annotations, {})} />);
  expect(screen.getByText('Not available in Kiali; Healthy condition missing')).toBeDefined();
  view.rerender(
    <WorkloadEntryHealth
      health={readWorkloadEntryHealth(annotations, {
        conditions: [
          {
            type: 'Healthy',
            status: 'True',
            reason: 'ProbeSucceeded',
            message: 'VM probe success',
            lastProbeTime: '2020-01-01T00:00:00Z',
            lastTransitionTime: '2019-12-31T23:59:59Z',
          },
        ],
      })}
    />
  );
  expect(screen.getByText('Last reported probe: 2020-01-01T00:00:00Z')).toBeDefined();
  expect(screen.getByText('Last reported transition: 2019-12-31T23:59:59Z')).toBeDefined();
  expect(screen.getByText('Reason: ProbeSucceeded')).toBeDefined();
  expect(screen.getByText('Message: VM probe success')).toBeDefined();
});
it('renders invalid evidence as a warning rather than dropping the resource', () => {
  render(<WorkloadEntryHealth health={{ ok: false, message: 'Invalid condition list' }} />);
  expect(screen.getByRole('alert').textContent).toBe(
    'Probe evidence unavailable: Invalid condition list'
  );
});
