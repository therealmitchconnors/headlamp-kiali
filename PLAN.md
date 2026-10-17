# Kiali native Headlamp port: implementation plan and agent handoff

This is the current, repository-local plan. It supersedes the earlier
session-local planning notes and does not require access to a Copilot session
database, conversation, or private artifact directory.

**The port is partial.** Native browsing, scoped settings and the first
application-correlation slice work. Most Istio-specific views, mutations,
telemetry, graph and analysis features remain to be implemented.

## Start here

1. Read [AGENTS.md](AGENTS.md), this plan, [docs/parity.md](docs/parity.md), and
   [test-files/README.md](test-files/README.md).
2. Inspect `git status`, the current branch and the recent commits before editing.
   Ensure the checkout includes the correlation and handoff checkpoint below.
3. Preserve the existing correlation implementation. Review it before extending
   it; do not regenerate the plugin scaffold.
4. Continue with **`config-views`**, beginning with a small coherent Istio
   configuration slice such as VirtualService and DestinationRule. `telemetry`
   is also dependency-ready, but configuration views are the next priority.
5. Update this plan and the parity ledger as work lands. A completed foundation
   milestone is not a claim of full parity for its broader feature family.

### Git handoff boundary

| Checkpoint | Contents |
| --- | --- |
| `06162d2` | Initial Kiali scaffold and extracted agent skills; scaffolding only |
| `739260f` | Native resource browsing, scoped settings, parity infrastructure and reproducible development fixtures |
| Correlation and handoff checkpoint after `739260f` | Application correlation, Applications list/detail UI, label settings, tests, oracle, related documentation and this plan |

At handoff the branch is `therealmitchconnors-kiali-plugin`.
The correlation implementation and this plan are committed together in a
checkpoint after `739260f`. Use the tip of this feature branch (or a later
checkpoint) when handing off to VS Code agents. Simply checking out `739260f`
elsewhere will not include the new Applications implementation or this plan.

The production plugin was installed in the local Headlamp Desktop profile.
That installation is outside Git; source changes still need a build/deployment.
Temporary development watchers and hosted-web verification servers were stopped.
Do not assume a live debug target or test service is still available: recheck it.

## Confirmed product decisions

- Port Kiali's mesh, observability and configuration behavior into native
  Headlamp React/MUI views, backed by reusable TypeScript domain logic.
- Support stock Headlamp Desktop and hosted Headlamp in a browser.
- No Headlamp modifications, local Kiali companion, runtime Go, kubectl, Docker,
  or custom backend requirement.
- Do not require installing Kiali or any other new component in an end user's
  target cluster. Reuse existing Istio resources and telemetry services.
- Missing dependencies must be visible; the plugin must not install them.
- Include tracing, traffic-management wizards, proxy diagnostics, multi-cluster
  behavior and the rest of the scoped parity target.
- **Exclude AI/chat and offline/gather/import workflows.** Live historical
  telemetry queries remain in scope.
- Reuse Headlamp login, cluster connections, hosting, themes and appropriate
  built-in resource interactions.
- Future plugin mutations follow Headlamp RBAC and require explicit
  confirmation. There is no separate per-cluster write-mode opt-in.
- Track stock-host/browser limitations explicitly. Do not introduce a bridge,
  credential escalation or policy bypass to hide a parity gap.
- Target functional/semantic parity, not a copy of PatternFly styling or a
  server implementing Kiali's REST API.
- Implementation is approved. That is not blanket authorization for new cluster
  installs, fixture application, cleanup or changes to security policies.

## Pinned references

