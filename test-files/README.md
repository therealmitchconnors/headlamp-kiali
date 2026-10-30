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

The latest observed managed control-plane image is
`mcr.microsoft.com/oss/v2/istio/pilot:v1.30.5-3`; AKS manages its servicing.
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
npm run resources:check
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

### Full health calculator oracle

`parity/health-calculator.json` contains 271 outputs from checksum-verified,
original Kiali v2.33.0 `business/health_calculator.go`, `business/health_config.go`
and supporting model/config blocks. Only package adapters and logging glue are
substituted; expected results are not calculated by TypeScript.

```sh
node scripts/parity/health-calculator-oracle.mjs --source /path/to/pinned/kiali
node scripts/parity/health-calculator-oracle.mjs --source /path/to/pinned/kiali --check
```

The standalone Go execution uses no downloaded Go dependencies. Vitest consumes
the committed outputs without requiring Go. The parity ledger records deliberate
input bounds and non-finite/hex/underscore threshold rejection.

The post-reset live hosted check used bounded productpage requests, no new
cluster objects. The measured Istio cluster label was `Kubernetes`. Request-rate
and p95 charts, six graph edges and reviews-v1 health were verified against real
Prometheus data. A custom browser-local tolerance was saved, reloaded, exercised
and restored to `[]`; no resource annotations were changed. Headlamp ConfigStore
debounces persistence, so wait for the save to reach storage before reloading.
The last check still showed zero Prometheus restarts. Memory-limit increases are
now authorized if needed; the checked deployment and overlay remain unchanged.

### Application and Service health

The Health page now supports both entity types. `entityHealth.test.ts`,
`data/entityHealth.test.ts` and `components/EntityHealth.test.tsx` exercise
canonical-vs-logical application identities, Service inbound-only rates and
annotations, controller aggregation without owned-ReplicaSet duplication,
missing/denied/stale/partial evidence, cancellation, timestamp consistency and
duplicate metric rejection. The pure rate aggregator retains its existing
same-code summation behavior; duplicate raw vector identities are rejected by
the transport adapter.

For a live check, generate bounded productpage GETs, then open Health with
`kind=Service&namespace=bookinfo&name=reviews` or the corresponding Application
target. Enter telemetry cluster `Kubernetes`; Application additionally requires
canonical service `reviews`. The hosted check observed Service request health
and application health across three 1/1/1 Deployments. An absent metric cluster
yielded unavailable health. After traffic aged out, the Service was Not assessed
and the app was explicitly replica-only; no healthy-request default appeared.
Application/Service links retained exact targets. No response fixture,
annotation update or resource mutation was used.

### Request reporter oracle

`parity/health-reporters-oracle.json` executes 372 cases through the original
pinned `models/health.go` reporter aggregation functions. The generator verifies
the blob and substitutes only a minimal Prometheus Sample type and logging stub.

```sh
node scripts/parity/health-reporters-oracle.mjs --source /path/to/pinned/kiali
node scripts/parity/health-reporters-oracle.mjs --source /path/to/pinned/kiali --check
```

Core tests retain legacy unknown-reporter behavior; adapter tests deliberately
reject missing reporter labels in combined mode. They also cover per-code max
instead of reporter sums, no-response precedence over gRPC status, HTTP fallback
when gRPC status is absent, source-only outbound and the single-mode contract.
Three real hosted health subjects used combined mode after 18 productpage GETs.
Separate intercepted rate vectors verified source-only errors, mode switching,
gRPC response-code 0 and missing reporter fields. No cluster object changed.

## Configuration schema fixtures

`configuration/schemas.json` is a sanitized capture of the 14 installed
Kiali-supported Istio CRD spec/status schemas and printer columns. Cluster object
metadata, credentials, defaults and descriptions are not included. It captures
all served versions, including Telemetry's stored v1alpha1 representation.

`scripts/generate-resources.mjs` produces the corresponding typed spec aliases,
one resource class per kind, and the registry with printer/summary columns:

```sh
npm run resources:generate
npm run resources:check
```

For an intentional schema refresh, capture only the intended CRDs into a scratch
JSON file, then run `node scripts/generate-resources.mjs --capture /path/to/crds.json`.
Review schema/version and generated-type changes before accepting them. Runtime
classes use the documented `K8s.cluster.KubeObject` barrel, not a private host
module. Each discovery-gated class owns its API endpoint cache; changing clusters
does not mutate the shared model's supported versions.

`configuration/gateway-schemas.json` adds nine Gateway API/inference kinds from
the exact dependencies in pinned Kiali's go.mod: Gateway API 1.6.0 and
inference-extension 1.5.0. It records repository/commit/path/blob provenance and
includes the Gateway API experimental schema fields. Those APIs are absent in
the live verification cluster. No installation was attempted.

```sh
# Explicit network refresh; each downloaded file must match its pinned Git blob.
node scripts/generate-resources.mjs --capture-gateway
npm run resources:check
```

Ordinary generation/checks are offline and cover all 23 kinds, spec/status types,
served versions, printer columns and scope. GatewayClass is cluster-scoped;
Istio and Gateway API Gateway have independent classes/routes. The combined
schema SHA-256 is `a905191a84771db27899f1ce19a4c83ca696f03eb684036b1a41df782e4ad27f`.
`configuration/gateway-fixtures.json` supplies synthetic GatewayClass, Gateway,
HTTPRoute and InferencePool data; none was applied. Tests cover cluster-scoped
SSAR/metadata/paths, condition printer filters, group-aware references and nested
parent/listener conditions without dropping other fields.

`configuration/fixtures.json` contains synthetic routing/policy/status examples.
They have **not** been applied to the cluster. Nested rendering tests assert that
all supplied fields remain visible; API tests cover discovery failures, version
selection, permission denial, dry-run, UID/version conflicts, delete preconditions,
cancellation and unknown write outcomes. Browser checks intercepted only the
fixture responses and writes; no fixture write reached Kubernetes.

The limited checker source references are pinned Kiali v2.33.0:
`business/checkers/virtualservices/route_checker.go`, `subset_presence_checker.go`,
`business/checkers/common/workload_selector_checker.go`,
`business/checkers/common/export_to_namespace_checker.go`,
`business/checkers/k8shttproutes/{no_k8sgateway_checker,no_host_checker}.go`,
`business/checkers/k8sgrpcroutes/{no_k8sgateway_checker,no_host_checker}.go`,
`business/checkers/k8sgateways/multi_match_checker.go`,
`business/checkers/k8sreferencegrants/namespace_checker.go`, and diagnostic
descriptors in `models/istio_validation.go`. Twenty bounded finding codes,
including dynamic GWAPI findings, are ported.
Their tests are source-derived cases, not a full Go differential checker oracle.

Checker activation matters as well as helper outputs: the pinned
`service_entry_checker.go` and `gateway_checker.go` do not enable their
port-name helpers. Regression tests ensure arbitrary port names do not produce
KIA0601 on those CRDs. The 564 original-Go local-helper cases remain valid
helper evidence; they do not enable a checker. Kubernetes Service port
validation has different mesh/appProtocol guards and remains separate work.

The KIA0004 caller audit gates the generic helper to security-group
AuthorizationPolicy/PeerAuthentication/RequestAuthentication `selector.matchLabels`
and networking-group Sidecar `workloadSelector.labels`. Test both complete and
incomplete inputs for inactive kinds/wrong groups, exact field selection,
empty/null selectors, malformed/oversized maps, and matching labels in the wrong
cluster/namespace. The UI must keep active absence checks deferred until complete
mesh-workload inclusion is supplied; do not substitute the bounded application
snapshot's `complete` flag.

Hosted checks intercept owned Telemetry, WasmPlugin and RequestAuthentication
GETs. Inactive kinds must not claim a workload-selector deferral; the active
RequestAuthentication still must. A malformed active selector must produce a
specific deferred reason, not a finding or an ignored error. Retain the global
partial-coverage disclaimer. Four scenarios/eight resource GETs passed with no
settings or cluster mutations. The targeted suite passed 334 tests in five files.
The preceding dashboard checkpoint `08b4021` passed 19,978 tests in 176 files.

Namespace revision selection has an independent source-pinned oracle:

```sh
node scripts/parity/namespace-revision-oracle.mjs --source /path/to/pinned/kiali --check
```

Its 1,538 cases execute original `GetRevision` and ambient-label projection code.
Test the native provenance separately: Maistra membership and ignore presence,
enabled-injection precedence, ambient defaults and explicit empty revisions.
Do not conflate this selector with Namespace DTO injection revision, actual
injection, controller resolution or complete managed-namespace membership.

Hosted checks use synthetic namespace/controller/configuration GETs only.
Show revision candidates alongside existing conflicting-label diagnostics.
Keep Maistra-only rows visible, block coincident Istiod assessment links unless
the configuration context is ready, and preserve own/root exceptions. Toggle
the local filter without requests; malformed relevant labels must not fall back.
Hold discovery for its shared deadline and retry explicitly. Four groups made
eighteen GETs and measured 15,544 ms. Actual Bookinfo labels matched the displayed
`asm-1-30` candidate without interception. The focused increment passed
1,713 tests in eight files. No settings or cluster resources were changed.
The full shared mesh-consumer suite passed 21,564 tests in 177 files. Browser
fixture initialization must positively verify the seeded schema/cluster slice
as well as ConfigStore/localStorage equality; two undefined values are not a
successful persistence check.

Same-context revision-tag selection has a separate source-pinned oracle:

```sh
node scripts/parity/revision-tag-oracle.mjs --source /path/to/pinned/kiali --check
```

Its 364 cases execute the original collection and assignment loops from
`Discovery.setTags` with one managed context. Type shims replace client/model
dependencies; no source algorithm is rewritten. Cases retain webhook order,
duplicate revisions, missing/empty revisions and explicit empty tags.
The native namespace-consumer tests separately prove that selected tags replace
raw revisions, ignored aliases do not match, equal tags across revisions remain
ambiguous, and empty tags prevent fallback. This does not cover cross-cluster
last-assignment behavior, complete managed membership or Service checker scope.

Hosted tag checks should reverse first/later webhooks, create equal-tag ambiguity,
retain missing-revision unsuffixed ConfigMap reads, inspect empty tags, and deny
tag reads. Inspect own/root assessment links for explicit context and serialized
query parameters, including Maistra-labelled own/root namespaces. Expanding
precedence details must work by keyboard without fetching. Do not apply any of
these synthetic webhooks or controllers to the cluster.
Five hosted groups made 37 intercepted GETs; the earlier namespace fixture also
passed with 18 GETs and a 15,049 ms deadline. The actual Bookinfo candidate
remained `asm-1-30`. Focused tests passed 1,958 cases in five files and the full
shared-consumer suite passed 21,932 cases in 178 files.

ServiceEntry KIA1211/KIA1212 tests cover complete-source and UID/spec freshness
gates, exact case-insensitive host/port groups, differing protocols, namespace
exports/defaults, ambient source/viewer behavior, Sidecar import filtering and
de-duplicated peer references. In particular, two entries with different
imported hosts can still conflict on a shared unimported host: the pinned
import filter retains each complete ServiceEntry if any host is imported.
Non-ASCII or over-capacity inputs defer the check; no truncated result is
presented as complete.

```sh
node scripts/parity/service-entry-oracle.mjs --source /path/to/pinned/kiali --check
```

The 398 cases execute original grouping/classification code with a recording
output callback, not a rewritten TypeScript implementation. They are not a
whole-validator oracle. Tests are `src/core/serviceEntryValidation.test.ts`,
`src/data/serviceEntryValidation.test.ts` and the configuration Validation
component tests. Hosted interception verified six cases plus scoped peer links
and keyboard dialog access. A real positive fixture still needs approval;
none was applied.

DestinationRule conflict tests reuse the same captured context and related
configuration dialog. They cover KIA0201 host/subset overlap, exact TLS-default
exceptions, export/default/import visibility, input-order edge cases and
selected UID/spec freshness. Reproduce the 1,087 original-Go pair cases with:

```sh
node scripts/parity/destination-rule-oracle.mjs --source /path/to/pinned/kiali --check
```

The oracle executes source checker/host/subset/TLS functions with a pair-recording
output callback; it does not independently cover collection provenance or the
entire visibility pipeline. Eleven hosted scenarios intercepted only test
DestinationRule reads. Any temporary DNS setting must be restored with the
ConfigStore persistence wait. Do not invent an autogenerated-name exclusion:
the pinned DestinationRule filter retains all rules.

KIA0204 tests preserve the source's `ParseHost` behavior, non-local defaults,
explicit same-host TLS peers and top-level/port-level presence semantics.
Empty TLS objects and disabled mode count as supplied settings; subset-only
TLS does not. Reproduce the 1,800 original-Go cases with:

```sh
node scripts/parity/destination-tls-oracle.mjs --source /path/to/pinned/kiali --check
```

`src/core/destinationRuleTls.test.ts` checks the native composition, visibility,
freshness, limits and ignore annotation. Twelve hosted fixture cases also proved
the qualified warning and peer link. Preserve the explicit warning that these
patterns are not observations of encryption. Restore any temporary DNS setting
durably and remove interception; no fixture was applied to the live cluster.

Sidecar root-selector KIA1006 uses the active `sidecars.GlobalChecker` and
per-namespace root configuration. Reproduce its 72 original-Go cases with:

```sh
node scripts/parity/sidecar-root-oracle.mjs --source /path/to/pinned/kiali --check
```

Core/data tests cover root and ordinary namespaces, nil/empty selectors, the
100-label bound, unknown roots, denied or ambiguous sources, configured discovery
exclusions, captured cluster/cancellation and annotation suppression. The Go
oracle covers the checker itself, not native controller association. Nine hosted
scenarios intercepted Sidecar GETs; root/non-root cases used the real managed
mesh configuration (`rootNamespace: aks-istio-system`). ConfigMap/controller
responses were intercepted only for unavailable-context scenarios. No Sidecar
was created and no setting changed; remove every handler in `finally`.

