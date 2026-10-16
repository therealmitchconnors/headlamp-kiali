# Kiali native-port parity ledger

## Baseline and scope

Reference: [Kiali v2.33.0](https://github.com/kiali/kiali/tree/0e8be887b8217bbcac5e3ae0bfcd258073949cca),
commit `0e8be887b8217bbcac5e3ae0bfcd258073949cca`.

The target is native mesh, observability and configuration behavior in stock
Headlamp Desktop and hosted Headlamp. No Kiali backend, Headlamp modifications,
cluster installations or elevated credentials are introduced. AI/chat and
offline/gather/import workflows are excluded by user decision. Login, cluster
connections and application hosting remain Headlamp responsibilities.

**The first native slice is implemented; this is not a completed port.** Kiali
now has an overview, namespace/Service lists, workload-kind tabs and per-cluster
settings. These routes were exercised against Bookinfo in both stock Headlamp
0.35.0 Desktop and hosted-web mode. The original pure health primitives remain
independently checked against Go, but are not yet integrated as mesh health.

## Verified initial native slice

| Surface | Implementation | Desktop and hosted-web evidence | Remaining boundary |
| --- | --- | --- | --- |
| Overview | `components/Overview.tsx` | Istio served versions and Prometheus 3.10.0 shown; named controls and nonblank English labels | API presence is not control-plane health; no traffic charts |
| Settings | `config.ts`, `core/config.ts`, `components/Settings.tsx` | Actual UI saved `istio-system/prometheus:9090`; connection succeeded in each profile; Desktop reload retained it | Explicit Service reference only; no automatic endpoint discovery or external-service credential support |
| Reactive connection state | `hooks/useRequest.ts`, `data/requests.ts` | Desktop overview changed immediately when configuration was disabled or pointed at a missing Service, then recovered on restoration | Restricted-user scenarios remain fixture-tested, not live-tested with a second identity |
| Namespaces | `components/Resources.tsx` | Native rows show Bookinfo's `asm-1-30` revision and Active phase | No namespace mesh-health summary or custom namespace actions |
| Services | `components/Resources.tsx` | Namespace filter restricted rows to the four Bookinfo Services; ports rendered; name opened native Service details | Not Kiali's service correlation, health or configuration detail view |
| Workloads | `components/Resources.tsx`, `core/readiness.ts` | Six Bookinfo Deployments show `1/1`; Jobs tab is honestly empty and retains kind/namespace in the URL | Five native controller tabs; no application grouping, standalone ReplicaSet/OpenShift extensions or custom Kiali details |
| Scope and errors | `core/scope.ts`, `data/requests.ts`, `hooks/useRequest.ts` | Explicit cluster requests; cancellation, late responses, malformed payloads, prototype-like cluster names and 401/403/404 classifications covered by tests | Multi-cluster browsing deliberately prompts for a single selection |

The production package was built once and the same main.js hash was installed
into both test targets. The temporary watch process was stopped; the production
package remains installed in Desktop. The temporary hosted-web server is stopped
after verification. This iteration performs no Kubernetes mutations.

Headlamp 0.35.0 does not provide the newer Service `getFormattedPorts` helper
advertised by the installed SDK types. The live check caught that mismatch; the
renderer now uses stable Service spec fields, with a regression test whose
Service model deliberately has no such helpers.

The final Desktop navigation/reload run recorded no runtime exceptions or
console errors. Hosted-web verification had no plugin execution or component
errors; Headlamp itself logged its deprecated
`apiextensions.k8s.io/v1beta1/customresourcedefinitions` discovery probe returning
404 before using the supported API. A rapid Desktop navigation run also surfaced
a host WebSocket-close diagnostic; the final settled run was clean. These are
not reported as proof that all host diagnostics are clean in every scenario.
Desktop CDP screenshot capture timed out; Desktop DOM/console checks and hosted
Playwright accessibility snapshots and screenshots supplied the recorded evidence.

## Source inventories

The committed inventories are the individual-entry ledger, not a count of
finished features:

- [`upstream.json`](../test-files/parity/upstream.json): 508 checksum-verified
  upstream sources and 616 records covering API operations, resource identities,
  validation descriptors/checkers, graph options/defaults/appenders, frontend
  source units and health primitives.
- [`frontend.json`](../test-files/parity/frontend.json): 21 resolved frontend
  routes and 216 individual graph/health/wizard contract fields. Repeated
  interface declarations retain their additional source lines without counting
  the same field twice.
- [`health-oracle.json`](../test-files/parity/health-oracle.json): expected
  results produced by the original pinned Go health model, not the port.

Go declarations are extracted using Go's parser/AST, not textual searches through
comments. Frontend routes and contract members use the TypeScript AST.
Every inventory record carries a source path, line, symbol and stable ID.
Every source has its Git blob hash. A source link is constructed as
`https://github.com/kiali/kiali/blob/<commit>/<source>#L<line>`.
Attributes retain handler expressions, validation messages/severities, resource
definitions, defaults and query-parameter names where applicable.

File-level records such as `wizard-source` are coverage leads, not proof that all
behavior in a file has been translated. Their interaction semantics, accepted
inputs, fixtures and acceptance criteria must be resolved before porting that
surface. API records specify behavior to reproduce through domain functions, not
HTTP endpoints to add to Headlamp.

### Effective status and ownership

All individual records are **planned**, in **both** host modes, unless an explicit
exception below says otherwise. Each category inherits its implementation task
and acceptance obligation from this table. An unlisted record must not be treated
as implemented. The catalogs themselves are not imported into the plugin bundle.
The initial native slice above is an explicitly partial implementation of the
larger Kiali families; it does not mark an entire upstream handler or family as
verified-parity.

| Category | Records | Implementation tasks | Acceptance obligation |
| --- | ---: | --- | --- |
| API operations | 88 | Feature family mapping below | Handler behavior/options and negative cases |
| Resources and API versions | 34 + 12 | `resource-access`, `config-views` | Live served schema, scope, fields, links and version normalization |
| Checkers and diagnostic descriptors | 64 + 72 | `basic-validation`, `full-validation` | Every check/code, severity, field path and incomplete-visibility behavior |
| Graph appenders | 17 | `advanced-graph` | Ordering, enrichment and graph modes against upstream fixtures |
| Graph defaults and parameters | 11 + 20 | `basic-graph`, `advanced-graph` | Defaults, allowed values, validation and historical query behavior |
| Graph/health/wizard contract fields | 216 | Corresponding graph, health and wizard tasks | Meaning, optional/empty values and supported interactions |
| Resolved frontend routes | 21 | Corresponding native-view task | Native equivalent, filter state and detail navigation |
| Frontend contract source units | 64 | Corresponding domain/view task | Enumerate behavioral dependencies before use |
| Page source units | 176 | Corresponding native-view task | Tabs, filters, actions, errors, accessibility and data dependencies |
| Wizard source units | 45 | `basic-wizards`, `full-wizards` | Exact proposed manifests, confirmation and partial-failure handling |
| Diagnostic source units | 6 | `diagnostics` | Payload normalization and mode-specific endpoint access |
| Health primitives | 7 | `parity-harness`, then `health` | Independent output comparison plus later data/UI integration |

### Feature families

| Family / API path or source | Target module and native surface | Prerequisites | Current status, Desktop / web |
| --- | --- | --- | --- |
| Overview, namespaces, namespace info/updates | `src/components/Overview.tsx`, `Resources.tsx` | Resource access and scoped permissions | Partial read-only native slice / partial read-only native slice |
| Apps, workloads, Services, pods | Native lists in `Resources.tsx`; correlation still planned | Typed resources and label/owner indexes | Partial native Services/workloads / partial native Services/workloads |
| Istio configuration, permissions and supported forms | `src/resources`, configuration views | API discovery and confirmed RBAC writes | Planned / planned |
| Metrics, dashboards, statistics, overview rates/latency | `src/core/telemetry`, charts | Existing Prometheus-compatible endpoint | Planned / planned |
| Health and annotations | `src/core/health.ts`, shared health presentation | Telemetry, normalized replica/proxy state | Partial core only / partial core only |
| Validations, references and ignore annotations | `src/core/validation`, configuration findings | Complete or explicitly partial snapshots | Planned / planned |
| Traffic graphs and summaries | `src/core/graph`, native traffic graph | Telemetry, correlation and compatible renderer | Planned / planned |
| Mesh graph, control planes, Istio status and TLS | `src/core/mesh`, Mesh page | Discovery, policy scope and observed data | Planned / planned |
| Logs, config dumps, proxy resources, logging changes | `src/data/diagnostics`, detail tabs | Proven SDK transport and permissions | Unverified transport / unverified transport |
| Traces, spans, error traces and tracing diagnostics | `src/data/tracing`, trace views | Existing Jaeger/Tempo HTTP endpoints/auth | Unverified transport / unverified transport |
| Grafana and Perses | Integration adapters and dashboard links | Existing endpoint and compatible auth | Planned / planned |
| Cluster aggregation | Scoped data adapters and cluster mapping | Headlamp cluster groups and telemetry labels | Planned / planned |
| Wizard source and action contracts | `src/core/wizards`, reviewed change sets | Confirmed writes and semantic validation | Planned / planned |
| API authenticate/logout/auth-info and frontend Login | Headlamp's existing identity UI | Host authentication | Replaced-by-Headlamp; integration unverified |
| Backend health endpoints and test instrumentation | Host health and local tests | No Kiali server shipped | Replaced by host/test responsibilities |
| `/api/chat*`, ChatSessionUsage, AI-specific source contracts | None | Explicit scope exclusion | Excluded-by-user / excluded-by-user |
| Offline and gather/import commands | None | Explicit scope exclusion | Excluded-by-user / excluded-by-user |

Source-unit inventories intentionally retain excluded source references so their
absence is visible. A general endpoint such as `/api/config` may contain both
in-scope and excluded settings; it is not blanket-excluded.

## Implemented pure-core evidence

`src/core/health.ts` ports the following exact model semantics:

| Upstream symbol | TypeScript equivalent | Evidence |
| --- | --- | --- |
| `HealthStatusPriority` | `healthStatusPriority` | Six statuses including unknown |
| `MergeHealthStatus` | `mergeHealthStatus` | All 36 ordered pairs, including ties |
| `WorkloadStatusHealth` | `workloadStatusHealth` | Null input and 320 replica/proxy combinations |
| `RequestHealth.GetErrorRatio` | `simpleRequestErrorRatio` | No-data, HTTP errors, mixed directions, fractional rates and non-HTTP codes |
| `GetInboundRequestRate`, `GetOutboundRequestRate` | `directionalRequestRate` | Inbound/outbound oracle results |
| `GetTotalRequestRate` | `totalRequestRate` | Combined oracle results |

The simple error-ratio fallback is **not** Kiali's protocol-aware HealthCalculator:
gRPC error tolerances, annotations, configurable thresholds, aggregation and UI
integration remain unimplemented. The workload function consumes normalized,
complete replica counts; an unknown workload is `null`, not a fabricated
zero-replica object. Unavailable proxy-sync data uses the upstream `-1` sentinel.

## Stock-host capability gate

Offline SDK inspection confirms declarations for K8s resource access,
`ApiProxy.request` with explicit cluster and RequestInit options, Service-proxy
requests (also used by the official Prometheus plugin), and managed port forwards.
`registerMapSource` is public; deep graph rendering internals must not be assumed
runtime-safe from declaration files alone.

An isolated stock Headlamp **0.35.0** server was started from the installed desktop
distribution, bound to `127.0.0.1:4487` with a separate empty kubeconfig and
temporary plugin directory. Playwright observed the Kiali app-bar label in the
accessibility tree and no console errors or warnings. No Electron GUI was
launched. The helper server is stopped after the check.

Runtime inspection confirmed function exports for `registerRoute`,
`registerSidebarEntry`, `registerPluginSettings`, `registerMapSource`,
`ConfigStore`, `useTranslation`, `K8s.cluster.KubeObject`, the Namespace/Service/
Deployment classes, `ApiProxy.request`, `startPortForward`, `stream`, and the
ResourceListView/DetailsGrid/SectionBox/SimpleTable/ConfirmDialog components.
Function availability does not establish network, permission or lifecycle
behavior.

**The environment blockers are now cleared.** The user selected the current
kubeconfig context, `mitch-auto`, and explicitly requested installation of Istio,
Bookinfo and the Istio example Prometheus for development. That optional setup
now uses managed Istio `asm-1-30` with CNI chaining in `aks-istio-system`, six
injected Bookinfo deployments in `bookinfo`, and Prometheus in `istio-system`.
AKS admitted the supported managed installation without any policy exemptions.
See [the fixture guide](../test-files/README.md) for the exact setup and limitations.

The user launched Headlamp Desktop with a loopback CDP target. A read-only
attachment confirmed SDK availability, and the actual Desktop
`ApiProxy.request(..., {cluster: 'mitch-auto'})` returned Bookinfo
`istio_requests_total` data from the Prometheus Service proxy. This verifies one
real native transport path, not all planned functionality or plugin UI parity.
Restricted-RBAC, streaming/lifecycle, other integrations and hosted-web
cluster-connected scenarios still need their own evidence.

| Capability | Offline evidence | Desktop / hosted-web live evidence |
| --- | --- | --- |
| Native slice loading and listed SDK exports | Installed stock Headlamp 0.35.0 | Confirmed / confirmed against the selected cluster |
| Desktop CDP and SDK availability | User-launched Desktop target on loopback 9222 | Confirmed / not applicable |
| Resource discovery/read/write and permissions | SDK K8s / ApiProxy contracts | Initial reads confirmed; writes and restricted-user cases pending / same |
| Existing HTTP Service access | ApiProxy plus official Prometheus example | Prometheus query/build-info confirmed / build-info confirmed |
| Cancellation, streaming and session invalidation | Must exercise the actual host lifecycle | Pending / pending |
| Envoy, Istiod and ztunnel endpoints | Reachability cannot be inferred from SDK types | Pending / pending |
| Port-forward listener use | SDK APIs exist; listener is backend-local | Pending / pending; browser localhost is not server localhost |
| Tracing HTTP/auth equivalents | Provider-specific endpoint validation required | Pending / pending |
| gRPC-only operations | Browser cannot use native gRPC directly | Gap unless an existing equivalent HTTP API is available |
| Graph renderer | Public structural Map registration only established | Pending / pending |

Unverified capabilities are not labeled impossible. Failed or unavailable
stock-host paths must become explicit per-operation gaps, not a new backend,
credential escalation, bridge deployment or unsafe network exposure.

The optional `istioctl proxy-status` probe failed when trying to create RPC
credentials in `aks-istio-system`: AKS protects that namespace. This is a concrete
CLI permission limitation, not proof that every read-only diagnostic transport
is unavailable. Do not weaken policy or assume synchronization checks passed.

## Closing a ledger entry

Before changing a row to verified-parity, add its plugin symbol/surface, a fixture
or scenario covering its semantics, documented supported API versions/defaults,
negative/partial cases, and separate Desktop/web runtime evidence. Use
implemented-unverified when code exists without live integration evidence.
Partial and blocked entries stay in the release gap list. They do not count as
passed merely because type-checking or unit tests succeed.

Regeneration and checks are documented in [test-files/README.md](../test-files/README.md).