- Kiali: **v2.33.0**, commit
  [`0e8be887b8217bbcac5e3ae0bfcd258073949cca`](https://github.com/kiali/kiali/tree/0e8be887b8217bbcac5e3ae0bfcd258073949cca).
  Do not silently change the parity baseline to upstream master.
- Plugin toolchain: `@kinvolk/headlamp-plugin` **0.14.0**.
- Host exercised so far: stock Headlamp **0.35.0**, Desktop and hosted-web mode.
- The upstream source inventories cover 508 source blobs, 616 inventory records,
  21 frontend routes and 216 distinct contract fields.
- Independent Go oracles cover 375 health-model cases and 75 label-resolution
  cases. These are developer-only tools, not a runtime dependency.
- Source and tests are authoritative. Upstream architecture documents are useful
  navigation aids, not substitutes for reading behavior.

## What exists now

| Surface | Current implementation | Important limit |
| --- | --- | --- |
| Kiali navigation | Overview, Applications, Namespaces, Services, Workloads, Connection settings | No links to unimplemented features |
| Overview | Istio API discovery and existing Prometheus Service connectivity | API presence is not mesh/control-plane health |
| Native resource browsing | Namespace/Service tables; Deployment, StatefulSet, DaemonSet, Job and CronJob tabs | No plugin list mutations; details delegate to Headlamp |
| Settings | Validated version-1 ConfigStore data keyed by cluster; Service endpoint and optional app/version label pair | Browser-profile-local; no credentials or external URLs stored |
| Scoped reads | Explicit cluster, namespace validation, abort propagation, structured failures, stale-response suppression | No persistent derived-data cache |
| Applications | List/detail grouping, versions, related Services, owned pods and native-sidecar detection | One cluster and one explicitly selected namespace |
| Correlation core | Scoped label postings, selectors, UID owner chains, de-duplication, Service-host resolution | Configuration relationships, not measured traffic |
| Health core | Ported low-level health model primitives | Not the complete HealthCalculator, and not integrated as mesh health |
| Parity evidence | Source inventories, reproducible generators, synthetic fixtures and live Bookinfo checks | Inventoried does not mean implemented |

### Application semantics to preserve

- Default label priority is canonical Istio labels, then `app.kubernetes.io`
  labels, then `app`/`version`. A configured pair replaces that fallback order.
- Presence matters: an empty preferred label value is distinct from a missing
  label. Empty application labels remain addressable through query parameters.
- Replica-controller application labels come from pod templates; Job/CronJob
  application labels come from controller metadata, matching the pinned source.
- Controller owner references require matching scoped UID, group, kind and
  name. Do not replace this with name-only matching.
- Owned ReplicaSets/Jobs collapse into observed parents. Missing or inconsistent
  parents are explicit uncertainty; known children may remain visible.
- Selectorless Services do not automatically select every pod or workload.
- Native sidecars are recognized in restartable init containers with
  `restartPolicy: Always`. Container presence does not prove proxy health.
- Snapshot reads cover nine namespaced kinds: Deployments, StatefulSets,
  DaemonSets, ReplicaSets, ReplicationControllers, Jobs, CronJobs, Pods and Services.
- Reads use three workers and at most four 250-item pages per kind. Limits,
  permission failures, malformed responses and inconsistent pagination are
  reported as incomplete; incomplete zero counts are shown as unavailable.
- Derived application refresh is manual. External/registry workloads,
  WorkloadGroups, OpenShift-specific controllers and multi-namespace UI are not
  yet included.

## Repository map

| Path | Purpose |
| --- | --- |
| `src/index.tsx` | Registration only, with `kiali-` names and `/kiali/...` paths |
| `src/config.ts`, `src/core/config.ts` | ConfigStore integration, schema validation and cluster-specific merging |
| `src/core/scope.ts`, `object.ts` | Explicit scope, identity and shared guards |
| `src/core/labels.ts`, `correlation.ts` | Pure selector, label, owner and application relationship logic |
| `src/core/health.ts`, `readiness.ts` | Separate Kiali health primitives and Kubernetes readiness |
| `src/data/requests.ts`, `correlation.ts` | Headlamp transport adapters, response validation and bounded snapshots |
| `src/hooks/useRequest.ts` | Scope/key-bound asynchronous state and cancellation |
| `src/components/` | Current native views and settings |
| `locales/en/translation.json` | Extracted nonempty English strings |
| `scripts/parity/` | Inventory/oracle generation and consistency checks |
| `test-files/parity/`, `test-files/correlation/` | Committed synthetic evidence; no production credentials |
| `test-files/deploy/` | Pinned Bookinfo/Prometheus examples and local Kustomize overlays |
| `docs/parity.md` | Feature evidence, partial coverage, limitations and provenance |
| `src/resources/`, `src/mapView.tsx` | Planned next surfaces; not implemented yet |
| `docs/OVERVIEW.md` | Planned permanent coverage/screenshot document; not implemented yet |

Keep pure core logic independent of React and transport. Keep adapters explicit,
typed and testable. Stay within this package; do not create a monorepo, generic
plugin framework, second React/Redux instance or bundled Kiali SPA.

## Milestone status and dependencies

This table is the portable execution record. Update it directly; access to the
original agent's SQL task store is not required.

**Done** means the initial bounded milestone described above was delivered.
It does not mean every upstream subfeature in that family has reached parity.
**Partial / open** still has implementation work. The full-parity ledger remains
the authority for individual behavior and platform claims.

| ID | Status | Deliverable / remaining work | Prerequisites |
| --- | --- | --- | --- |
| `parity-catalog` | Done | Initial pinned source and behavior inventory | None |
| `stock-host-spikes` | Done, bounded | Public APIs needed by native browsing/settings proved; advanced transport/renderer questions remain with their feature tasks | `parity-catalog` |
| `parity-harness` | Done, foundation | Reproducible inventories/oracles; add fixtures for each new port | `parity-catalog` |
| `shared-context` | Done | Scope, identity, settings, failure states and cancellation | `stock-host-spikes`, `parity-harness` |
| `resource-access` | Done, initial | Typed built-in SDK models and explicit ApiProxy adapters; new CRD models belong to `config-views` | `shared-context` |
| `resource-views` | Done, initial | Native read-only lists, readiness and native detail links | `resource-access` |
| `correlation` | Done, initial | Supported Kubernetes correlation core and first Applications consumer | `resource-access` |
| `config-views` | **Partial / open; next** | Applications consumer exists; implement typed Istio/Gateway models, list/detail coverage, references and structural Map integration | `resource-views`, `correlation` |
| `safe-mutations` | Pending | Confirmed RBAC-aware CRUD and supported workload/namespace/Service actions | `config-views` |
| `basic-validation` | Pending | Checker contracts and useful reference/selector checks with upstream codes | `config-views` |
| `telemetry` | Pending; ready | Prometheus query/result core and basic charts; connection checks alone are not this milestone | `resource-views`, `correlation` |
| `health` | Partial / open | Complete thresholds, annotations, protocols, aggregation and UI beyond the existing primitives | `telemetry` |
| `basic-graph` | Pending | Deterministic observed single-cluster traffic graph | `telemetry`, `correlation`, `stock-host-spikes` |
| `mesh-security` | Pending | Control-plane/revision/network discovery and configured/observed security analysis | `correlation`, `config-views`, `telemetry` |
| `full-validation` | Pending | Complete every scoped checker/code and incremental evaluation | `basic-validation`, `mesh-security` |
| `basic-wizards` | Pending | Reviewed traffic-shifting change sets | `safe-mutations`, `basic-validation` |
| `full-wizards` | Pending | All scoped forms, routing, faults, retries, policies and deletion workflows | `basic-wizards`, `full-validation` |
| `diagnostics` | Pending | Logs, proxy synchronization/configuration, ztunnel and logging controls where stock transport permits | `resource-views`, `mesh-security`, `safe-mutations`, `stock-host-spikes` |
| `integrations` | Pending | Dashboard families, tracing and Grafana/Perses integration | `telemetry`, `correlation`, `basic-graph`, `stock-host-spikes` |
| `multi-cluster` | Pending | Cluster-group fan-out, telemetry identity mapping, provenance and partial visibility | `config-views`, `telemetry`, `mesh-security` |
| `advanced-graph` | Pending | All graph modes/options, appenders, ambient behavior and interactions | `basic-graph`, `health`, `full-validation`, `mesh-security`, `multi-cluster`, `integrations` |
| `runtime-hardening` | Pending | Measured query/memory/concurrency/rendering budgets and both-mode resilience | `advanced-graph`, `diagnostics`, `full-wizards` |
| `parity-release` | Pending | Close the ledger, verify live, document and package with explicit remaining gaps | `runtime-hardening`, `full-validation`, `full-wizards`, `integrations`, `multi-cluster` |

The optional verification setup is also complete: managed Istio installation,
Bookinfo/example Prometheus deployment, real metric verification and a supplied
Desktop debug target. These are development-environment milestones, not product
installation requirements.

## Immediate next task: configuration views

1. Review the new correlation code and its limits before building on it.
2. Read the focused `.github/skills/define-resource/SKILL.md`,
   `add-list-view/SKILL.md` and `add-detail-view/SKILL.md`. Do not launch the whole
   operator-installing `create-crd-plugin` workflow for this native port.
3. Inspect the chosen cluster's discovery and CRD schemas, served versions,
   printer columns and real instances. Do not infer field shapes from memory.
4. Deliver a small initial pair, such as VirtualService and DestinationRule,
   using typed KubeObject models under `src/resources/`. Normalize served-version
   differences through typed getters.
5. Register lists and plugin-owned detail routes under the existing Kiali parent.
   Render meaningful spec/status groups, related references, and Conditions last
   before Events where applicable. Record deliberate field omissions.
6. Reuse the selector, owner, identity and Service-host helpers when appropriate,
   but do not coerce CRDs into the existing nine-kind Kubernetes DTO union.
7. Add structural Map sources and real icons through public `registerMapSource`
   and `registerKindIcon` APIs. Structural edges are not observed traffic edges.
8. Test absent APIs, installed-but-empty resources, forbidden access, optional
   fields, versions and links; then verify actual loading and rendering in both
   host modes. Do not enable custom mutation controls before `safe-mutations`.

Bookinfo's current fixtures primarily provide Kubernetes objects. Do not assume
representative VirtualService/DestinationRule instances are present. If seeding
is needed, obtain explicit approval for the exact cluster/namespace first.
An empty list or a green build is not describe-parity evidence.

If multiple agents work independently, agree on ownership of shared registration,
configuration, locale and ledger files. Do not run concurrent watchers that
overwrite the same installed plugin.

## Full scoped target and later acceptance gates

### Resource and configuration inventory

Expand coverage from the pinned API criteria and actual discovery, not a guessed
list. The initial inventory includes:

- Istio networking: VirtualService, DestinationRule, Gateway, ServiceEntry,
  Sidecar, WorkloadEntry, WorkloadGroup and EnvoyFilter.
- Security: AuthorizationPolicy, PeerAuthentication and RequestAuthentication.
- Extensions/telemetry: WasmPlugin, Telemetry and TrafficExtension.
- Gateway API: Gateway, HTTPRoute, GRPCRoute, TCPRoute, TLSRoute, UDPRoute,
  ReferenceGrant and InferencePool; supporting GatewayClasses where referenced.
- Supporting resources: namespaces, Services, EndpointSlices/Endpoints, pods,
  controllers, events, control-plane configuration and supported DeploymentConfigs.

For each resource, record scope, versions, schema/getters, list column sources and
visibility, full meaningful detail sections, related links and action behavior.
Use ResourceListView for resources and native tables for logical applications.
Use read-only code blocks for specific free-form fields, not raw JSON as a
substitute for meaningful detail presentation.

### Safe actions and early diagnostics

- Add confirmed CRUD and supported workload/Service/namespace operations through
  Headlamp, with explicit captured targets and resourceVersion handling.
- Surface permission changes, conflicts, validation failures and partial results.
  Do not retry destructive operations blindly.
- Introduce useful missing-target/reference/selector checks before the entire
  validation catalog. Preserve upstream diagnostic codes, severity and field paths.
- A partial snapshot cannot prove a configuration is valid.

### Telemetry, health and first graph

- Port safe query construction and typed Prometheus-compatible result decoding.
- Cover HTTP/gRPC/TCP signals, inbound/outbound metrics, reporter selection,
  histograms/quantiles, throughput, missing samples and duplicate-series handling.
- Complete health thresholds, annotations, protocol semantics and aggregation.
  Missing telemetry is not zero traffic or healthy status.
- Build a simple deterministic observed graph before advanced decorations.
  Never synthesize traffic edges from ownership/selector relationships.
- Compare query, health and graph outputs to pinned upstream fixtures.

### Full validation, mesh analysis and wizards

- Complete every scoped checker/code in independently testable batches: routing
  hosts/subsets, Gateway API relationships, security scope/selectors, sidecar
  imports, ambient and remaining extension/telemetry/workload cases.
- Discover control planes, revisions, networks and sidecar/ambient participation.
  Keep policy intent, observed mTLS and proxy state separate.
- Implement wizard logic as pure proposed change sets first. Then present diffs,
  targets, conflicts and impact before applying.
- Cover traffic shifting, routing, timeouts/retries, fault injection, circuit
  breakers, policies, Gateway API forms, annotations and deletion workflows.
- Multi-object changes are not transactions: report per-object outcomes and stop
  safely on failure. No unreviewed automatic rollback.

### Diagnostics and other integrations

- Port supported pod logs, proxy synchronization, Envoy listener/cluster/route
  inspection, ztunnel configuration and confirmed logging controls.
- Complete resource/control-plane/ztunnel/custom dashboards.
- Add Jaeger/Tempo trace/span search, details, normalization, workload correlation
  and graph overlays; Grafana/Perses discovery and dashboard links.
- Use existing HTTP equivalents where they provide the same behavior.
  A deep link alone is not integrated-tracing parity, and browser fetch is not
  a substitute for native gRPC.

### Multi-cluster and advanced graphs

- Keep Headlamp cluster identities separate from Istio/telemetry labels, using
  explicit mapping rather than assuming names match.
- Support cluster-group fan-out and shared/per-cluster metric stores without
  double counting or cross-scope cache leakage.
- Complete application/version/workload/Service/aggregate graph modes, grouping,
  node-focused views, idle/dead/unknown/outsider nodes, ServiceEntry/WorkloadEntry
  enrichment, blackhole/passthrough semantics, security/health/config decorations,
  ambient/waypoint behavior, historical queries and baseline UI interactions.
- Preserve per-cluster errors and provenance. A graph selection must not silently
  change a mutation target.

### Runtime and release closure

- Measure query fan-out, memory, analysis/rendering cost and large-mesh behavior.
  Record and enforce actual budgets. Use workers/incremental computation only
  when measurement and host compatibility justify them.
- Complete accessibility, translation, screenshots/coverage documentation and
  packaging. Verify new runtime imports in the actual host.
- Maintain an explicit compatibility matrix and upstream-update review process.
- Reconcile every parity entry; do not stop at convincing screenshots or hide
  unsupported cases behind success-shaped UI.

## Verification environment and operating notes

Last verified local setup:

| Item | Value / behavior |
| --- | --- |
| Kubernetes context | `mitch-auto`; verify it still exists and is the intended target |
| AKS | Automatic, Kubernetes 1.35 |
| Istio | Managed `asm-1-30`, CNI chaining, control plane in `aks-istio-system` |
| Bookinfo | Six injected deployments in `bookinfo` |
| Prometheus | Example Prometheus 3.10.0 in `istio-system`, Service port 9090 |
| Sample source | Istio 1.30.6, commit `b85dac9587f2f997151d205e069e4f4ff091c7c5` |
| Desktop | Headlamp 0.35.0, user-launched CDP on loopback port 9222 |
| Temporary hosted checks | Used loopback port 4487; server is not left running |

The AKS platform blocked self-managed injection webhooks and privileged
`istio-init` capabilities. The supported managed mesh and CNI were used instead.
**No admission policy was weakened.** Do not attempt to recreate the failed OSS
installation, alter protected webhooks/namespaces, or grant privileges to force
an unsupported diagnostic.

The sample setup was explicitly requested for development. It does not change
the no-new-installation product goal. Use `kubectl --context mitch-auto ...`
rather than changing the user's current context. Installation/teardown commands,
source hashes, resource overlays and traffic generation are in the fixture guide.
No persistent traffic generator was left running; rate-based views need fresh
traffic when being checked.

To provide Desktop debugging, the user fully quits Headlamp and launches:

```sh
/Applications/Headlamp.app/Contents/MacOS/Headlamp \
  --remote-debugging-port=9222 \
  --remote-debugging-address=127.0.0.1
```

In another terminal:

```sh
curl --fail http://127.0.0.1:9222/json/list
```

Attach to Headlamp's `page` target with available CDP/browser tools. Do not assume
the original session's helper scripts or screenshots are present. Keep CDP
loopback-only; it grants control of the app. The user launches the Electron GUI.

The pinned SDK's `npm start` copies into the normal Headlamp `plugins/kiali`
directory, not `dev-plugins`. Follow the actual CLI output, avoid competing
watchers, and preserve a production package when stopping temporary helpers.
Do not hand-create symlinks to paper over a plugin load failure.

## Checks and evidence

Last code validation before this documentation handoff: **581 Vitest tests**,
TypeScript, lint, production build, packaging and parity consistency passed.
Both health and label oracle regeneration checks reproduced the committed outputs.
This is historical evidence; rerun the relevant checks after code changes.

```sh
npm run tsc
npm run lint
CI=1 npm test
npm run parity:check
npm run build
npm run package
```

Packaging refuses to overwrite an existing tarball; inspect and replace only the
specific generated artifact when intentionally rebuilding it. Use the existing
toolchain rather than modifying its build configuration.

The fixtures do not need Go during ordinary npm tests. Go is used only to
regenerate independent expected outputs. Follow the pinned checkout and source
hash instructions in `test-files/README.md`; do not regenerate expectations from
the TypeScript implementation under test.

Live evidence includes:

- Four Bookinfo Services and six ready Deployment rows with native filtering and
  resource links in Desktop and hosted mode.
- Four applications; reviews has three versions, one matching Service and three
  UID-owned pods detected as native sidecars.
- Per-cluster settings persistence, connection checks, label-override effects,
  and restoration without overwriting Prometheus configuration.
- Actual Desktop ApiProxy access to Prometheus metrics; healthy Bookinfo scrape
  targets during fixture setup.
- Accessible names on the new controls and nonblank English translations.
- No plugin execution or component failure after the runtime compatibility fixes.

Restricted-user, large-scale, other telemetry-provider and full graph scenarios
are not established by those successful checks. Continue negative fixtures and
live coverage rather than extrapolating from the administrator/demo case.

## Known compatibility traps and open risks

| Area | Evidence / required handling |
| --- | --- |
| Runtime values | Type-checking does not prove an externalized value exists in Headlamp. Use documented barrels; deep type imports are different from runtime imports. |
| Service helpers | Headlamp 0.35.0 lacks `Service.getFormattedPorts`; the current renderer uses stable spec fields. Keep its regression test. |
| Links | That host expects `CommonComponents.Link.search` to be a string. Serialize with URLSearchParams; do not trust newer declaration support for objects. |
| Charts/graph internals | The probed generic CommonComponents Chart export was absent. Select documented/exported or compatible bundled renderers before using them; do not deep-import private GraphView internals. |
| Proxy synchronization | `istioctl proxy-status` could not create RPC credentials in the protected managed namespace with this caller. Do not bypass that policy; investigate legitimate read-only transport separately. |
| gRPC-only tracing | Requires an existing equivalent HTTP operation or an explicit stock-host parity gap, not a new bridge. |
| Port forwarding | A listener belongs to the backend machine; hosted-browser localhost is not backend localhost. Track and clean up only forwards the plugin owns. |
| External auth/CORS/TLS | Kubernetes proxy authorization does not automatically authenticate an application. No arbitrary credential forwarding or ConfigStore secrets. |
| Visibility | A user's readable resources can differ from Kiali's service-account-wide view. Incomplete data cannot prove absence, health, security or valid configuration. |
| Background lifecycle | A browser is not an always-on backend; explicitly define refresh, invalidation and cancellation semantics. |
| Host diagnostics | Hosted Headlamp logged its deprecated CRD-v1beta1 discovery 404. Desktop also produced host release-fetch/permission-review or watch-close diagnostics in some runs. Do not misreport all host logs as clean, or confuse them with plugin execution failures. |
| Screenshots | Desktop CDP screenshot capture timed out; DOM/console evidence and hosted Playwright snapshots/screenshots were used. Do not invent Desktop image evidence. |
| Mutations | Freeze target identity, handle resourceVersion conflicts and permission changes, and expose partial multi-object outcomes. |

## Parity accounting and completion

Keep each inventory item tied to upstream source, plugin module/UI, prerequisites,
defaults/versions, tests and separate Desktop/web evidence. Use the ledger states
`planned`, `implemented-unverified`, `verified-parity`, `partial`,
`blocked-stock-host`, `replaced-by-Headlamp` and `excluded-by-user`.

Graph options, appenders, checker codes and wizard actions need individual
coverage entries, not a single family-level success mark. Preserve source
attribution and explain deliberate semantic deviations such as strict UID
ownership. Normalize only non-semantic differences in differential comparisons.

Full scoped parity is reached only when every in-scope behavior is verified or
genuinely replaced by equivalent Headlamp behavior on the claimed platform.
Otherwise release explicitly as partial parity with the remaining gaps. Update
this plan, `docs/parity.md` and the eventual `docs/OVERVIEW.md` together so the
handoff never depends on stale append-only progress notes.
