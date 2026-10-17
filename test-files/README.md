# Native-port evidence and fixtures

This directory contains offline parity fixtures and an explicitly requested live
Bookinfo/Prometheus development setup. Offline tests need no cluster and contain
no captured credentials or production objects. The live setup is optional test
infrastructure, not a runtime installation requirement of the plugin.

## Live AKS Automatic setup

The selected verification context is `mitch-auto`. It runs:

| Component | Namespace | Configuration |
| --- | --- | --- |
| Managed Istio | `aks-istio-system` | Revision `asm-1-30`, CNI chaining; two ready istiod replicas |
| Bookinfo | `bookinfo` | Six deployments; namespace label `istio.io/rev=asm-1-30` |
| Istio example Prometheus | `istio-system` | Prometheus 3.10.0, internal Service port 9090 |

The observed managed control-plane image is
`mcr.microsoft.com/oss/v2/istio/pilot:v1.30.4-2`; AKS manages its servicing.
The example manifests are taken verbatim from Istio **1.30.6**, commit
`b85dac9587f2f997151d205e069e4f4ff091c7c5`. The Bookinfo application images are
the upstream sample's `1.20.3` images. Matching the Istio minor line does not
imply that AKS uses the same upstream patch image.

### Why managed Istio and CNI

On this AKS Automatic cluster, admission policy reserves the default Istio
validator name and disallows self-managed pod-mutating webhooks. The supported
installation is the AKS-managed mesh add-on, not an OSS Helm injection webhook.
The initial failed Helm attempt was reconciled: the managed add-on adopted the
CRDs, and only the obsolete failed-release record and unused reader account were
removed. No managed CRDs, webhooks, or admission policies were deleted.

The CLI initially selected `InitContainers`. AKS rejected its `NET_RAW`
capability, so the managed mesh was switched to the documented `CNIChaining`
mechanism. Bookinfo now uses `istio-validation` with `drop: [ALL]`; its native
Envoy sidecar appears among restartable init containers. Do not add security
exemptions or place application workloads in protected namespaces.