Sidecar KIA1004 has a separate 288-case checker/Service-registry oracle:

```sh
node scripts/parity/sidecar-egress-oracle.mjs --source /path/to/pinned/kiali --check
```

Core/data/UI tests cover the three Service host aliases, Go-compatible export
annotations (including explicit empty values), namespace-specific defaults,
unknown relevant visibility, ServiceEntry exports/ambient scope, complete-list
guards, the exact record/host/comparison/annotation budgets and suppression.
The helper intentionally preserves the pinned ServiceEntry suffix predicate
and ignores the namespace prefix when parsing a concrete egress DNS name.
Null listeners retain their actual JSON field index in native findings.

Fourteen hosted scenarios used intercepted Sidecar GETs with actual Bookinfo
Service/ServiceEntry/configuration data for existing/missing-name cases. Other
scenarios intercepted Service exports, mesh defaults, ServiceEntry visibility
and denied reads. All were read-only. Restore any temporary DNS setting, wait
for persistence and remove every handler. The warning is not evidence of
reachability or effective Sidecar enforcement.

VirtualService destination checks reproduce 576 original-Go cases:

```sh
node scripts/parity/virtual-service-registry-oracle.mjs --source /path/to/pinned/kiali --check
```

Core/data/UI tests cover registry exports, `GetHost` aliases, all forwarding
protocols, nil indexes, complete-source guards, exact limits, ignored findings
and captured resource/source inputs. Policy cases distinguish omitted policy
(`ALLOW_ANY` baseline default) from a present empty policy (`REGISTRY_ONLY` zero
value), shared/local precedence and numeric/text modes. The pinned API's
`ALLOW_ANY_DYNAMIC_DNS` remains an error under Kiali's classifier.

Fourteen hosted scenarios intercepted the selected VirtualService and needed
configuration/failure sources. Existing Bookinfo matching used live registry
data. Also click **Discover mesh** before checking the configured-mode inventory
column; navigating to that page alone does not issue discovery reads.
Restore DNS settings and await persistence. No routing fixture was applied.

VirtualService host-conflict grouping reproduces 400 original-Go cases:

```sh
node scripts/parity/virtual-service-conflict-oracle.mjs --source /path/to/pinned/kiali --check
```

The runner executes the pinned `SingleHostChecker` grouping and host helpers,
instrumenting only the output sink for distinct references. Native core/data/UI
tests additionally cover caller export/import selection, captured UID/relevant
specification, malformed/oversized context and exact 20,000-contribution bounds.
Preserve omitted-versus-`mesh` gateways, duplicate self-contributions, namespace
wildcard buckets, and whole-object imports. Two objects can conflict on an
unimported host after each was retained through a different imported host.

For hosted verification, intercept only owned VirtualService detail/list and
Sidecar list reads. Keep Namespace/managed mesh discovery real; never apply
these objects to manufacture evidence. The latest 16 scenarios observed 30
configuration-list GETs and covered export defaults, private/generated peers,
wildcards, self duplicates, imports, stale UID/spec, denial, ignore annotations,
missing DNS and a 15,132 ms timeout/retry. A timeout must show Unavailable rather
than successful empty checks. Inspect the related UID and explicit cluster
link, then follow it to the correct kind/namespace/name. Also rerun the eleven
Gateway collision cases because the related-links renderer is shared.
Wait for ConfigStore persistence after restoring settings, remove handlers,
close the isolated browser and stop the hosted helper. Live VirtualServices
were absent; these positive cases do not establish controller behavior.

Istio Gateway host conflicts reproduce 328 original-Go grouping/matching and
validation-reference merging cases:

```sh
node scripts/parity/istio-gateway-conflict-oracle.mjs --source /path/to/pinned/kiali --check
```

Local source/configuration/UI and 22 hosted scenarios pass. Use synthetic
Gateway objects scoped to `networking.istio.io`, keeping
Gateway API discovery separate. Cover case-folded and subdomain matches,
different subdomain wildcards, current/explicit/disjoint target namespaces,
selector/port differences, ignored protocol differences, duplicate self hosts,
generated peers, stale UID/port, denied lists, invalid patterns, suppression,
timeout/retry and in-flight saved-setting changes. Use Settings to toggle
**Skip bare wildcard hosts in Istio Gateway conflict checks**, save, wait for
ConfigStore persistence and hard reload. Check that true excludes bare `*`
comparisons but still checks `*.example.com`; false is the pinned default.
Follow an observed-UID link to the Istio Gateway detail, not the Gateway API
detail. The prepared runner also restores the original settings and closes its
isolated browser. Live Istio Gateways were absent; do not install fixtures
without permission. Re-run the existing Gateway API/VirtualService cases.
The latest run observed 23 Gateway-list GETs and a 15,391 ms deadline, followed
by successful retry and rejection of an old in-flight result after the setting
changed. Eleven Gateway API and sixteen VirtualService regression scenarios
passed, with no writes or plugin errors.

PeerAuthentication pattern checks reproduce 348 original-Go cases:

```sh
node scripts/parity/peer-authentication-oracle.mjs --source /path/to/pinned/kiali --check
```

The separate KIA0002 selectorless branch reproduces another 176 cases:

```sh
node scripts/parity/peer-selectorless-oracle.mjs --source /path/to/pinned/kiali --check
```

Its source constructor and selectorless traversal include absent/null/empty
selectors; do not apply the mTLS-pattern exclusion below to this branch.
Native tests cover immutable identity, normalized selector freshness, denied
or unresolved mesh context, same-namespace peers, ignored findings, and exact
10,000-label/1,000,000-character limits. No KIA0003 overlap is inferred from
selector equality or raw Pods.

Eighteen hosted cases observed 17 policy-list GETs and a 15,401 ms deadline.
Intercept owned detail/list objects, but keep namespace/controller scope real
unless testing denial. Check no unused list read for nonempty selected labels
and no unused mesh configuration read after list denial. Generated policy
names remain eligible. Same-namespace links must show the observed UID and
reach the PeerAuthentication detail. Re-run the prior 19 mTLS/root-fallback
cases, supplying the selected synthetic policy in the newly read list so
freshness is meaningful; they must not invent a selectorless conflict for
one policy. No actual PeerAuthentications were installed.

Preserve the distinction between absent and empty selectors: any present
selector excludes the mTLS-pattern checkers. Preserve DestinationRule iteration order,
top-level-only TLS, `ISTIO_MUTUAL` versus `MUTUAL`, automatic-mTLS shortcuts,
export provenance and the 1,000-record bounds. Related-rule links retain
observed UID and cluster scope.

Nineteen hosted scenarios covered the four codes and root fallback across the
Sidecar, mesh and configured-mTLS surfaces. Root fallback requires resolved
configuration and an observed controller namespace; a ConfigMap denial is not
permission to guess a root or a successful indicator. Existing missing-root
fixtures must now expect the controller-namespace fallback where that evidence
is complete. All objects were intercepted and settings restored.

DestinationRule counterpart policies reproduce 984 original-Go cases:

```sh
node scripts/parity/destination-peer-policy-oracle.mjs --source /path/to/pinned/kiali --check
```

The oracle includes the real namespace/root peer filter and four active
checkers. Native tests additionally prove complete group-correct collections,
selected UID/spec/export freshness, unrelated-namespace exclusion, explicit
DNS requirements, record bounds and ignore annotations. Preserve the different
namespace-DISABLE ordering rules in each checker family.

Twenty-two hosted scenarios intercepted the selected DestinationRule, peer
lists and required configuration responses; no object was applied. Verify
related PeerAuthentication links use the security-group route rather than the
ServiceEntry route. Restore DNS settings with the persistence wait and remove
all handlers before resuming real reads.

Istio Gateway checks additionally reference
`business/checkers/virtualservices/no_gateway_checker.go` and its call in
`business/checkers/no_service_checker.go`. Core/data tests cover modern references
without DNS, legacy references with explicit DNS, reserved `mesh`, all nested
HTTP/TCP/TLS match paths, API-group isolation, denial, malformed/oversized inputs
and ignore annotations. Browser fixtures intercept only the test VirtualService
GET and the Istio Gateway collection GET. Verify KIA1102 on missing targets,
KIA1108 plus DNS deferral for legacy names, no absence finding on 403, and no
legacy warning for an explicit namespace/dotted.name reference. Never apply
the fixture or treat empty intercepted lists as live cluster evidence.

AuthorizationPolicy pattern helpers have a separate 296-case original-Go oracle:

```sh
node scripts/parity/authorization-oracle.mjs --source /path/to/pinned/kiali --check
```

Pinned sources are `authorization/namespace_method_checker.go`,
`models/namespace.go` and `util/httputil/http_util.go`. Tests include every
standard HTTP method, prefix/suffix/presence forms, Unicode whitespace and case
expansion traps, exact namespace names, wildcard ordering and empty evidence.
Core/data integration tests check precise field paths, malformed/oversized
inputs, ignored findings and method-only operation without namespace requests.
Hosted fixtures used a synthetic AuthorizationPolicy with real namespace reads;
a separate 403 case proved that method findings survive unavailable namespace
context without manufacturing missing-namespace findings. No policy was applied.
These are positive namespace/method checks, not principal validation or effective
authorization enforcement.

WorkloadGroup label checks follow
`business/checkers/workloadgroups/duplicate_labels_checker.go`. Core/data tests
cover label ordering, absent/empty metadata, delimiter collisions, captured UID,
fresh label evidence, namespace-scoped API paths, denial, malformed peers and
suppression. Browser fixtures intercept only the test object's GET and its
namespace's WorkloadGroup collection. Assert no cluster-wide list request,
and no finding after UID/label drift or a cross-namespace response. Include
synthetic creation timestamps when capturing detail-page screenshots so a
fixture omission does not create an unrelated "Invalid Date" display.

Do not implement KIA1701 by substituting ServiceAccount object existence:
the pinned source builds its account identities from observed workloads.
Likewise KIA1504 needs configured/discovered GatewayClass registry semantics,
not only raw API existence.

### Explicit telemetry identity

`telemetryIdentity.test.ts`, `TelemetryIdentity.test.tsx`, settings tests and
the shared query hook cover optional saved identities, exact limits, null
clearing, manual overrides and no inference from context names. All five
consumer paths (metrics, topology, workload/Application/Service health) assert
captured identity and cancellation/no replay on endpoint or identity changes.
Equal but newly allocated settings must not retrigger reads.

Seven hosted checks intercepted twenty-three provider GETs (including the
overview connection probe), while health used read-only real Bookinfo resource
evidence. The initial fixture found endpoint-reference churn causing refetches;
the submitted settings are now cloned and kept stable. No settings remain
changed after the test, and no broad unscoped query is sent for a missing label.

### Graph resource candidates

Core tests keep metric and Headlamp identities separate, reject duplicate/
unknown mappings and invalid or overlong reported name lists, match supported
workload kinds without guessing on collisions, and require correct namespace
scope and resolved ownership. Data tests capture targets before deferred work,
assert the nine standard bounded namespaced source reads plus optional VM API
discovery and complete group/entry evidence, and handle incomplete lists and
ignored transport aborts. UI tests require an explicit button and invalidate
candidate links after node or mapping changes.

Seven hosted cases used synthetic topology samples and real read-only Bookinfo
resources for workload/application/Service candidate paths. Negative fixtures
deny a Pod list, add a same-named StatefulSet or report an unobserved/unmapped
name. Fifty-four resource reads occurred and no writes. Candidate UIDs are
current observations, not proof of historical graph identity or traffic origin.
Restore temporary metric endpoints/identities and remove all handlers.

### Multi-context comparison

Core tests enforce 1..8 distinct available contexts, exact metric/endpoint
capture and duplicate-identity disclosure. Transport tests measure three active
reads, exercise per-source denial/absence/malformed responses, preserve
zero versus missing metrics, verify per-target deadlines with ignored SDK aborts
and stop queued work on cancellation. UI tests retain explicit selection,
correct single-context links, partial visibility and no connection-change replay.

Three hosted scenario groups injected eight synthetic contexts into the public
Headlamp `/config` response without modifying kubeconfig or private Redux state.
All thirty-five scoped API/provider GETs were intercepted, with measured peak
concurrency of three and no writes. Remove config and API handlers together
and restore the Kiali settings snapshot. Host errors can prefix messages with
HTTP status text; verify classification and reason without assuming an exact
SDK error-message shape. `Link.activeCluster` preserves the old selected group,
so navigation to a single-context page must use explicit `params.cluster`.

### WorkloadGroup matching entries

The optional probe evidence also has 228 independently executed original-Go cases:

```sh
node scripts/parity/workload-entry-health-oracle.mjs --source /path/to/pinned/kiali --check
```

Preserve Go boolean spellings, first `Healthy` condition order and the
default-available path for disabled/unrecognized annotations. Show those
defaults explicitly as assumptions, not a successful live probe. Test true,
false, missing, unknown, duplicate and malformed conditions; expand old
timestamp/reason/message fields without claiming freshness. Malformed probe
data must not erase a valid selector association or prevent other rows rendering.
Three hosted groups covered these eight cases and partial/denied/retried lists
using five intercepted GETs. No health aggregate or live VM availability is claimed.

`core/workloadGroupEntries.test.ts`, `data/workloadGroupEntries.test.ts`,
`components/configuration/WorkloadGroupEntries.test.tsx` and `mapView.test.tsx`
cover exact spec-label matching, nil/empty selectors, scoped identities,
captured inputs, typed-list envelope rules, supported versions, partial pages,
denial, cancellation/deadlines, label budgets and structural Map edges.
The relationship follows the pinned `FilterWorkloadEntriesBySelector`; empty
selectors must not become all-entry matches. These are source-informed tests,
not a new independent Go oracle.

