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
  'active loggers:\n  a2a: warning\n  admin: warning\n  alternate_protocols_cache: warning',
  'active loggers:\r\n  a2a: warning\r\n  admin: warning\r\n  alternate_protocols_cache: warning\r\n',
  'active loggers:\n  a2a: warning\n  admin: warning\n  alternate_protocols_cache: warning\n',
])('parses Envoy-indented logger listings and line-ending variants', response => {
  expect(parseProxyLoggerLevels(response)).toEqual([
    { logger: 'a2a', level: 'warning' },
    { logger: 'admin', level: 'warning' },
    { logger: 'alternate_protocols_cache', level: 'warning' },
  ]);
});

it.each([
  ['', 'unsupported format'],
  ['Unauthorized', 'unsupported format'],
  ['active loggers:\nError: unavailable', 'invalid or duplicate'],
  ['active loggers:\n', 'did not report any loggers'],
  ['active loggers:\nrouter: verbose', 'invalid or duplicate'],
  ['active loggers:\nrouter: info\nrouter: debug', 'invalid or duplicate'],
  ['active loggers:\nrouter: info\n  router: debug', 'invalid or duplicate'],
  ['active loggers:\n router: info', 'invalid or duplicate'],
  ['active loggers:\n   router: info', 'invalid or duplicate'],
  ['active loggers:\n  bad name: info', 'invalid or duplicate'],
  ['active loggers:\n  bad:name: info', 'invalid or duplicate'],
  ['active loggers:\n  router : info', 'invalid or duplicate'],
  ['active loggers:\n  router: info\n\nextra', 'invalid or duplicate'],
])('rejects unsupported logger state %#', (response, reason) => {
  expect(() => parseProxyLoggerLevels(response)).toThrow(reason);
});

it('retains the response-size limit', () => {
  expect(() => parseProxyLoggerLevels('x'.repeat(262145))).toThrow('exceeds 256 KiB');
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