References: [managed Istio installation](https://learn.microsoft.com/en-us/azure/aks/istio-deploy-addon)
and [managed Istio CNI](https://learn.microsoft.com/en-us/azure/aks/istio-cni).

### Reproduce the environment

These commands **change the selected cluster** and can cause AKS to provision
worker capacity. Use them only after selecting the intended test environment.
Do not run the fixture teardown against a shared or production installation.

```sh
CONTEXT=mitch-auto
SUBSCRIPTION='<subscription-id>'
RESOURCE_GROUP='<resource-group>'
CLUSTER='<aks-cluster-name>'
LOCATION='<azure-region>'

az aks mesh get-revisions --subscription "$SUBSCRIPTION" --location "$LOCATION" -o table
az aks mesh enable --subscription "$SUBSCRIPTION" \
  --resource-group "$RESOURCE_GROUP" --name "$CLUSTER" --revision asm-1-30
az aks mesh proxy-redirection-mechanism --subscription "$SUBSCRIPTION" \
  --resource-group "$RESOURCE_GROUP" --name "$CLUSTER" --mechanism CNIChaining

kubectl --context "$CONTEXT" rollout status deployment/istiod-asm-1-30 -n aks-istio-system
kubectl --context "$CONTEXT" rollout status daemonset/azure-service-mesh-istio-cni-addon-node -n aks-istio-system
kubectl --context "$CONTEXT" apply -f test-files/deploy/namespaces.yaml
kubectl --context "$CONTEXT" apply -k test-files/deploy/bookinfo
kubectl --context "$CONTEXT" apply -k test-files/deploy/prometheus
kubectl --context "$CONTEXT" wait --for=condition=Available deployment --all -n bookinfo --timeout=10m
kubectl --context "$CONTEXT" rollout status deployment/prometheus -n istio-system --timeout=10m
```

Inspect `serviceMeshProfile` first on an existing mesh; do not rerun enable or
change revisions blindly. These fixtures assume `asm-1-30`; select a compatible
available revision and update the namespace label for other environments.
Keep the current kubeconfig unchanged by using explicit `--context`.

Kustomize overlays add CPU/memory requests and memory limits to the otherwise
unchanged samples because AKS enforces resource requests. The cluster may apply
additional resource/default scheduling mutations. It emitted advisory image and
missing-probe warnings for the upstream samples, but admitted them; no policy was
weakened. These are demo manifests, not production deployment recommendations.

Prometheus uses ephemeral storage and the example's cluster-scoped scrape RBAC.
Bookinfo and Prometheus Services are ClusterIP only: no public ingress or
LoadBalancer was created.

### Exercise traffic and check metrics

Open a temporary, loopback-only forward:

```sh
kubectl --context mitch-auto -n bookinfo port-forward service/productpage 19080:9080 --address 127.0.0.1
```

In a second terminal, generate bounded traffic:

```sh
for i in $(seq 1 75); do
  curl --fail --silent --show-error http://127.0.0.1:19080/productpage > /dev/null || break
  sleep 1
done
```

Then query through the same Kubernetes Service proxy pattern the plugin uses:

```sh
kubectl --context mitch-auto get --raw \
  '/api/v1/namespaces/istio-system/services/prometheus:9090/proxy/api/v1/query?query=istio_requests_total%7Bdestination_workload_namespace%3D%22bookinfo%22%7D'
```

Stop the port-forward with Ctrl-C when finished. No persistent traffic generator
is installed; generate traffic again when testing rate-based views.

Observed verification: all six Bookinfo pods were ready with sidecars, all six
Prometheus Bookinfo scrape targets reported `up=1`, and successful productpage
requests produced Istio metrics for productpage-to-details/reviews and
reviews-to-ratings. The actual Headlamp Desktop `ApiProxy.request` also returned
those metrics using `cluster: 'mitch-auto'`.

The optional `istioctl proxy-status` probe could not create its RPC credentials
in the managed namespace under this caller's permissions. No protected namespace
policy or service-account permissions were changed to force that diagnostic.
This does not prevent the verified application traffic or Prometheus queries.

### Live scenario matrix

| Fixture | State | Intended plugin evidence |
| --- | --- | --- |
| `deploy/bookinfo/bookinfo-running.yaml` plus overlay | Six healthy, injected application deployments | Workloads, Services, app/version correlation and native sidecar detection |
| `deploy/prometheus/prometheus-running.yaml` plus overlay | Ready Prometheus with healthy Bookinfo scrape targets | Existing-service discovery and proxied metric queries |
| Bounded productpage traffic | Requests traverse details, reviews and ratings | Observed traffic edges, request rates and protocol health |

Only the requested healthy sample was installed. The first native browsing and
connection-settings views have now been exercised against it in Desktop and
hosted-web mode. Error-state cluster fixtures and full mesh/traffic analysis
remain future work; healthy cluster data does not establish full Kiali parity.

### Desktop debug target

Fully quit Headlamp and launch it from your own terminal:

```sh
/Applications/Headlamp.app/Contents/MacOS/Headlamp \
  --remote-debugging-port=9222 \
  --remote-debugging-address=127.0.0.1
```

In another terminal while Headlamp stays open:

```sh
curl --fail http://127.0.0.1:9222/json/list
```

A `page` target for Headlamp is required. Enable Plugin Development Mode under Settings >
Plugins if available. Keep this port local: CDP grants control of the app.
The supplied Desktop target was successfully attached and its SDK was used to
read the installed Prometheus; it is not necessary to relaunch it while that
target remains available.

### Explicit teardown

Cleanup is **not automatic**. If these resources remain dedicated to this demo,
review and run:

```sh
kubectl --context mitch-auto delete -k test-files/deploy/bookinfo
kubectl --context mitch-auto delete -k test-files/deploy/prometheus
# Only if no other workloads now use the managed mesh:
az aks mesh disable --subscription "$SUBSCRIPTION" \
  --resource-group "$RESOURCE_GROUP" --name "$CLUSTER"
```

Do not manually delete managed CRDs or webhooks. Remove the demo namespaces only
after confirming they contain no resources added by other users.

### Upstream sample provenance

| Local upstream file | Istio source | SHA-256 |
| --- | --- | --- |
| `deploy/bookinfo/bookinfo-running.yaml` | `samples/bookinfo/platform/kube/bookinfo.yaml` | `ec82aaf76a031b83b26126da65e04e56c5791f0825ee2382d5c05801d4406bc5` |
| `deploy/prometheus/prometheus-running.yaml` | `samples/addons/prometheus.yaml` | `429abcb6cb74b6045d8787c66add166aa6ca77889835107bdea8dfb46dd1eca8` |

Both are pinned to the commit above and preserve upstream licensing headers.
Local changes live in the adjacent `kustomization.yaml` files.

## Normal checks

```sh
npm run parity:check
CI=1 npm test
npm run tsc
npm run lint
npm run build
```

Ordinary tests need only the plugin's existing npm dependencies. Go is needed
only when regenerating source inventories or the independent oracle.

The native-slice tests additionally cover per-cluster configuration validation
and merging, explicit request scope, unsafe endpoint rejection, 401/403/404
classification, late responses after cancellation, Kubernetes readiness, settings
UI save/reset/check behavior, and resource rendering against older host models.
These run alongside the upstream health oracle in the existing Vitest command.
See the parity ledger for the separate live Desktop/web evidence and host
limitations; unit results alone do not establish runtime parity.

## Correlation fixtures and label oracle

`correlation/label-oracle.json` contains 75 cases independently executed against
the original Kiali label-priority methods and their initialization block. It
covers every combination of default label presence, empty values, custom pairs,
and the upstream fallback behavior when only one override is set. The settings
UI deliberately requires a complete valid override pair.

Regenerate or check it using the same pinned checkout:

```sh
node scripts/parity/correlation-oracle.mjs --source /path/to/kiali
node scripts/parity/correlation-oracle.mjs --source /path/to/kiali --check
```

The generator verifies all source Git blob hashes before executing copied
standard-library-only Go code. Its additional source references are:

| Source | Git blob |
| --- | --- |
| `config/config.go` | `fbde570684b760495782fce1df801d9c0046723e` |
| `models/workload.go` | `8070c2c4423dee1ef6629e94ffd299e57c03c843` |
| `business/apps.go` | `9c2d919d2629fefb5d2719fcc6212a91fb55731c` |
| `kubernetes/filters.go` | `1f5c24f5819ff1e633f848d1534b6f29ba53ca2a` |

Only label resolution is executed by that Go oracle. Ownership, Service
association and UI behavior have separate synthetic tests and live Bookinfo
evidence; they are not claimed to have a complete upstream differential oracle.

| Correlation scenario | Expected behavior |
| --- | --- |
| Bookinfo-shaped controller/ReplicaSet/pod chain | Four applications; reviews has three versions, one Service and three pods |
| Same names/UIDs in different scopes | No cross-cluster or cross-namespace association |
| Stale, missing, mismatched or cyclic owner references | Explicit uncertainty; no name-only ownership fallback |
| Empty Service selector | No automatic workload/pod association |
| Metadata labels differ from template labels | Template labels for replica controllers; metadata labels for Jobs/CronJobs, matching pinned Kiali behavior |
| Native `istio-proxy` init container | Counted as a native sidecar only with `restartPolicy: Always` |
| Failed or capped paginated read | Earlier data retained with incomplete status, not an empty successful list |
| Labels changed in settings | Recomputed application groups without losing the metrics endpoint |

The live Bookinfo view was checked through the actual Desktop UI. A temporary
valid-but-absent label override yielded six unlabelled workloads; restoring the
original configuration restored the four applications. No cluster objects were
changed for these checks.

## Reproduce the pinned evidence

Use a local checkout of public `kiali/kiali` at
`0e8be887b8217bbcac5e3ae0bfcd258073949cca` (`v2.33.0`). Do not use master or a
modified source tree. Download its complete GitHub tree response:

```sh
gh api 'repos/kiali/kiali/git/trees/0e8be887b8217bbcac5e3ae0bfcd258073949cca?recursive=1' \
  > /path/to/kiali-tree.json
```

From this plugin directory, using Go 1.23 or later:

```sh
GO111MODULE=off GOPROXY=off GOTOOLCHAIN=local go test ./scripts/parity
GO111MODULE=off GOPROXY=off GOTOOLCHAIN=local go run scripts/parity/main.go \
  -source /path/to/kiali \
  -tree /path/to/kiali-tree.json
node scripts/parity/frontend.mjs --source /path/to/kiali
node scripts/parity/health-oracle.mjs --source /path/to/kiali
npm run parity:check
```

Add `-check` to the Go generator and `--check` to the Node generators to verify
byte-for-byte reproducibility without changing committed output.
The inventory generator rejects the wrong commit, truncated trees, modified
source blobs, duplicate identities, and missing required source files. The Node
generators recheck the selected source hashes against that inventory.

`scripts/parity/health-oracle.mjs` copies the original health-model Go functions
and the two required structs into a temporary standalone program, changes only
the package name, and invokes Go with module/network lookup disabled. It executes
no Kiali server or third-party code outside those pinned model functions and the
standard-library test adapter. The temporary directory is removed after execution.
Expected outputs never come from the TypeScript functions being tested.

## Scenario matrix

| Fixture | Scenarios | Expected contract |
| --- | --- | --- |
| `parity/upstream.json` | Every selected pinned source and Go declaration | Stable source identity, operation/check/default coverage |
| `parity/frontend.json` | Routes and individual graph/health/wizard fields | Resolved paths and preserved source definitions |
| Health oracle: priorities | Five Kiali statuses plus unknown | Exact priority, unknown priority zero |
| Health oracle: merges | Every ordered status pair | Worst status, second argument on equal priority |
| Health oracle: workloads | Null plus replica/proxy cross-product | NA differs from scaled-down; partial readiness and proxy sync follow upstream precedence |
| Health oracle: requests | Missing/empty/zero traffic, HTTP errors, gRPC/TCP codes, fractional rates, both directions | No-data sentinel and exact fallback aggregation; no claim of full protocol-aware health |

Normal tests compare TypeScript output against 375 independent oracle cases.
The fixture guard and two focused boundary tests also run in Vitest. Metric
ratios/rates use an absolute tolerance through 12 decimal places for floating
point accumulation; status values and classifications are exact.

## Attribution

The ported health logic, generated source metadata and expected outputs derive
from Kiali's Apache-2.0 source:

- `models/health_status.go`, Git blob `1aab7bf024eac81f1e8093a85cbad040c4eb6f27`
- `models/health.go`, Git blob `d3df3111150fc1143c7678fdf73c3b898a0e0487`
- Related upstream tests: `models/health_status_test.go`

See [LICENSE](../LICENSE), [NOTICE](../NOTICE), and the source links in
[docs/parity.md](../docs/parity.md). Regeneration should be reviewed like code:
do not update expected outputs merely to make a divergent port pass.