Live CRD inspection found 256-property string label maps and no WorkloadGroup
or WorkloadEntry instances. Do not deploy VMs for this check without approval.
Intercept one owned WorkloadGroup GET with metadata/template/probe fields and
an Unknown condition; preserve all supplied detail sections and verify Conditions
directly above Events. First read the actual empty namespaced entry list.
Then intercept entries with matching spec labels but decoy object metadata,
and nonmatching spec labels with matching metadata. Check the single correct
link, address/network/account/UID fields and explicit empty values. Test missing,
empty and malformed selectors without list requests; denied/later-page/
wrong-namespace/oversized-label results must remain incomplete. Hold a request,
observe the 15-second failure and retry explicitly.

For Map verification, enable only the Kiali WorkloadGroup leaf in addition to
normal host defaults; do not enable a separate WorkloadEntry leaf. Return the
owned group and entries plus a matching-label entry in another namespace.
Use current live list resource versions in the intercepted Map envelopes to
avoid stale-watch churn. Wait for the native Custom Resources source group
before selecting Kiali, click the checkbox and wait for checked state, then
close both nested popovers. Open the collapsed WorkloadGroup node to inspect
its members and verify the source/target IDs, exclusions, SVG path and custom
detail explanation.

A horizontal SVG path may have a zero-height bounding box, and native layout
can replace it while the viewport changes. Inspect a connected path with
nonzero length/stroke/opacity rather than relying on `isVisible()` alone.
Headlamp 0.35 does not render edge captions; do not claim visible captions from
the SDK metadata. Its native source checkboxes lack accessible names, a host
limitation recorded in the parity ledger.

Eleven hosted scenarios observed 17 list reads and zero writes. The timeout
was 15,111..15,121 ms across the final checks. Successful relationships and Map nodes were synthetic; all
handlers were removed and the isolated browser closed.

### AuthorizationPolicy host registry

Reproduce the independent checker/caller evidence with:

```sh
node scripts/parity/authorization-host-oracle.mjs --source /path/to/pinned/kiali --check
```

The 960 cases execute the original KIA0104 checker, host/Service registry
helpers and `filterVSExportToNamespaces` / `filterSEExportToNamespaces`.
`core/authorizationHosts.test.ts` adds malformed/budget/unknown-context checks;
`data/authorizationHosts.test.ts` covers namespace-first pruning, captured
specification, per-kind defaults, source failures and independent method checks.
The shared validation UI test verifies the scoped-hint explanation and severity.

In hosted Headlamp, intercept only an owned synthetic AuthorizationPolicy read,
using `operation.hosts: [reviews]`, and run initial checks against real Bookinfo
registry evidence. No policy should be applied. For negative cases, intercept
Service/ServiceEntry/VirtualService lists: verify missing names, external
single-dot names, wildcard/multi-dot exemptions, exported/private/generated
VirtualServices, ServiceEntry suffix matching, denied VirtualService/Namespace
reads, ignore annotations and unset DNS. External or failed namespace evidence
must prevent registry reads. Twelve cases observed 43 registry/namespace GETs
(a mix of live reads and interceptions), with zero writes and durable settings
restoration. Do not infer HTTP-host validity or actual allow/deny enforcement.

The existing eleven-case Gateway collision fixture was also rerun with explicit
explanation-visibility assertions: KIA1501/KIA1502 show their scope warning
without a KIA0204 TLS finding; absent/suppressed conflicts do not show it.

### Traffic histogram summaries

Reproduce the original-Go query evidence with:

```sh
node scripts/parity/histogram-oracle.mjs --source /path/to/pinned/kiali --check
```

The generator checks Git blob identities for `prometheus/metrics.go` and
`business/metrics_definitions.go`, then runs the original builder for 180
metric/direction/identity/workload/summary combinations. No runtime Go is used.
`core/histograms.test.ts`, `data/histograms.test.ts`,
`components/Histograms.test.tsx` and `components/MetricChart.test.tsx` cover query
parity, invalid inputs, captured requests, worker/deadline limits, matrix bounds,
partial errors, historical scope, units and visible isolated samples.

In hosted Headlamp, select Bookinfo, its explicit `Kubernetes` telemetry identity
and duration average/P95. Both real responses in the checked window contained
one series but no finite samples; the UI correctly reported unavailability.
For synthetic checks, intercept only the configured Prometheus query-range
endpoint: use request-size average/P50/P90/P95/P99, a historical end and workload;
return a NaN gap followed by one finite average, zero-valued P90 samples, an
empty P50 result, a P95 denial and a P99 result with an unexpected label.
Confirm a visible isolated marker, bytes, the zero values, independent errors,
and a maximum of three concurrent requests. Editing metric drafts issues no new
request and does not relabel captured results; deselecting all summaries blocks
submission. Five provider requests were intercepted and no writes occurred.
Restore the exact prior Kiali settings and wait for persistence before closing.

### Custom aggregate dashboard scenarios

Reproduce the 216 original raw/rate/histogram expression cases, including grouping:

```sh
node scripts/parity/custom-dashboard-query-oracle.mjs --source /path/to/pinned/kiali --check
```

The extracted raw-query construction, rate helper and histogram builder use a
transport sink, not a backend/parser. Core/config/data/UI tests cover unsupported-field
rejection, definition/chart/text limits, metric/label validation, mandatory
cluster scoping or explicit single-cluster acknowledgment, exact capture,
negative raw values, nonnegative rates, scale overflow/underflow and the shared
time/sample/series budgets. Preserve histogram and traffic-signal regressions
when editing the generalized range reader.

For hosted verification, save eight raw/rate chart definitions through Settings,
await ConfigStore persistence, and hard reload. Return signed/scaled values,
zero/non-finite gaps, one 403 and one unexpected aggregation label. Inspect
the numeric disclosure and captured historical namespace/cluster labels.
Changing drafts must not issue requests. Changing source/definitions must
invalidate results and clear an earlier single-cluster acknowledgment. Delay
the first three requests past 15 seconds and confirm no queued jobs start;
retry explicitly. The verified run observed 27 intercepted reads, concurrency
three and 15,044..15,549 ms timeouts across reruns. A real namespace-scoped Bookinfo memory-metric
aggregate returned 61 finite nonzero samples; duplicate scrape dimensions
were not reconciled. Restore settings durably and remove handlers.
No component was installed and no configuration was written to Kubernetes.

For custom classic histogram charts, save a `histogram` definition using the
base metric name, select all five supported summaries and capture historical
time. Inspect exact sum/count and cumulative-bucket expressions, signed unit
scaling, zero/non-finite gaps and a single-quantile denial. Change a checkbox
without submitting and preserve the old capture. Add four raw charts alongside
five histogram summaries: nine requests must fail before transport. Remove one
raw chart and verify the exact eight-request dashboard succeeds. Reject empty
summaries without leaving old charts visible. Three hosted groups observed 13
intercepted GETs with concurrency three. Re-run both native Istio histograms
and raw/rate dashboard fixtures; this reuses the existing 180-case histogram
oracle without claiming new independently executed source cases.

Custom dashboard equality-filter tests cover raw/rate/histogram query paths.
Submit literal quote/backslash and empty values, then edit the draft and
inspect the unchanged captured filter table. Attempt to override namespace/
cluster/metric-name selectors, submit malformed values or Unicode, eleven
keys, and ten 1,024-character Unicode values whose encoding exceeds 16 KiB.
None may issue a query. A corrected retry must replace the capture.
The hosted fixture observed eight GETs across three groups, with no writes
or filters saved to settings/navigation. Core tests cover exactly 16,384
encoded parameter characters and the first over-limit character.

For named multi-metric charts, configure both a valid legacy `metricName` and
a nonempty `metrics` list; only the list may be queried. Use offset timestamp
sets to verify numeric alignment and explicit gaps, not summation/extrapolation.
Deny the first metric and ensure the second remains visible with its original
declared color. Switch to histogram mode and get one comparison panel per
summary; five metrics times two summaries must fail before requests. Empty
metrics must restore legacy fallback. Five hosted groups observed nine GETs,
with no writes or persisted fixture settings. Pure comparison tests cover
eight metrics, 241 samples each and 1,928 distinct union timestamps.

For saved template composition, configure a root with whole-template and
`template$Chart name` items referencing other definitions in the same cluster.
Save and hard reload; includes must remain unexpanded in Settings. Query the
root and inspect resolved chart order, included histogram controls, exact scope
labels and captured template name/title references. A shadow chart must not be
queried when its item has a nonempty include. Change an included definition and
confirm results clear without replay.

Reject missing templates/charts, cycles and repeated sibling references before
network requests; two different chart references to the same template still
count as repetition in pinned Kiali. Resolve all dependencies before selecting
a chart, even unused ones. Verify corrected retry and included metrics/summary
expansion at the eight-query bound. Core tests cover Go whitespace, first exact
match, immutable source/capture separation, extra-suffix rejection, twenty
visited templates, 64 KiB definitions and bounded subsets of larger intermediate
expansions. These tests are native/source-inspected, not new original-Go cases.
Six hosted groups observed 12 intercepted metric GETs, with actual chart/table
rendering and corrected retry verified. The named-metric/legacy fixture also
passed again. All new positive samples were synthetic; prior Kiali settings
were restored and no cluster writes occurred.

For grouped charts, configure `groupLabels: ["pod","revision"]` through Settings
and reload. Return several named groups, including an omitted label, signed and
zero samples, offset timestamps and nonfinite gaps. Inspect real separate lines,
the accessible wrapping legend, numeric headers and captured grouping labels.
Reverse response order without changing identities and preserve line order/colors.
Deny one metric and retain its successful sibling's groups. Grouping and included
template changes must invalidate results without replay.

Check raw/rate and all classic histogram query shapes. Reject undeclared labels,
duplicate groups (including absent/empty equivalence), contradictory equality
filter labels and nine groups per response. Verify exactly eight total lines
across a panel's metrics and reject the ninth without truncation. Exercise empty
and all-unavailable results, corrected retry, 256-character values, 1,024-character
captions, four group names totaling 256 characters and 241 samples per group.
Ungrouped multi-metric/template and built-in histogram/signal regressions must
keep their strict scalar response contract.
Seven hosted groups observed 32 intercepted GETs. They inspected actual chart
lines, captions/numeric columns and long-label layout, exact eight-line and
1,024-character boundaries, response-order stability, per-metric failures and
corrected retry. Ungrouped named metrics and template composition were rechecked.
All new samples were synthetic; settings/handlers were restored and no writes
occurred. Grouped query evidence expands the custom oracle from 45 to 216
original-Go cases; it does not replace the separate built-in histogram oracle.

For saved-template discovery, configure template-level `discoverOn` metric names
and optional `runtime` labels. Preserve literal include text through Settings
save/reload. Match parent/child names together: a literal `child` include suppresses
the child, while ` child ` and `child$Chart` do not. All three still compose when
explicitly loaded. Discovery must issue one captured instant count-by-name GET,
never a chart request; selecting a result changes only the template draft.

Check zero/nonfinite count values without treating them as health, unspecified
runtime labels, returned warnings, draft independence and saved-definition
invalidation. Reject duplicate names, extra dimensions and wrong timestamps.
Keep denial and timeout separate from a valid empty result; cancel at fifteen
seconds and retry explicitly. Five hosted groups observed ten discovery GETs,
three explicit chart GETs and a 15,101 ms timeout. A real, unintercepted Bookinfo
query returned ten names and matched `istio_requests_total` using
`destination_workload_namespace`, `destination_cluster="Kubernetes"` and the
destination reporter. No workload-language or health inference was made.
All settings/handlers were restored, with no cluster writes.

Stock Headlamp's Select role can differ from the SDK test renderer. Inspect the
rendered labelled control and form value rather than assuming a `combobox` role.
Its request errors can also prefix provider text with `Forbidden -`; verify the
classification and detail without assuming the unit-test mock's exact prefix.

For undeclared units, omit `unit`, save and hard reload; no unit property should
be invented. Load a metric whose name ends in `_bytes` and retain the explicit
unspecified-unit disclosure instead of guessing bytes. Scalar numeric headers
must say Value, and signed/zero values must still obey unitScale. Add grouped
named metrics and verify the dimensional-compatibility warning and actual lines.
Then explicitly declare a unit and restore normal labeling without extra queries.
Three hosted groups/five intercepted GETs covered these cases. All samples were
synthetic, with no writes or retained fixture settings.

For display bounds and spans, save `min: 0`, `max: 10`, `spans: 6` on adjacent
charts, keeping another chart at the default full width. Check actual region
geometry at desktop width, then stack at 800 pixels without new requests.
Verify Y-axis ticks preserve 0..10 on scalar, named and grouped charts.
Return samples outside both bounds after unitScale; count them explicitly and
retain their original numeric values. Test all-negative data with only minimum
zero and all-positive data with only maximum zero: only the automatic edge may
expand. Invalid/reversed bounds must prevent reads. Extreme values that would
produce nonfinite display geometry must show an error but retain the table.

Four hosted groups/eight intercepted GETs covered these cases and checked SVG
errors. The declared/undeclared-unit fixture passed again. Core tests cover
safe-integer bounds, spans 1..12/default zero, 1,928 samples and the first excess
sample. The new positive samples were synthetic; no writes occurred and all
fixture settings/handlers were restored.

For aggregation controls, save `aggregations` label/displayName declarations,
load once without optional grouping, then check labels in reverse order and
explicitly load. Request grouping must follow option-map order after fixed
groupLabels, without changing scope or request count. Open captured-value
filters and toggle ordinary, empty and `__proto__` values: only local charts/
tables change, missing labels remain visible, and all-hidden is not reported as
an empty provider response.

Enable `singleSelection` and verify the first observed value, radio selection
without refetch, and reset on a new captured result. Repeated fixed/optional
labels and conflicting alias selection modes must fail before requests.
Five hosted groups/six intercepted GETs covered these cases and corrected retry;
axis/layout regressions passed. Core tests cover last-display-name conversion,
UTF-8 ordering, alias handling, 32 choices and 64 observed values per label.
All samples were synthetic, with no writes or retained fixture settings.

