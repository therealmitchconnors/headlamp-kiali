import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmod, cp, copyFile, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createFixtureApi, fixtureToken } from './fixture-api.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const image =
  'ghcr.io/headlamp-k8s/headlamp@sha256:bbca49510385effd4fe27be07dd12b845f530f6abbbaa06ef35ff7b4ae06cc39';
const cluster = 'smoke';
const artifactBase = process.env.HEADLAMP_SMOKE_ARTIFACTS ?? path.join(root, 'smoke-artifacts');
const knownHostDiagnostics = [
  /apiextensions\.k8s\.io\/v1beta1.*customresourcedefinitions.*404/i,
  /customresourcedefinitions.*apiextensions\.k8s\.io\/v1beta1.*404/i,
  /404.*apiextensions\.k8s\.io\/v1beta1.*customresourcedefinitions/i,
  /websocket.*closed before the connection is established/i,
];
const iconApiHosts = ['api.iconify.design', 'api.simplesvg.com', 'api.unisvg.com'];

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`${command} failed with status ${result.status}: ${result.stderr.trim()}`);
  return (result.stdout ?? '').trim();
}

async function unusedPort() {
  const listener = createServer();
  await new Promise((resolve, reject) => {
    listener.once('error', reject);
    listener.listen(0, '127.0.0.1', resolve);
  });
  const address = listener.address();
  if (!address || typeof address === 'string') throw new Error('Could not reserve a local port');
  const { port } = address;
  await new Promise((resolve, reject) =>
    listener.close(error => (error ? reject(error) : resolve()))
  );
  return port;
}

