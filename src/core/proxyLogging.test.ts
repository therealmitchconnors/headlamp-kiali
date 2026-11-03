import {
  parseProxyLoggerLevels,
  proxyLoggingProposal,
  ProxyLoggingSnapshot,
  proxyLoggingStateMatches,
} from './proxyLogging';

const snapshot: ProxyLoggingSnapshot = {
  cluster: 'alpha',
  target: {
    namespace: 'bookinfo',
    pod: 'reviews-v1',
    uid: 'pod-uid',
    container: 'istio-proxy',
    restarts: 2,
  },
  capturedAt: '2026-10-29T12:00:00.000Z',
  loggers: [
    { logger: 'http', level: 'warning' },
    { logger: 'router', level: 'info' },
  ],
};

it('parses the source-supported logger listing without losing logger names or levels', () => {
  expect(parseProxyLoggerLevels('active loggers:\nrouter: info\nhttp: warning\n')).toEqual([
    { logger: 'http', level: 'warning' },
    { logger: 'router', level: 'info' },
  ]);
});

it.each([
  ['', 'unsupported format'],
  ['active loggers:\n', 'did not report any loggers'],
  ['active loggers:\nrouter: verbose', 'invalid or duplicate'],
  ['active loggers:\nrouter: info\nrouter: debug', 'invalid or duplicate'],
  ['active loggers:\n router: info', 'invalid or duplicate'],
  ['active loggers:\nrouter: info\n\nextra', 'invalid or duplicate'],
])('rejects unsupported logger state %#', (response, reason) => {
  expect(() => parseProxyLoggerLevels(response)).toThrow(reason);
});

it('captures an immutable all-loggers proposal and rejects no-op or unsupported changes', () => {
  const proposal = proxyLoggingProposal(snapshot, 'debug');
  expect(proposal).toMatchObject({
    cluster: 'alpha',
    target: snapshot.target,
    currentLoggers: snapshot.loggers,
    level: 'debug',
  });
  expect(() =>
    proxyLoggingProposal(
      { ...snapshot, loggers: [{ logger: 'http', level: 'info' }] },
      'info'
    )
  ).toThrow('already active');
  expect(() => proxyLoggingProposal(snapshot, 'verbose')).toThrow('valid current/proposed');
  expect(proxyLoggingStateMatches(proposal.currentLoggers, snapshot.loggers)).toBe(true);
  expect(Object.isFrozen(proposal.currentLoggers)).toBe(true);
  expect(Object.isFrozen(proposal.target)).toBe(true);
});