For chart batches, compose a template with eight included raw charts plus a
ninth histogram. Save/reload without truncating metadata. All-selected and empty
selections must fail without transport. Select only the histogram and use an
aggregation declared by an unselected raw chart; exactly the selected summaries
should be queried. Draft selection changes retain the captured result until load.

Check original chart order/indices when selecting out of order. Eight selected
charts can still exceed the expanded request budget; six raw charts plus two
histogram summaries must fit exactly eight requests. Definition changes clear
the capture and reset selection, without replay. A raw-only batch must not be
blocked by unused histogram-summary settings. Four hosted groups/16 intercepted
GETs covered these cases and corrected retry; aggregation controls were rechecked.
Core tests now cover the effective-catalog bound of 328 resolved charts and
128 KiB metadata, invalid/unknown/duplicate
selections, preserved indices and query-specific rules on selected charts only.

For the bundled catalog, regenerate/check the pinned asset with:

```sh
npm run dashboards:generate -- --source /path/to/pinned/kiali
npm run dashboards:check
```

Opt in through Settings and reload. The saved user array must remain empty
while the selector exposes 21 bundled templates. Load all six Go charts and
inspect absent units, aggregation declarations and captured source labels.
Explicit discovery should match bundled names without loading charts. The
Thorntail include expansion has nine charts: require an explicit bounded subset.
Override `go` by name with a saved definition and confirm loading/discovery use
that definition with custom provenance. Opt out and retain the saved override
without a replay.

Five hosted groups observed eight metric GETs and two discovery GETs, with
saved-only selection regressions passing. Core tests resolve every template and
build queries for every chart, check the exact capture hash, copy isolation and
separate user/effective budgets. New samples were synthetic; no writes occurred.

For disable declarations, save a name-only `go` declaration alongside a parent
including `go` and a discovery-only metadata entry. Reload and verify Go is not
selectable/discoverable, the parent fails explicitly without provider calls,
and the title-less discovery-only entry is named but cannot load charts.
Remove the disable declaration and explicitly load the parent: the original
six Go charts should return. A custom-only disabled catalog must stay explained
and issue no reads. Four hosted groups observed six metric GETs and one
discovery GET, with no writes or retained fixture settings.

For annotation overlays, intercept only owned Namespace/workload GETs and a
dedicated fixture metric endpoint. Supply a Namespace override, a Deployment
pod-template override and a conflicting controller annotation. Read explicitly
and inspect UID/version/location evidence before loading metrics. Empty template
annotations must mask controller annotations; Job/CronJob use their own metadata.

Reject denied Namespace/workload reads, malformed YAML, aliases, wrong resource
identity and excess budgets without falling back to base or a partial layer.
Keep parser errors free of source excerpts. Change the namespace and return:
old evidence must not resurrect. Test the shared fifteen-second deadline,
corrected retry and explicit annotation opt-out. Five hosted groups observed
15 resource GETs, six metric GETs and 15,103..15,544 ms timeouts across runs.
Actual Bookinfo Namespace/reviews-v1 Deployment reads also passed without
interception. No annotation or other resource was written to Kubernetes.

For application recommendations, exercise `core/applicationDashboards.test.ts`,
`data/applicationDashboards.test.ts` and `components/ApplicationDashboards.test.tsx`
alongside correlation, settings and shared dashboard suites. Capture real or
intercepted UID-owned Pods with `kiali.io/runtimes`/`kiali.io/dashboards` references.
Open an Application before clicking inspection: there must be no Namespace
overlay/discovery request yet. A matching explicit reference suppresses metrics;
unknown-only refs fall through only on complete supported-source correlation.

Keep all fixture resource responses under an owned fake namespace and metric
responses under a dedicated fake Service proxy. Show Pod/Namespace UID/version
evidence. Choose an app metric label for explicit references and verify embedded
queries contain the application, namespace and metric-cluster constraints.
For discovered refs, return differing templates under the same runtime for each
selector: the final group replaces earlier groups, and its label is used by the
chart. Never test scope with a namespace-wide template-only navigation.

Check disabled policy, the default threshold at ten/eleven Pods, enabled
bypass, unknown names, malformed Pod annotation evidence and Namespace denial.
Change configuration and return: old results/acknowledgments must not resurrect
or replay. Hold a metric read for the whole-inspection deadline, then retry.
Save a discovery-only JSON policy with no templates and threshold zero through
Settings; wait for the public ConfigStore/localStorage values to match before
hard reload and after restoring the exact previous settings slice.

Six hosted groups observed 78 intercepted resource GETs, 12 metric GETs and a
15,081 ms deadline. The live Bookinfo check captured three owned reviews Pods
and the Namespace in eleven unintercepted GETs, without discovery templates.
Discovery-only settings survived the UI save/reload check. All fixture
interceptors/settings were removed/restored and no Kubernetes writes occurred.
The focused increment passed 429 tests in ten files; this is not a new
full-suite or original-Go oracle count.

For chart sorting, run `core/dashboardSorting.test.ts`, shared custom-dashboard
core/data/UI, metric-group and aggregation tests. Capture sort-only query
labels separately from displayed groups. Check raw/rate/histogram grouping,
fixed/optional sort-label retention, the unchanged four-label budget, UTF-8
lexical ordering and exact signed int64 boundaries above JavaScript precision.
Reject invalid/missing/out-of-range integer strings and display-label collisions
without zero defaults or merging; validate captured equality filters before
hidden labels are removed.

In hosted Headlamp, return `{pod:"alpha",rank:"10"}` before
`{pod:"zeta",rank:"2"}` and compare lexical versus integer legends/tables.
Use distinct Pod names for the above-safe-integer response to ensure a prior
capture cannot satisfy the assertion. Wait for each explicit load's response.
Toggle local display values using the keyboard after the layout changes and
confirm no refetch/order change. Retain `rank` in `groupLabels` to resolve a
collision after automatic removal. Repeat for both histogram summaries.
Five hosted groups issued nine metric GETs; the application regression also
passed with the unchanged shared renderer. Restore settings/interceptors.
The final sorting suite passed 380 tests in eight files.

For workload recommendations, run `core/workloadDashboards.test.ts`, shared
application core/data/UI, `components/WorkloadDashboards.test.tsx`, correlation,
annotation and resource-link tests. Exercise Deployment→ReplicaSet→Pod and
CronJob→Job→Pod trees, then select a child and verify sibling Pods are excluded.
Preserve original owners and validate the selected UID/API group/resourceVersion.
Check paired default/custom app/version keys, empty-version omission and
post-sanitization key collisions. Applications must still omit version filters.

In hosted Headlamp, navigate through **Inspect dashboards** or the explicit
workload route. Navigation does not read; ownership loading does not inspect
annotations or query metrics. Supply Namespace and workload definitions and
verify the workload wins, with app/version equality in every request.
Change only the individual workload response's resourceVersion: inspection must
fail until ownership is recaptured. Denied workload reads must not fall back.
Check child ReplicaSet and Job scopes; Job's own annotation must win over its
template. Return unknown Pod refs to exercise paired-selector discovery, hold a
metric read for the shared deadline, retry and change/return the target to rule
out resurrection. Restore settings and every handler.

Five hosted groups observed 78 intercepted resource GETs, twelve metric GETs and
a 15,251 ms timeout. Actual Bookinfo navigation captured reviews-v1's one Pod and
Namespace/workload provenance in 22 unintercepted GETs. Application-only
regressions passed. The focused increment passed 175 tests in twelve files.
No fixture resources were applied and no cluster writes occurred.

For chart expansion, load a scalar and a grouped/sorted panel with captured
equality filters. Measure actual rendered plot height before/after expansion
(220→520 px scalar, 260→520 px comparison), not just a dialog title. Inspect the
same negative/zero values, units, display bounds, sort order and hidden-series
choices. Count requests before opening/closing: no extra metric GETs are allowed.
Use Escape and Close and assert focus returns to the original expand control.

Change the public ConfigStore source while open; the dialog must close without
replay or resurrection on returning to the old settings. Expand a captured error
panel and verify no successful plot appears. At 720×600, tab through the dialog,
check focus containment and absence of horizontal overflow, then restore the
viewport. Test expansion on workload recommendations and inspect the version
equality filter inside the dialog. Restore source settings and interceptors.
Five hosted groups required four metric GETs; workload expansion added none to
its existing twelve. The focused increment passed 51 tests in five files.

For time-axis plot styles, run `core/chartTypes.test.ts`, custom-dashboard core/
data/UI and scalar/comparison chart tests. Verify each style across raw, rate and
histogram plans without changing expressions or expanded request counts.
Missing/null/empty keeps line; unsupported names fail before transport.
Include multiple isolated finite samples separated by missing points.

Hosted verification should render eight panels in one bounded batch: each of
line/area/bar/scatter in scalar and grouped form. Return negative, missing, zero
and positive samples. Inspect actual area fills, finite dot counts, scatter's
absent connecting stroke and non-stacked bar positions. Check numeric rows and
captured sort order, then expand a bar panel without extra requests. Wait for
line animation completion before counting dots and dialog opacity before images.
Three hosted groups rendered eight charts with eight metric GETs. Default-line
expansion/focus/narrow-screen regressions also passed. All fixture settings and
interceptors were restored. The increment passed 385 tests in ten files.

For series-category axes, run `core/metricCategories.test.ts`, category-chart UI
and shared schema/rendering suites. Verify latest finite selection after trailing
nulls, zero at Unix epoch, empty/all-unavailable series, mixed/equal sample times,
immutable input, invalid/bounded evidence and unchanged raw/rate/histogram
query plans. Explicit empty `chartType` must mean line even with `xAxis: series`;
omitted/null type uses bar there. Unknown axes remain errors.

Hosted fixtures should return an earlier negative value followed by a newer
negative value and nulls, a latest zero followed by null, and an all-null series.
Check the selected value and exact timestamp in each numeric row, not just
chart existence. Preserve captured sort order, disclose differing times, and
leave missing values/timestamps unavailable. Inspect real default bars and
isolated line/area/point geometry: do not connect unrelated series or manufacture
positive-height bars for nulls. Expand and filter categories without refetching.
Three hosted groups rendered six panels with six metric GETs; time-axis
regressions rendered eight charts with eight GETs. The increment passed
408 tests in twelve files. Restore settings and every handler.

For `startCollapsed`, test true/false, omitted/null and rejected non-booleans,
include propagation and unchanged eight-versus-nine expanded-query limits in
`core/chartVisibility.test.ts`. UI tests must exercise the actual captured result,
ARIA relationship, Show/Hide, expanded inspection of a collapsed panel and reset
on a new capture. Read errors, provider warnings and scalar no-finite-sample
notices must remain visible rather than disappearing with the chart body.

Hosted verification used seven charts/eight expanded queries: collapsed time
and series plots, a denied metric, empty warned data, an explicitly visible
chart, a two-summary histogram and another scalar. All eight queries still ran.
Show/Hide/Expand and local filters added none; histogram summary visibility was
independent. An explicit reload issued eight more requests and restored the
definition defaults. Four groups observed sixteen metric GETs total and category
regressions passed. The increment passed 421 tests in thirteen files; restore
settings/interceptors and do not infer a data-request opt-out from collapse.

For template `rows`, cover omitted/null metadata, nonpositive-to-two
normalization, positive safe integers and explicit rejection of invalid values.
Included layouts must not override their parent's preference; annotation and
saved-catalog layers must retain their own values. `core/dashboardRows.test.ts`
checks exact gap/floor/minimum calculations, no-query differences and rejection
of the inactive `rowSpans` field. The reader must clone rows before awaiting and
reject malformed values before transport.

Hosted checks use three finite plot variants plus a denied metric (five GETs per
capture). At viewport heights 1000/600/300/900 and rows=3, verify actual plot
heights 322/189/150/289. Narrow screens keep full-width spans. Keyboard toggle,
resize and expansion add no requests; natural sizes remain 220/260 and expanded
row sizing uses one viewport. Save zero through the actual Settings editor,
wait for positive ConfigStore/storage persistence and hard reload to confirm
two. Remove rows, reload and verify natural sizing plus the optional local
two-row mode. Four groups made fifteen metric GETs total. Visibility/workload/
application regressions passed, alongside 433 focused tests in ten files.
Restore fixture settings and interceptors before teardown.

### Additional traffic signals

Reproduce the original metric-definition/rate-builder evidence with:

```sh
node scripts/parity/traffic-signals-oracle.mjs --source /path/to/pinned/kiali --check
```

The 108 cases verify all eight aliases, including Kiali's reversed TCP
sent/received raw counters. `core/trafficSignals.test.ts`,
`data/trafficSignals.test.ts` and `components/TrafficSignals.test.tsx` cover
selection limits, exact query mappings, scope/history capture, scalar
matrix/sample bounds, three-worker queues, per-signal errors, cancellation and
settings changes without replay. Existing histogram tests exercise the shared
range reader/decoder too.

In hosted Headlamp, load request/response throughput from real Bookinfo.
The checked window returned 61 finite zero samples per panel; do not describe
that as positive traffic. Then intercept an owned fixture Prometheus endpoint
and select all eight signals with outbound workload and historical scope.
Return positive byte rates, zero response throughput, empty/NaN gRPC data,
a denied open-rate response and invalid labelled close-rate data. Check raw
names/units, compensation text, independent panels and peak concurrency three.
Draft edits retain captured results; saved-identity changes clear without
replay. Hold requests for the whole-read deadline and confirm only three jobs
start; retry explicitly and reject an empty selection.

Five hosted scenario groups intercepted 19 reads and measured 15,056..15,070 ms
timeouts. The existing raw-TCP disclosure and histogram regression checks also
passed after the shared extraction.
Restore settings durably and remove handlers; no Jobs or traffic generators
are required or authorized by these tests.

### Telemetry and health lifetime

