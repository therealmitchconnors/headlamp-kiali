import {
  initialOutboundTls,
  outboundTlsChange,
  OutboundTlsDraft,
  planOutboundTls,
} from './outboundTls';

const spec = {
  host: 'reviews',
  workloadSelector: { matchLabels: { app: 'client' } },
  subsets: [{ name: 'v1', trafficPolicy: { tls: { mode: 'DISABLE' } } }],
  trafficPolicy: {
    loadBalancer: { simple: 'RANDOM' },
    connectionPool: { tcp: { maxConnections: 10 } },
    portLevelSettings: [{ port: { number: 9080 }, tls: { mode: 'SIMPLE' } }],
    tls: {
      mode: 'MUTUAL',
      credentialName: 'existing-secret',
      clientCertificate: '/old/cert.pem',
      privateKey: '/old/key.pem',
      caCertificates: '/old/ca.pem',
      caCrl: '/old/crl.pem',
      sni: 'reviews.example.com',
      subjectAltNames: ['reviews.example.com'],
      insecureSkipVerify: false,
      extension: { retained: true },
    },
  },
};
const draft: OutboundTlsDraft = {
  ...initialOutboundTls(spec),
  action: 'set',
  mode: 'MUTUAL',
  clientCertificate: '/new/cert.pem',
  privateKey: '/new/key.pem',
  caCertificates: '/new/ca.pem',
};

it('does not infer or enable TLS from absent, unknown or omitted modes', () => {
  for (const value of [
    undefined,
    {},
    { trafficPolicy: { tls: {} } },
    { trafficPolicy: { tls: { mode: 'future-mode' } } },
  ]) {
    expect(initialOutboundTls(value)).toMatchObject({ action: 'keep', mode: '' });
    expect(outboundTlsChange(initialOutboundTls(value))).toBeUndefined();
    expect(() => outboundTlsChange({ ...initialOutboundTls(value), action: 'set' })).toThrow(
      'explicit'
    );
  }
  expect(initialOutboundTls(spec)).toEqual({
    ...draft,
    action: 'keep',
    clientCertificate: '/old/cert.pem',
    privateKey: '/old/key.pem',
    caCertificates: '/old/ca.pem',
  });
});

it('sets MUTUAL file references while preserving unrelated TLS and traffic fields', () => {
  const before = JSON.stringify(spec);
  const plan = planOutboundTls(spec, draft);
  expect(plan.spec).toEqual({
    ...spec,
    trafficPolicy: {
      ...spec.trafficPolicy,
      tls: {
        mode: 'MUTUAL',
        clientCertificate: '/new/cert.pem',
        privateKey: '/new/key.pem',
        caCertificates: '/new/ca.pem',
        caCrl: '/old/crl.pem',
        sni: 'reviews.example.com',
        subjectAltNames: ['reviews.example.com'],
        insecureSkipVerify: false,
        extension: { retained: true },
      },
    },
  });
  expect(JSON.stringify(spec)).toBe(before);
});

it('SIMPLE clears client credentials and an omitted CA path, but never changes verification flags', () => {
  const plan = planOutboundTls(spec, { ...draft, mode: 'SIMPLE', caCertificates: '' });
  expect(plan.spec).toEqual({
    ...spec,
    trafficPolicy: {
      ...spec.trafficPolicy,
      tls: {
        mode: 'SIMPLE',
        caCrl: '/old/crl.pem',
        sni: 'reviews.example.com',
        subjectAltNames: ['reviews.example.com'],
        insecureSkipVerify: false,
        extension: { retained: true },
      },
    },
  });
  expect(outboundTlsChange({ ...draft, mode: 'SIMPLE' })).toEqual({
    mode: 'SIMPLE',
    caCertificates: '/new/ca.pem',
  });
});

it.each(['DISABLE', 'ISTIO_MUTUAL'] as const)(
  'explicitly clears the whole TLS sub-block for %s',
  mode => {
    expect(
      planOutboundTls(spec, { ...draft, mode, clientCertificate: '', privateKey: '' }).spec
    ).toEqual({
      ...spec,
      trafficPolicy: { ...spec.trafficPolicy, tls: { mode } },
    });
  }
);

it('removes only the entire top-level TLS block, including all credentials and overrides', () => {
  const { tls, ...remaining } = spec.trafficPolicy;
  expect(tls).toBeDefined();
  expect(planOutboundTls(spec, { ...draft, action: 'remove' }).spec).toEqual({
    ...spec,
    trafficPolicy: remaining,
  });
  expect(
    planOutboundTls({ host: 'reviews', trafficPolicy: { tls: {} } }, { ...draft, action: 'remove' })
      .spec
  ).toEqual({ host: 'reviews' });
});

it('rejects no-ops, including alternate JSON property order and absent-block removal', () => {
  const value = {
    host: 'reviews',
    trafficPolicy: {
      tls: {
        privateKey: '/new/key.pem',
        clientCertificate: '/new/cert.pem',
        mode: 'MUTUAL',
        caCertificates: '/new/ca.pem',
      },
    },
  };
  expect(() => planOutboundTls(value, draft)).toThrow('would not change');
  expect(() => planOutboundTls(spec, { ...draft, action: 'keep' })).toThrow('Choose');
  for (const trafficPolicy of [undefined, null, {}]) {
    expect(() =>
      planOutboundTls({ host: 'reviews', trafficPolicy }, { ...draft, action: 'remove' })
    ).toThrow('would not change');
  }
});

it.each(['clientCertificate', 'privateKey', 'caCertificates'] as const)(
  'validates %s file references without accepting key/certificate contents',
  field => {
    for (const value of [
      'relative/file',
      '/',
      '/folder/',
      '-----BEGIN PRIVATE KEY-----',
      '/path\ncontents',
      '/path\u0000contents',
      '/' + 'x'.repeat(4096),
    ]) {
      expect(() => outboundTlsChange({ ...draft, [field]: value })).toThrow('file path');
    }
    expect(outboundTlsChange({ ...draft, [field]: '/' + 'x'.repeat(4095) })?.[field]).toHaveLength(
      4096
    );
    if (field !== 'caCertificates')
      expect(() => outboundTlsChange({ ...draft, [field]: '' })).toThrow('file path');
  }
);

it('rejects malformed parent blocks rather than overwriting them as empty policies', () => {
  expect(() => planOutboundTls({ host: 'reviews', trafficPolicy: [] }, draft)).toThrow('malformed');
  expect(() => planOutboundTls({ host: 'reviews', trafficPolicy: { tls: [] } }, draft)).toThrow(
    'malformed'
  );
  expect(() => planOutboundTls({}, draft)).toThrow('existing DestinationRule');
});
