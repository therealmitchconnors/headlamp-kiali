# Hosted Headlamp smoke test

The hosted smoke launches the stock Headlamp 0.35.0 web host in Docker, mounts
the production plugin build, and drives it with headless Chromium. It does not
need a user kubeconfig, real cluster, browser profile, separately provisioned
service, or personal credential.

## Run locally

Use Linux, Node.js 22.23.4, npm, Docker with its daemon running, and the repository
root as the working directory:

```sh
npm ci
npx playwright install chromium
npm run build
npm run smoke:hosted
```

The runner starts `ghcr.io/headlamp-k8s/headlamp` at the pinned v0.35.0 image
digest in `scripts/smoke/run.mjs`, stages the built `main.js`, package manifest
and English locale in a temporary plugin directory, and mounts that directory
alongside a temporary synthetic kubeconfig. It serves the UI on an unused
loopback port. The kubeconfig points to the runner's loopback-only fake
Kubernetes API. That API requires its synthetic bearer token, permits only
GET/HEAD plus Headlamp's authenticated, non-persisting `SelfSubjectRulesReview`
POST, and rejects resource writes. The browser enters the synthetic token
through Headlamp's actual authentication dialog; it does not intercept host API
routes or preseed host authentication state.

The fresh browser context configures the test cluster through Kiali's settings
form, waits for the public `ConfigStore` value and persisted `pluginConfigs.kiali`
slice to match after the 500 ms debounce, reloads the page, and confirms the
setting survived. It then verifies the visible Kiali contribution, English
labels, named controls, and a synthetic Prometheus build-info response through
Headlamp. It also requires HTTP 200 responses for the plugin bundle, manifest,
and English locale. Both inspectors run against synthetic, owned objects in
positive, denied, incomplete, and stale scenarios. No Kubernetes writes are
accepted.

The runner removes its own container, browser context, fake API server, and
temporary kubeconfig on success or failure. It does not stop or delete unrelated
containers, processes, cluster resources, or browser profiles. On failure it
keeps one viewport screenshot and bounded browser-error JSON under
`smoke-artifacts/` (or `HEADLAMP_SMOKE_ARTIFACTS`); successful runs leave no
artifacts. The CI workflow uploads this directory only on failure and retains
it for seven days. The browser artifacts contain synthetic UI data only; host
container logs and request authorization headers are not collected.

The runner separately classifies the known stock-host CRD-v1beta1 discovery 404
and synthetic watch/multiplexer diagnostics, plus the stock-host parser message
only when correlated with a successful authenticated fixture read. The expected
unauthenticated bootstrap and the fixture's denied namespace read are recorded
separately. Plugin execution errors, uncaught page errors, other console errors,
unauthenticated fixture reads, unexpected WebSocket endpoints, and attempted
Kubernetes writes fail the run. The temporary token field is cleared before a
failure screenshot is captured.

## GitHub Actions and Copilot environments

`.github/workflows/headlamp-smoke.yml` runs type-checking, lint, the existing
test suite, parity inventory, production build, and the hosted smoke on pushes,
pull requests, and manual dispatch. The workflow pins its Actions by commit,
uses the Node version above, and downloads the pinned Headlamp image and
Playwright browser at runtime.

This is a repository Actions workflow, not a Copilot setup workflow. No
`.github/workflows/copilot-setup-steps.yml` is added: that file only applies
when present on the default branch and does not configure cloud-sandbox
sessions. Publishing this workflow on the port branch does not change the
default branch or globally enable Copilot setup.

The smoke is synthetic hosted-web evidence only. It does not close Desktop,
live-cluster, live-provider, or OIDC/authentication gates.