`data/telemetryLifetime.test.ts` exercises exported-reader input capture,
including later metric batches, Application label settings, custom health
rules and returned query identity. All four reader paths time out with ignored
SDK cancellation rather than returning success-shaped empty snapshots.
Existing per-panel/source errors remain visible when reads finish.

Four hosted fixtures held provider responses and measured 15,054..15,092 ms
deadlines across metrics, workload, Service and Application health. Timeout
removed successful panels; explicit retry restored normal empty-data handling.
Eighteen metric GETs were intercepted, while workload evidence used read-only
Bookinfo sources. All temporary provider settings were restored.

### Configuration context deadline

`data/validationDeadline.test.ts` verifies captured scope/spec/settings before
deferred work, the shared linked child signal, 15-second timeout with ignored
SDK abort, queued-read cancellation and retained source error classifications.
Source tests accept the borrowed signal rather than requiring the caller's
signal object, while the new test proves all requests receive the same captured
child and that it is aborted on completion/cancellation.

The hosted fixture held a Namespace list response, measured a 15,051 ms timeout
and verified no absence findings, explicit retry and clearing of prior findings
after denial. All three Namespace GETs were intercepted; no settings or cluster
objects were modified. The timeout is a read failure, not a valid/healthy result.

### Gateway listener/address collision oracle

`gateway-collision-oracle.json` independently executes 508 original-Go cases
from `business/checkers/k8sgateways/multi_match_checker.go` plus the original
validation merge method. Caller and model/source hashes are pinned:

```sh
node scripts/parity/gateway-collision-oracle.mjs --source /path/to/pinned/kiali
node scripts/parity/gateway-collision-oracle.mjs --source /path/to/pinned/kiali --check
```

Tests compare full finding fields, KIA1503 interactions and normalized related
identities. Native tests additionally gate incomplete/stale/duplicate evidence
and exact per-object/total entry limits. Preserve same-name peer exclusion
across namespaces, literal wildcard equality and missing address-type semantics.
Eleven hosted cases intercepted eleven Gateway lists without writes, including
freshness, permission and exclusion-annotation cases. Related Gateway links must
use the Gateway API route, not the same-named Istio kind.

### Gateway class registry

`core/gatewayClassRegistry.test.ts` and the data/settings/validation tests cover
configured precedence, selector/controller-prefix discovery, empty successful
fallback, conditional unknown defaults, strict scope/input bounds and permission/
pagination failures. Explicit classes do not read cluster-wide GatewayClasses.
The portable oracle runs 64 original membership-checker cases:

```sh
node scripts/parity/gateway-class-oracle.mjs --source /path/to/pinned/kiali
node scripts/parity/gateway-class-oracle.mjs --source /path/to/pinned/kiali --check
```

Sources are the pinned Gateway checker/caller, `models/istio_validation.go`
and `cache/cache.go`. Only the membership checker executes in the oracle;
discovery and cache defaults have separate contract tests.
Sixteen hosted scenarios intercepted twenty-two class-list requests, with no
cluster writes. Settings save/reload used public ConfigStore persistence, and
the original cluster settings were restored after testing. No Gateway API or
GatewayClass was installed. API absence and lack of permission are not empty
successful discovery. Keep mesh-wide conditional defaults unresolved unless
the actual configured mesh membership and ambient evidence are known.

### Host normalization oracle

`parity/host-oracle.json` contains 627 outputs from checksum-verified original
`kubernetes/host.go` and the host functions in `kubernetes/filters.go`.
The generator executes only those copied functions and standard-library glue:

```sh
node scripts/parity/host-oracle.mjs --source /path/to/pinned/kiali
node scripts/parity/host-oracle.mjs --source /path/to/pinned/kiali --check
```

The hosted reference check supplied a synthetic VirtualService while reading
actual namespaces and empty DestinationRule/Sidecar lists, then intercepted a
matching subset and a Sidecar access denial. It verified missing versus unknown,
not a blanket valid verdict. Synthetic Gateway/ReferenceGrant inputs exercised
KIA1503/KIA1601. The temporary `svc.cluster.local` test setting was restored to
unknown afterward; no cluster DNS suffix is inferred from this fixture.

### Sidecar import/export oracle

`parity/import-scope-oracle.json` contains 760 outputs executed by the original
pinned Sidecar import scope and `kubernetes.IsExportedTo` functions. Its generator
checks each Git blob and supplies only standard-library JSON and minimal
Sidecar/selector/listener type adapters; no Istio modules or server run.

```sh
node scripts/parity/import-scope-oracle.mjs --source /path/to/pinned/kiali
node scripts/parity/import-scope-oracle.mjs --source /path/to/pinned/kiali --check
```

Tests additionally cover conflicting effective Sidecars, root fallback,
cross-namespace defaults, malformed/bounded input and partial mesh discovery.
The low-level first-match rule is preserved for differential tests; the consumer
rejects ambiguous namespace-wide resources. Validator inclusion of invalid
export namespace references is separately tested and is not runtime permission.
The full KIA1107/KIA0005 integration is source-informed, not itself a Go oracle.

Hosted verification intercepted a VirtualService, DestinationRule and Sidecars
while reading real namespace/controller/configuration context. Eight cases
covered private/public exports, root exclusion/local precedence, conflicting
Sidecars, mesh defaults, denied configuration and invalid export namespaces.
Only the latter default/denial scenarios intercepted the mesh ConfigMap too.
No cluster mutation occurred; DNS settings and all handlers were restored.

### Service traffic creation scenarios

`core/serviceTraffic.test.ts`, `data/serviceTraffic.test.ts`,
`data/mutationBatch.test.ts` and `components/ServiceTrafficWizard.test.tsx`
exercise version grouping, pinned per-workload weight defaults, namespace-local
HTTP/port scope, complete source evidence, Service UID/version changes, overlap,
target collisions/denial, deep immutability and single-use review tokens.
Batch tests verify ordered dry-runs/writes, partial outcomes, cancellation and
the absence of automatic retries or rollback.

The hosted test used the real reviews Service and its three versioned
Deployments. All authorization and configuration POSTs were intercepted:
80/20/0 review/apply succeeded in the fixture, a second-write failure left the
first fixture object applied, and a changed Service stopped before final writes.
Invalid totals blocked review. Every handler was removed, and actual
VirtualService/DestinationRule lists remained empty. Read-only Monaco previews
were inspected separately with intercepted dry-runs only.

### Gateway route reference scenarios

`core/gatewayValidation.test.ts` and `data/gatewayValidation.test.ts` cover
HTTP/GRPC parent/service defaults, same/cross-namespace sharing, full label
selectors, mirrors, incomplete reads, source bounds and strict ReferenceGrants.
Groups and target names are intentionally enforced beyond the pinned helper.
Unknown kinds/attachment/ports/controller state remain explicitly unevaluated.

Nine hosted scenarios intercepted Gateway API discovery, routes, gateways and
grants, while reading actual Namespaces and Services. The fixture route referred
to `istio-system/prometheus`; private/specific grants did not alter cluster
permissions or traffic. Wrong grant groups, names and route kinds produced
KIA1402; a denied list produced uncertainty instead. Missing/unshared Gateways
produced KIA1401. Every handler was removed, restoring the real absent API.
These are not live-Gateway or Go-oracle checker results.

### TCP Service routing

Service core/data/UI tests cover exact TCP match/destination/weight shapes,
immutable ordered batches, HTTP-default compatibility and explicit rejection
of unknown/null protocols, mirrors and HTTP-only affinity. Switching the form's
protocol retains draft choices so incompatible fields must be corrected rather
than silently discarded. The source generator is pinned
`WizardActions.ts` `WIZARD_TCP_TRAFFIC_SHIFTING`.

Four hosted scenarios intercepted eight specification writes and nine SSARs:
successful TCP generation, retained/incompatible draft correction, denied
creation and stale Service discovery. The DNS domain was entered in the local
form, not saved to settings. Real Bookinfo evidence was read, but its traffic
was not changed; this verifies proposal shape/guards, not real TCP routing.

### Circuit-breaker workflows

Core tests prove no-op/invalid rejection, exact int32/uint32 limits, zero values,
legacy-to-canonical threshold migration and preservation of unrelated nested
fields. Mutation/UI tests verify captured versions, separate review/confirmation,
scope cancellation, metadata/status preservation and the optional Service-create
proposal. The baseline UI source is
`frontend/src/components/IstioWizards/CircuitBreaker.tsx` and its
ConnectionPool/OutlierDetection children.

Eight hosted scenarios intercepted all specification requests and permission
reviews. Create SSARs have no resource name, so the fixture recognizes their
group/resource/namespace/verb, while every POST/PUT remains restricted to owned
names. Do not bypass these guards with a real write. The browser run used real
Bookinfo discovery for Service creation, then restored DNS settings durably.

For Monaco review evidence, target the **Read-only Proposed specification**
group and wait for its textarea and expected `.view-lines` text. Long proposals
are virtualized; keyboard PageDown can reveal the changed field. Verify
`readOnly`, wait for fonts and capture the settled editor, not a loading frame.

### Load-balancing workflows

Core tests cover all schema-supported simple modes, header/cookie/source-IP
affinity, incompatible-key replacement, cookie metadata and advanced-setting
preservation, no-op detection and exact token/duration bounds. UI tests verify
immutable review and composition with circuit settings during Service creation.
The source workflow is `frontend/src/components/IstioWizards/TrafficPolicy.tsx`.

Eight hosted scenarios intercepted sixteen specification requests and sixteen
SSARs. They used real Bookinfo discovery only for read-only Service evidence.
Whole-group removal must not be described as preserving locality/warmup;
setting a strategy preserves those unrelated fields. Restore DNS settings,
await persistence and remove all handlers after each run.

### Gateway API backend weights

Core tests check relative (not percentage) semantics, omitted/null default1,
effective no-ops, exact 0..1,000,000 and 16-rule/backend limits, invalid input,
same-named cross-namespace references and complete unowned-field preservation.
Both HTTPRoute and GRPCRoute UI tests verify captured versions and a separate
confirmation. Source contracts are pinned Kiali `K8sTrafficShifting.tsx` and
Gateway API `89b3b0c3fa63f9342f43ba0fb2cf93d6aab53af7` `BackendRef`.

Seven hosted scenarios intercepted discovery, target objects, five specification
writes and seven SSARs. They retained references/filters/matches and exercised
denial, stale input and server rejection. All-zero proposals require deliberate
JSON editing; no Gateway resources were installed or mutated by these checks.

### Inbound mTLS editing

PeerAuthentication editor tests cover all explicit modes, no inferred defaults,
no-op/malformed rejection, top-level removal versus UNSET inheritance and
preserved selectors/port overrides. Mutation/UI tests verify original version
capture and security-group permission/PUT targets. The source contracts are
pinned Kiali `TrafficPolicy.tsx`/`WizardActions.ts` and Istio API
`23c54ad84d6e` `peer_authentication.proto`.

Eleven hosted cases intercepted thirteen specification writes and fifteen
SSARs, covering modes, removal, denial, stale input, rejected dry-run and
uncertain commit. No PeerAuthentication was applied. Inspect the read-only
proposal and warnings without equating a successful dry-run with enforcement.

### Outbound TLS workflows

Core tests exercise explicit modes, file-reference bounds, optional CA clearing,
no automatic mode inference, no-ops, credentialName replacement and preservation
of sibling/advanced policies. UI tests prove captured versions, separate review/
confirmation and optional Service-create composition. The source contracts are
pinned Kiali `TrafficPolicy.tsx`/`WizardActions.ts` and Istio API
`23c54ad84d6e` `networking/v1alpha3/destination_rule.proto`.

Twelve hosted scenarios intercepted nineteen specification writes and
twenty-one SSARs. They exercised all modes, file paths, inheritance, no-ops,
failed guards and explicit Service creation from real read-only evidence.
No TLS configuration was applied, and no credentials were read or installed.
Do not treat these results as proof of encryption. Inspect the read-only review
for preserved SNI/SAN/CRL/verification flags and unchanged subset/port overrides.
The first screenshot attempt timed out because Monaco had not rendered the
target virtualized lines; bounded keyboard scrolling and scrolling the matching
line into view corrected the fixture, not the application.
Restore DNS settings durably and remove handlers even when a check fails.

### HTTP mirroring

`core/httpMirroring.test.ts`, Service traffic tests and mutation/action tests
cover single-target creation, legacy/list initialization, explicit replacement
of competing representations, full removal, zero/fractional percentages,
field preservation, no-ops, invalid inputs and immutable guarded review.
Source references are the pinned `IstioWizards/WizardActions.ts` and
`TrafficShifting.tsx`. These are contract tests, not Go-oracle cases.

Ten hosted scenarios intercepted thirteen specification writes and fifteen
SSARs. They exercised legacy/list conversion, removal, invalid/no-op blocking,
denial, stale version, dry-run rejection, uncertain final outcomes and creation
using real Bookinfo version reads. In creation, the shadow subset must remain in
the DestinationRule but be absent from forwarding; only the other weights sum
to 100. Confirm that the side-effect warning is visible in review and the Monaco
proposal is read-only. No real mirrored requests were generated.
Restore DNS settings durably and remove all handlers, including on failure.

### HTTP request conditions

Core tests prove header-AND/non-header-OR grouping, preserved input order,
header presence, duplicate/ignored-name rejection and exact condition/value/
RE2 bounds. Service tests prove every OR alternative retains the selected
port, with no extra port-only catch-all. UI tests retain invalid drafts,
block TCP, preserve the semantic warning through review and remove rows.
Source references are pinned `RequestRouting/MatchBuilder.tsx`,
`WizardActions.ts` `buildHTTPMatchRequest`, and Istio API `23c54ad84d6e`
`HTTPMatchRequest`.

Four hosted cases intercepted twelve specification writes and thirteen SSARs.
They combined conditions with mirroring, checked bad/valid RE2, rejected
duplicate headers, explicitly removed HTTP conditions for TCP and surfaced
permission denial. No live routing or settings changed. A version marked as
mirrored for a conditional rule can still receive ordinary unmatched/default
traffic; verify that this limitation is stated in the review.