async function waitForHost(url, timeoutMs = 90000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
      lastError = new Error(`Headlamp returned HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error(`Pinned Headlamp host did not become ready: ${lastError}`);
}

async function waitForPersistedKialiConfig(page) {
  await page.waitForFunction(
    () => {
      if (!window.pluginLib?.ConfigStore) return false;
      const current = new window.pluginLib.ConfigStore('kiali').get();
      if (
        current?.schemaVersion !== 1 ||
        current?.clusters?.smoke?.meshClusterName !== 'smoke-mesh' ||
        current?.clusters?.smoke?.prometheus?.service !== 'prometheus'
      )
        return false;

      try {
        const configs = JSON.parse(window.localStorage.getItem('pluginConfigs') ?? '{}');
        const stored = configs.kiali;
        return (
          stored?.schemaVersion === 1 &&
          stored?.clusters?.smoke?.meshClusterName === 'smoke-mesh' &&
          JSON.stringify(stored) === JSON.stringify(current)
        );
      } catch {
        return false;
      }
    },
    undefined,
    { timeout: 15000 }
  );
}

async function expectVisible(locator, message) {
  await locator.waitFor({ state: 'visible', timeout: 30000 });
  assert.equal(await locator.isVisible(), true, message);
}

async function configureSettings(page) {
  const identity = page.getByRole('textbox', {
    name: 'Logical mesh cluster name (optional)',
    exact: true,
  });
  await expectVisible(identity, 'The English-labeled mesh identity setting must render');
  await identity.fill('smoke-mesh');

  const prometheusToggle = page.getByRole('checkbox', {
    name: 'Connect to an existing Prometheus Service',
  });
  await prometheusToggle.check();
  await page
    .getByRole('textbox', { name: 'Prometheus namespace', exact: true })
    .fill('observability');
  await page.getByRole('textbox', { name: 'Prometheus Service', exact: true }).fill('prometheus');
  await page.getByRole('textbox', { name: 'Service port', exact: true }).fill('9090');
  await page.getByRole('button', { name: 'Save cluster settings' }).click();
  await expectVisible(page.getByText('Settings saved for smoke.', { exact: true }));

  // ConfigStore writes are debounced; wait for its public value and persisted Kiali slice.
  await waitForPersistedKialiConfig(page);
  await page.reload({ waitUntil: 'domcontentloaded' });
  const savedIdentity = page.getByRole('textbox', {
    name: 'Logical mesh cluster name (optional)',
    exact: true,
  });
  await expectVisible(savedIdentity);
  assert.equal(await savedIdentity.inputValue(), 'smoke-mesh');
}

async function openKialiOverview(page) {
  await page.getByText('Kiali', { exact: true }).first().click();
  await expectVisible(page.getByRole('heading', { name: 'Kiali overview' }));
}

async function openGatewayInspector(page) {
  await openKialiOverview(page);
  await page.getByRole('link', { name: 'Istio configuration', exact: true }).click();
  const kindSelect = page.getByLabel('Configuration kind', { exact: true });
  await expectVisible(kindSelect);
  await kindSelect.click();
  await page.getByRole('option', { name: 'Gateway (Istio)', exact: true }).click();
  const gatewayLink = page.getByRole('link', { name: 'smoke-gateway', exact: true });
  await expectVisible(gatewayLink);
  await gatewayLink.click();
  await expectVisible(page.getByRole('heading', { name: 'Declared-scope Gateway checks' }));
}

async function openServiceInspector(page) {
  await openKialiOverview(page);
  await page.getByRole('link', { name: 'Services', exact: true }).last().click();
  const inspectLink = page.getByRole('link', { name: 'Inspect port checks', exact: true });
  await expectVisible(inspectLink);
  await inspectLink.click();
  await expectVisible(page.getByRole('heading', { name: 'Service port validation' }));
}

async function checkService(page, api, mode, expected) {
  await openServiceInspector(page);
  const runButton = page.getByRole('button', { name: 'Run Service port checks' });
  await expectVisible(runButton, 'The Service inspector action must have an accessible name');
  assert.equal(await runButton.isEnabled(), true);
  api.setScenario(mode);
  const firstRequest = api.requests.length;
  await runButton.click();

  if (expected === 'positive') {
    await expectVisible(page.getByText('KIA0601', { exact: true }));
    await expectVisible(page.getByText('KIA0701', { exact: true }));
  } else if (expected === 'stale') {
    await expectVisible(
      page.getByText(/Selected Service changed while reading port validation evidence/i)
    );
  } else {
    await expectVisible(page.getByText(/Unavailable:.*(complete|incomplete|pod)/i));
  }

  const reads = api.requests.slice(firstRequest);
  assert.ok(reads.some(request => request.path.includes('/services/reviews')));
  if (mode === 'positive') {
    assert.ok(reads.some(request => request.path.includes('/pods')));
    assert.ok(reads.some(request => request.path.includes('/deployments')));
  }
}

async function checkGateway(page, api, mode, expected) {
  await openGatewayInspector(page);
  const runButton = page.getByRole('button', { name: 'Run scoped Gateway checks' });
  await expectVisible(runButton, 'The scoped Gateway action must have an accessible name');
  assert.equal(await runButton.isEnabled(), true);
  api.setScenario(mode);
  const firstRequest = api.requests.length;
  await runButton.click();

  if (expected === 'positive') {
    await expectVisible(page.getByText('KIA0302', { exact: true }));
    await expectVisible(page.getByText(/Captured controller: istio-system\/istiod-1-30/));
  } else if (expected === 'stale') {
    await expectVisible(
      page.getByText(/Gateway identity, version, spec, status or metadata changed/i)
    );
  } else {
    await expectVisible(page.getByText(/Unavailable:.*(complete|incomplete|pod)/i));
  }

  const reads = api.requests.slice(firstRequest);
  if (mode === 'positive') {
    assert.ok(reads.some(request => request.path.includes('/deployments')));
    assert.ok(reads.some(request => request.path.includes('/pods')));
  }
}

async function main() {
  const mainBundle = path.join(root, 'dist', 'main.js');
  await readFile(mainBundle);
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'headlamp-kiali-smoke-'));
  let tempName;
  let hostPort;
  let api;
  let apiUrl;
  const kubeconfigPath = path.join(tempDir, 'kubeconfig.json');
  const pluginDir = path.join(tempDir, 'plugins', 'kiali');
  try {
    await chmod(tempDir, 0o755);
    tempName = `headlamp-kiali-smoke-${process.pid}-${randomBytes(4).toString('hex')}`;
    hostPort = await unusedPort();
    api = createFixtureApi();
    apiUrl = await api.listen();
    await mkdir(pluginDir, { recursive: true });
    await copyFile(path.join(root, 'dist', 'main.js'), path.join(pluginDir, 'main.js'));
    await copyFile(path.join(root, 'package.json'), path.join(pluginDir, 'package.json'));
    await cp(path.join(root, 'dist', 'locales'), path.join(pluginDir, 'locales'), {
      recursive: true,
    });
    await writeFile(
      kubeconfigPath,
      JSON.stringify({
        apiVersion: 'v1',
        kind: 'Config',
        clusters: [{ name: cluster, cluster: { server: apiUrl } }],
        contexts: [{ name: cluster, context: { cluster, user: cluster } }],
        'current-context': cluster,
        users: [{ name: cluster, user: { token: fixtureToken } }],
      }),
      { mode: 0o644 }
    );
  } catch (error) {
    if (api?.server.listening) await new Promise(resolve => api.server.close(() => resolve()));
    await rm(tempDir, { recursive: true, force: true });
    throw error;
  }

  let browser;
  let page;
  let containerStarted = false;
  let failed;
  const consoleErrors = [];
  const hostDiagnostics = [];
  const failedRequests = [];
  const hostHttpErrors = [];
  const pluginRequests = [];
  const pluginResponses = [];
  const iconRequests = [];
  let observedSyntheticHostSocket = false;
  const groupDiscoveryResponses = [];
  let authCompleted = false;
  let authenticatedRequestStart = 0;
  const startedAt = api.requests.length;
  const origin = `http://127.0.0.1:${hostPort}`;
  try {
    run('docker', [
      'run',
      '--detach',
      '--rm',
      '--name',
      tempName,
      '--platform',
      'linux/amd64',
      '--network',
      'host',
      '--mount',
      `type=bind,source=${pluginDir},target=/headlamp/plugins/kiali,readonly`,
      '--mount',
      `type=bind,source=${kubeconfigPath},target=/tmp/kubeconfig.json,readonly`,
      image,
      '-listen-addr=127.0.0.1',
      `-port=${hostPort}`,
      '-kubeconfig=/tmp/kubeconfig.json',
      '-plugins-dir=/headlamp/plugins',
    ]);
    containerStarted = true;
    await waitForHost(origin);

    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    for (const host of iconApiHosts) {
      await context.route(`https://${host}/**`, async route => {
        const url = new URL(route.request().url());
        const prefix = path.basename(url.pathname, '.json');
        const names = (url.searchParams.get('icons') ?? '').split(',').filter(Boolean);
        const icons = Object.fromEntries(
          names.map(name => [name, { width: 24, height: 24, body: '<path d="M2 2h20v20H2z"/>' }])
        );
        iconRequests.push({ host, prefix, count: names.length });
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          headers: { 'access-control-allow-origin': '*' },
          body: JSON.stringify({ prefix, icons }),
        });
      });
    }
    page = await context.newPage();
    page.on('websocket', webSocket => {
      try {
        const url = new URL(webSocket.url());
        const expectedWatchPath =
          url.host === `127.0.0.1:${hostPort}` &&
          (url.pathname === '/wsMultiplexer' ||
            (url.searchParams.get('watch') === '1' &&
              new RegExp(
                `^/clusters/${cluster}/(?:api/v1/(?:namespaces|pods|events|nodes)|apis/apiextensions\\.k8s\\.io/v1/customresourcedefinitions|apis/networking\\.istio\\.io/v1/(?:gateways|virtualservices))$`
              ).test(url.pathname)));
        if (expectedWatchPath) {
          observedSyntheticHostSocket = true;
        } else consoleErrors.push(`Unexpected WebSocket endpoint: ${url.origin}${url.pathname}`);
      } catch {
        consoleErrors.push('Invalid WebSocket endpoint');
      }
    });
    page.on('console', message => {
      if (message.type() !== 'error') return;
      const text = message.text().replaceAll(fixtureToken, '[redacted]').slice(0, 2048);
      if (
        !authCompleted &&
        (text.includes('401 (Unauthorized)') ||
          text.includes('Getting the cluster version: Error: Unauthorized'))
      ) {
        hostDiagnostics.push('Expected unauthenticated Headlamp bootstrap challenge');
        return;
      }
      if (
        /WebSocket connection to 'ws:\/\/127\.0\.0\.1:\d+(?:\/wsMultiplexer|\/clusters\/smoke\/(?:api\/v1\/(?:namespaces|pods|events|nodes)|apis\/apiextensions\.k8s\.io\/v1\/customresourcedefinitions|apis\/networking\.istio\.io\/v1\/(?:gateways|virtualservices))[^']*[?&]watch=1)/i.test(
          text
        ) &&
        /handshake: Unexpected response code: 200/i.test(text)
      ) {
        hostDiagnostics.push(
          'Stock Headlamp watch endpoint is not a WebSocket in the synthetic API'
        );
        return;
      }
      if (text === 'WebSocket error: Event' && observedSyntheticHostSocket) {
        hostDiagnostics.push(
          'Stock Headlamp watch closed after its unsupported synthetic handshake'
        );
        return;
      }
      if (/Failed to load resource:.*(?:403|404)/i.test(text) && hostHttpErrors.length) {
        const failure = hostHttpErrors.shift();
        const diagnostic = `${text} (${failure.path})`;
        if (
          failure.status === 404 &&
          failure.path ===
            `/clusters/${cluster}/apis/apiextensions.k8s.io/v1beta1/customresourcedefinitions` &&
          knownHostDiagnostics.some(pattern => pattern.test(diagnostic))
        )
          hostDiagnostics.push(diagnostic);
        else if (
          failure.status === 403 &&
          failure.path === `/clusters/${cluster}/api/v1/namespaces` &&
          api.requests.some(
            request =>
              request.scenario === 'denied' &&
              request.status === 403 &&
              request.path.split('?')[0] === '/api/v1/namespaces'
          )
        )
          hostDiagnostics.push('Expected denied namespace-list evidence in the inspector fixture');
        else consoleErrors.push(diagnostic);
        return;
      }
      const emptyHostError = text.match(
        /Unable to parse error json at url: (http:\/\/127\.0\.0\.1:\d+\/clusters\/[^ ]+)/
      );
      if (
        emptyHostError &&
        text.includes('Unexpected end of input') &&
        text.includes('/assets/index-')
      ) {
        try {
          const requestUrl = new URL(emptyHostError[1]);
          const fixturePath =
            requestUrl.pathname.replace(`/clusters/${cluster}`, '') + requestUrl.search;
          if (
            api.requests.some(
              request =>
                request.path === fixturePath && request.authenticated && request.status === 200
            )
          ) {
            hostDiagnostics.push(
              'Stock Headlamp parsed an empty error body after a successful synthetic API read'
            );
            return;
          }
        } catch {
          consoleErrors.push(text);
          return;
        }
      }
      if (knownHostDiagnostics.some(pattern => pattern.test(text))) hostDiagnostics.push(text);
      else consoleErrors.push(text);
    });
    page.on('pageerror', error => consoleErrors.push(error.message.slice(0, 2048)));
    page.on('requestfailed', request => {
      try {
        const url = new URL(request.url());
        failedRequests.push({
          origin: url.origin,
          path: url.pathname.slice(0, 512),
          error: request.failure()?.errorText?.slice(0, 512),
        });
      } catch {
        failedRequests.push({ origin: 'invalid', path: '', error: 'invalid request URL' });
      }
    });
    page.on('request', request => {
      try {
        const url = new URL(request.url());
        if (url.pathname.includes('/plugins/')) pluginRequests.push(url.pathname.slice(0, 512));
      } catch {
        return;
      }
    });
    page.on('response', response => {
      try {
        const url = new URL(response.url());
        if (
          url.origin === origin &&
          url.pathname === `/clusters/${cluster}/apis/networking.istio.io`
        )
          groupDiscoveryResponses.push({
            status: response.status(),
            contentType: response.headers()['content-type'],
            contentLength: response.headers()['content-length'],
          });
        if (url.origin === origin && [403, 404].includes(response.status()))
          hostHttpErrors.push({ path: url.pathname, status: response.status() });
        if (url.pathname.includes('/plugins/'))
          pluginResponses.push({ path: url.pathname.slice(0, 512), status: response.status() });
      } catch {
        return;
      }
    });

    await page.goto(origin, { waitUntil: 'domcontentloaded' });
    const tokenField = page.getByLabel('ID token');
    await tokenField.waitFor({ state: 'visible', timeout: 30000 });
    const clusterVersionResponse = page.waitForResponse(
      response =>
        response.url().endsWith(`/clusters/${cluster}/version`) && response.status() === 200,
      { timeout: 30000 }
    );
    await tokenField.fill(fixtureToken);
    await page.getByRole('button', { name: 'Authenticate' }).click();
    await tokenField.waitFor({ state: 'detached', timeout: 15000 });
    authCompleted = true;
    authenticatedRequestStart = api.requests.length;
    await clusterVersionResponse;
    await expectVisible(page.getByText('Kiali', { exact: true }).first());
    await page.getByText('Kiali', { exact: true }).first().click();
    await expectVisible(page.getByRole('heading', { name: 'Kiali overview' }));
    await expectVisible(page.getByRole('button', { name: 'Refresh connections' }));

    await page.getByRole('link', { name: 'Connection settings', exact: true }).click();
    await configureSettings(page);

    await page.getByText('Kiali', { exact: true }).first().click();
    await expectVisible(page.getByRole('heading', { name: 'Kiali overview' }));
    await expectVisible(
      page.getByText(/Prometheus smoke-v1 is reachable through observability\/prometheus:9090\./)
    );

    await checkGateway(page, api, 'positive', 'positive');
    await checkGateway(page, api, 'denied', 'denied');
    await checkGateway(page, api, 'incomplete', 'incomplete');
    await checkGateway(page, api, 'stale', 'stale');

    await checkService(page, api, 'positive', 'positive');
    await checkService(page, api, 'denied', 'denied');
    await checkService(page, api, 'incomplete', 'incomplete');
    await checkService(page, api, 'stale', 'stale');

    const trafficPath = '/api/v1/namespaces/observability/services/prometheus:9090/proxy/';
    assert.ok(
      api.requests.some(request => request.path.includes(trafficPath)),
      'The plugin must reach the synthetic Prometheus response through Headlamp'
    );
    assert.deepEqual(
      api.requests.slice(authenticatedRequestStart).filter(request => !request.authenticated),
      [],
      'Every post-auth synthetic Kubernetes request must pass fixture authentication'
    );
    assert.deepEqual(
      api.requests.filter(
        request =>
          !['GET', 'HEAD'].includes(request.method) &&
          !(
            request.method === 'POST' &&
            request.path === '/apis/authorization.k8s.io/v1/selfsubjectrulesreviews'
          )
      ),
      [],
      'The synthetic Kubernetes API must receive no writes beyond its read-only auth review'
    );
    for (const asset of [
      '/plugins/kiali/main.js',
      '/plugins/kiali/package.json',
      '/plugins/kiali/locales/en/translation.json',
    ])
      assert.ok(
        pluginResponses.some(response => response.path === asset && response.status === 200),
        `The stock Headlamp host must load ${asset}`
      );
    assert.ok(
      api.requests.some(
        request =>
          request.method === 'POST' &&
          request.path === '/apis/authorization.k8s.io/v1/selfsubjectrulesreviews' &&
          request.authenticated
      ),
      'The stock Headlamp authentication flow must verify the synthetic bearer token'
    );
    assert.deepEqual(
      consoleErrors,
      [],
      `Unexpected browser/plugin errors: ${consoleErrors.join('\n')}`
    );
    console.log(
      `Headlamp smoke passed: visible Kiali contribution, English labels, persisted settings, synthetic Prometheus response, 8 Gateway/Service inspector outcomes, ${
        api.requests.length - startedAt
      } authenticated read requests, and no Kubernetes writes.`
    );
    if (hostDiagnostics.length)
      console.log(
        `Known stock-host diagnostics (${hostDiagnostics.length}) were classified separately.`
      );
  } catch (error) {
    failed = error;
    if (page) {
      try {
        const tokenField = page.getByLabel('ID token');
        if (await tokenField.isVisible().catch(() => false))
          await tokenField.fill('').catch(() => undefined);
        await mkdir(artifactBase, { recursive: true });
        const artifactDir = path.join(artifactBase, `failure-${Date.now()}-${process.pid}`);
        await mkdir(artifactDir, { recursive: true });
        await page.screenshot({ path: path.join(artifactDir, 'failure.png'), fullPage: false });
        await writeFile(
          path.join(artifactDir, 'browser-errors.json'),
          JSON.stringify(
            {
              errors: consoleErrors,
              knownHostDiagnostics: hostDiagnostics,
              failedRequests: failedRequests.slice(-100),
              hostHttpErrors: hostHttpErrors.slice(-100),
              pluginRequests: pluginRequests.slice(-50),
              pluginResponses: pluginResponses.slice(-50),
              syntheticIconRequests: iconRequests.slice(-50),
              groupDiscoveryResponses: groupDiscoveryResponses.slice(-20),
              pageUrl: page.url(),
              pageText: (
                await page
                  .locator('body')
                  .innerText()
                  .catch(() => '')
              ).slice(0, 12000),
              fixtureRequests: api.requests
                .slice(-100)
                .map(({ method, path: requestPath, scenario, authenticated, status }) => ({
                  method,
                  path: requestPath.slice(0, 1024),
                  scenario,
                  authenticated,
                  status,
                })),
              fixtureFailures: api.requests
                .filter(request => request.status >= 400)
                .slice(-100)
                .map(({ method, path: requestPath, scenario, authenticated, status }) => ({
                  method,
                  path: requestPath.slice(0, 1024),
                  scenario,
                  authenticated,
                  status,
                })),
            },
            null,
            2
          )
        );
        console.error(`Credential-free browser artifacts: ${artifactDir}`);
      } catch {
        console.error('Unable to capture browser failure artifacts.');
      }
    }
    throw error;
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => api.server.close(resolve));
    if (containerStarted) {
      try {
        run('docker', ['stop', tempName], { stdio: 'ignore' });
      } catch {
        // The container is owned by this run and may already have exited.
      }
    }
    await rm(tempDir, { recursive: true, force: true });
    if (failed)
      console.error('The smoke run cleaned up only its temporary host and fixture resources.');
  }
}

await main();