### Existing HTTP condition editing

Core tests prove one-field/header updates preserve complete compound alternatives
and unowned route/protocol fields. Tests cover no-ops, absent/malformed targets,
exact list bounds, invalid RE2 and removal without validating unused drafts.
Metadata (`name`, `ignoreUriCase`, `statPrefix`), protobuf-empty scopes/maps and
documented ignored header keys do not count as remaining conditions.
UI tests verify the captured original version/spec and a separate confirmation.

Nine hosted cases intercepted eight specification writes and ten SSARs.
They exercised header/URI set/remove, last-condition rejection including
statistics/empty defaults, no-op/missing alternatives, denial and stale version.
The read-only proposal retained source namespace/labels, gateway, port, query,
negative headers and the case flag. No live object or settings changed.

### HTTP route ordering

Core tests cover both move directions, full-object preservation, no-op detection,
catch-all correction/rejection, unresolved delegates, malformed inputs and exact
route/match-count bounds. UI tests mutate the live source after opening to prove
review uses the original version/specification. The source is pinned
`RequestRouting.tsx` `onMoveRule` and `matchAllIndex`.

Six hosted scenarios intercepted four specification writes and six SSARs, with
no live writes. Redirect and delegate cases retain their complete objects.
An unresolved delegate is not assumed to be a catch-all just because its parent
has no match list; its target can contain additional conditions.

### HTTP behavior editor

Service creation now reuses the same planner, with groups excluded by default.
Tests assert full weighted/mirrored route preservation, independent
DestinationRule policy, timeout/retry versus fault exclusion, retained TCP draft
errors and warnings at confirmation. Source caller branches are pinned
`WizardActions.ts` `WIZARD_FAULT_INJECTION` and `WIZARD_REQUEST_TIMEOUTS`.
Four hosted scenarios intercepted eight specification writes and nine SSARs,
using real Bookinfo reads but no live traffic mutation. The actual read-only
proposal showed the mirror percentage and generated delay/abort fields.

`core/httpRouteBehavior.test.ts` and the configuration action tests cover
keep/set/remove semantics, exact field preservation, valid/bounded durations,
zero timeout, retries, percentage/status bounds, alternative fault replacement
and explicit removal of incompatible timing settings. Browser fixtures exercised
two guarded updates and a rejected stale third update. All PUTs were intercepted.
Read-only JSON previews were inspected; the test waits for dialog closure after
success because stock detail remounts can clear the inline success message.
Reload between fixture updates because intercepted writes produce no watch event.

### Local checker oracle

`parity/local-checks-oracle.json` independently executes 564 original
`kubernetes.MatchPortNameRule` and Gateway condition-predicate cases.

```sh
node scripts/parity/local-checks-oracle.mjs --source /path/to/pinned/kiali
node scripts/parity/local-checks-oracle.mjs --source /path/to/pinned/kiali --check
```

Additional consumer tests cover current/unknown/stale condition generations,
accurate listener paths, JSON outbound-mode presence, limits and ignore
annotations. Hosted read-only fixtures verified ServiceEntry, Sidecar and
Gateway outcomes; explicit modes remained unambiguous and stale status was
deferred. No status patch or configuration mutation was applied.

## Live verification boundaries

The initial configuration browser was loaded in a stock Headlamp 0.35.0 hosted
instance against `mitch-auto`. Actual discovery and empty lists worked. Populated
detail data, embedded Monaco code, dry-run/confirm operations, charts and graph
selection were exercised using explicit browser fixtures. The Map filter showed
the Kiali parent and all 14 leaf sources with icons; reference-edge behavior has
unit coverage. None of that is evidence of deployed synthetic CRs.

The subsequent increment verified all nine actual Gateway/inference absent-API
banners. Populated GatewayClass/Gateway/HTTPRoute/InferencePool details and
GatewayClass create confirmation were verified only through explicit browser
interception. All mutation/authorization POSTs were intercepted: the captured
cluster-wide dry-run and final payloads omit namespace, and their paths do not
contain `/namespaces/`. No write reached Kubernetes. Parent/listener Conditions
were last before Events; named references opened the intended group/scope paths.
The host's read-only SelfSubjectRulesReview also needs a fixture response when
blocking all POSTs; returning a denial makes Headlamp redirect to authentication.

Desktop debugging was unavailable on loopback 9222 at the latest UI verification.
Prometheus was repeatedly OOMKilled while replaying/compacting its TSDB under a
1 GiB memory cap. The user then authorized deleting that history: replacing only
the selected Prometheus pod discarded its emptyDir, and the replacement became
ready with six healthy Bookinfo scrape targets and no pre-reset samples.
The memory request/limit and scrape configuration are unchanged. Shortly after
the reset, Prometheus reported about 39,900 head series and 820 MiB resident memory,
so recurrence remains possible; this reset is not a lasting sizing fix.
Later real hosted checks proved Bookinfo request/p95 charts, six graph edges and
workload health, as described above. Prometheus still had zero restarts at about
903 MiB RSS; its resources were not changed. The user permits a memory-limit
increase if trouble recurs. Recheck readiness before further live UI tests.
A Desktop debug target is still needed for the remaining Desktop evidence.

**Update, 2026-10-29:** the same replacement Pod subsequently accumulated
156 OOM restarts while compacting TSDB under the 1 GiB cap. Node
`MemoryPressure=False`; restart logs again ended during block writes.
Using the user's conditional memory-increase authorization, the existing
`prometheus-7979cfd68-mwnxh` Pod was resized **in place** with the core
`pods/resize` subresource after server dry-run and UID/name/old-resource tests.
The server limit is now 2 GiB and request 1 GiB; CPU and config reloader were
unchanged. No Pod was deleted and no data was reset. The same UID became ready,
completed backlog compaction and WAL checkpointing, and stayed at 157 restarts
across the observation window. Observed memory reached 1,142 MiB.
The live `prometheus_tsdb_lowest_timestamp_seconds` query still reported
1793118046 (2026-10-27T16:20:46Z), confirming older TSDB history was retained.

The Deployment template and pinned source YAML still specify the original
budget. Do not blindly reapply or roll out the `Recreate` Deployment: its storage
is `emptyDir`, so replacement loses history. The current Pod's resize survives
container restarts but not replacement. Persisting the larger budget in the
workload template needs a separately approved rollout/storage decision, rather
than silently initiating another TSDB reset.

The existing-VirtualService weight editor was exercised with all writes
intercepted: invalid total rejected; 50/50 changed to 80/20 while preserving
matches, ports, mirror, timeout, headers and metadata; dry-run then explicit
confirmation; changed resourceVersion rejected before another PUT. The review
snapshot is cloned at dialog opening and covered by a live-object-mutation
regression test. Because synthetic PUTs produce no real watch events, the
explicit Reload page action was used to observe the new fixture response.
No live traffic policy was changed.

The mesh-inventory route read real controller/revision/namespace/tag/config data.
It found 2/2 istiod replicas, Bookinfo's `asm-1-30` label association, root
namespace `aks-istio-system`, trust domain `cluster.local` and injector DNS
suffix `cluster.local`. The literal shared-map reference was confirmed absent.
A temporary browser-intercepted shared map then exercised local precedence,
alias union and false preservation; an intercepted 403 suppressed the merged
projection. The final view was returned to real data. No Secrets or writes were
used. Source semantics are pinned `istio/discovery.go` and its merge tests;
these selected-field tests are not a full independent Go mesh-discovery oracle.

### Configured mTLS oracle and consumer

`parity/mtls-oracle.json` executes 2,600 combinations of original pinned
`util/mtls/status.go` composition/inheritance functions. It needs no Go dependency
downloads and does not execute a Kiali server:

```sh
node scripts/parity/mtls-oracle.mjs --source /path/to/pinned/kiali
node scripts/parity/mtls-oracle.mjs --source /path/to/pinned/kiali --check
```

The hosted namespace consumer reported UNSET from real Bookinfo/controller/
policy reads. Intercepted root STRICT, DestinationRule denial and conflicting
policy cases verified the conservative consumer. Empty selectors are explicitly
namespace-wide there, and ambiguous input suppresses output; see the ledger for
the differences from the low-level helper. No policy was written.

Fresh bounded Bookinfo requests verified destination-reported
`connection_security_policy=mutual_tls` in the observed-security panel. One
request-chart query transiently returned HTTP 500; the exact Service-proxy query
and manual UI refresh subsequently succeeded. Prometheus had zero restarts,
and its logs showed successful block compaction and WAL checkpointing. This was
not a recurrent OOM, so the memory limit was not changed.

## Correlation fixtures and label oracle

### VM workload labels and provenance

The WorkloadGroup/entry extension has an additional 96-case source-hash-checked
oracle:

```sh
node scripts/parity/virtual-workload-labels-oracle.mjs --source /path/to/pinned/kiali --check
```

It executes the original entry filter and label-selection branch from
`ParseWorkloadGroup`, using an equality-selector adapter. It does not execute
VM health or service-account collection. Native tests cover group UID/version
versus contributing-entry identity, returned-order sensitivity, empty selector
behavior, canonical/custom labels, same-namespace validation, exact
10,000-comparison/1,000,000-character limits, unsupported health and
fail-closed Service routing. Decoder budgets stop later pagination after a
label-size failure. Shared correlation captures scope and stops at 15 seconds,
even when a transport ignores abort.

The hosted run used actual Bookinfo and empty live VM lists, followed by 16
scenario groups with synthetic WorkloadGroups/entries. It observed 34 VM-list
GETs, one synthetic graph metric query and a 15,658 ms timeout/retry. Reverse
the entry list and verify the first entry's canonical label/version changes;
no-entry fallback uses group `spec.metadata.labels`, not object/template labels.
Denied or partially read entries must never produce this fallback. Follow both
group and entry links, inspect separate UID/version provenance, change custom
labels, verify no Pods are fabricated, and verify VM health/routing remain
unavailable without extra metric/authorization/write calls. Graph candidates
must preserve the group UID while showing the first entry as label evidence.
Restore settings durably and remove handlers. No VM, Service fixture or policy
was deployed.

### Original application-label precedence

Account-provenance tests in `core/workloadAccounts.test.ts` and the correlation/
application tests retain actual Pod `spec.serviceAccountName`, without
defaulting absent or malformed values. Aggregate only verified scoped attributed
Pods; exact 1,000-Pod, duplicate UID, namespace/cluster and VM guards apply.

Six hosted cases used the real reviews Pod/ReplicaSet/Deployment ownership
chains and observed account `bookinfo-reviews`, followed by four intercepted
Pod-list negatives (missing/malformed account, unresolved owner, denied read).
Each real Deployment showed one attributed Pod; no ServiceAccount API read or
write was issued. A retry restored real observations. Verify both the workload
summary and owned-Pod table, explicit unavailable evidence, and no fabricated
default/principal/permission or account-absence finding. This is not a full
mesh workload/account-inclusion differential oracle.

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

## Tracing contract fixtures

`tracing/fixtures.json` contains synthetic Jaeger and Tempo/OTLP JSON examples.
No provider or collector is deployed by these tests. Contracts follow pinned
Kiali `tracing/jaeger/http_client.go`, `tracing/tempo/http_client.go`,
`tracing/tempo/traceQLBuilder.go`, `tracing/jaeger/model/json/model.go` and
`tracing/otel/model/json/model.go`. These are source-informed fixtures, not
captured production traces or Go-oracle output.

| Scenario | Expected behavior |
| --- | --- |
| Jaeger process/child/log data | Microseconds become exact nanoseconds; parents, false/zero tags and warnings survive |
| Tempo hex/base64 IDs and OTLP arrays | Canonical identities, exact uint64 times and int64 strings, false/zero values |
| Invalid/unsafe/overflowing data | Explicit malformed-response error, no fabricated empty result |
| Missing parents, cycles and dropped counts | Visible uncertainty, no invented hierarchy or healthy status |
| Error-only and partially successful Jaeger search | Error-only fails; successful rows retain backend warnings |
| Duplicate IDs/map keys and collection/depth limits | Explicit rejection without overwriting values or silently truncating |
| Cluster/provider/draft changes | Abort prior reads and suppress stale results; no credentials saved |
| Trace URL, same-ID retry and parent selection | Reload/history load the right trace; retry issues a fresh read |

Focused checks:

```sh
CI=1 node_modules/.bin/vitest run \
  -c node_modules/@kinvolk/headlamp-plugin/config/vite.config.mjs \
  src/core/tracing.test.ts src/data/tracing.test.ts \
  src/components/Traces.test.tsx src/components/Settings.test.tsx
```

For browser verification, use a temporary tracing endpoint in the isolated
Headlamp test profile. Intercept only that endpoint's GETs and return the
corresponding fixture for `/api/traces`, `/api/search` and `/api/traces/{id}`.
Capability probes return `{ "data": ["reviews"] }` at Jaeger's `/api/services`
or `{ "tagNames": ["service.name"] }` at Tempo's `/api/search/tags`.
Check actual search/detail/span rendering, exact timestamps, parent navigation,
deep-link reload and 403/404 states. Restore the original tracing setting and
remove every interception in `finally`. Never label this live backend evidence.

These success paths were exercised in stock hosted Headlamp 0.35.0. The real
missing-Service error was also checked. No tracing backend was installed and
Desktop/live-provider success remains unverified. Only a separate explicit
approval permits installing additional development infrastructure.

The tracing fixture also contains explicit zero Jaeger/OTLP flags, a remote
OTLP parent, a known-local link, distinct resource/scope schema URLs, scope/link
attributes with false/exact-int64 values, empty trace state/status text and
dropped-data counts. `src/core/tracingMetadata.test.ts` checks masks, missing
versus zero values, malformed/oversized metadata, alias ambiguity, strict
whole-string identities/integers and the 10,000-record aggregate bound.
The OTLP contract is the Kiali-pinned `go.opentelemetry.io/proto/otlp v1.10.0`.

Hosted metadata checks configure a temporary intercepted Service endpoint,
inspect both Tempo and Jaeger spans, open the link-metadata dialog, then restore
the previous settings and remove all routes in `finally`. Wait for dialog and
ancestor opacity to reach 1 (or disable screenshot animations) before capturing
images; a visible dialog can still be mid-fade. Do not mistake a transition
screenshot for a persistent transparent-dialog defect.

### Exact trace search filters

`src/core/tracing.test.ts`, `src/data/tracing.test.ts` and
`src/components/Traces.test.tsx` also cover additional exact string tags,
historical end time and 24-hour ranges. The request contract is:

- Jaeger JSON tag maps preserve literal keys, including `__proto__`, and string
  values without changing prototypes.
- Tempo unscoped attribute keys retain simple identifier spelling or use
  whole-name quoting for literal punctuation/Unicode; values are quoted
  literals. A value such as `" } || { true } #\` remains data.
- Duplicate keys, 11 tags, keys over 256 characters, values over 1,024 and
  encoded paths over 16 KiB fail before network access.
- The special error tag accepts only `true`/`false`; false conflicts with
  errors-only. Tempo non-error status includes unset and does not mean health.
- Jaeger times are microseconds and Tempo times seconds. Submitted tag values
  are immutable with respect to later form edits. Provider/endpoint/limit changes
  made after request capture cannot redirect or alter its decode.
- A 15-second search deadline cancels pending transport and rejects late work,
  even when the SDK ignores abort. Detail/probe reads now have the same bound,
  as described below.

Six hosted interception scenarios passed for both providers, including denial
and invalid client-side conditions. Browser setup/cleanup used public
ConfigStore and waited for its persistence debounce before reload; it preserved
other cluster settings and left tracing disabled. This proves native request/UI
behavior, not actual backend matching. Typed filters are covered below;
live-provider evidence remains open.

### Trace detail and connection-check deadlines

Transport tests cover Jaeger/Tempo input capture for both exported readers,
including mutated endpoint/cluster/provider values before deferred work. They
verify rejection at 15 seconds with ignored SDK abort, caller cancellation
before and during a request, completion cleanup and retained denial/format errors.

In hosted Headlamp, intercept the configured Jaeger `/api/services` and
`/api/traces/00000000000000000000000000000001`. Hold each until the corresponding
settings check or detail read times out. Abort the held interception, retry
explicitly using the normal service list or committed `tracing/fixtures.json`
Jaeger body, then return 403 on the next attempt. Success must not remain visible
after denial. Observed times were 15,119 ms from the check action and 15,440 ms
from detail navigation; six requests were intercepted without live writes.
Restore settings durably and remove all held routes/handlers even after failure.

### Typed Tempo attribute filters

`core/traceFilters.test.ts`, transport and trace UI tests cover scoped/type-safe
comparisons, quoted strings, bounded RE2, exact signed-integer boundaries,
float bounds, boolean/operator restrictions, URL budgets, immutable submission
and Jaeger rejection. Connection changes clear submitted queries without
replaying them, including when returning to the original connection.

Reference contracts are the official TraceQL construction documentation and
Tempo `afbbb308bbad6caa74fe33f4f122aff6275974f8` parser/operator/execution files.
The minimum int64 token needs `(-9223372036854775807 - 1)` because the positive
integer token is parsed before its unary minus. Source inspection confirms
the subtraction preserves integer type; these tests do not execute Tempo.

Six hosted checks intercepted four GETs, with no live tracing provider reads.
They exercised resource regex, same-attribute numeric ranges, unscoped booleans,
floats, exact large integers, query-like strings, history, invalid conditions,
connection changes, explicit removal for Jaeger and denial. Captured-filter
details must be reopened after a new search replaces the result panel.
Restore the exact prior tracing value/presence through public ConfigStore,
await persistence, then remove handlers even if a fixture fails.

Missing/null predicate coverage additionally verifies `= nil` and `!= nil`,
rejects irrelevant values and unsupported operators, distinguishes empty strings
and false, and clears old text when changing types. The hosted check intercepted
one GET and verified the captured “Not applicable” display; tracing was restored.

### Literal Tempo keys

Query/transport/UI tests now cover punctuation, embedded spaces, quotes,
backslashes, Unicode, intrinsic-looking names, prototype-like keys and all three
attribute scopes. Existing simple query spelling stays unchanged. Rejection
cases cover controls, line separators, unpaired surrogates, surrounding
whitespace and the 256-unit limit; tag duplicates still fail before requests.

For hosted verification, intercept a Tempo search with an empty trace list.
Combine a query-like exact tag name with a resource-scoped boolean key containing
`app.kubernetes.io/`, a quote, a backslash and Unicode, plus a missing/null
unscoped attribute literally named `span:status`. Inspect encoded scope/name
boundaries and captured raw keys. Draft edits must not replay or change captures;
a control-character key and duplicate exact tags must fail before requests.
After removing typed rows, switch to Jaeger and confirm the literal JSON tag map.
Five scenario groups intercepted two search GETs; settings/handlers were restored,
with no provider installation, live matching claim or cluster writes.

### Tempo metadata attribute scopes

Typed filters now include event, span-link and instrumentation attributes.
The scope/type/operator matrix covers all 120 added combinations, while literal
name tests repeat across all six scopes. Transport/UI tests preserve captured
scope after draft edits and prohibit Jaeger replay.

For hosted verification, add event `"event:name"` string equality, link
`sequence >= -9223372036854775808`, instrumentation `"library/version" != nil`,
event `retry = false`, link `weight < 0.125` and instrumentation
`library.name =~ otel.*`, plus a whole-trace duration intrinsic. Verify the exact
encoded scopes and quoting, and inspect captured rows. Edit a scope without
resubmitting, reject int64 overflow and invalid RE2, switch provider without
replay, return 403 and retry with zero. Five groups observed three search GETs
with no writes or plugin errors. Restore settings durably and remove handlers.
These are not same-event/link join tests or live provider matching evidence.

### Tempo intrinsic filters

`core/traceIntrinsics.test.ts` exercises seventeen span/trace/event/instrumentation/ID fields and every
comparison operator, enum tokens versus same-named attributes, string quoting,
shared RE2 limits and exact duration normalization. Units ns/us/ms/s/m/h use
integer arithmetic; tests cover zero, fractional units, whole-nanosecond
precision, values above JavaScript safe integers and signed-64-bit overflow.
Transport/UI tests verify immutable capture, validation before requests,
incompatible draft preservation, removal and provider changes without replay.

For the hosted fixture, intercept the configured Tempo `/api/search` endpoint
with `{ "traces": [], "metrics": {} }`. Submit historical filters for duration
`>= 9007199254740993ns`, status `!= unset`, kind `= server`, name `=~ GET .*`
and empty status message, together with string attribute `span.status=custom`.
Check the encoded `span:` versus `span.` clauses and captured table. Change
drafts/providers without resubmission, reject `0.1ns`, overflowing duration and
lookahead regex, then return a 403 and retry explicitly with `0ns`.
Five scenario groups issued three search GETs with no writes. No live provider
was queried; restore exact prior settings and wait for ConfigStore persistence.
These tests do not execute the Tempo parser or prove backend matching.

The trace-wide extension repeats those cases with `trace:duration >= 2s`,
`trace:rootName` equal to literal query-like quoted text, and
`trace:rootService =~ product.*`. These remain ANDed with the different matched
span service and duration; captured field names must not gain a `span:` prefix.
Edit the trace-duration draft without resubmitting and retain the prior captured
value; after provider switching, reject `0.1ns` for trace duration too. The
explicit retry must contain distinct zero-valued span and trace durations.
Five hosted groups issued three GETs with no writes, and the original settings
were restored after the combined eight-field run.

The metadata extension adds `event:name`, `instrumentation:name` and
`instrumentation:version`. Test dot attributes separately, literal strings and
lexicographic versions, empty values, 1024-character values, 512-character RE2,
the ten-predicate cap and shared URL/Jaeger rejection. Change metadata values
while the reader awaits and retain the original request; edit field/value
drafts after submission without changing the captured table.

Four hosted groups made three intercepted search GETs. They combined the three
new intrinsics with same-named attributes, quoted query-like library text and a
version range. Provider changes must remove captured results without replay;
invalid regex stays local, denial remains an error and explicit retry preserves
an empty version. Eleven selectable fields still allow at most ten predicates.
The increment passed 382 tests in five files. It does not execute the Tempo
parser, join individual event records or prove backend storage/live matching.
When choosing stock-host Select options, wait for the prior listbox transition
to finish; both the closing listbox and its control can share an accessible
label. Remove unrelated invalid-provider drafts before asserting which
validation family supplies the submission error.

`core/traceIdentityIntrinsics.test.ts` adds the five scoped ID fields and
`event:timeSinceStart`. Check every operator: IDs permit only equality/
inequality, not generic string ranges or regexes. Reject malformed/oversized
hex before requests; retain case, leading zeros, zero and explicit empty
literals. Do not reuse the trace-detail ID decoder, which has different
normalization and nonzero requirements.

Event offset tests cover exact negative fractional-unit conversion, negative
zero, above-safe-integer values, both supported magnitude endpoints and
rejected fractional-nanosecond/overflow inputs. The negative int64 extreme is
deliberately rejected rather than serialized through float duration arithmetic.
The same negative inputs must remain invalid for span/whole-trace durations.

Four hosted identity/offset groups issued three searches. Submit all five ID
scopes plus `event:timeSinceStart <= -9007199254740993ns`; inspect the exact
request and captured table. Field switches must retain invalid operator/value
drafts until corrected. Invalid hex, fractional nanoseconds and the unsupported
negative extreme must not reach transport. Provider switching must not replay
captures; denial/retry with `-1.5ms` must serialize `-1500000ns`. Count seventeen
field options but at most ten predicates, and forbid trace-detail/link traversal
requests in the fixture. The increment passed 461 focused tests in six files
and metadata regressions; restore settings and remove every interceptor.

### Related-span searches

`core/traceRelations.test.ts` checks each of the six fixed operators, exact
left/right predicate placement, literal string protection, strict secondary
shape/length validation, Jaeger rejection and the combined encoded URL cap.
Same-trace AND may match the same span and returns both groups; structural
relations return right-group matches. Do not equate either with linked traces,
causality or timestamp ordering.

Hosted checks submit all six relations using different primary/related services,
a primary operation, a query-like related operation and related-only error
status. Inspect the complete captured query, not merely the operator string.
Change drafts without submission, switch providers, reject Jaeger until the
group is explicitly disabled, and verify denial/retry. Three groups made nine
search GETs; no detail read, link traversal or cluster write occurred. A
keyboard Space action can disable a control that immediately disappears on
Jaeger; wait for its disappearance instead of polling an unchecked state on a
removed element. The increment passed 484 focused tests in seven files and
primary ID/offset regressions. Restore settings and handlers before teardown.

### Trace name discovery

`core/traceNames.test.ts`, `data/tracing.test.ts` and `Traces.test.tsx` cover
on-demand name pickers with these provider responses:

- Jaeger `/api/services`: `{ "data": ["reviews"] }`.
- Jaeger `/api/operations?service=reviews`:
  `{ "data": [{ "name": "GET /reviews", "spanKind": "server" }] }`.
- Tempo `/api/v2/search/tag/.service.name/values` or `/name/values`:
  `{ "tagValues": [{ "type": "string", "value": "reviews" }] }`.

Tempo requests use Unix seconds and `limit=1000`; operation lookups add
`q={ .service.name = "reviews" }` through URLSearchParams. Names containing
quotes remain literal query values. Reject legacy/incorrect response shapes,
non-string types, backend errors, over 1,000 raw entries and names over 256
characters; do not silently truncate or probe an alternate endpoint.

Hosted verification intercepted eight GETs across six scenarios, including
historical scope, denial, malformed/oversized/empty lists and draft-only
selection. Restore the exact previous tracing setting and await persistence
before removing the handler or reloading. Neither provider is installed.

### Reported trace Pod identity

Core/data/UI tests for `traceCorrelation` require explicit namespace/name/UID,
cover resource-versus-span conflicts, preserve scope snapshots and reject
name-only/mismatched links. The data test deliberately uses an SDK promise that
ignores abort to verify the shared 15-second deadline.

For hosted verification, add a real Bookinfo Pod's namespace/name/UID to a
synthetic trace response, then explicitly verify it. This proves current API
identity checking, not real trace origin. Change only the reported UID to prove
mismatch suppression; intercept the exact Pod GET for a 403 case; omit/conflict
identity attributes to prove zero lookups. No controller/Service inference or
cross-cluster fan-out should occur. Do not commit the real Pod UID to fixtures.

Wait for ConfigStore persistence before every hard reload and after restoring
settings: the pinned host debounces writes by 500 ms. Compare only the stored
`pluginConfigs.kiali` slice with `new pluginLib.ConfigStore('kiali').get()`.
A Save message alone is insufficient. Remove owned temporary endpoints, await
durable restoration, then remove interceptors and reload. The verified final
test profile has tracing disabled in both memory and storage.

### Envoy-to-current-Service candidates

`core/proxyService.test.ts`, `data/proxyService.test.ts`,
`components/ProxyServiceCandidate.test.tsx` and the proxy diagnostic integration
test cover strict eligibility, captured scope, validated returned identities,
bounded ports, cancellation/deadlines, explicit lookup, failure clearing and
binding changes without replay. The adapter reuses existing Go-backed cluster
summary parsing but does not expand its historical-identity claims.

In hosted Headlamp, configure the known development DNS suffix, load a real
Bookinfo Pod and read one bounded Envoy configuration snapshot. Inspect an
outbound `:9080` Bookinfo cluster (paginate the table if necessary). No Service
GET should occur before **Find current Service candidate**. Compare the rendered
UID/port to the actual Service response. Intercept only that Service GET for
port drift, wrong identity, missing UID, 403 and 404; retain no stale link after
failure. Change and restore DNS without replay, then hold a request for the
15-second deadline and retry against the live API.

Eight scenario groups observed ten Service GETs and one proxy stream, with
zero writes and a 15,535 ms timeout. The verified live Service was
`bookinfo/details`. Native Service links open an activity drawer on Headlamp
0.35, so verify its heading/content rather than waiting for URL navigation.
Restore the exact prior Kiali settings and wait for persistence before closing;
no credentials, logging changes or synchronization-auth workaround are needed.

### Envoy configuration metadata candidates

The proxy configuration-reference core/data/UI tests cover canonical path/kind
guards, dotted identities, captured inputs, supported current API versions,
strict response identity, cancellation/deadlines and no query resurrection.
Raw route paths are retained independently of the legacy short display string.
The Service and configuration readers share observed UID/version validation.

The hosted fixture uses a real authorized Bookinfo Pod and Playwright's public
WebSocket routing API. Connect to the real forwarding endpoint to negotiate
`v4.channel.k8s.io`, preserve its greeting, intercept only the expected
`GET /config_dump` frame and return a bounded synthetic HTTP/JSON body.
Do not forward unexpected frames, inspect authorization protocols, patch SDK
globals, create credentials or change cluster objects. Close both routed socket
ends during cleanup; the isolated browser owns the route registration.

Intercept only owned DestinationRule/VirtualService GETs. Exercise explicit
lookup without DNS configuration, beta serving, wrong identity, missing UID,
denial/absence, discovery denial, timeout/retry, route metadata including direct
responses, dotted names, entry changes, noncanonical kinds/versions and native
configuration detail navigation. Twelve cases intercepted eleven object reads
and used four negotiated fixture streams; timeout was 15,052 ms and writes zero.
This proves native request/UI behavior, not live metadata provenance.

## Pod logs and native Envoy diagnostics

These are read-only checks; they do not authorize fixture installation, live
routing, log-level changes, commands or cleanup. In the isolated hosted profile,
open **Kiali > Pod diagnostics**, select an existing injected Bookinfo pod and
load its identity. An Application's owned-pod diagnostic link supplies the
namespace/name without automatically fetching logs.

| Scenario | Expected behavior |
| --- | --- |
| Regular/init/native-sidecar/ephemeral inventory | Exact names/types, unknown readiness and restart evidence remain explicit |
| Current/previous logs | Explicit selection, 1,000-line/24-hour/256-KiB bounds and 15-second deadline |
| Real Kubernetes log negotiation | Raw `Response` via public ApiProxy; wildcard Accept, not exclusive text/plain |
| Oversized/split UTF-8 logs | Byte-bound truncation warning, no corrupt split codepoint |
| Pod replacement or restart during read | Reject attribution; never display old logs/configuration as a new instance |
| Real Envoy server/configuration | One fixed GET over a v4 Kubernetes WebSocket forwarding stream to port 15000; close afterward |
| Repeated/unnamed proxy entries | Distinct indexed rows/controls; preserve source fields rather than inventing names |
| Active/warming/draining/pending listener data | Separate observed states, never a synchronization or health verdict |
| Selected configuration entry | Read-only Monaco JSON with unknown fields preserved; clear on replacement read |
| Denial, malformed framing, unsupported encoding, early close, oversize | Explicit failure, no partial-success snapshot or automatic retry |
| Cancellation before SDK socket assignment | Close an available late handle; never send a GET from late callbacks |
| Host setup stuck beyond 15 seconds | Explicit timeout/warning; a later silent socket is a recorded stock-host reclamation limitation |

Focused checks use the repository's existing Vitest configuration:

```sh
UNDER_TEST=true node_modules/.bin/vitest run \
  -c node_modules/@kinvolk/headlamp-plugin/config/vite.config.mjs \
  src/core/diagnostics.test.ts src/data/diagnostics.test.ts \
  src/components/Diagnostics.test.tsx src/core/proxyHttp.test.ts \
  src/core/proxyConfig.test.ts src/data/proxyAdmin.test.ts \
  src/components/ProxyDiagnostics.test.tsx
```

Proxy framing tests cover exact byte thresholds, incremental/chunked UTF-8,
content-length ambiguity, malformed/oversized headers, incomplete bodies and
chunk bounds. JSON is bounded to 100,000 values, depth 64, 10,000 entries and
64 sections. Server/configuration reads cap bodies at 256 KiB/4 MiB. These
are source-informed tests, not independent Go summary-oracle cases.

Real hosted Bookinfo checks loaded native-sidecar logs, Envoy LIVE state and
88 configuration entries. Browser-only synthetic sockets separately exercised
selection, repeated/unnamed routes, warming listeners, HTTP 403, oversize and
replacement reads. Restore the original WebSocket constructor in `finally`
and reload before checking real data again. Do not retain real logs or full
configuration dumps in artifacts/screenshots; use synthetic payloads instead.
Desktop, control-plane synchronization, full upstream summaries, ztunnel and
confirmed logging controls remain outside this checkpoint.

Proxy summaries add a separate independent oracle:

```sh
node scripts/parity/proxy-summary-oracle.mjs --source /path/to/pinned/kiali --check
```

Its 1,063 cases execute pinned cluster/metadata/protocol/domain/xDS helper bodies
with network/module lookup disabled on a 64-bit Go target. Cases include malformed
and int64-overflow ports, exact metadata API versions, ordered protocol lists,
domain selection and all nonce/subscription combinations. The xDS comparator
alone is not evidence that synchronization has been read from a control plane.

`src/core/proxyDetails.test.ts` additionally checks full route matches/actions,
passthrough/redirect/direct-response retention, unknown fields, default listener
chains, RDS/inline/TCP/weighted destinations, ambiguous oneofs and combined
summary bounds. `ProxyDiagnostics.test.tsx` checks scoped DNS updates without
refetching, malformed-summary warnings with retained JSON and subentry reset.
Live hosted Bookinfo checks exercised cluster DNS context and real route/listener
inspection. The managed Istiod `http-debug=8080` Pod-proxy `/debug/syncz` read
returned 401; do not create credentials or try alternative authorization paths
as part of these read-only fixtures.

### Ztunnel configuration fixture

`diagnostics/ztunnel.json` is authored synthetic data, not a captured cluster
dump. It follows pinned `kubernetes/ztunnel.go` and the ambient service/workload
tables. Transport uses the same fixed `/config_dump` on port 15000 as
`cache/ztunnel_dump.go`. The fixture includes two reported mesh clusters,
waypoints, known/unknown/empty endpoint data, a nameless observation, IPv4/IPv6,
false/zero extension values and synthetic top-level certificate/policy bodies
that must not appear in the rendered projection.

| Ztunnel scenario | Expected behavior |
| --- | --- |
| Explicit format choice | No fetch on selection; only the fixed read-only config request on action |
| Real Envoy body under ztunnel format | Explicit format error, never a successful empty registry |
| Missing versus empty endpoint map | Not reported versus known zero; reported healthy count is not a health verdict |
| Repeated/missing registry IDs | Preserve indexed rows without inventing Kubernetes or Headlamp identities |
| Service/workload filtering | Local filtering, no refetch, old selected entry cleared |
| Selected JSON | Actual Monaco text retains unknown fields, false and zero |
| Certificate/policy bodies | Counts only; no top-level material/body rendering |
| Named ztunnel container | Recheck that exact container's restart count and pod UID |

Focused tests are `src/core/ztunnel.test.ts`, `src/data/proxyAdmin.test.ts`,
`src/components/ProxyDiagnostics.test.tsx` and `src/components/Diagnostics.test.tsx`.
The 4 MiB/15-second transport bound is shared; projection limits are 1,000
services/workloads, 1,000 endpoints per service and 10,000 endpoints overall.
Browser fixtures restore the original WebSocket constructor in `finally` and
reload afterward. Monaco uses non-breaking whitespace in rendered lines;
normalize whitespace when checking synthetic false/zero text.

Hosted fixture checks passed. The test cluster's `app=ztunnel` DaemonSet query
returned none and no ambient components were installed. This is not live
ztunnel, metrics, enrollment or multi-cluster identity-mapping evidence.

## Validation exclusion actions

`src/core/validationAnnotations.test.ts`, `src/data/validationExclusions.test.ts`
and the configuration action tests cover per-object exclusion parsing and
guarded metadata updates. Reproduce the 72 original-Go cases with:

```sh
node scripts/parity/validation-annotations-oracle.mjs --source /path/to/pinned/kiali --check
```

Verify absent vs empty vs selected-code annotations; exact code matching;
Unicode NEL/BOM differences; malformed/oversized input; and bounded linear
trimming with large interior whitespace. Invalid annotations must not hide
findings. Editing supports normal/selected/all modes and rejects invalid code
lists before permission or write requests.

Write tests assert unchanged specs/status/labels/other annotations, update
permissions, UID/version checks before dry-run and confirmation, cluster-scoped
paths without namespaces, explicit acknowledgement validation and no retry.
Unknown actions must never fall through into DELETE. Cluster changes close and
abort an old dialog even when the new cluster presents the same UID.

For hosted verification, intercept the unique test-resource GET/PUT and every
SelfSubjectAccessReview for that target. Seven cases cover successful selected
codes, restoration, ignore-all, denial, stale versions, malformed dry-run
acknowledgement and an aborted final response. A full run captures 12 permission
reviews and 10 dry-run/final PUTs, all intercepted. Reload between fixture state
checks; these writes create no real watch events. Wait for Monaco view lines
and `document.fonts.ready` before capturing the read-only review. Remove all
handlers in `finally`; never write the fixture annotation to the live cluster.

## Configured namespace discovery selectors

`src/core/namespaceDiscovery.test.ts`, `src/core/labels.test.ts`,
`src/data/mesh.test.ts`, `src/data/mtls.test.ts` and `src/components/Mesh.test.tsx`
cover configured namespace selection without changing cluster configuration.
They test OR/AND behavior, missing keys, empty values, all four expression
operators, own/root exceptions, malformed/inconsistent selector declarations,
whole-string key validation, 63-character values and exact selector/term limits.
Unmatched or malformed scope blocks configured-mTLS policy reads.

The runtime remains conservative for ambiguous controller labels, unrelated
unlabelled namespaces and remote topology. It does not import Kiali-server
visibility defaults or silently skip invalid selectors. Selector matches are
not injected-workload, encryption or health evidence.

Hosted fixture checks intercept only the selected Istio mesh ConfigMap GET,
using real controller/namespace discovery. Exercise a matching metadata-name
selector, a nonmatching selector, invalid empty In-values, OR alternatives and
an empty selector array. Verify the root namespace exception and that an excluded
namespace issues no PeerAuthentication/DestinationRule reads during mTLS
assessment. Remove interception and reload; never save the fixture to Kubernetes.

## Traffic topology projections

`topology/fixture.json` contains synthetic canonical-label observations. Merge
its `labels` with each sample's `labels`, supplying the captured query time as
the instant-vector timestamp and the sample's `rate` as its value. No Kubernetes
object or namespace needs to be created for these scenarios.

| Scenario | Expected result |
| --- | --- |
| Workload/app/versioned-app modes | Six/four/six nodes; app grouping preserves separate HTTP/gRPC edges |
| Service mode | Four nodes, retained external root and derived reviews-to-ratings rate 5 |
| Response/security inspection | HTTP 200 rate 2 and 503 rate 3, UF flags and explicit none/mutual_tls observations |
| Node filter `ratings` in Service mode | Two visible nodes, one edge; no new backend read |
| TCP or gRPC message totals | Two same-time reads with byte/message units; one failure prevents a total |
| Historical time/window | Every query uses the captured end and selected rate window |
| Bad scope/reporter, duplicate, stale/NaN/negative samples | Explicit failure, not empty success or a healthy default |
| Missing canonical/security labels | Unknown/fallback identity; no guessed resource link or policy enforcement |
| Zero observations enabled | Dashed zero-rate edges, not liveness |
| 61 nodes | Diagram limit message; all rows remain reachable through table pagination |
| Service aliases and protocol overlap | Mappings deduplicated per workload; repeated alias rates explicitly marked non-additive |

Focused tests: `src/core/topology.test.ts`, `src/data/topology.test.ts`,
`src/components/Topology.test.tsx`, `src/components/TrafficGraph.test.tsx`.
The shared read-deadline cleanup also runs against proxy/log/trace regressions.
Exact budgets are tested, including 1,000 nodes, 2,000 edges and 20,000
Service-projection contributions.

The original-Go identity oracle can be reproduced without downloading modules:

```sh
node scripts/parity/topology-oracle.mjs --source /path/to/pinned/kiali --check
```

Its source-hash-checked `Id`, `IsOK` and `IsOKVersion` functions produce 1,728
cases. Native tuple IDs deliberately avoid upstream separator collisions;
tests compare the upstream representation and kind, then check tuple safety.
This is not a full Go graph/reporter/service-reduction differential oracle.

Hosted real Bookinfo checks exercised source and destination reporters and all
four projections. TCP series were absent. Eleven intercepted browser scenarios
covered populated TCP/message totals, historical controls, metadata, explicit
errors and large-table pagination. No fixture settings, writes or cluster
components were introduced.

Namespace membership annotations have four additional hosted scenario groups
with three intercepted metric GETs. Include a selected-namespace endpoint,
an outside endpoint, a different telemetry cluster using the same namespace
name, and an unknown source. Check SVG captions and `aria-describedby`, the
node table and keyboard inspection. Repeat all four projections and local
filtering without another read. A namespace edit clears captured results;
explicit resubmission updates membership, while a denied query removes stale
annotations. Restore the exact previous settings slice durably and remove
fixture handlers. This does not test namespace RBAC, egress-cluster
classification or full upstream outsider/inaccessible finalization.

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
