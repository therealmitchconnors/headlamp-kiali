# Kiali native-port parity ledger

## Baseline and scope

Reference: [Kiali v2.33.0](https://github.com/kiali/kiali/tree/0e8be887b8217bbcac5e3ae0bfcd258073949cca),
commit `0e8be887b8217bbcac5e3ae0bfcd258073949cca`.

The target is native mesh, observability and configuration behavior in stock
Headlamp Desktop and hosted Headlamp. No Kiali backend, Headlamp modifications,
cluster installations or elevated credentials are introduced. AI/chat and
offline/gather/import workflows are excluded by user decision. Login, cluster
connections and application hosting remain Headlamp responsibilities.

**Native browsing and an initial correlation slice are implemented; this is not
a completed port.** Kiali has an overview, Applications, namespace/Service lists,
workload-kind tabs, per-cluster settings, initial Istio configuration/CRUD,
limited checks and traffic metrics/graph surfaces. The original browsing routes were exercised
against Bookinfo in both stock Headlamp
0.35.0 Desktop and hosted-web mode. The original pure health primitives remain
independently checked against Go. A subsequent calculator/workload-health
increment is described below; it is not complete mesh-health integration.

## Current integration — 2026-11-05

The implementation branch integrates validated PRs #4, #6, #11, #13, #37,
#38 and #39 through `c8128c5be38bf1fd42cdbe41bd70a083a5da2232`.
The combined implementation passed 23,105 tests in 193 files, type-check,
lint, build and catalog/resource/dashboard checks after conflict resolution.
Individual PR heads were also exercised read-only in stock hosted Headlamp
0.35.0 against `mitch-auto`; the original Docker smoke harness passed.

PRs #12/#19 need Gateway API CRDs and representative route/controller
resources; #14 needs an approved isolated mutation fixture; #20/#21 need
a real tracing backend and appropriate trace/Pod identity data; #22 needs
ztunnel; #27 needs WorkloadGroups and an OpenShift DeploymentConfig API;
#28 needs multiple real contexts with known shared/isolated telemetry mappings;
#29 needs Grafana/Perses endpoints and dashboards. They remain partially
validated, not ready merely because the existing-resource guards render.
PR #31's combined graph rejects ordinary source/destination policy-label
differences; #36 rejects Envoy's indented logger names. Neither is integrated.

Prometheus on `mitch-auto` was recovered with an approved persistent
Deployment memory change to a 2 GiB limit / 1 GiB request. Automatic Pod
replacement cleared ephemeral data; readiness and queries succeeded with
zero restarts after 27 minutes. No storage-volume capacity change was made.
Current live positive-provider, Desktop, mutation and large-browser-scale
gaps remain open. The 2026-11-03 snapshot below is historical, not the
current merge or cluster state.

## Historical baseline and issue-linked state — 2026-11-03

This ledger describes the integrated `therealmitchconnors-kiali-plugin` base at
`655e75109cf27f964f55045bdadfe39c72d22022`, including merged PRs [#1](https://github.com/therealmitchconnors/headlamp-kiali/pull/1)
and [#2](https://github.com/therealmitchconnors/headlamp-kiali/pull/2). The
current documentation task targets that branch. At the 2026-11-03 review
snapshot, the implementation PRs linked in the [portable execution map](../PLAN.md#issue-linked-execution-and-catalog-map)
remain open and unmerged. Do not import their source or promote their work to
current behavior until it is integrated and its own evidence is reviewed.

| Assignment | Integrated status in this baseline | Issue / implementation PR |
| --- | --- | --- |
| Service-port checks and declared-scope Gateway checks | Code is present from merged #1/#2; the added Gateway/Service inspector browser and live gates remain open | [#1](https://github.com/therealmitchconnors/headlamp-kiali/pull/1), [#2](https://github.com/therealmitchconnors/headlamp-kiali/pull/2) |
| Effective mesh configuration sources | Current projection is bounded; explicit file/mount overrides and external source resolution remain blocked/unresolved | [#3](https://github.com/therealmitchconnors/headlamp-kiali/issues/3), open [#4](https://github.com/therealmitchconnors/headlamp-kiali/pull/4) |
| Hosted smoke, workload/account provenance, Gateway attachment, health, and guarded existing-resource workflows | Assigned deliverables are pending; no unmerged behavior is counted | [#5](https://github.com/therealmitchconnors/headlamp-kiali/issues/5) / [#6](https://github.com/therealmitchconnors/headlamp-kiali/pull/6), [#7](https://github.com/therealmitchconnors/headlamp-kiali/issues/7) / [#11](https://github.com/therealmitchconnors/headlamp-kiali/pull/11), [#8](https://github.com/therealmitchconnors/headlamp-kiali/issues/8) / [#12](https://github.com/therealmitchconnors/headlamp-kiali/pull/12), [#9](https://github.com/therealmitchconnors/headlamp-kiali/issues/9) / [#13](https://github.com/therealmitchconnors/headlamp-kiali/pull/13), [#10](https://github.com/therealmitchconnors/headlamp-kiali/issues/10) / [#14](https://github.com/therealmitchconnors/headlamp-kiali/pull/14) |
| Gateway API forms, Tempo predicates, trace correlation, proxy metadata | Assigned deliverables are pending; current route schemas, trace filters and bounded Envoy/ztunnel views do not prove these increments complete | [#15](https://github.com/therealmitchconnors/headlamp-kiali/issues/15) / [#19](https://github.com/therealmitchconnors/headlamp-kiali/pull/19), [#16](https://github.com/therealmitchconnors/headlamp-kiali/issues/16) / [#20](https://github.com/therealmitchconnors/headlamp-kiali/pull/20), [#17](https://github.com/therealmitchconnors/headlamp-kiali/issues/17) / [#21](https://github.com/therealmitchconnors/headlamp-kiali/pull/21), [#18](https://github.com/therealmitchconnors/headlamp-kiali/issues/18) / [#22](https://github.com/therealmitchconnors/headlamp-kiali/pull/22) |
| External/VM dashboards and cross-context telemetry stores | External provider discovery, VM/custom attribution, shared-store normalization and full mesh membership remain separate open work | [#23](https://github.com/therealmitchconnors/headlamp-kiali/issues/23) / [#29](https://github.com/therealmitchconnors/headlamp-kiali/pull/29), [#24](https://github.com/therealmitchconnors/headlamp-kiali/issues/24) / [#27](https://github.com/therealmitchconnors/headlamp-kiali/pull/27), [#25](https://github.com/therealmitchconnors/headlamp-kiali/issues/25) / [#28](https://github.com/therealmitchconnors/headlamp-kiali/pull/28) |
| Mixed-reporter graph, authorized sync/logging, graph appenders, observed security, large inputs | These increments are pending; current bounded graph/security/diagnostic implementations do not close their respective families | [#26](https://github.com/therealmitchconnors/headlamp-kiali/issues/26) / [#31](https://github.com/therealmitchconnors/headlamp-kiali/pull/31), [#30](https://github.com/therealmitchconnors/headlamp-kiali/issues/30) / [#36](https://github.com/therealmitchconnors/headlamp-kiali/pull/36), [#32](https://github.com/therealmitchconnors/headlamp-kiali/issues/32) / [#37](https://github.com/therealmitchconnors/headlamp-kiali/pull/37), [#33](https://github.com/therealmitchconnors/headlamp-kiali/issues/33) / [#38](https://github.com/therealmitchconnors/headlamp-kiali/pull/38), [#34](https://github.com/therealmitchconnors/headlamp-kiali/issues/34) / [#39](https://github.com/therealmitchconnors/headlamp-kiali/pull/39) |

The older “immediate next task” checkpoint below and in `PLAN.md` is preserved
as provenance, but it is not a current queue: Service-port source is integrated
from #1; declared-scope Gateway validation is integrated from #2; the effective
mesh-source increment remains #3 / PR #4. Effective workload/port/subset mTLS
and principal-absence checks require both appropriate effective-configuration
sources and complete caller-specific workload/account evidence. They remain
blocked; assignment of #3 or #7 alone does not activate them.

## Partial-release readiness

**Release posture: partial implementation, not full parity and not publication
approval.** The current code supports a bounded native slice. Any partial release
must state its exact supported views and limitations; do not describe the open
implementation PRs, source inventories, synthetic fixtures or unit-test count as
shipped behavior.

### Compatibility and evidence matrix

| Area | Hosted Headlamp (stock 0.35.0) | Desktop (stock 0.35.0) | Current compatibility boundary / evidence state |
| --- | --- | --- | --- |
| Runtime imports and contribution | Earlier hosted checks loaded the integrated native slices and inspected plugin execution failures; there is no running host in this checkout, and #5 / PR #6 is still pending | The initial native browsing slice was exercised historically; current CDP target is unavailable, and later Gateway/Service increments have not had this gate | Type-check/build cannot prove runtime-global availability. Use public externalized barrels; recheck the actual route and console before release claims |
| Kubernetes authentication and API transport | Existing authenticated `K8s`/`ApiProxy` reads have been exercised with real Bookinfo for supported paths; synthetic interception is used for absent/denied/positive CR scenarios | Headlamp owns login and cluster auth; current Desktop rerun is unavailable | No direct API-server calls, token copying, RBAC changes or credential workarounds. Incomplete visibility cannot prove absence |
| Prometheus | Read-only real Bookinfo request/latency and health reads were observed at historical hosted checkpoints; positive/error/dashboard cases also use intercepted fixtures | Earlier Desktop metrics/API proxy checks exist for the initial slice; no current run | A prior TSDB compaction OOM was mitigated in-place for the then-current Pod after approval, but the Deployment template remains at a 1 GiB memory limit and replacement can recur. No current cluster is assumed; telemetry is not mesh membership or policy proof |
| Jaeger / Tempo | Search/detail/filter success evidence is fixture-intercepted; no live provider was installed or queried | No current Desktop provider evidence | HTTP integration only where an existing endpoint is configured; gRPC-only, provider authentication and real-provider success remain unsupported/unverified |
| Envoy / ztunnel / synchronization | Bounded Envoy and pod-log reads were checked live on Bookinfo; ztunnel positives are synthetic and no live ztunnel deployment was observed. `/debug/syncz` returned 401 | No current Desktop diagnostic rerun | Do not infer sync/readiness from admin HTTP success or bypass the 401. Confirmed logging controls and broader metadata are pending #18/#30 |
| Istio/Gateway configuration and checks | Gateway API CRUD/details and scoped Gateway/Service inspectors have source/unit coverage; the #1/#2 inspector browser/live/positive-resource evidence remains open | No current Desktop verification of these increments | Live Gateway API CRDs/instances were absent in the recorded cluster; no full route attachment, controller, workload or policy verdict |
| Scope and identity | Pages and reads capture cluster/namespace inputs; logical mesh and telemetry identities are explicit, not inferred from Headlamp context names | No current Desktop scope rerun | The local declared mesh projection is bounded. An explicit-context comparison does not certify mesh membership or allow single-target configuration writes across contexts |
| Cross-context mesh and telemetry | Bounded explicit-context comparison exists; current values are not normalized as shared/per-context stores | No true multi-context Desktop evidence | #25 remains open; store mapping is not configurable mesh-membership proof. Cross-context graph claims remain blocked |
| Grafana / Perses | No current endpoint/auth integration; #23 / PR #29 remains open | No current evidence | Kubernetes proxy access does not authenticate a destination app. No arbitrary credential forwarding, CORS/TLS bypass or ConfigStore secrets |
| Accessibility, i18n and screenshots | Earlier hosted checks recorded named controls, English strings and snapshots for selected scenarios; no current all-route audit | Desktop screenshot capture timed out historically; no new screenshots are available | `docs/OVERVIEW.md` and image evidence are pending. Do not create mock screenshots or infer whole-plugin accessibility from selected checks |
| Large-scale cost | Pure-core request/cardinality bounds and deterministic tests exist; no current end-to-end host rendering/memory measurement | No large-mesh Desktop measurement | #34 / PR #39 is open. Do not extrapolate unit budgets to browser memory, UI responsiveness or large-cluster readiness |
| Host diagnostics | Prior consoles included the known Headlamp CRD-v1beta1 discovery 404 and watch-close messages; exercised views had no remaining plugin execution failure | Some prior release-fetch/permission/watch diagnostics; current CDP unavailable | Separate host logs from plugin failures; the absence of a current browser session is not a clean-console result |

### Measured evidence, missing evidence, and closure conditions

Measured or recorded on named earlier checkpoints (not a fresh run for this
documentation change):

- [x] Kiali is pinned to v2.33.0 / `0e8be887b8217bbcac5e3ae0bfcd258073949cca`;
  plugin toolchain is `@kinvolk/headlamp-plugin` 0.14.0 and the host target is
  stock Headlamp 0.35.0.
- [x] Inventories and generators preserve source blob hashes and stable
  per-record IDs. The 508-source / 616-record catalogs and 21 routes / 216
  contracts are coverage inventories, not implementation totals.
- [x] Existing `package.json` declares Apache-2.0 and packages `LICENSE` and
  `NOTICE` via `headlamp.extraDist`; the lockfile is committed. A fresh
  `npm run package`/member check is still required for the exact release commit.
- [x] Historical hosted Bookinfo checks cover selected native browsing, metrics,
  health and Envoy reads; evidence and their negative/fixture boundaries are
  retained in this ledger.

Not measured or not closed for the current candidate:

- [x] Candidate checks passed: `npm run tsc`, `npm run lint`, `CI=1 npm test`
  (**22,594 tests in 189 files**), `npm run build`, `npm run parity:check`,
  `npm run resources:check` (23 models) and `npm run dashboards:check`
  (21 templates / 91 charts).
- [x] `npm run package` produced `kiali-0.1.0.tar.gz`; archive inspection
  confirmed `headlamp-kiali/LICENSE`, `NOTICE`, English translation, `main.js`
  and `package.json`. SHA-256:
  `c95235c9229a20229adc35c2d39781fec33a74c4c5c4514a72edbae4359c7339`.
  The artifact is ignored locally, not committed or published.
- [x] `npm audit --omit=dev` found zero production dependency advisories.
  `npm ci` reported 53 advisories in the complete installed tree (3 critical,
  5 high, 38 moderate, 7 low); the pinned development toolchain was not upgraded
  in this documentation task. Review that development-tree report before a
  release.
- [ ] Current stock-host plugin load, actual contribution, English labels,
  accessible names and console review, including the integrated #1/#2 Gateway
  and Service inspectors.
- [ ] Complete hosted browser smoke in an isolated synthetic environment (#5);
  this does not replace Desktop or real cluster/provider verification.
- [ ] Desktop 0.35.0 load/console/a11y verification. The user must launch the
  Desktop CDP target; no target or screenshot evidence is available here.
- [ ] Authorized live cluster with representative Istio and Gateway resources,
  real read/permission boundaries, applicable Prometheus/tracing providers and
  approved fixtures. Existing Bookinfo success is not evidence for empty
  Gateway/configuration kinds or new writes.
- [ ] Real Jaeger/Tempo, ztunnel/ambient, Grafana/Perses and authorized
  synchronization evidence; do not create infrastructure or credentials to
  close these gaps.
- [ ] Measured browser/host memory, responsiveness and large-input behavior
  (#34); pure-core limits do not close this.
- [ ] `docs/OVERVIEW.md` and the required screenshots. Follow
  [the document-plugin workflow](../.github/skills/document-plugin/SKILL.md)
  only after a real running host and seeded/approved resources satisfy its
  preconditions. Until then, screenshots and per-kind live coverage remain
  explicitly pending.

Use an approved isolated hosted Headlamp fixture environment for synthetic
contribution checks; use a separately authorized stock Desktop 0.35.0 session
for Desktop claims; and use only a confirmed cluster/context/namespace with
explicit approval for resource application or cleanup. Existing read-only
provider endpoints may be tested only with authorized access. No step in this
checklist authorizes an install, fixture write, cleanup, privileged workaround,
release publication or credential handling.

## Large-input analysis and rendering budgets

The measured code baseline is PR-base commit
`655e75109cf27f964f55045bdadfe39c72d22022`. Run the deterministic local
scenarios with:

```sh
node_modules/.bin/vite-node --script -c node_modules/@kinvolk/headlamp-plugin/config/vite.config.mjs scripts/bench-analysis.ts
```

The command reports Node/platform/architecture/CPU count, scenario dimensions,
accepted or rejected output, elapsed time and retained heap delta. Its single-run
timings are observational, not pass/fail thresholds; retained heap delta is not
peak allocation and can be affected by garbage collection. Exact counts and
output-shape boundary tests, rather than elapsed-time assertions, enforce the
budgets.

| Scenario | Baseline | Guarded result |
| --- | --- | --- |
| Dense Service correlation: 1,000 Deployments, 1,000 UID-owned Pods and 1,000 Services sharing a selector | 2,000,000 distinct relation matches (1,000,000 workload + 1,000,000 Pod), plus 1,000,000 reverse `workload.services` references; 187.95 ms and +39,606,000 retained heap bytes in this run | Capped at 20,000 Service-to-workload/Pod matches. The 10-Service exact-boundary case returns 10,000 of each relation type plus 10,000 reverse references (30,000 retained links); the 1,000-Service case rejects at the next match. The guarded boundary run measured 33.10 ms and +12,583,704 retained heap bytes; over-budget rejection measured 25.81 ms and +3,249,808 bytes. |
| General metric-chart flattening: one 100,000-sample series | Flattened all 100,000 points; 2.56 ms and +2,815,888 retained heap bytes | `MetricChart` accepts at most 1,928 total points and displays an error without flattening/rendering larger results; the 100,000-point rejection measured 0.11 ms and +3,008 retained heap bytes. |
| Topology: 4,000 observations, 1,000 nodes, 2,000 edges | Accepted the exact existing limits | Same exact output shape; no topology threshold or projection semantics changed. |
| VirtualService Cartesian host/gateway input: two records × 100 hosts × 100 gateways | Accepted exactly 20,000 contributions with one peer reference | Same accepted findings/reference shape at the existing 20,000-contribution cap; an additional contribution is rejected by the existing guard. |

These are pure-core measurements on Node `v22.23.4`, Linux x64, four reported
CPUs. They do not measure Headlamp, Recharts, DOM/SVG construction, layout,
browser memory or interactive responsiveness. No running stock Headlamp host was
available for this increment, so host-level graph/chart limits remain
unverified. `decodePrometheus` can receive up to 100,000 samples before chart
projection; the chart guard bounds subsequent flattening and rendering, not the
HTTP/JSON response or decoded input allocations.

Namespace correlation reads retain the existing four pages of 250 items per
kind, three concurrent readers and 15-second deadline. Decoding now rejects
label maps over 256 entries, key/value text over 1,024 characters, owner lists
over 20 entries, and any source over 20,000 normalized label entries or
1,000,000 label-text characters. A source that exceeds these limits is
incomplete; earlier pages may remain available, but a partially decoded page is
not retained as complete. Dense Service selectors are rejected rather than
returning a partial or truncated relation set. Existing `RequestStatus` surfaces
that failure.

These guards run after `ApiProxy.request` has delivered the parsed response to
the plugin. Headlamp/transport buffering and JSON parsing of the initial body
are outside plugin-side decoding control; pagination bounds item counts, not
response bytes. No request fan-out, captured-scope, deadline, cancellation or
dashboard query semantics were changed.

## Selectorless PeerAuthentication conflicts

KIA0002 now executes the PeerAuthentication branch of the pinned generic
selectorless checker. The active `PeerAuthenticationChecker` invokes it before
the separate mTLS-pattern checks. Missing/null selectors, empty selectors and
missing/null/empty matchLabels all have zero labels and participate. Nonempty
selectors do not participate, regardless of whether workloads would match.
The error path is `spec/selector`; related peers are in the same namespace.
Mode and creation time do not alter this diagnostic. Unlike some networking
callers, this caller does not discard `autogenerated-k8s` policy names.

The **176-case original-Go oracle** executes the actual PeerAuthentication
constructor and selectorless traversal/diagnostic merging, asserting the caller
activation. It does not execute KIA0003 workload overlap, managed namespace
discovery or all of `PeerAuthenticationChecker.Check`. Sidecar selectorless
coverage remains separate work; RequestAuthentication explicitly disables
both generic multi-match checks. The native adapter requires complete policy
identity evidence and a matching selected UID/normalized selector. It
conservatively requires resolved namespace mesh configuration; unresolved
configuration is deferred rather than assuming an unmanaged/default namespace.

Limits are 1,000 policy records, 256 labels/object, 1,024 characters/key/value,
10,000 relevant labels and 1,000,000 label-text characters. Exact aggregate
threshold tests cover both budgets. Nonempty/malformed selected selectors do
not schedule new context reads; malformed data is reported. Failed policy
lists suppress otherwise-unused mesh discovery. Existing independent mTLS
checks can still read their own required context.

Eighteen hosted cases observed 17 intercepted policy-list GETs, including
absent/null/empty selectors, mode independence, single/three policies, different
namespaces, selected/peer workload selectors, generated names, stale UID and
selector, list/mesh denial, suppression, a **15,401 ms** timeout and retry.
Observed UID links reached the security-group detail. Nineteen prior mTLS and
root-fallback scenarios passed again with a single captured policy in the new
list; empty-selector semantics remained distinct. No plugin errors or live
writes occurred. Namespace/managed mesh evidence was real except explicit
denial; all policy objects were intercepted. The actual policy list was empty.
This is not encryption, access enforcement, or full selector checker parity.

## Declared-scope Gateway listener/port/controller increment

`core/gatewayWorkloads.ts`, `data/gatewayValidation.ts` and the explicit
detail-page **Run scoped Gateway checks** action add KIA0302 and reuse the
existing Gateway checks over the declared local/default-visibility namespace
scope. This is an active-caller-only milestone, not full Gateway API attachment,
Service backend-port validity, controller readiness or reachability parity.
The older initial-check action retains its independent bounded behavior.

The pinned Istio `gateway_checker.go` (`f12fc368f401076f10a084662f66ef778e427da1`)
enables `SelectorChecker` (`692a678199da1173a3cc4e4272975d3b451aa841`), not its
port-name helper. KIA0302 compares Gateway equality selectors against workload
DTO labels. Empty/null selectors match any workload in the effective pool,
but an empty pool still warns. The pinned warning text retains "in this
namespace" even when the controller allows all captured managed namespaces.
`PILOT_SCOPE_GATEWAY_TO_NAMESPACE` reads the first declared container and
accumulates exact `true` declarations; later `false` does not undo true.
Indirect/noncanonical values remain unavailable natively, without blocking
unrelated mesh configuration. The discovery source is
`istio/discovery.go` (`60f6f7ab41a65acc5f40ca1095ce279433e62dce`).

Workload inclusion follows the pinned defaults, excluding Job, CronJob,
ReplicationController and DeploymentConfig, not the application correlation
projection. Complete Deployment, ReplicaSet, StatefulSet, DaemonSet and Pod
lists are required. Controller template labels apply even without Pods;
standalone Pods use metadata labels. Owned Pods and child ReplicaSets are not
independent selector targets. UID ownership guards reject missing/stale owners;
custom controllers, ambiguous controller-priority names and unsupported owner
chains/legacy owner API versions abort rather than approximate inclusion.
Configured nondefault workload
inclusion is not implemented. Sources are `business/workloads.go`
(`e0b704c0b299d19b50fbe9ae1d19cab1272a15cc`) and `models/workload.go`
(`8070c2c4423dee1ef6629e94ffd299e57c03c843`).

Complete WorkloadGroup and WorkloadEntry reads participate. VM labels use the
first matching WorkloadEntry in captured pool order, without a namespace
re-filter; otherwise they use group spec metadata labels only after a complete
entry read. Empty group selectors never import entries. Group identity/version
and entry-label provenance remain separate. This label-only inclusion evidence
does not establish VM health, accounts, Service routing or generic KIA0004
workload-absence coverage.

Both Gateway types require complete versioned namespace/controller/tag and
resolved local configuration evidence plus an explicit logical mesh mapping.
The selected namespace must be in the declared projection. Istio Gateway
selector checks additionally require one unambiguous controller with a captured
scope flag. Complete cluster-wide resource collections are reduced to declared
membership before analysis; pooled VM entry order is preserved. Pagination
uses at most four 250-item pages, and source jobs share three workers and one
15-second deadline including discovery. All source failures abort the scoped
result. The selected Gateway is compared against its list capture and a final
GET by UID/resourceVersion/spec/status/generation/labels/annotations.
Every declared Istio controller's identity/version/environment/configuration
provenance must match the later Deployment capture, not just the selected
Gateway controller. These are bounded captures, not atomic Kubernetes
transactions or continuous watch-based validity.

Gateway API `k8sgateway_checker.go`
(`325feda97b07a084ddc33b8c0372bec3de078d7e`) enables the existing class registry
and controller-condition checks, alongside listener/address conflicts.
KIA1501/KIA1502 retain exact fields and equal-name exclusion across namespaces;
KIA1503 retains literal listener uniqueness. GWAPI keeps current generation,
benign-transition and actual nested-listener-path guards. Registry membership
is not controller acceptance; absent/denied discovery never becomes successful
empty discovery. Conditional mesh-wide fallback classes remain unevaluated.
Dormant Istio port-name checks and unsupported listener/section/hostname/backend
attachment rules are not introduced.

Limits add 7,000 native/group/entry inputs, 256 labels/object, 20,000 aggregate
labels, 1,000,000 label characters, 20,000 VM comparisons and 20 owner references/
object. Equality selectors retain the shared 100-entry decoder limit.
Gateway spec/status/annotations each have 256 KiB guards and Gateway collection
captures a 1 MiB aggregate guard, in addition to existing host/listener/address
analysis limits. These are analysis bounds, not an assertion that Headlamp never
buffers a larger initial response.

Source-informed core, loading and UI tests cover controller flags, workload
inclusion, pooled VM order, both Gateway groups, complete pagination, scope/
ownership/freshness failures, suppression, deadlines, retries and no capture
replay/resurrection after settings changes. No new original-Go differential
oracle or positive live Gateway fixture was added. No Headlamp CDP target or
Kubernetes CLI was available: browser contribution/console/i18n/a11y, hosted
fixture, Desktop and live-cluster gates remain explicitly open. No cluster
install, fixture application or write occurred.
The final focused set passed **103 tests in three files**; the final full suite
passed **22,480 tests in 186 files**, including the owner-API-version guard and
related-link provenance regression. Type-check, lint and production build pass.
Resource/dashboard generation,
catalog parity, i18n extraction and code formatting also pass. These are local
gates only, not live-load evidence.

## Istio Gateway host-conflict checks

KIA0301 follows the active `GatewayChecker` and `gateways.MultiMatchChecker`,
distinct from Gateway API collision rules. **328 original-Go cases** execute
the pinned grouping/matching and `MergeValidations`/`MergeReferences` functions.
Only the Kubernetes label-set serialization is replaced with sorted key/value
serialization in the developer harness. Its source hashes are in the fixture.

Selectors must match exactly; ports group by protobuf uint32 number, with
missing ports defaulting to zero. Protocol, TLS and server names are not
comparison fields. Host prefixes set the target namespace (`.` becomes the
Gateway namespace; omitted prefix means `*`). Names compare case-insensitively;
the original dot-escaped, anchored RE2 pattern construction is retained, not
replaced with DNS glob logic. Different `*.` patterns do not match one another.
The saved `skipWildcardGatewayHosts` boolean defaults false and, when true,
skips comparisons involving a **bare** `*`, not subdomain patterns.

Input order affects the host paths selected by upstream's duplicate-reference
suppression. Self duplicates can yield one warning with no peer. References
are object-level, not a claim that every reference conflicts with every warned
host. Autogenerated objects are excluded. Captured UID and relevant
selector/host/port fields must match; complete source lists are required.
Bounds are 1,000 objects, 100 servers/object, 100 hosts/server, 2,000 aggregate
hosts, 20,000 comparisons, 256 selector entries and 1,024 characters/value.
Unsupported non-ASCII/control text and invalid patterns defer checks visibly
instead of diverging silently from Go normalization or crashing the page.

Twenty-two hosted scenarios observed 23 intercepted Gateway-list GETs,
including positive/negative hostname, namespace, selector and port cases,
protocol independence, self duplicates, generated peers, stale UID/spec,
denial, invalid pattern, suppression, a **15,391 ms** timeout/retry and an
in-flight setting replacement. The public settings UI saved/restored the
toggle across hard reload after waiting for ConfigStore persistence.
Related links reached the networking-group detail and displayed the observed
UID. Eleven Gateway API and sixteen VirtualService regression scenarios
also passed, with no plugin execution errors or live writes. Settings were
restored durably. The live Istio Gateway list was empty; positive objects were
intercepted and no controller acceptance/reachability claim is made.

Local gates pass **18,583 tests in 143 files**. Independent original-Go evidence
totals **16,904 cases**, with **37 bounded codes**. Desktop and full checker
parity remain open.

## VirtualService host-conflict checks

KIA1106 now follows the active `VirtualServiceChecker.runGroupChecks` caller and
`virtualservices.SingleHostChecker` at the pinned baseline. The latter source
blob is `36ea67a0aa0b701ff331af3784413029c62ae181`; normalization reuses the pinned
`kubernetes/host.go`. A checksum-verified developer-only Go runner executes the
original grouping, host extraction and wildcard traversal for **400 cases**.
Only the diagnostic sink is instrumented to collect selected objects and
distinct non-self references. Caller/export/import behavior is source-inspected
and tested natively, reusing existing independently checked scope helpers; the
400 cases do not claim independent execution of the entire caller pipeline.

The native adapter retains raw gateway keys, including the `no-gateway`
sentinel for absent/empty gateway lists and its distinction from `mesh`.
Buckets use normalized domain/namespace/service components. Namespace `*`
service buckets overlap other services in that bucket; external wildcard
strings do not become general DNS-pattern comparisons. Repeated host/gateway
contributions can emit a warning for one object without peer references.
Generated objects are excluded. Export defaults are VirtualService-specific;
ambient exports remain own-namespace only. The namespace-wide import filter
retains an entire object when **any** host is imported, before counting all its
hosts. Workload-selected Sidecar overrides are not inferred.

The selected name/namespace/UID and relevant hosts, gateways and exports must
match the captured list. Complete Namespace, VirtualService and Sidecar lists
and explicit DNS identity are required. Unknown export/default/root scope
defers the check, not a successful absence result. Bounds are 1,000 objects per
source, 100 hosts/gateways/export values per object, 1,024 characters per value,
and 20,000 gateway-host contributions; these are analysis limits, not a claim
that Headlamp buffers no larger initial response.
In particular, this adapter does not replace unavailable mesh evidence with
the upstream nil-default assumption for unmanaged namespaces; that wider
configuration-provenance parity remains open.

Sixteen hosted scenarios observed 30 intercepted configuration-list GETs:
matching/private/generated objects, omitted-versus-mesh gateways, self
duplicates, namespace wildcards, whole-object imports/exclusions, actual
managed-mesh defaults, stale UID/spec, denial, suppression, a **15,132 ms**
whole-read timeout, retry and missing DNS identity. The timeout displayed
Unavailable, not an empty successful result. Related-configuration navigation
used explicit cluster route parameters, showed the observed UID, and reached
the correct VirtualService detail. Eleven existing Gateway collision scenarios
also passed after this shared link change. Labels/controls rendered and no
plugin execution errors occurred.

All VirtualServices and Sidecars in these positive cases were synthetic; real
Namespace/mesh reads supplied supporting scope. The actual VirtualService list
was empty. No policy was installed, settings were restored durably, and owned
browser/server helpers were closed. Desktop debugging remains unavailable.
The checkpoint has **18,234 tests in 142 files**, **16,576 original-Go cases**
and **36 bounded finding codes**. Full checker parity remains open.

## Native traffic topology projections

### Captured namespace annotations

Projected nodes now expose selected/outside/unknown namespace captions in the
SVG, node table, keyboard description and selected-node inspector. The
namespace-name comparison follows `isOutside` in pinned
`graph/telemetry/istio/appender/outsider.go`
(`5a267fd5298d2c7f36c24fccc8ea1a1e327027ea`). A namespace with the same name in
another telemetry cluster still matches this name-based selection. Unknown
source nodes and empty/unknown namespace labels are explicitly unestablished.
This does **not** implement accessible-namespace discovery, egress-cluster
classification or the appender's complete `isInaccessible` behavior. No RBAC,
current-object, health or mesh-membership conclusion is inferred.

The same captured query supplies all captions after every local projection and
neighbor filter; no extra metric/API read is issued. Namespace edits preserve
the existing form behavior: old results are cleared, not relabeled or replayed.
An explicit new submission recomputes membership for the new selection.
The older request-only diagram does not receive these optional captions.

Four hosted scenario groups used three intercepted metric GETs, covering all
four projections, cross-cluster same-name namespaces, unknown source identity,
keyboard inspection, consistent node-table/SVG descriptions, local filtering,
explicit scope resubmission and stale-result removal on denial. The screenshot
and plugin console were checked. Settings were restored and no cluster objects
were changed. The new helper has source-informed native tests, not an added Go
oracle; the previous 1,728 graph identity cases remain unchanged.
Gates pass **18,943 tests in 145 files**.

### Projection and query semantics

`core/topology.ts`, `data/topology.ts` and `Topology.tsx` add a separate
`kiali-graph` route. The original metrics page still issues its original five
queries. Its SVG renderer is shared with the new page, preserving its old
request-only interface and adding selected-measure units and controlled node
selection.

Graph identity/fallback semantics derive from `graph/types.go` and
`graph/util.go`. **1,728 original-Go cases** independently cover all four modes,
empty/unknown app/workload/Service values, namespace fallback and
`latest`/unknown revisions. Native IDs retain tuple boundaries instead of
upstream underscore concatenation; explicit collision tests cover that deliberate
identity-safety difference. Versioned apps use workload identity when available,
retain conflicting reported revisions and warn rather than selecting one label.

Query grouping is source-informed by pinned
`graph/telemetry/istio/istio.go` at Kiali `0e8be887b8217bbcac5e3ae0bfcd258073949cca`.
Explicit **Source** and **Destination** modes preserve their prior single-reporter
selectors. The default **Combined source + destination** mode uses one bounded
query per metric with three aligned selector branches: source-reported egress
from the selected namespace, destination-reported ingress to selected-namespace
workloads, and source-reported ingress to unserviced destination hosts in the
selected namespace. It retains `reporter` in the aggregation, does not infer
ambient/waypoint traffic, and does not issue extra requests for a mixed batch.
The query preserves canonical labels, protocol, response code/status, flags and
connection-security labels.

Combined observations are paired before any of the four projections. Exact
reporter-independent metric-label identities are retained on each projected
edge, together with the reporters that supplied them. A pair contributes once
only when both sides have the same identity and rate; the source observation is
the representative. Protocols remain separate. A metric/endpoint/protocol
bucket reported by only one reporter remains visible. If both reporters appear
in a bucket, their complete response/status/flag/security identity sets and rates
must agree; partial sets and conflicting labels/rates fail closed rather than
choosing an arbitrary side or adding both.
Missing labels remain distinct from explicit `unknown` values in identity
matching; missing endpoint values still display as unknown and retain their
existing warnings. Duplicate same-reporter series still fail.

The supported metric directions follow Kiali's graph selection: requests use
`istio_requests_total`; TCP sent bytes use `istio_tcp_received_bytes_total` and
TCP received bytes use `istio_tcp_sent_bytes_total` because Istio's L4 counters
are reversed; total bytes use both. gRPC sent/received messages use request/
response message counters respectively, and totals use both. Request, byte and
message measures remain separate. Total measures require both counter reads;
failures abort outstanding siblings. The shared diagnostic deadline aborts its
internal signal on every exit.

Service projection follows the observed Service-injection/reduction model in
`graph/telemetry/common.go`: it retains non-Service roots and creates derived
Service adjacency through workloads. It does not infer a source-Service label.
Aliases are deduplicated per backing workload, rather than multiplying a mapping
again for each incoming protocol; repeated outgoing rates across distinct
Service aliases are explicitly warned about. Unretained direct workload paths
are counted. This projection has source-informed tests, not an independent
whole-graph Go differential oracle.

Historical end time and rate windows are captured explicitly. Every returned
instant sample must be finite/nonnegative, within one second of that time, from
the selected reporter branch and inside its captured namespace/cluster scope.
Duplicate series, conflicting reporter pairs, invalid protocol families and
malformed totals fail explicitly. Limits: two concurrent reads/15 seconds,
2,000 series per read, 4,000 total observations, 4,000,000 characters of exact
reporter identities, 1,000 intermediate nodes, 2,000 projected edges and 20,000
projection contributions. Boundary tests exercise the existing node/edge/
contribution limits. Optional zero-rate edges are dashed and do not imply
activity; paired zero/positive disagreement fails. The 50-node/200-edge diagram
cap does not truncate the paginated tables.

### Bounded node-state and graph interactions

`appendTopologyNodeStates` runs after the mode projection and records the
immutable query scope/time with each projected namespace-position snapshot.
Selected/outside/unknown position is derived only from the graph's reported
namespace names and the captured selected namespace, consistent with the narrow
`isOutside` comparison in pinned
`graph/telemetry/istio/appender/outsider.go`. It is not cluster-qualified
authorization, inaccessible-namespace discovery, egress classification,
Kubernetes existence, mesh membership, or health. Unknown identity and empty
namespace remain unknown in every graph mode.

Zero-rate metric samples remain edges (when requested) and can still have a
selected/outside/unknown namespace position; that position is not an idle/dead
verdict. A missing historical sample creates no node and does not establish
current inventory, deletion, or health. The current topology query has no
complete workload/service inventory, pod count, ServiceEntry export resolution,
or WorkloadEntry-to-metric-node join. Accordingly, the new state stage adds no
inventory nodes and does not label these states.

The node table can group by `none`, `app`, `cluster`, or `namespace`, the values
accepted by pinned `graph/options.go#boxBy`. Group order and node order are
deterministic. This is table grouping only: it does not create upstream
`isBox`/parent nodes, cluster/namespace boxes, or Kiali's group-summary panels.
Ambiguous multi-application nodes are shown in a separate explicit bucket.
Focusing a selected node limits only the diagram to that existing node and its
directly observed adjacent edges; complete filtered node/edge tables remain
available. Focus requires an exact captured query scope/time, rejects stale or
absent node IDs, performs no additional reads, and resets with projection/query
scope changes. Selection remains inspection-only and does not choose a mutation
target.

#### Pinned graph appender coverage

Source inventory: `test-files/parity/upstream.json`; pinned Kiali
`0e8be887b8217bbcac5e3ae0bfcd258073949cca`. The `topology` fixture, four-mode
projection tests and new appender/group/focus tests use
`test-files/topology/fixture.json`; these native tests are source-informed, not a
new Go differential oracle. An inventory entry proves the source symbol is
catalogued, not that its behavior is implemented or verified.

| Upstream appender | Coverage in this plugin | Remaining evidence/behavior |
| --- | --- | --- |
| `AggregateNodeAppenderName` | Deferred | Aggregate values, aggregation, and aggregate node/edge behavior |
| `AmbientAppenderName` | Deferred | Ambient traffic, waypoint/ztunnel and deduplication semantics |
| `DeadNodeAppenderName` | Deferred | Complete inventory, pod counts, accessibility, iterative pruning and edge cleanup |
| `ExtensionsAppenderName` | Deferred | Extension discovery and graph overlays |
| `HealthAppenderName` | Deferred | Complete per-node health inputs and graph health summaries |
| `IdleNodeAppenderName` | Deferred | Complete current workload/service inventory; zero-rate metrics are not sufficient |
| `IstioAppenderName` | Deferred | Configuration overlays and Istio-specific graph details |
| `LabelerAppenderName` | Deferred | Upstream node labeling semantics |
| `MeshCheckAppenderName` | Deferred | Complete accessible mesh evidence |
| `OutsiderAppenderName` | Partial | Captured namespace-name comparison only; inaccessible, egress and authorization states are not implemented |
| `ResponseTimeAppenderName` | Deferred | Latency metric query, bounds and edge aggregation |
| `SecurityPolicyAppenderName` | Deferred | Per-edge security evidence and complete protocol semantics; raw reported labels are not a verdict |
| `ServiceEntryAppenderName` | Deferred | Host matching, export/access checks, node replacement and edge aggregation |
| `SidecarsCheckAppenderName` | Deferred | Complete scoped Pod/proxy evidence |
| `ThroughputAppenderName` | Partial | TCP byte measures exist separately; upstream appender and `throughputType` behavior are not implemented |
| `TrafficGeneratorAppenderName` | Deferred | Upstream traffic-generator classification |
| `WorkloadEntryAppenderName` | Deferred | Scoped app/version label join against current WorkloadEntry inventory |

Unknown telemetry identities are preserved in projection as unknown nodes; they
are not an independent upstream appender and do not imply inaccessible or dead.
The separate structural Map WorkloadGroup label association is not a graph
WorkloadEntry appender match.

#### Graph defaults and parameters

The current four projection values (`graphType`) are implemented as local
projections, not all Kiali graph API semantics. `includeIdleEdges` retains only
explicit zero-rate metric observations; it is not `idleNode`. Captured `queryTime`
and bounded rate windows provide a historical snapshot. The table grouping
supports the four `boxBy` values, with the limitations above.

Deferred individually: `ambientTraffic`, `appenders`, `aggregate`,
`configVendor`, `injectServiceNodes`, multi-namespace `namespaces`,
`refreshInterval`, upstream `rateGrpc`/`rateHttp`/`rateTcp` option semantics,
`responseTime`, `telemetryVendor`, `throughputType`, and `waypoints`. Existing
measure choices for requests, TCP bytes and gRPC messages are separately scoped
native query behavior, not a claim that the upstream rate defaults/options have
parity. Blackhole/passthrough, aggregate boxes, security/health/config overlays,
and ambient/waypoint families remain explicit gaps.

Focused validation for this increment passed 1,777 topology core tests and
9 topology component tests after dependency installation. No new hosted/Desktop
or live graph verification was performed; those checks remain open.

Hosted stock Headlamp 0.35.0 checks used real Bookinfo telemetry after 18 bounded
read-only productpage GETs: six source-reported workload nodes/edges, four app
nodes/three app edges, six versioned nodes, and four Service-projection nodes/
three edges. Destination reporting additionally retained the unknown ingress
source and exposed `mutual_tls`; the source reporter's missing security label
stayed unknown. Actual TCP counters were empty, not presented as healthy zero.
These are earlier explicit single-reporter checks; they do not verify the new
combined reporter mode in a running Headlamp instance.
An intercepted 11-scenario browser run covered app/versioned/Service modes,
edge metadata, local filtering, TCP and gRPC totals, historical window/end time,
backend warnings, denied/stale responses and complete pagination beyond the
diagram limit. Interceptors were removed in `finally`; settings were unchanged.
Normal gates passed **9,493 tests in 80 files**; independent Go evidence now
totals **8,731 cases**.

Still open: complete upstream query/default and missing-report reconciliation
outside this bounded batch, unserviced destination normalization beyond the
source-reported host case, ambient/waypoint semantics, full graph appenders,
idle inventory/dead-node detection, aggregate boxes, health and configuration
overlays, trace correlation, verified Kubernetes links, and current mixed-mode
hosted/console/i18n/a11y and Desktop evidence. Reported security labels are not
enforcement proof.

## Read-only pod and Envoy diagnostics

`core/diagnostics.ts` and `data/diagnostics.ts` provide explicit container
inventory and bounded current/previous pod logs, including restartable init
sidecars and ephemeral containers. The adapter uses public `ApiProxy.request`
raw `Response` mode, streams UTF-8 safely, enforces 256 KiB even if the server
ignores its limit, and checks pod UID/container restart count before and after.
Controls cap requests at 1,000 lines, 24 hours and 15 seconds. Unknown instance
evidence is displayed, not treated as verified readiness. The real cluster
returned HTTP 406 for `Accept: text/plain`; wildcard Accept fixed negotiation.
No logs are persisted in settings or stored in screenshots of real log output.

`data/proxyAdmin.ts` proves that stock hosted Headlamp can reach loopback-only
Envoy admin using **public `ApiProxy.stream`**, Kubernetes WebSocket
`v4.channel.k8s.io`, channels 0/1 and port 15000. It exposes only fixed read-only
GETs for `/server_info` and `/config_dump`, with no local listener, exec, custom
backend, token creation or installation. Identity/restart checks and the
15-second deadline cover the entire read. Server information is capped at
256 KiB and configuration at 4 MiB. No automatic reconnect/retry occurs.

`core/proxyHttp.ts` incrementally decodes explicit-length or chunked HTTP/1 JSON
responses, enforcing 16 KiB headers, 64 KiB chunk framing, 8,192 chunks,
byte limits and strict UTF-8. Unsupported encoding, ambiguous framing,
incomplete responses and non-200 status fail explicitly. Chunk extensions and
close-delimited bodies are not supported. `core/proxyConfig.ts` bounds JSON to
100,000 values, depth 64, 10,000 entries and 64 top-level sections. It preserves
cluster/route/listener configuration state and unknown fields. Protobuf names
may be absent or repeated; source indexes distinguish entries rather than
rejecting real dumps or inventing Kubernetes identities.

The native UI displays server version/state/uptime and a paginated configuration
table with on-demand read-only entry JSON. Bootstrap, secrets and endpoint
details are not displayed. The full dump is read into transient memory, so the
warning does not claim that those sections were excluded from transport.
Neither HTTP success, LIVE server state nor an active configuration proves
control-plane synchronization, validity or health.

Real hosted Bookinfo checks loaded native-sidecar logs, LIVE Envoy server state
and 88 configuration entries. Each observed forwarding stream sent one GET and
closed after its response. Browser-only synthetic sockets separately exercised
repeated/unnamed routes, warming listeners, selected JSON, HTTP 403, over-limit
responses and replacement/cancelled reads; normal sockets were restored.
The checkpoint passed 6,191 tests in 64 files and type/lint/schema/parity/i18n/
build/package gates. New tests are source-informed, not an independent Go
oracle for the full proxy-summary algorithms.

Stock-host limitation: `stream().cancel()` may run before the host assigns its
socket. The adapter observes `getSocket()` for 15 seconds and cancels late
frames without sending. If host setup remains stuck past that window and later
creates a silent socket, the public API cannot guarantee reclamation. This is
recorded rather than hidden behind a private import, bridge or host patch.
Desktop, full cluster/route/listener projections, bootstrap/endpoint inspection,
control-plane synchronization, ztunnel and confirmed logging changes remain.

### Proxy summaries and full match inspection

`core/proxySummary.ts` adds independently checked cluster parsing, Istio metadata
reference rendering, application-protocol classification, preferred-domain
selection and xDS nonce comparison. The **1,063 original-Go cases** pin
`models/config_dump.go`, `kubernetes/envoy.go`, `kubernetes/host.go` and
`business/proxy_status.go`. The generator executes original function bodies
offline on a 64-bit Go target; only type qualification and struct decoding tags
are adapted. Host wire-field names are normalized in tests. Parsed int64 ports
use decimal text, preserving overflow saturation and values beyond JS's safe
integer range; these are parsed values, not port-validity assessments.

Cluster inspection consumes the saved service DNS identity reactively, without
refetching configuration. When unset or invalid, it does not guess Kubernetes
namespace identity. Metadata names are not asserted to exist and are not linked
without canonical context. Malformed summaries show a warning while retaining
full entry JSON.

`core/proxyDetails.ts` and `ProxyEntryDetails.tsx` provide native route and
listener inspection. Unlike the pinned path-only summary, route details retain
header/query/extension matches, all domains and all action types. They do not
discard passthrough, redirects or direct responses or infer a 404 from an absent
action. Listener details preserve default chains, full match objects, every
filter name and recognized RDS/inline/TCP/weighted destinations. Protocol labels
are configuration matches, not observed encryption. Unknown filter details remain
in the full entry. Summary-specific limits are 1,000 routes/chains and 10,000
total network filters; ambiguous oneofs fail explicitly. This normalization has
source-informed tests, not a full original-Go route/listener projection oracle.

The checkpoint passed 7,279 tests in 66 files and the normal build/parity gates.
Live hosted Bookinfo checks covered cluster DNS interpretation both ways,
real route match/action inspection and listener filter-chain JSON. Temporary
DNS settings were restored. The pure preferred-domain and xDS helpers are not
used to infer resource identity or synchronization from incomplete evidence.

The test control plane advertises `http-debug=8080`; `/debug/syncz` through
Headlamp's Pod proxy returned **401**, while the same Pod's ordinary API read
succeeded. No credentials were created and no alternative authorization path
was attempted. Control-plane synchronization remains an explicit authorization
gap, separate from the proven Envoy forwarding transport.

### Current Service candidates from Envoy names

`core/proxyService.ts`, `data/proxyService.ts` and `ProxyServiceCandidate.tsx`
add explicit current-resource inspection for eligible outbound cluster names.
The adapter reuses the pinned summary parser but requires exactly four name
parts, outbound direction, a complete Service FQDN in the explicitly configured
DNS domain, valid namespace/Service names and a port from 1 to 65535.
Noncanonical, external, wildcard, inbound and unscoped names remain ineligible;
the Pod namespace is never substituted. The shared parser's Go-backed
normalization remains unchanged; no new Go oracle cases are claimed.

The read captures name/domain/cluster before awaiting, uses one public
Headlamp Service GET and a linked 15-second deadline, and validates returned
kind/API version/name/namespace/UID/resource version. At most 100 declared ports
are projected. Port presence is a numeric comparison only, not subset,
endpoint, protocol or routing verification. Current UID and timestamp are
disclosed, and a native link appears only after this check. Name/DNS/cluster
changes discard the result and cannot resurrect it when settings revert.

Eight hosted scenario groups used a real Bookinfo proxy snapshot and an
actual `bookinfo/details` Service read, then intercepted changed-port,
mismatched-identity, missing-UID, denied and missing responses. DNS changes
invalidated results without another proxy read; a held Service request timed
out at **15,535 ms**, and explicit retry succeeded against the live Service.
Ten Service GETs were observed with one proxy forwarding stream and no writes.
The native link opened Headlamp's Service drawer, not a new page URL; its
actual Service content was inspected. Settings/interceptors were restored.

The increment passed **17,654 tests in 135 files** and normal gates.
This is current name-based candidate evidence, not proof that the captured
proxy used that UID or that traffic reaches it. Canonical configuration
metadata links, authorized sync, live ambient coverage, logging controls and
Desktop verification remain open.

### Current configuration candidates from metadata

Cluster DestinationRule and expanded-route VirtualService metadata now support
explicit current-object lookup. Raw paths remain separate from the unchanged
source-backed `name.namespace` display. `proxyConfigurationTarget` accepts only
the pinned `networking.istio.io/v1` namespace path, the expected plural kind and
valid namespace/name identities, preserving dotted names without guessing.
External URLs, encoded separators, queries/fragments, wrong kinds and legacy
reference versions cannot become API requests.

The reader captures kind/path/cluster, discovers a supported current version,
validates the resulting object identity/UID/resource version and returns a
group-safe detail route. Reference and served versions are displayed separately;
an observed v1 reference may resolve through the server's supported v1beta1
endpoint. It uses a linked 15-second deadline and the same observed-identity
guard as Service candidates. Entry/reference/cluster changes discard prior
results without replay. No DNS suffix, historical UID, specification version or
configuration-validity inference is made.

Twelve hosted fixture scenarios covered DestinationRules without DNS settings,
current beta serving, wrong identity, missing UID, object/discovery denial,
absence, a **15,052 ms** timeout/retry, direct-response VirtualService metadata,
dotted names, entry invalidation, rejected kinds/legacy paths and detail
navigation. Eleven configuration GETs were intercepted. Four real authorized
pod-port-forward handshakes supplied the negotiated v4 channel; the browser
intercepted the expected read request and supplied synthetic configuration
payloads, without forwarding application commands or changing SDK globals.
All displayed proxy/configuration payloads in these scenarios were fixtures,
not deployed configuration. Connections/handlers were closed and no writes
occurred.

Gates pass **17,686 tests in 138 files**. The parent diagnostics test mock was
updated for the new reader boundary; the original Service lookup and proxy
summary behavior remains covered. No new Go oracle cases are claimed.
Other reference formats/types, live configuration provenance, synchronization,
ambient/logging controls and Desktop closure remain open.

### Explicit ztunnel configuration format

`core/ztunnel.ts` and `ZtunnelDiagnostics.tsx` add bounded service/workload
observations for an explicitly selected ztunnel dump. The transport remains the
same fixed GET `/config_dump` to port 15000, matching pinned
`cache/ztunnel_dump.go` (`b41a3039b687b9c3d0b57eb6322e9334c3e635fd`).
The JSON model follows `kubernetes/ztunnel.go`
(`b070023fd52ec9e86bc6f156f8b8a2e25241be42`) and the pinned ambient tables.
The current upstream Rust handler also explicitly returns JSON Content-Type:
[`src/admin.rs` at e7b46ba](https://github.com/istio/ztunnel/blob/e7b46ba54d248d7060564fbf41fbe331f8403da5/src/admin.rs).
This secondary transport reference does not change the pinned Kiali baseline.

Both `services` and `workloads` arrays are required, so Envoy/malformed payloads
cannot become empty ztunnel success. Limits are 1,000 services, 1,000 workloads,
1,000 endpoints per service and 10,000 endpoints overall, in addition to shared
4 MiB, 15-second and structural limits. Missing endpoint maps differ from known
empty maps. Counts have separate reported-total and reported-healthy columns,
not an ambiguous fraction. Repeated/missing names and registry IDs remain
distinct indexed observations; no Kubernetes UID or cross-cluster lookup is
invented. Waypoints retain destination and HBONE port.

Local filters make no network requests and clear stale detail selection.
Selected service/workload JSON preserves unknown fields, false and zero.
Runtime identity fields and certificate/policy counts are shown, but top-level
certificate material, policy bodies and remaining runtime configuration are not
projected. They are still present transiently in the received bounded dump.
Protocol/status strings are reported observations, not enrollment, synchronization,
encryption or effective-authorization verdicts.

Hosted fixtures used `test-files/diagnostics/ztunnel.json` and intercepted only
the diagnostic stream. Real pod identity reads remained active. Tables, counters,
filtering and actual Monaco text were checked; the synthetic stream sent one
GET and closed. A real Envoy response separately proved wrong-format rejection.
All browser interception was removed. No ztunnel was installed, so live ztunnel
and Desktop support remain unverified. Metrics, ambient enrollment/health,
canonical resource linking and full runtime/certificate inspection remain open.
The checkpoint passed 7,637 tests in 71 files and the normal build/package gates.

## Health calculator and live telemetry increment

`core/healthCalculator.ts` ports the pinned matcher and calculator, independently
compared with 271 original-Go executions in `parity/health-calculator.json`.
Coverage includes defaults, HTTP/gRPC/no-response codes, direction, float32
thresholds, annotation overrides, rule fallback and replica merging.
The application/workload/Service core is reusable. The initial adapter covered
five replica-controller kinds; Application/Service consumers are described below.

Per-cluster custom rules are additive schema-version-1 settings. They precede
Kiali defaults and use RE2JS 2.8.8 rather than JavaScript backtracking regexes.
Explicit safety limits: 99 custom rules, 100 tolerances per rule, 512-character
patterns and 4,096-character annotation text. Saved invalid patterns/thresholds
are rejected. Annotations retain upstream fallback warnings, but non-finite,
hexadecimal and underscore-separated thresholds are deliberately rejected.
Ordinary decimal/scientific thresholds preserve float32 rounding.
Equal-severity protocol ties use deterministic JavaScript insertion order;
Go's map traversal may choose a different same-severity error ratio.

`data/health.ts` reads the exact controller and two scoped instant vectors.
Missing telemetry, failed directions, Prometheus warnings, invalid replicas,
and stale observed generations suppress the combined verdict. Proxy
synchronization is explicitly unknown, never inferred from an injected pod.
The result is labeled replica/request health, not overall mesh health.

On October 27, stock hosted Headlamp 0.35.0 loaded the production RE2JS bundle
without plugin execution errors. Real Bookinfo traffic supplied request-rate
and p95 charts, six workload edges, and reviews-v1 health with 1/1/1 replicas.
TCP telemetry was absent and correctly shown as unavailable. A temporary
browser-local custom rule changed healthy traffic to Failure as configured,
persisted after the host's debounced save and reload, and was then removed.
Workload-table links retained exact kind/namespace/name. No cluster writes
or browser response fixtures were used for these success checks.

Desktop debugging remained unavailable. Host-only deprecated CRD-v1beta1
discovery and watch-close errors remain separate from plugin behavior.
Prometheus stayed ready with zero restarts under the existing 1 GiB limit.
The user now permits raising that limit if trouble recurs; it was not needed.
TCP error semantics, capability detection, external Service discovery and
proxy/ambient assessment remain open.

### Application and Service consumers

The **Health** route now accepts Application, Service and existing workload
subjects. Application/Service browsing links preserve namespace/name. Application
queries use the explicit `canonical_service` metric identity, following the
pinned `GetAppRequestRates`; the logical application label is kept separate.
Service queries use destination Service name/namespace and inbound rates only,
with annotations from the actual Service.

`data/correlation.ts` now retains only replica/staleness summaries from the same
controller objects used for ownership grouping. It does not retain extra raw
annotations or refetch each controller. Applications reuse top-level correlated
workloads, avoiding ReplicaSet/controller double counting. The consumer requires
complete ownership/resource evidence, at most 100 workloads and supported,
current replica state. Workload annotation parsing errors remain health errors
without breaking unrelated relationship browsing; individual workload rate
tolerances do not override Application rules.

`readHealthMetric` supplies the shared scoped adapter. It rejects duplicate
instant-vector label identities and timestamps outside one second of the
captured query time; the domain aggregator still sums independent observations
with the same protocol/code. Missing, stale, warning-bearing and invalid
observations suppress derived health. Service health does not incorporate
endpoint or replica readiness.
Zero-rate Service health is Not assessed. When both request directions return
explicit zero-rate vectors, Applications/workloads retain the calculator's
replica status but label it replica-only with request health unassessed. An
absent direction is unavailable instead; it is not treated as a zero rate.

Real hosted Bookinfo evidence covered reviews Service inbound health and
Application replica/request health across three 1/1/1 Deployments, following
36 bounded productpage GETs. A nonexistent telemetry-cluster label produced
unavailable health. Native links retained target identity, and no response
fixtures or resource mutations were used. Existing workload regression checks
remain green. Reporter combination is described below. Query labels use the
exact explicit telemetry-cluster value, including literal `unknown` or `external`;
there is no unknown-cluster fallback. Unknown-destination fallback, external
Service discovery, capability detection, additional workload kinds and
proxy/ambient semantics remain unsupported. Desktop evidence remains outstanding.

### Reporter combination and no-response normalization

`core/healthReporters.ts` ports `AggregateInbound`, `AggregateOutbound`,
`CombineReporters` and response-code normalization from pinned `models/health.go`.
The original Go functions independently generate 372 oracle cases, including
source/destination asymmetry, repeated buckets, legacy unattributed input,
no-response precedence and gRPC HTTP-code fallback.

The Health UI now explicitly defaults to **Kiali inbound combination**. Inbound
queries retain reporter identity; aggregation sums each reporter, then takes
the greater source/destination rate for each protocol/code, rather than adding
both reporters. Outbound remains source-only. The previous single-reporter
behavior is selectable; programmatic queries omitting the new mode retain it.
`response_code=0` normalizes to `-` even when gRPC status says 0. Missing gRPC
status uses response_code, following the original aggregate function.

The pure core preserves legacy unattributed reporter behavior for differential
parity. The native combined-mode adapter is deliberately stricter: it requires
explicit known reporter labels and refuses a healthy result when they are
missing/malformed. The adapter retains the 2,000-series bounds; the pure combiner
accepts at most 4,000 samples across both directions and rejects nonfinite or
negative input. Traffic charts retain their existing reporter semantics.

`parity/entity-health-oracle.json` adds query-and-output fixtures bound to the
same commit and the pinned health service/model sources. The fixtures cover a
workload inbound query, Application canonical-service inbound/outbound queries,
an inbound-only Service query, and literal `unknown`/`external` telemetry labels.
Combined expected output covers source/destination max-per-code behavior, HTTP,
gRPC status and no-response normalization; the 372 independently executed Go
reporter cases remain the differential oracle for the aggregation functions.

Health request observations are supported only for HTTP and gRPC. A `tcp` or
unknown protocol on `istio_requests_total` is rejected as unsupported; TCP byte
counters have no response-code health semantics and are not converted into
healthy request results. A zero-valued vector sample is observed evidence, while
an absent vector is not: Applications and the five supported replica workload
kinds require both directions to have observations; Services require inbound
observations only. Missing directions are announced accessibly and suppress the
calculation. No sidecar, waypoint, proxy-sync, ambient or security capability is
assumed. Other workload kinds and VM WorkloadGroup application health remain
unavailable rather than receiving fabricated replica or traffic health.

Real hosted Bookinfo checks loaded Service, Application and workload health
using combined queries after 18 bounded productpage GETs. Separate intercepted
metric cases proved source-only failure visibility, selectable legacy behavior,
gRPC no-response precedence and missing-reporter suppression. Fixtures were
removed and real reads restored. Type/lint, 5,505 tests in 51 files, oracle
reproducibility and parity/build checks passed. Desktop and the remaining
query/capability coverage are still open.

## Istio Gateway reference checks

KIA1102/KIA1108 now check VirtualService Gateway references separately from
Gateway API parent refs. `core/istioGatewayReferences.ts` walks top-level and
HTTP/TCP/TLS match lists with precise field paths. `data/validation.ts` uses a
distinct `istioGateways` source and explicit `networking.istio.io` discovery;
same-named Gateway API resources cannot satisfy these references.

Short names resolve in the owning namespace; explicit namespace/name references
need no guessed DNS suffix. Legacy dotted names reuse the pinned host helpers
and require an explicitly configured suffix. Missing/forbidden/partial/wrong-group
lists defer absence findings, while nomenclature can still be checked locally.
Bounds are 200 references, 100 routes per protocol, 1,000 matches and 1,000
Gateway objects. Ignore annotations apply normally.

The source is pinned `virtualservices/no_gateway_checker.go`, called by
`checkers/no_service_checker.go`. Intentional native improvements: evaluate all
matches instead of Go's `valid &&` short-circuit, include the missing match
index in paths, cover TCP/TLS references, and treat namespace/dotted.name as
modern syntax rather than misclassifying every dot as legacy notation.
Existence is not listener attachment, controller acceptance or mesh health.
The integration has source-informed tests, not a complete independent checker
oracle; the reused normalization helpers retain their existing Go oracle.

Five hosted fixture cases covered missing/found, denial, legacy without DNS,
and dotted names in explicit references. The full suite passed 7,300 tests in
68 files, along with type/lint/schema/parity/i18n/build/package gates. No Istio
Gateway or VirtualService was created; normal empty lists were restored.

## AuthorizationPolicy namespace and method patterns

KIA0101/KIA0102 now check positive `source.namespaces` and
`operation.methods` in AuthorizationPolicy rules. The pure matchers in
`core/authorizationValidation.ts` have **296 independent original-Go cases**
from pinned `authorization/namespace_method_checker.go`, `models/namespace.go`
and `util/httputil/http_util.go`. Exact/prefix/suffix/presence semantics,
namespace case sensitivity, Go whitespace and simple Unicode method casing are
preserved; JavaScript multi-character case expansions must not turn a ligature
into an accepted HTTP-method suffix.

Method checks are local and run even when namespace reads fail. Namespace
absence requires complete bounded evidence, never a denied/partial list.
Method-only and negative-only rules do not request namespace context. Bounds
are 100 rules, 1,000 rule groups, 200 combined patterns, 512 characters per
pattern and 1,000 namespace objects. Malformed/oversized inputs are explicitly
deferred. Negative patterns, principal existence, trust-domain relationships
and access decisions are not covered by this slice.

Five hosted fixture scenarios checked findings, valid wildcards, denied
namespace evidence, method-only behavior and ignore-annotation suppression,
using real namespace reads except the explicit denial case. All interception
was removed; no AuthorizationPolicy was applied. The checkpoint passed 7,614
tests in 70 files and the normal build/parity/package gates. This is checker
coverage, not a security certification or proof of policy enforcement.

## AuthorizationPolicy host-registry hints

KIA0104 ports the active `authorization.NoHostChecker` path, not a general
HTTP Host-header validator. `core/authorizationHosts.ts` skips trimmed
prefix/suffix/presence wildcard matchers and every value with two or more dots.
Single-dot values are checked only when their suffix is the policy namespace
or a namespace in complete evidence. Bare/internal names retain their original
untrimmed text for `GetHost` lookup, matching the source behavior.

The original caller supplies namespace-export-filtered ServiceEntries and
VirtualServices plus namespace-visible Kubernetes Service hosts. The port
reuses existing Service/ServiceEntry registry behavior and adds explicit
VirtualService matching and its own `defaultVirtualServiceExportTo` selection.
Autogenerated names containing `autogenerated-k8s` are excluded; ambient objects
remain limited to their own namespace. No Sidecar imports are applied.
ServiceEntry suffix behavior and VirtualService host-form quirks are preserved,
including the lack of a separate `.svc` alias in the VirtualService matcher.

`scripts/parity/authorization-host-oracle.mjs` checks seven pinned source
identities, verifies checker activation and executes the original checker,
host helpers, Service registry and namespace export filters. Its **960 cases**
cover DNS domains, namespace scope, ambient filtering, explicit/default/unknown
exports, Service/ServiceEntry/VirtualService variants, autogenerated names,
nil rule groups, raw whitespace and both severities. Independent original-Go
evidence now totals **16,068 cases**; active coverage is **35 bounded codes**.

The reader captures inputs, obtains namespace evidence first and avoids registry
reads when names are exempt or namespace evidence fails. Positive method checks
remain independent. Bounds are 100 rules, 1,000 groups, 200 hosts, 1,024
characters per host, 1,000 objects per source, 100 hosts per VirtualService,
20,000 aggregate VirtualService hosts and 10,000 host comparisons. Complete
sources, explicit DNS and resolved relevant defaults/policy are required for
absence claims; unresolved scope is reported instead of defaulted to success.
Only `ALLOW_ANY` produces a warning, not other outbound modes.

Twelve hosted cases observed 43 registry/namespace GETs. The selected policy
was always synthetic; one case used actual Bookinfo Service/configuration
evidence, while the others exercised intercepted registries, exports,
autogenerated exclusions, suffix matching, denial, suppression and missing DNS.
No policy or other cluster resource was written. Settings and handlers were
restored. The increment passed **17,578 tests in 129 files** and normal gates.
This is bounded registry-hint evidence, not an authorization decision or proof
of enforcement; Desktop and broader principal/workload semantics remain open.

The shared findings UI also corrected the Gateway collision explanation's
accidental nesting under the unrelated TLS-override condition. Eleven existing
Gateway scenarios now explicitly verify that explanation appears only with
collision findings, without requiring a TLS finding. Their eleven lists were
intercepted; no Gateway resources changed.

## WorkloadGroup label conflicts

KIA1702 follows pinned
`business/checkers/workloadgroups/duplicate_labels_checker.go`. It compares
complete label maps in the same namespace, excludes the selected object, and
preserves the upstream distinction between absent metadata and present empty
labels. Native tuple serialization avoids delimiter-based comparison collisions.

The data reader now supports explicitly scoped validation sources and retains
UID provenance. It never widens a missing WorkloadGroup namespace into a
cluster-wide query. A complete snapshot, matching namespace, selected UID and
unchanged selected label set are required; malformed peers, replacement and
partial evidence defer findings. Bounds are 1,000 objects, 100 labels/object,
1,024-character keys and 4,096-character values. Ignore annotations still apply.

Eight hosted intercepted scenarios verified conflict/distinct/denied/stale-UID/
stale-label/cross-namespace/suppressed/absent-metadata behavior. No WorkloadGroup
was created. The increment passed 7,716 tests in 77 files and normal gates.
This is source-informed checker evidence, not an independent full group-check
oracle or complete VM-workload validation.

Inspected dependencies remain explicit: KIA1701 derives service-account
identities from observed workload state; querying ServiceAccount object
existence would not reproduce it. KIA1504 checks Kiali's configured/discovered/
fallback class registry, not simply GatewayClass existence. Neither shortcut
was introduced.

## WorkloadEntry probe evidence

The matching-entry table now exposes `healthutil.IsWorkloadEntryHealthy` as
reported evidence with explicit assumption provenance. The pinned source blob
`util/healthutil/health_util.go` is
`dfe83f57c9876b1a7b01479c93da9e272565029a`. **228 original-Go cases** execute
the complete helper, Go `strconv.ParseBool`, and first-condition lookup.

An annotation is enabled only for the exact accepted true spellings; false,
missing/empty and invalid strings take the pinned default-available path.
Native output distinguishes disabled checks from unrecognized annotation
strings rather than showing either as an observed healthy condition. Enabled
checks use the first exact `Healthy` condition: `True` is available, `False`
is not, and missing/unknown status defaults false. Input order is preserved;
no timestamp sorting or freshness inference is added.

The decoder bounds the annotation to 1,024 characters, conditions to 100 and
scanned type/status text to 20,000 characters, with bounded message/reason/time
fields. Malformed probe data produces an explicit row warning without erasing
valid name/label matching evidence. The UI offers compact summaries and an
expandable raw-field disclosure. VM application health remains unassessed;
entries do not become Pods or safe traffic-version evidence.

Three hosted groups observed five intercepted WorkloadEntry-list GETs covering
eight reported/assumed/missing/unknown/duplicate/malformed cases, old timestamps,
partial pagination, denial, stale-data removal and explicit retry. The actual
CRD schema/discovery was read; no VM was deployed and no live probe was run.
The table, named controls and console were inspected. Gates pass **19,312 tests
in 149 files**; original-Go evidence totals **17,404 cases** and finding coverage
remains 38 bounded codes.

## WorkloadGroup matching entries and structural Map links

The WorkloadGroup detail page now provides an explicit, read-only
**Load matching WorkloadEntries** action. `core/workloadGroupEntries.ts` follows
the inspected pinned `business/workloads.go` caller and
`kubernetes/filters.go` helper: group `spec.metadata.labels` selects entry
`spec.labels`, not object metadata labels or `spec.template.labels`.
`FilterWorkloadEntriesBySelector` deliberately returns none for an empty
selector; absent/null metadata remains distinct from an explicit empty map,
but neither triggers this detail lookup. No generic all-matching empty-selector
rule is substituted.

`data/workloadGroupEntries.ts` captures namespace/cluster and selector before
work, discovers a supported WorkloadEntry API and uses the existing bounded
collection reader. It accepts omitted item kind/version only through the
validated envelope, checks identity/scope and preserves partial results/errors.
Four 250-item pages and a whole-read 15-second deadline bound the lookup.
Labels are limited to 256 entries per map, 1,024 string units per key/value
and 1,000,000 aggregate JavaScript string units across the selector/inventory.
These are projection/analysis limits, not a guarantee about Headlamp's initial
response-buffer allocation.

The related table exposes declared address/network/service account and observed
UID, with explicit empty-versus-missing values and cluster-specific native
configuration links. Identity/version/selector changes discard the captured
lookup; fresh translations do not refetch. Supplied metadata/template/probe and
status sections remain intact, with Conditions directly above Events.
Associations do not establish ownership, VM registration, connectivity, proxy
synchronization or health. Bounded VM application correlation is now implemented
separately below; KIA1701 and complete workload/service-account provenance
remain open.

The opt-in structural Map source reuses the same matcher, includes matching
target nodes and rejects cross-namespace/cluster edges. Its analysis bounds are
1,000 groups, 1,000 entries, 10,000 comparisons and the aggregate label-text
limit. Source/format/budget failures produce explicit incomplete-topology nodes;
native list subscriptions still follow the host lifecycle. Existing Service
references retain their behavior.

The installed live schemas confirmed the label-map shape and 256-property
limit; both resource lists were empty. Eleven hosted scenarios observed 17 list
reads and no writes. They covered an actual empty list, fixture-backed matches,
metadata-label decoys, missing/empty/malformed selectors, namespace mismatch,
denial, partial pages, label-budget failure and **15,111..15,121 ms** timeout/retry checks.
Native Map selection, same-scope targets, a drawn SVG connection and the linked
detail explanation were inspected. Positive objects and associations were
intercepted fixtures, not deployed VMs. The increment passed
**17,611 tests in 132 files** and normal gates; no new Go oracle cases are claimed.

Stock Headlamp 0.35 limitations remain explicit. Its edge renderer draws the
path but ignores captions even though newer SDK declarations expose `label`;
the plugin supplies the metadata for compatible hosts and explains semantics
in the linked detail view. Its native source-picker checkboxes also lack
accessible names. New lookup buttons/links have names, but this is not full Map
accessibility closure. Native source menus populate asynchronously, and the
picker can shift when Custom Resources arrives; tests wait for discovery and
selected state, without changing private application state.

## Explicit telemetry identity and query capture

Per-cluster `telemetryCluster` supplies the exact Istio metric label to all
three query forms: metrics, topology, and workload/Application/Service health.
The label is separate from the Headlamp context and Service DNS suffix, never
inferred from either. Local overrides remain page-local; null explicitly clears
the default. Existing configurations without the field keep manual-entry
behavior. Setting validation preserves literal label contents while rejecting
surrounding whitespace/control characters and lengths outside 1..256.

`useTelemetryQuery` captures query settings as a clone on submission. Semantic
endpoint/identity changes discard submissions before new work can render; health
rule/application-label changes do likewise for health. Returning to an old
binding does not revive its old query or local override. Equal settings objects
do not refetch. Hosted testing caught a reference-identity-driven refetch when
ConfigStore produced a new but equal endpoint object; capturing the submitted
endpoint/settings fixed it, and every consumer has regression coverage.

Seven hosted checks covered settings validation/save/reload, all five consumer
surfaces, overrides, endpoint/identity switching and missing-label blocking.
Twenty-three provider GETs were intercepted, including the overview connection
probe; no live writes occurred. Read-only Bookinfo evidence was used for health.
Settings were restored exactly. This is a multi-cluster identity foundation,
not mesh-membership inference, metrics aggregation or multi-provider deduplication.

## On-demand graph resource candidates

`core/graphResources.ts`, `data/graphResources.ts` and `GraphResources.tsx`
resolve a graph node only through the captured query identity or a unique saved
telemetry-to-Headlamp mapping. Unknown/ambiguous labels and unavailable contexts
block lookup. Workload/application nodes use the actual reported workload-name
list, not the presentation label; Service nodes use an explicit valid Service
name. The bound is 20 distinct names per lookup.

An explicit button then reuses the bounded namespace correlation reader and
requires all supported lists plus resolved workload ownership. One current
matching workload kind produces a candidate; multiple kinds with the same name
remain ambiguous. Current UID/app/version metadata and native links are shown,
with no historical UID or traffic-origin claim. The shared resource-link
component preserves the established Application view behavior and supported
native route names. Missing/external/custom workloads are not inferred absent
from the full mesh.

Seven hosted cases covered workload, application and Service candidates against
real Bookinfo reads, plus denied-list, ambiguous-kind, missing-name and unmapped
identity fixtures. Fifty-four namespace resource reads were issued, with only
the negative fixture endpoints intercepted; all metric input was synthetic.
No live writes occurred. Settings/handlers were restored, and current UID
disclosures were inspected. Gates pass **15,731 tests in 116 files**.
Historical identity and broader cross-provider correlation remain open.

## Bounded multi-context comparison

`core/clusterComparison.ts`, `data/clusterComparison.ts` and the native
**Cluster comparison** page support explicit selection of 1..8 Headlamp
contexts, initialized from the host selection. Captured targets use their own
validated Service endpoint and explicit telemetry identity. A three-worker
queue performs sequential discovery, Namespace and optional request-metric
reads per target, with a 15-second deadline per target. Ignored SDK aborts do
not block timeout, queued work does not start after cancellation, and complete
earlier observations survive an individual target timeout.

Every target/source retains independent error classification and provenance.
No mapping means no metric request; zero, absent samples, malformed samples,
denial and namespace absence remain distinct. Request observations use one
destination reporter and a captured five-minute rate window, not a workload
health verdict. Repeated identities are flagged as possibly overlapping;
there is no cross-provider sum or claimed deduplication. Mesh membership is
not inferred from the user's available contexts or selections.

Connection/selection changes discard the captured comparison before refetch;
equal settings do not replay reads. Links to the single-context overview use
explicit `params.cluster`: hosted testing caught that `Link.activeCluster`
preserves the prior selected group and could otherwise open the single-cluster
guard. Existing write/resource pages retain their one-cluster boundary.

Three hosted scenario groups used eight synthetic contexts supplied only in an
intercepted public `/config` response. Thirty-five API/provider GETs were
intercepted; peak concurrent target reads measured **3**. They verified mixed
denied/absent/empty observations, missing mappings, malformed Namespace identity,
settings invalidation, correct links and the eight-context selection cap.
All fake context/configuration state was removed; no live writes occurred.
Tests also cover hanging/cancelled targets and retained prior observations.
Gates pass **15,722 tests in 113 files**. Comparison rates additionally reject
unexpected aggregation labels and mixed sample times. Actual multi-cluster topology,
shared-store normalization and full mesh-wide semantics remain open.

## Native traffic histogram explorer

`core/histograms.ts`, `data/histograms.ts` and `components/Histograms.tsx`
implement scoped request duration, request size and response size summaries.
The source metrics are `istio_request_duration_milliseconds`,
`istio_request_bytes` and `istio_response_bytes`; units stay milliseconds/bytes,
with no silent scaling. Average uses the sum-rate/count-rate ratio; quantiles
use bucket-rate aggregation by `le` before `histogram_quantile`.

The generator in `scripts/parity/histogram-oracle.mjs` executes the original
`prometheus/metrics.go` histogram builder from the pinned Kiali commit.
It checks the metric names against `business/metrics_definitions.go` and covers
180 query combinations, bringing independent original-Go evidence to
**15,108 cases**. This is query-builder evidence, not proof of Prometheus
distribution accuracy or complete upstream dashboard/default parity.

The native page captures its connection, query and current/historical end time.
One to five distinct summaries run with three workers and a 15-second deadline.
Each matrix must have at most one unlabelled series, fit the captured time/sample
budget and contain only nonnegative finite values or explicit non-finite gaps.
Zero is retained. Shared chart rendering exposes units, numeric values and
isolated-point markers rather than hiding a lone finite sample.

Hosted Bookinfo duration average/P95 reads succeeded but each returned one
series with **zero finite samples** in the checked window. Synthetic byte
responses verified five summaries, peak concurrency three, historical/workload
scope, per-summary denial and invalid-aggregation errors, null gaps, zero and
draft/submission isolation. The actual isolated sample marker was inspected.
No live writes occurred; temporary Kiali settings and handlers were restored.
The increment passed **16,470 tests in 126 files** and type/lint/schema/parity/
i18n/build gates. Desktop and finite live histogram evidence remain open.

## Native custom aggregate dashboards

The new custom-dashboard page executes an explicit bounded subset of the pinned
dashboard schema: per-cluster definitions with `name`, `title` and `items.chart`
fields for single-metric raw/rate charts and the classic histogram extension
below. Raw aggregation supports sum/avg/min/max;
rate uses sum of five-minute counter rates. Namespace and metric-cluster labels
are configurable. Omitting the metric-cluster selector requires a fresh explicit
single-cluster-source confirmation bound to the endpoint/settings; this
assertion is disclosed and is not inferred from a Headlamp context name.

The original `Client.FetchRange` query-construction block and complete
`fetchRateRange` helper execute in a **45-case original-Go oracle**. The harness
replaces transport with an expression sink and supplies literal scope labels;
it does not execute discovery, full dashboard conversion or a Prometheus parser.
The source caller, schema and unit-scale-zero default were inspected at the
existing baseline. Template includes and label-grouped charts are covered below;
builtins, automatic application-runtime discovery, namespace/workload annotations, layout contracts
and external Grafana/Perses links remain unsupported and are rejected explicitly.

The shared metric-range reader now accepts a common captured time-range shape,
retaining the stricter Istio label validation in its existing query builders.
The new scalar decoder allows signed raw values but keeps counter rates
nonnegative. Every chart must return at most one unlabeled aggregate series;
timestamps/sample counts must fit the captured 15-second range. Non-finite
samples remain gaps, zero is preserved, and finite unit-scaling overflow or
underflow is a visible chart error. No series/replica/scrape deduplication is
inferred from a sum.

Bounds initially limited dashboards to eight charts; the explicit selection
extension below retains the request budget while allowing larger compositions.
Saved definitions remain capped at 20, with 64 KiB normalized definition JSON,
three concurrent requests and a 15-second whole-read deadline.
Per-chart denial/shape errors do not hide successful siblings. Provider,
definition or saved identity changes clear submitted results and the
single-cluster acknowledgment, without replay or resurrection.

Five hosted groups exercised public Settings save and hard reload, eight
historical charts, signed scaling/gaps/zero, three-worker concurrency,
per-chart denial/aggregation errors, captured drafts, definition/source changes,
explicit scope acknowledgment and a **15,549 ms** deadline cancelling queued
jobs. The final rerun measured 15,044 ms. There were 27 intercepted chart reads. A real Bookinfo
`container_memory_working_set_bytes` namespace aggregate returned one series
with **61 finite nonzero samples** through the existing Service; this is a
metric aggregate, not a deduplicated memory or health verdict. All settings
were restored and no cluster writes occurred. Gates pass **19,394 tests in
153 files**; original-Go evidence totals **17,449 cases**, with 38 finding codes.
Hosted histogram and traffic-signal regressions also passed after the shared
reader change: duration histograms retained non-finite gaps, throughput retained
61 explicit zero samples per panel, and bounded concurrency/deadlines held.

### Classic histogram dashboard extension

Saved charts now accept `dataType: histogram`. The shared classic-histogram
builder supports average/P50/P90/P95/P99, preserving the existing Istio
histogram query spelling and its 180 original-Go cases. No additional oracle
count is claimed for this reuse. Average and P95 are the native view's initial
selection, not a claim that all upstream dashboard request defaults match.
Average uses `_sum`/`_count` rates; quantiles use `_bucket` rates grouped by `le`.
Precomputed quantiles are not averaged. Prometheus native-histogram payloads
remain unsupported.

The captured summary list expands to individually labeled results and counts
against the existing **eight-request** limit before transport. Chart count alone
does not authorize a larger query fan-out. Per-summary errors are independent;
gaps, zero, unit scaling and signed custom observations are retained.
Signed custom histograms differ deliberately from the nonnegative domain of
the existing latency/request-size/response-size Istio histograms.

Three hosted scenario groups issued 13 intercepted GETs and measured peak
concurrency three. They covered all five historical summaries and exact query
shapes, signed scaling/zero/gaps, one denied quantile, captured draft independence,
settings save/hard reload, definition invalidation, nine-query rejection,
exact eight-query mixed charts and empty-summary rejection. The original
Istio histogram explorer and raw/rate custom dashboards were rechecked hosted,
including real Prometheus read paths; no writes or provider installations
occurred. Positive custom histogram samples were synthetic.
Gates pass **19,400 tests in 153 files**; source-oracle totals stay 17,449 and
finding coverage stays 38 bounded codes.

### Explicit dashboard equality filters

The native query now accepts up to ten `labelsFilters` entries, corresponding
to the pinned dashboard query's equality-filter role. Names must already be
valid Prometheus identifiers; unlike upstream's name sanitization, invalid
names are rejected instead of silently changed. Values are bounded literal
strings, with empty equality's missing-label semantics disclosed. Namespace,
configured metric-cluster and `__name__` selectors cannot be replaced.
The source scope remains explicit, but label filters are not an authorization
boundary or proof that a metric represents a Kubernetes object.

Filters are cloned with each submission and shown separately from draft edits.
They are not persisted in ConfigStore or navigation URLs. Raw, rate and every
histogram summary use the same captured filters. The shared range serializer
now rejects **more than 16 KiB of encoded query parameters before transport**;
exact-boundary and Unicode-expansion tests supplement the existing raw-query
and sample limits. Histogram expansion is checked before any job starts.

Three hosted groups issued eight intercepted GETs for mixed raw/rate/histogram
charts. They verified literal quote/backslash values, empty values, captured
draft independence, protected-scope collisions, invalid key/type/Unicode,
ten-label/encoded-size bounds and a corrected retry. No cluster reads beyond
the fixture metrics, writes, or persisted filter drafts were introduced.
This is native/contract evidence, not an additional independent Go oracle.
Gates pass **19,404 tests in 153 files**.

### Named multi-metric charts

Charts now accept `metrics` entries containing `metricName` and `displayName`,
following the pinned `MonitoringDashboardChart.GetMetrics` precedence:
a nonempty list overrides the deprecated single `metricName`; otherwise the
legacy metric and chart name supply one series. The native boundary additionally
requires bounded, nonblank, distinct display names and valid metric identifiers.
It preserves declared order and does not infer a unit or rename invalid fields.
No new Go oracle cases are claimed for this source-inspected metadata behavior.

Each metric and histogram summary counts toward the eight-query bound before
expression construction or transport. Histogram comparisons are grouped into
one panel per summary. The multi-line chart uses a union of returned timestamps,
fills absent observations with null rather than zero, and never sums or
extrapolates named metrics. At most eight 241-sample scalar series yield 1,928
union rows. Table columns show the same named values, gaps and signed numbers.
Failed metrics remain explicit; surviving series retain their declared color
position on retry. The single-metric chart keeps its existing behavior, with
an optional display-name label for custom metric tooltips.

Five hosted groups issued nine intercepted metric GETs, checking Settings
save/hard reload, legacy precedence, two real rendered lines/legend labels in
one panel, signed/zero/gapped numeric data, independent failure with stable
sibling color, two multi-metric histogram panels, expansion rejection and
empty-list fallback. The earlier single-metric histogram fixture passed again.
Runtime imports, screenshots and console were inspected; all samples in the
new positive cases were synthetic. Gates pass **19,415 tests in 155 files**.

### Saved template composition

`resolveCustomDashboard` follows the pinned `business/dashboards.go`
`loadAndResolveDashboardResource`/`resolveReferences` pipeline for locally saved
definitions. It applies Go edge-whitespace trimming, nonempty-include precedence,
whole-template and exact `template$Chart name` selection, ordered flattening and
first-match selection. The complete referenced template is resolved before chart
selection. Its shared visited set is deliberately retained across siblings:
reusing the same template twice is an error even without a recursive cycle.

The native schema and resolution boundary remain stricter: missing chart matches
are errors rather than silently omitted items; extra `$` suffixes are rejected;
even a shadowed chart must satisfy the supported schema. Selected resolved chart
names must be distinct. Unresolved references can be saved but fail visibly when
selected, without a remote template lookup or metric request. Source definitions
remain unexpanded in ConfigStore. Submitted results capture detached resolved
charts and ordered template name/title references; editing any definition clears
the capture without replay.

Twenty templates with at most eight source items each bound traversal and depth.
Resolved metadata now allows up to 328 charts under the effective-catalog and explicit selection
extension below; source templates still contain at most eight items. A bounded
named subset of a larger intermediate expansion is allowed. Metric/summary expansion,
encoded-query, three-worker and deadline limits still apply before transport.
All composed metrics retain the selected namespace/provider/cluster-label scope.
This is source-inspected native evidence, not an additional original-Go oracle.

Six hosted groups issued 12 intercepted metric GETs, verifying Settings
save/hard reload, unexpanded definitions, ordered nested charts and an actual
included histogram curve, captured reference headers/rows, draft independence,
referenced-definition invalidation, missing/cyclic/repeated dependencies,
full resolution before selection, expansion rejection and corrected retry.
The existing named-metric/legacy fixture passed again. The new positive samples
were synthetic; settings were restored durably and no Kubernetes writes occurred.
The increment passed **171 focused tests in six files** and type/lint/i18n/build/
package gates. The prior full-suite checkpoint remains 19,415 tests in 155 files;
source-oracle totals stay 17,449 and finding coverage stays 38 bounded codes.

### Label-grouped custom charts

The saved `groupLabels` field now follows the pinned dashboard caller's always-on
grouping path. Raw/rate expressions retain `by (...)`; histogram averages group
both operands and quantiles group cumulative buckets by `le` plus the declared
labels. Dynamic `ByLabels`/aggregation controls and `sortLabel` conversion remain
unsupported, rather than silently changing the grouped result.

The custom-dashboard query oracle now executes **216 original-Go cases**:
180 raw/rate and 36 histogram combinations, covering absent, single, multiple
and four-label grouping. This adds 171 cases to the prior 45-case harness and
brings total independent original-Go evidence to **17,620 cases**. The unchanged
180-case built-in histogram oracle remains a separate check.

Native grouping is bounded to four distinct names with 256 total characters,
excluding `__name__` and histogram `le`. The range decoder accepts only declared
dimensions, at most eight series and 241 captured samples per series, preserving
signed custom observations, rate-domain checks, explicit zero and nonfinite gaps.
Returned grouped labels must agree with any captured equality filter. Duplicate
label sets, including absent/empty-equivalent sets, are rejected instead of merged.
Values are at most 256 characters without unpaired surrogates; escaped group
captions are at most 1,024 characters, excluding the metric display name.
Ungrouped callers retain scalar decoding.

Each successful metric/group is compared independently. A chart/summary panel
allows at most eight lines across all its metrics; overflow is a visible panel
error, not a truncated success. Names and group values remain separate in the
model and form unambiguous quoted legend/table captions. Groups sort by captured
label identity; response ordering does not change colors, but membership changes
can. An external wrapping legend avoids shrinking the plot for long captions.
Numeric union rows retain gaps and zero without summation or extrapolation.
Individual metric failures do not hide successful sibling metrics. Group labels
are metric dimensions, not current-resource, health or authorization evidence.

Seven hosted groups issued 32 intercepted metric GETs, verifying persisted group
definitions, actual lines and accessible legends/tables, signed/zero/gapped data,
ordering under reversed responses, independent denials and malformed responses,
eight-line and 1,024-character caption boundaries, grouped histogram/rate
semantics, captured-scope contradictions and corrected retry. Timestamp cells
were made wrappable after a screenshot exposed overlap beside long grouped
headers. Ungrouped named-metric and template fixtures passed again. New positive
samples were synthetic; settings were restored and no Kubernetes writes occurred.
The increment passed **695 focused tests in 13 files**, a final three-test
chart-layout rerun, type/lint/i18n/build/package gates and the expanded Go oracle/
catalog checks. Full-suite evidence remains the earlier 19,415-test checkpoint;
finding coverage remains 38 bounded codes.

### Explicit saved-template discovery

Optional template-level `discoverOn` and `runtime` fields support an explicit
discovery action. The reader follows pinned `GetMetricsForLabels` query shape,
`count({captured labels}) by (__name__)`, using one captured instant and retaining
the native explicit metric-cluster selector/acknowledgment contract. Responses
must be bounded vectors with only `__name__`, unique valid names and matching
sample timestamps. At most 2,000 names are decoded, then only configured
`discoverOn` names are retained. The source matcher uses names, not count values;
zero or nonfinite counts therefore do not become health/runtime verdicts.

Matching definitions are grouped by their declared runtime label, including an
explicit unspecified group. UTF-8 ordering follows Go for runtime names; template
references are sorted deterministically rather than copying Go map iteration
order. Only a matching parent's literal direct include suppresses a standalone
matching child. Whitespace includes and chart-specific `$` includes do not
suppress a base template. Include strings now preserve their input text in
settings; composition still trims at resolution. Existing canonical settings
retain their behavior. Discovery never resolves missing/cyclic dependencies.

The native schema requires canonical `discoverOn` metric names instead of
silently trimming a value that the source fetcher's wanted-name filter would
not match. Queries, definitions, source settings and scope are captured before
I/O, with a 16 KiB encoded-parameter limit and 15-second deadline. Definition/
source changes invalidate discovery without replay. Selection only changes the
template draft; chart fetching remains explicit. Transport/decoder failures
never become successful empty discovery.

This is source-inspected native functionality, not a new Go-oracle claim.
Built-in catalog loading, automatic app/Pod-label selection, annotations and
discovery-auto threshold behavior remain open.

Five hosted groups issued ten intercepted discovery GETs and three explicitly
requested chart GETs. They verified metadata/literal-include persistence,
source-compatible suppression and composition, selection without fetching,
captured drafts, definition invalidation, denied/malformed/empty responses,
a **15,101 ms** timeout and corrected retry. Grouped-chart regressions passed
again. A separate unintercepted Bookinfo read returned ten metric names and
matched `istio_requests_total` under explicit destination-namespace, cluster
`Kubernetes` and reporter selectors. That demonstrates metric-name presence,
not an application-language runtime. Settings/handlers were restored and no
Kubernetes writes occurred. The increment passed **398 focused tests in nine
files**, type/lint/i18n/build/package checks and actual contribution/console
inspection. Independent original-Go evidence remains 17,620 cases.

### Charts without declared units

The pinned `ConvertChart` copies its unit string without inferring one; 42 of
the 91 inline built-in charts omit that field. Native chart definitions now
accept absent/null/empty units and preserve the absence. Shared chart components
require an explicit nullable unit argument, so other callers cannot accidentally
omit an expected unit. Missing units produce an explicit disclosure, a neutral
scalar-table `Value` heading and a dimensional-compatibility warning for
comparisons. Declared metric names remain tooltip/legend identities. Scaling,
signed values, gaps and zero retain their existing semantics; a scale factor is
not evidence of a unit. Invalid nonempty declarations remain errors.

Three hosted groups/five intercepted GETs verified saved omission and reload,
an actual scalar line with neutral numeric headers, signed/zero scaling,
four named/grouped lines with dimension warnings despite bytes-like metric
names, and a declared-unit update. All samples were synthetic. The increment
passed **390 focused tests in nine files** and type/lint/i18n/build/package
checks; settings and handlers were restored with no Kubernetes writes.
Original-Go evidence remains 17,620 cases.

### Captured display bounds and spans

The pinned frontend `KChart` forwards supplied `min`/`max` as Victory domain
limits, and `Dashboard` places charts in a twelve-column grid using `spans`.
The native schema now accepts safe-integer bounds and spans 1..12, with
null/absent bounds omitted and zero/absent spans treated as full width.
Invalid/reversed bounds and invalid spans fail before a provider request.

Both scalar and comparison renderers apply bounds after unit scaling without
clamping stored samples. They disclose the requested edges, count outside
samples and retain the complete numeric table. An automatic edge expands only
when necessary to avoid an inverted/zero-width domain; declared edges never
change. Nonfinite geometry produces a display error while preserving the table.
No-bounds callers retain their existing Recharts auto-domain behavior.

Captured span values drive a responsive MUI twelve-column grid. Native cards
stack at full width below 900 pixels; this deliberately differs from the source
layout on narrow screens. Plot heights remain native defaults; upstream
row-height allocation, maximization and collapse controls are not claimed.
The source was inspected at these verified Git blob identities:
`Dashboard.tsx` `5bae5eaea3a39924d1015382e19064fbcb61b798`,
`KChart.tsx` `164795d09bfd8060ca0ce6222bd5e90b27ada58d`, and
`ChartWithLegend.tsx` `f2abf3dceb7e479b96ca2a406d68c4b4644832fa`,
all under `frontend/src/components/Charts/` at the pinned Kiali commit.

Four hosted groups/eight intercepted GETs verified settings persistence, exact
0..10 axes on all three chart paths, post-scale unclamped numeric values,
two half-width cards and full-width defaults, stacking at 800 pixels without
refetch, invalid-bound rejection, valid one-sided domains when all samples are
outside, and an unsafe-geometry error with the full table still available.
SVG errors were checked explicitly. The unitless/declared-unit fixture passed
again. The increment passed **399 focused tests in ten files** plus type/lint/
i18n/build/package gates. Samples were synthetic; settings/handlers were restored
with no Kubernetes writes. No additional Go oracle cases are claimed.

### Optional aggregation grouping and captured value filters

Chart `aggregations` now declares bounded label/display-name/single-selection
options. The source `ConvertAggregations` last-declaration-by-display-name rule
and UTF-8 sorting precede the frontend's per-label map behavior. Compatible
aliases therefore keep the last sorted display name with the original label-map
position. Native validation rejects aliases whose single-selection modes
conflict, rather than reproducing the source's inconsistent first/last alias
behavior.

Optional query `byLabels` is captured separately from fixed `groupLabels`.
The UI submits choices in option-map order on explicit load; the backend-style
builder appends them after each chart's fixed groups. Effective labels are
carried with every job/result through decoding, filter-consistency checks,
captioning and comparison rendering. Unknown/duplicate/excess labels and
histogram `le` are rejected before transport. Grouping drafts reset when the
source or selected template changes.

Observed aggregation values are display-only controls. Source-compatible
visibility excludes only explicit false values of labels that a series actually
contains; absent labels remain visible. Single-selection starts with the first
observed value, and immutable Map-based state handles arbitrary literal values
without prototype-key hazards. Filters change charts and numeric tables locally,
not server queries, captured data or authority. Hidden counts and lack of visible
samples remain distinct from empty responses. Native selections reset for each
new captured result; upstream URL persistence/cross-refresh state is not claimed.
Axis notices and numeric tables describe the currently visible series.

Bounds are eight declarations per chart, 32 distinct display-name choices,
four effective grouping labels, eight successful responses with eight series
each, and at most 64 observed values per label. Provider decoding limits remain
in force before display filtering. The pinned caller/helper sources inspected
for this increment include `CustomMetrics.tsx` blob
`2f5b936b67e0f22ea390aea7c62e30b49e0f4c5c`, `Metrics/Helper.ts`
`462d0dc7a15008b1b3b13deee7c600480a8734c2`, `MetricsSettingsDropdown.tsx`
`76be1e8051f6d5a98ee784a4b1072d8e5a00ef89`, and `TimeSeriesUtils.ts`
`697177bd5282327217bd383416b249e2313f800f` at the pinned Kiali commit.

Five hosted groups/six intercepted GETs verified saved declarations, unchecked
optional defaults, canonical request ordering, actual grouped lines, local
checkbox/radio updates without requests, empty/prototype-key values, missing-label
retention, all-hidden disclosure, first-observed single selection and reset,
preflight duplication/alias errors and corrected retry. Display-bound/layout
regressions passed. The increment passed **456 focused tests in 14 files** plus
type/lint/i18n/build/package gates. Samples were synthetic; settings/handlers
were restored and no Kubernetes writes occurred. Original-Go evidence remains
17,620 cases; these new controls are source-inspected/native-tested.

### Explicit bounded chart batches

Source templates still accept one to eight items, while resolved composition
metadata can contain up to 328 uniquely named charts within 128 KiB once bundled
and saved inputs are combined. Saved-user input remains limited separately. This keeps
all reachable chart metadata instead of dropping excess panels. An optional
captured `chartNames` selection chooses one to eight known distinct names.
Omitting it retains the legacy all-chart behavior, including the eight-expanded-
query rejection. The native UI starts with all charts selected and requires
explicit narrowing when over budget.

Only selected charts are expanded into metric/summary jobs and query-specific
grouping. Original chart indices and definition order survive selection;
unselected histograms cannot impose unused summary/bucket-label constraints.
Global aggregation declarations remain available from the full captured
definition, following their dashboard-wide scope. Source metadata validation,
include-cycle/repeated-reference semantics, request/series limits and deadlines
are unchanged. Selected-chart counts remain visible with the captured result,
and draft edits never rewrite an existing capture or replay requests.

Four hosted groups/16 intercepted GETs verified persistence of a nine-chart
composition, all/empty selection rejection, a selected histogram using an
aggregation declared on an unselected chart, original panel order, independent
chart/request bounds, an exact eight-query batch, source reset and corrected
retry. A raw-only selection also succeeded with unused histogram summaries
unchecked. Aggregation/value-filter regressions passed. The increment passed
**412 focused tests in nine files** and type/lint/i18n/build/package gates.
Samples were synthetic; settings/handlers were restored with no Kubernetes
writes. Independent original-Go evidence remains 17,620 cases.

### Opted-in pinned built-in catalog

The plugin now bundles the complete `DEFAULT_DASHBOARDS_YAML` capture from
`config/dashboards/dashboards.go`, Git blob
`cbbc6cd2ac7834b117fb11e61af613d92016b30f`, at the pinned Kiali commit.
`src/core/builtinDashboards.json` contains 21 templates and 91 inline charts;
`scripts/generate-dashboards.mjs` verifies the source blob and reproducible
SHA-256 `ef584498688cbf0cf3a7b5ffd314d45e373ad1176484cb8523691ba53a5ef35a`.
The generated capture is checked offline and in tests. No template is silently
trimmed or stripped of unsupported fields: all bundled definitions normalize,
resolve and produce a valid bounded query for every selected chart.

`includeBuiltins` is opt-in per browser/Headlamp cluster to preserve existing
saved-dashboard behavior. Saved definitions take precedence by exact name and
are listed first; the bundled copies never enter the saved user array. Resolved
references and explicit discovery retain source provenance. The source/version
is visible, and toggling the catalog invalidates captured results without replay.
All metric namespace/cluster labels and endpoint scope still require explicit
configuration; a bundled template does not prove availability or resource identity.

Saved-user limits remain twenty templates and 64 KiB. The bundled twenty-one
templates have their own 64 KiB guard; combining them permits at most 41 effective
templates and 128 KiB. Eight source items per template yield a conservative 328
resolved-chart bound. Request, sample, series and explicit chart-selection limits
are unchanged. Whole-catalog opt-out, name overrides, disable declarations and the
explicit annotation overlays below are supported; automatic app discovery remains open.

Five hosted groups issued eight intercepted metric GETs and two discovery GETs.
They verified opt-in save/hard reload with an empty saved-user array, all 21
selector entries, six Go charts with aggregation/unit metadata, source labels,
explicit bundled discovery, a bounded subset of the nine-chart Thorntail
composition, whole-name overrides and opt-out without losing saved definitions
or replaying requests. Saved-only selection regressions passed. The increment
passed **442 focused tests in 11 files**, type/lint/i18n/build/package gates and
the offline catalog check. All new positive samples were synthetic; settings/
handlers were restored, with no cluster writes. Original-Go evidence stays 17,620.

### Per-template disable declarations

The pinned `AddMonitoringDashboards` keeps a definition only if trimmed
`discoverOn` is nonempty or items exist. Saved empty/name-only declarations now
preserve that rule: missing/null items normalize to an empty list, and bounded
Go-whitespace-only discovery values normalize to absent. Empty metadata can omit
its title; active chart definitions still require a nonblank title. Unsupported
fields and malformed metadata remain errors even on disabled entries.

The effective catalog removes disabled names only after applying user-name
precedence, so a bundled template cannot silently reappear. The source declaration
remains in settings and counts toward its existing limits. Disabled names are
disclosed, dependent includes fail explicitly, and disabling is not a Kubernetes
mutation. A discovery-only definition is retained and displayed with its name
when no title exists, but loading it reports that no charts exist rather than
returning a misleading empty chart result.

Four hosted groups/six metric GETs/one discovery GET verified name-only
save/reload, disabled-builtin exclusion, dependent-include failure, named
discovery-only entries, removal/restoration and an explained disabled-only
catalog. The increment passed **409 focused tests in eight files**, type/lint/
i18n/build/package and catalog checks. Responses were synthetic, settings/
handlers were restored, and no Kubernetes writes occurred.

### Captured namespace/workload annotation overlays

The explicit annotation reader applies the pinned order: base saved/bundled
catalog, Namespace annotation declarations, then optional workload declarations.
Same-layer repeated names use the last declaration; later definitions can disable
or re-enable names. Existing effective 41-template/128 KiB limits apply after
every layer rather than being raised for each extra source.

The parser reads only `dashboards.kiali.io/templates`, with 64 KiB text/UTF-8
and normalized bounds, twenty declarations, 8,192 structural nodes and depth 16.
It uses the safe YAML JSON schema, rejects aliases/cycles and sanitizes parser
errors so annotation excerpts are not echoed. A present null/empty document is
rejected instead of reproducing the source's nil-list catalog clearing; `[]`
explicitly means no overrides. Unsupported schema fields remain errors.

Resource kind/API version/name/namespace, UID and resourceVersion are validated
before applying evidence. Deployment/DaemonSet/StatefulSet/ReplicaSet/
ReplicationController choose non-null pod-template annotations, including an
empty map, otherwise resource annotations. Pod, Job and CronJob use their own
metadata: the pinned Job/CronJob parsers deliberately do not use pod templates.
Custom-controller and VM annotation sources remain unsupported.

At most two public Headlamp reads share a captured fifteen-second deadline.
Failure of either source returns no effective overlay, never a partial success
or automatic fallback. The UI binds readiness to cluster, namespace, base settings
and the explicit resource request. Edits/reloads invalidate applied data and
block metric/discovery reads until a new capture succeeds; disabling annotation
usage is an explicit return to base definitions. Captured chart/discovery queries
retain source UID/version evidence and definition origins. These are separate
snapshots, not an atomic multi-resource read or telemetry ownership proof.

Five hosted groups issued 15 intercepted resource GETs and six metric GETs,
verifying namespace/workload precedence, Deployment empty-template masking,
Job own metadata, captured origins/UIDs/versions, denial/malformed/later-failure
blocking, sanitized parser errors, namespace-return non-resurrection and explicit
opt-out. The final timeout measured **15,103 ms** (15,544 ms in the initial run).
A separate unintercepted read captured actual `Namespace/bookinfo` and
`Deployment/reviews-v1` evidence; no fixture annotation was applied. Bundled
catalog regressions passed. Gates passed **366 focused tests in eight files**
plus a final 27-test UI rerun, type/lint/i18n/build/package/catalog checks.
Settings and handlers were restored with no Kubernetes writes.

### Application-scoped dashboard recommendations

The application detail now invokes an explicit inspection following pinned
`business/apps.go` (Git blob `9c2d919d2629fefb5d2719fcc6212a91fb55731c`)
and `business/dashboards.go` (`2707361491dc93e769f363c6bdb9122af230bd20`):
`GetCustomDashboardRefs(namespace, appName, "", pods)`, Pod-reference extraction,
resolved-reference precedence, configured discovery policy and per-runtime
last-writer replacement across sequential app-label selectors.
These new policy/evidence tests are TypeScript tests, not additional independent
original-Go executions; the existing oracle total remains 17,620.

Only narrow reference evidence is retained from Pod annotations. Each annotation
has a 4 KiB UTF-8 limit, names are bounded to 128 characters, each Pod/application
to 64 distinct names, and the application capture to 1,000 Pods/64 KiB annotation
text. UID/name/scope/version, workload labels and captured Pod ownership coverage
are checked. Malformed annotations are local evidence failures, not a failure of
the general relationship snapshot and not a successful empty reference list.
Positive refs can remain visible on partial supported-source snapshots; fallback
requires complete correlation. VM entries remain separate from Pods.

The Namespace overlay is mandatory for this application caller; workload
overlays are not passed. A denied or malformed Namespace source blocks the
whole inspection. Auto defaults to a ten-observed-Pod threshold; enabled
bypasses it and disabled suppresses metric fallback only. Explicit native
invocation, bounded settings and no background fan-out are intentional deviations
from the backend caller.

The default canonical/recommended/legacy app selectors retain their source
order; a complete custom app/version pair selects only the app key. Metric-label
sanitization preserves punctuation-to-underscore mapping without repairing an
invalid first character. Protected scope collisions and invalid mapped labels
fail before transport. Version is deliberately empty for applications. Three
selector requests at most share the Namespace read's fifteen-second deadline.
Provider failures stay visible beside successful candidates; expiry cancels
the whole capture instead of returning a success-shaped partial result.

Embedded charts use the captured effective catalog, Namespace UID/version,
endpoint, end instant, namespace/cluster labels and app equality filter.
Discovery supplies the winning runtime selector; explicit references require
a user choice if multiple label conventions exist. Existing composition and
chart/metric/summary limits remain unchanged. Settings, workload identity/version
and Pod-reference changes invalidate captures without replay or resurrection.
No recommendation establishes runtime, telemetry ownership or health.

Verification passed **429 focused tests in ten files**, type/lint/i18n/build and
catalog/resource/parity checks. Six stock hosted groups observed 78 intercepted
resource GETs and 12 metric GETs, covering explicit/discovered precedence,
runtime replacement, scoped embedded charts, settings invalidation, auto/
enabled/disabled policies, Namespace denial, malformed annotations and the
**15,081 ms** deadline with retry. An unintercepted Bookinfo read captured three
owned reviews Pods and Namespace evidence (11 resource GETs). A separate
Settings UI exercise retained discovery-only policy through a hard reload.
No cluster writes occurred; settings/interceptors were restored. Desktop and
workload-specific recommendations remain open.

### Captured sort-label series ordering

Charts now accept `sortLabel` and optional `sortLabelParseAs: "int"`, following
the pinned `business/dashboards.go` grouping/conversion caller and
`models/metrics.go` (Git blob `0244185be0f0c5947a9bf7d28a83749b2ce62ef7`).
The sort label is added after fixed/optional query groups only when absent.
Only automatically added sort labels are removed from displayed labels.
This extra query dimension counts toward the existing four-label budget and
does not increase the eight-series/expanded-request limits.

Ordering is ascending UTF-8 lexical or exact signed 64-bit decimal comparison,
without converting integer text to JavaScript floating point. Sorting occurs
independently for each metric and histogram summary. Legend/table conversion
retains that order, including after local display filtering; unsorted charts
retain their previous canonical label ordering. Captured inputs and sample
timestamps/values are never mutated, merged or re-aggregated.

Native guards intentionally differ from upstream's ignored `strconv.Atoi`
errors: missing/invalid/out-of-range integer values fail the affected chart,
rather than sorting them as zero or saturated extrema. Equal keys keep the
observed order. Removal of a sort-only label must not produce indistinguishable
displayed groups; that is an explicit error with guidance to retain the label
in `groupLabels` or narrow the query. Query scope consistency is checked before
removing hidden labels.

Five stock hosted scenario groups made nine intercepted metric GETs and proved
lexical/integer ordering in both legend and numeric table, exact ordering above
JavaScript's safe-integer range, fixed sort-label retention, independent
histogram ordering, failure/recovery and local keyboard display filtering.
Every reload awaited its new response; wide-integer fixtures used distinct
series identities to exclude a stale-result false positive. The application
dashboard regression also passed (78 resource/12 metric GETs, 15,052 ms deadline).
Settings and routes were restored with no cluster writes. Source/helper/caller
tests are TypeScript evidence, not new original-Go oracle cases.
The final increment passed **380 focused tests in eight files** plus
type/lint/i18n/build/package and catalog/resource/parity checks.

### Workload-specific dashboard recommendations

The new `/kiali/workload-dashboards` inspector follows pinned
`business/workloads.go` (`e0b704c0b299d19b50fbe9ae1d19cab1272a15cc`) and
`config/config.go` (`fbde570684b760495782fce1df801d9c0046723e`):
`GetWorkload` passes both selected app/version values and the workload to the
dashboard service. App/version selectors use the three paired conventions,
or one configured pair; selected values are not inferred from other Pods.
An empty/missing version omits its constraint. Collisions after metric-label
sanitization fail explicitly.

The supported eight Kubernetes kinds use the existing bounded correlation
reader. A read-only projection roots ownership at the selected resource UID,
allowing child ReplicaSet/Job and managed Pod inspection without inheriting
ancestor/sibling Pods. Original owner metadata is preserved. Linked UID changes,
missing identity/version, malformed references and unsupported app-label scope
remain errors. Incomplete supported-source evidence can retain positive refs,
but cannot initiate absence-based discovery. This is not complete arbitrary
custom-controller workload attribution.

Shared inspection applies Namespace then workload annotation overlays, checking
the workload source against the captured UID/resourceVersion before resolving
refs or querying metrics. Controller template-map precedence and Job/CronJob/Pod
own-metadata semantics remain unchanged. No Namespace/base fallback is allowed
on denied or stale workload reads. The explicit ownership phase and subsequent
annotation/discovery phase each share a fifteen-second deadline, not a separate
deadline for every request. Captured chart queries preserve the winning or
explicitly chosen app/version pair and source evidence.

Workloads and associated application-workload tables add UID-bound links without
replacing native resource-name links. This inspector intentionally does not
duplicate spec/status/conditions/events; those remain native resource details.
VM/custom-controller annotation sources are explicitly unsupported. Application
recommendations still use no version or workload overlay.

Verification passed **175 focused tests in twelve files**, type/lint/i18n/build,
resource/catalog/parity checks and five stock hosted scenario groups:
78 intercepted resource GETs, twelve metric GETs and a **15,251 ms** deadline.
Cases covered child ownership, app/version scope, workload-over-Namespace
precedence, Job metadata, denied/stale source blocking, refresh/retry and
non-resurrection. An actual Bookinfo application-to-workload link captured
`Deployment/reviews-v1`, its one owned Pod, app/version and Namespace/workload
source identity in 22 unintercepted resource GETs. Application regressions
passed separately (15,049 ms deadline). No Kubernetes writes occurred.

### Captured chart expansion

The pinned frontend `components/Charts/Dashboard.tsx` has a transient maximized
chart state. The native equivalent now opens one captured panel in a labelled
MUI dialog instead of replacing the entire dashboard grid. It reuses the same
panel renderer and adds no data loader. Existing scalar/comparison heights
remain 220/260 pixels; the expanded plot is 520 pixels with vertical dialog
scrolling on constrained screens. This is an intentional native presentation,
not complete upstream row/viewport-layout parity.

Expansion retains captured namespace/cluster/time/equality filters and current
sort/value-filter state. Errors, signed/zero values, units and display bounds
are rendered identically. Query/source changes invalidate the dialog; closing
does not refetch or resurrect prior results. Only the expanded instance of the
panel is mounted, and Escape/Close restores focus to its unchanged expand
control. MUI owns modal focus trapping and accessible title association.

The increment passed **51 focused tests in five files** and type/lint/i18n/build,
catalog/resource/parity checks. Five hosted groups issued only four metric
GETs (initial load and explicit reload), measured scalar height **220→520 px**,
and verified grouped sorting/filtering, negative/zero numeric values, scope
display, source invalidation, error panels and keyboard trap/restore at a
720×600 viewport without horizontal overflow. The workload regression also
expanded captured app/version charts without increasing its twelve metric GETs
(78 resource GETs, 15,228 ms inspection deadline). No cluster writes occurred.

### Captured time-axis plot styles

The optional chart `chartType` now accepts the pinned `KChart.tsx`
(`164795d09bfd8060ca0ce6222bd5e90b27ada58d`) choices: line, area, bar and scatter.
Missing/null/empty retains the native line default. Unknown styles fail
validation rather than the upstream switch's silent line fallback. The native
reader still does not create source/destination reporter-paired envelopes or
infer area rendering from paired values.

Style is preserved through definitions/includes/annotation overlays and captured
jobs without changing raw/rate/histogram PromQL or request counts. The shared
render primitive keeps named/grouped series independent: bars are side by side,
areas are unstacked, and scatter is rendered as point-only line primitives to
retain the existing time-axis tooltip and null handling. Values and numeric
tables are not rescaled or recomputed for the chosen presentation. Expansion,
sort order, local filters, units and bounds use the same captured panel.
Scalar line/area plots now also mark isolated finite samples separated by gaps,
not only the special case of a single finite sample in the entire result.

Verification passed **385 focused tests in ten files**, including all four styles
across raw/rate/histogram query plans, plus type/lint/i18n/build and catalog/
resource/parity checks. Three hosted scenario groups rendered eight scalar/
grouped charts with eight metric GETs, verifying actual filled paths, point
counts, absent connecting strokes, distinct non-stacked bar positions, unchanged
negative/zero/unavailable numeric rows, sorting and expanded styles without
refetching. Existing expansion/focus/narrow-screen regressions also passed with
four metric GETs. No cluster writes occurred. Row/viewport layout remains a
separate gap; series-category support follows below.

### Captured series-category axes

The chart `xAxis` now accepts `time` and `series`. The series projection follows
`toVCSinglePoint` in pinned `VictoryChartsUtils.ts`
(`c299b98a5e90ef91fbadb4d89bf893574e965fa1`) and independent category placement in
`ChartWithLegend.tsx` (`f2abf3dceb7e479b96ca2a406d68c4b4644832fa`).
Each series selects its latest finite sample within the existing bounded
range; it does not change PromQL, fetch an instant value, interpolate, sum or
average across samples/series. Sample times remain explicit and differing
times produce a warning.

Unlike the upstream empty-array reduction, all-unavailable series remain
explicit unavailable rows/categories with no invented value or timestamp.
Zero, signed values, source order/colors and original data are retained.
The existing bounds/units/sort/local-filter/expansion pipeline applies. Hidden
series are removed locally before category placement without refetching.
Numeric tables show the selected timestamp and value, not a misleading common
range-end timestamp.

An omitted/null chart type uses the source default bar for series axes and line
for time axes. An explicitly empty chart type is normalized to **line**, not
omitted: the pinned frontend's default switch case differs from its missing-type
axis default. Unknown type/axis names still fail validation. Explicit
line/area/point categories are rendered independently, with no segment or filled
region joining different series. Reporter-paired envelopes remain unsupported.

The increment passed **408 focused tests in twelve files** plus type/lint/i18n/
build and source/catalog/resource/parity checks. Three hosted groups rendered
six category panels with six metric GETs, verifying exact older sample times,
latest zero/negative values rather than averages, all-missing rows, sort order,
default/empty type semantics, independent actual SVG geometry, expanded samples
and local filtering without new requests. Eight-chart/eight-GET time-axis style
regressions also passed. No cluster writes occurred.

### Captured chart visibility

Chart `startCollapsed` now accepts a boolean and preserves explicit true/false
through definitions/includes. Omitted/null keeps the normal expanded default;
invalid types fail validation. The pinned `KChart.tsx` consumes this flag in its
initial collapsed state. The native UI additionally provides explicit local
Show/Hide controls rather than relying on upstream's data-empty transitions to
reveal content.

Visibility is scoped to the captured result and original chart/summary key.
It never skips requests, modifies values, hides read errors/warnings, or raises
the eight-expanded-query budget. Unavailable scalar notices remain exposed even
when the plot/numeric table is collapsed. Histogram summaries toggle separately.
Expansion can inspect a collapsed panel and returns to its previous visibility;
local value filters survive hiding/showing. New captures or source changes
discard local visibility instead of applying it to unrelated data. Controls have
named buttons with `aria-expanded` and an associated controlled plot region.

Verification passed **421 focused tests in thirteen files** plus type/lint/i18n/
build and catalog/resource/parity checks. Four hosted groups issued exactly
eight metric GETs per explicit load (sixteen total across a reload), proving
initial flags, keyboard controls, unchanged errors/warnings/missing-data
disclosures, independent histogram toggles, filtered category restoration,
collapsed-panel expansion and capture reset. Six-chart category-axis regressions
also passed. No cluster writes occurred.

### Captured dashboard row sizing

Template `rows` follows the pinned configuration and response models, including
the `< 1` default of two in `business/dashboards.go`
(`2707361491dc93e769f363c6bdb9122af230bd20`). Configuration declarations are pinned
at `config/dashboards/dashboards_config.go`
(`1eace997db22287475c17be2763c838334f1304e`); the height formula comes from
`frontend/src/components/Charts/Dashboard.tsx`
(`5bae5eaea3a39924d1015382e19064fbcb61b798`). These files and the frontend model
were checked against their exact source blobs.

The native plot calculation retains the sixteen-pixel gap, floor operation and
150-pixel minimum. Expanded plots use one viewport. Unlike upstream's measured
parent container, native sizing uses the browser viewport and leaves captions,
controls, errors and numeric tables in normal flow. This is intentionally a
plot-height preference, not pagination, grid row spans or exact upstream
container layout. The frontend `rowSpans` declaration is not consumed by that
renderer or supplied by its custom-dashboard backend; it remains unsupported.

Explicit safe-integer rows enable the captured layout; nonpositive values
normalize to two. Omitted/null metadata preserves existing natural heights
unless the user enables the local two-row control. A new capture resets the
control, and changes to viewport height never replay metric requests. The
selected template owns the preference; included templates do not replace it.
Saved, bundled and Namespace/workload annotation definitions share validation,
and data capture clones the preference before awaiting. Invalid rows fail before
transport. This affects no query, chart-selection or expanded-request budget.

Four stock-hosted groups measured 322, 189, 150 and 289 px plots at different
viewport heights, checked narrow-screen stacking, keyboard toggle/expansion,
independent errors and real Settings save/hard-reload normalization. Three
explicit captures made five metric GETs each; layout actions added none.
Existing visibility and workload/application-inspection regressions also passed.
The increment passed **433 focused tests in ten files**, type/lint/i18n/build
and resource/catalog/parity checks. The preceding full-suite checkpoint remains
21,932 tests in 178 files; it predates this increment.
This is source-inspected TypeScript/UI evidence, not a new Go-oracle count.

## Additional traffic counter signals

The native `/kiali/signals` explorer adds eight simple rate families from the
pinned `business/metrics_definitions.go`: request/response throughput, gRPC
sent/received messages and TCP sent/received bytes plus opened/closed
connections. Raw names and units are displayed. The source's intentional L4
mapping is retained: `tcp_sent` reads `istio_tcp_received_bytes_total`, and
`tcp_received` reads `istio_tcp_sent_bytes_total`. The original metrics-page raw
TCP query remains unchanged and now discloses the distinction.

`scripts/parity/traffic-signals-oracle.mjs` checksum-verifies the definitions and
`prometheus/metrics.go`, then executes the original `fetchRateRange` builder for
108 selection/scope cases, including all signals and escaped identities.
Independent original-Go evidence now totals **16,176 cases**; finding coverage
remains **35 bounded codes**.

`core/metricRanges.ts` and `data/metricRanges.ts` share scalar-response validation
and captured three-worker reads with histograms. They reject extra aggregation
dimensions, multiple series, out-of-range/oversized matrices and negative
finite values, with early shape/size rejection before full sample decoding.
Input, endpoint and jobs are captured; cancelled/expired reads do not start
queued work. Histograms retain their previous messages and query behavior.
Each signal uses one reporter, five-minute rates, 15-second samples and a
5/15/60-minute display window; manual/historical submission remains explicit.

Five hosted scenario groups observed real Bookinfo request/response throughput
with one series and **61 zero samples per panel**, not positive throughput.
Nineteen signal reads were intercepted for eight-signal output, raw mapping,
units, null/empty versus zero, independent errors, historical workload scope,
draft/identity invalidation, **15,056..15,070 ms** deadlines and explicit retry.
Measured peak concurrency was three; timeout started no queued jobs.
The prior histogram hosted fixture also passed after extraction, retaining its
real no-finite-sample result and five synthetic summary responses.
Settings/handlers were restored and no writes or traffic generation occurred.
The existing metrics page's raw-TCP disclosure was also inspected without
changing its query.
Gates pass **17,811 tests in 141 files**. This expands metric families, not full
custom-dashboard/query/default, multi-reporter or Desktop parity.

## Telemetry and health request lifetime

The exported metric, workload-health and entity-health readers now capture
scope, normalized Service endpoint, query and custom configuration before any
deferred work. This protects later counter batches and Application reads from
caller mutation, independently of the UI capture guards. Each entire read has
a linked 15-second deadline. Completed per-panel/source errors retain their
existing classifications; timeouts reject the attempt without empty/healthy
fallbacks or retained result panels.

Tests verify all four reader paths, including Application label capture,
mutated query/config objects, exact child-signal propagation and SDKs that
ignore abort. Four hosted scenarios measured **15,078 ms** for metrics,
**15,054 ms** for workload health, **15,064 ms** for Service health and
**15,092 ms** for Application health. Explicit retries then produced the normal
empty-data disclosures. Eighteen metric GETs were intercepted; real Bookinfo
resource reads remained read-only and settings were restored. Gates pass
**16,280 tests in 122 files**.

## Configuration read lifetime and input capture

`loadValidationSnapshot` now captures cluster identity, specification and
registry settings before deferring context work, and uses the shared 15-second
deadline helper. This closes the mutable-scope/queued-read risk and prevents a
hung source from leaving configuration checks running indefinitely. Completed
reads retain their existing per-source failures and partial coverage; timeout
rejects the attempt without a validity/absence claim.

The deadline owns a child AbortSignal linked to caller cancellation. Tests now
assert this borrowed-signal contract, including exact shared child identity,
early caller cancellation, no queued reads after cancellation and SDKs that
ignore abort. Original source-function oracles and semantic checks are unchanged.
The hosted delayed-Namespace scenario measured **15,051 ms**, displayed the
timeout, permitted an explicit successful retry, and cleared old findings after
a subsequent denied read. Three Namespace GETs were intercepted and no writes
occurred. Gates pass **16,273 tests in 121 files**.

## Gateway API listener/address collisions

`core/gatewayCollisions.ts` adds active KIA1501/KIA1502 alongside existing local
KIA1503. The pinned `k8sgateway_checker.go` invokes
`k8sgateways.MultiMatchChecker`; the port preserves exact hostname/port/protocol
and explicit address-type/value comparisons. Nil hostnames/types and empty
address values do not match. Wildcards are literal, not expanded.
Same-named Gateways are excluded even across namespaces, matching the actual
caller instead of silently correcting its name-only exclusion.

Complete bounded Gateway evidence and selected UID/relevant-field freshness
are required before cross-object findings. Shared identity validation rejects
duplicate objects; malformed or oversized inputs defer rather than emit partial
collision conclusions. Limits are 1,000 Gateways, 64 listeners/16 addresses
per object and 20,000 total entries. Indexes retain per-object deduplicated
references without quadratic peer scans. Duplicate address checks merge into
one finding at the pinned path. Related links distinguish Gateway API Gateway
from Istio Gateway and disclose observed UIDs.

The new oracle executes the original checker, helper functions and model
merge routine for **508 cases**, including KIA1503 interactions and deduplicated
reference identities. Source hashes are checked before Go execution with
module/network lookup disabled. Total independent original-Go evidence is now
**14,928 cases**, and active coverage is **34 bounded codes**.

Eleven hosted cases covered conflicts, literal wildcard/protocol/address
differences, nil fields, same-name exclusion, denied lists, stale UID/spec and
suppression. Eleven Gateway lists were intercepted; no API or Gateway was
installed and no live writes occurred. Group-safe references were inspected.
Gates pass **16,269 tests in 120 files**. These are configuration-pattern
findings, not proof of listener attachment or address allocation.

## Gateway API class registry and KIA1504

`core/gatewayClassRegistry.ts`, the existing validation reader and per-cluster
settings now implement registry-backed KIA1504. Explicit `{name,className}`
entries take priority without class-list reads. Otherwise the bounded
cluster-scoped GatewayClass collection is filtered by an equality-label map and
the pinned `istio.io` controller prefix rule. A nonempty selector allows matching
non-Istio controllers. The literal prefix rule includes `istio.io-other`; it is
not silently strengthened to a controller-domain equality test.

An empty successful selection uses pinned `istio`/`istio-remote` defaults,
which are registry entries, not evidence that corresponding objects exist.
Conditional `istio-east-west` and `istio-waypoint` memberships remain unresolved
without configured mesh-client count/ambient evidence across the mesh.
Findings for those two names are deferred rather than guessed. Denied, absent,
malformed and incomplete discovery remains unavailable instead of using the
upstream error-to-default behavior. Invalid configuration is rejected visibly
rather than skipped. These are deliberate native visibility safeguards.

The UI shows the resolved source, class entries and unresolved defaults.
Configuration limits are 100 classes and 100 equality-label entries; collection
resolution is bounded to 1,000 records. Invalid/missing Gateway class identities
do not request irrelevant source reads. Settings and API objects are captured
before deferred work. Existing ignore annotations suppress KIA1504 normally.

`gateway-class-oracle.json` independently executes 64 original-Go membership
cases from `gatewayclass_checker.go`, with caller/model/cache source hashes
verified. Registry selection/fallback tests are source-informed; they do not
execute the original cache or prove controller acceptance. This raises original
Go evidence to **14,420 cases** and the active set to **32 bounded codes**.

Sixteen hosted scenarios passed, including settings save/reload, configured/
discovered/selector/default sources, conditional deferral, denial, incomplete
pagination, malformed scope/data and absent API. Twenty-two class lists were
intercepted; no cluster writes occurred. Browser settings were restored exactly
and all interceptors removed. The current tool server lacked its code runner,
so verification used isolated session-local Playwright tooling and the installed
Chrome against stock hosted Headlamp; production dependencies were unchanged.

## Host and bounded reference-validation increment

`core/hosts.ts` ports the pinned parse/get/format/gateway/filter/normalization and
wildcard functions. `host-oracle.json` independently executes 627 original Go
cases, including namespace-sensitive short names, external names, custom DNS
suffixes and wildcard label boundaries. DNS identity is separate from Headlamp
and metric cluster identities, and is never guessed from either.

KIA1107 checks missing subsets only with an explicit DNS suffix and complete
namespace/DestinationRule/Sidecar collections. Its initial blanket Sidecar
deferral has been replaced by the namespace-wide import/export slice below;
full per-workload and registry visibility are not claimed. Alias-aware KIA1105 uses the same host core when
namespace/domain context is known, otherwise checks only identical raw hosts and
reports the limitation. Tuple keys deliberately avoid ambiguous string-concat
collisions. KIA1503 covers the pinned local listener uniqueness rule; KIA1601
requires complete namespace discovery. All checks retain ignore annotations,
severity and field paths. Selector absence still defers in the UI.

`data/validation.ts` reads only needed sources, at most three simultaneously,
with 250-item pages and a four-page bound. Forbidden, malformed, repeated-token,
changed-version and truncated reads remain incomplete. The live check caught
valid NamespaceList items omitting kind/apiVersion; the decoder now inherits
only the validated envelope type and rejects conflicting item metadata.

Hosted verification used synthetic input resources, real namespace/empty Istio
lists, an intercepted matching DestinationRule, and an intercepted Sidecar 403.
The missing/present/unknown outcomes and KIA1503/KIA1601 severity/paths rendered
correctly, with no plugin execution failure. The temporary DNS setting was
restored. No test resource or annotation was applied to the cluster.
Checker cases remain source-derived tests, **not** a full independent checker
oracle; the host and health functions have the independent Go oracles.

## Namespace-wide Sidecar imports and exports

`core/importScope.ts` ports the pinned namespace-wide Sidecar resolver/matcher
and runtime export helper. `parity/import-scope-oracle.json` independently
executes 760 original Go cases, with source hashes checked by its generator.
Coverage includes local-over-root precedence, selector-less/empty-selector
handling, namespace/DNS wildcards, exclusions, external hosts and reverse
matching only for applicable config wildcards. The low-level port preserves
first-match behavior; its validation consumer refuses multiple applicable
namespace-wide Sidecars instead of making an arbitrary choice.

KIA1107 now applies only when at least one VirtualService host is imported,
and searches imported/exported DestinationRules. Namespace-wide imports do not
evaluate workload-selected Sidecar overrides. Ambient source namespaces bypass
Sidecar filtering and retain the pinned same-namespace export restriction.
KIA0005 checks explicit export namespaces on VirtualService, DestinationRule and
ServiceEntry, with the original code/severity/path and ignore-annotation handling.

Mesh inventory projects the three default export lists, using local-over-shared
precedence without claiming effective runtime defaults in the inventory.
Validation resolves controller/root/default fields only from complete,
unambiguous namespace/revision/controller evidence and resolved configuration.
Missing configuration, conflicting controller choices, unresolved discovery
selectors or root Sidecars defer affected references. An omitted export list
means the default only after the relevant mesh configuration resolves.

The pinned validator intentionally includes exports to nonexistent namespaces
so their own diagnostic remains visible; this differs from runtime
`IsExportedTo` visibility. The port keeps those functions separate and never
treats validator inclusion as authorization. Missing subsets can still be
reported when no matching candidate exists anywhere in a complete snapshot.
Limits add 200 subset destinations, 100 listeners/1,000 hosts per Sidecar and
10,000 import hosts across the validation context.

Eight hosted scenarios used intercepted resources against real namespace and
controller/configuration reads: private/public exports, root exclusion/local
override, conflicts, mesh-default exports, configuration denial and invalid
export namespaces. Every expected finding/deferral rendered without a plugin
execution error. Additional mesh ConfigMap responses were intercepted only for
the default/denial cases; no resource was changed in the cluster. Temporary DNS
settings were restored. The real mesh view displayed the three unset export
lists as Not reported, retaining the actual shared-ConfigMap 404.

Per-workload imports, custom/external discovery, registry visibility, advanced
mesh sources and Desktop evidence remain open.

## HTTP/gRPC Gateway route references

`core/gatewayValidation.ts` adds KIA1401/KIA1402 for HTTPRoute and GRPCRoute,
following the pinned `no_k8sgateway_checker.go` and `no_host_checker.go` families.
Reference traversal is shared with native links and additionally covers mirror
backends. API defaults distinguish Gateway parents from core Service backends;
Gateway identities use exact namespace/name rather than DNS-host alias parsing.

The caller audit is against Kiali v2.33.0 (baseline
`0e8be887b8217bbcac5e3ae0bfcd258073949cca`). Its
[`K8sHTTPRouteChecker`](https://github.com/kiali/kiali/blob/v2.33.0/business/checkers/k8shttproute_checker.go)
and
[`K8sGRPCRouteChecker`](https://github.com/kiali/kiali/blob/v2.33.0/business/checkers/k8sgrpcroute_checker.go)
activate only `NoK8sGatewayChecker` and `NoHostChecker`. Those callers consume
HTTPRoute/GRPCRoute v1, Gateway v1, and ReferenceGrant v1beta1. The native models
also expose HTTPRoute v1beta1, so running the same reference predicates for that
model version is a native extension, not evidence of pinned v1beta1 parity.
TCPRoute, TLSRoute and UDPRoute have schema/resource models but no route-checker
caller in this baseline. Their relationship findings remain disabled; the
regression test prevents model availability alone from activating checks.

The active parent predicate resolves exact Gateway group/kind/name and defaults
the parent namespace to the route namespace. Same-namespace parents need no
sharing rule. A cross-namespace parent is accepted when any Gateway listener has
`allowedRoutes.namespaces.from: All`, or a non-null `Selector` matching the
complete route-Namespace labels; an omitted/`Same` rule does not allow cross-
namespace sharing. This predicate does not evaluate `allowedRoutes.kinds`,
parent section/port selection, listener protocol, hostname intersections, or
route/Gateway status conditions. These remain gaps rather than inferred
attachment success or new findings.

The active backend predicate covers Service-kind parent references and rule
`backendRefs`; Service existence is checked in its effective namespace and a
cross-namespace reference requires a ReferenceGrant from the route kind/group.
The native traversal also inspects request-mirror backends, and its grant matcher
requires exact source/target groups and kinds plus an optional exact target
name, which is stricter than the pinned helper. These differences are bounded
native behavior, not a claim of exact checker parity. Service backend port
validity remains unevaluated.

Cross-namespace Gateway sharing supports matchLabels and matchExpressions via
the reusable bounded selector decoder. Missing/forbidden collections and invalid
selectors defer conclusions. Service references require complete Service
evidence; cross-namespace permission requires a complete ReferenceGrant list.
Deliberately stricter than the pinned `HasMatchingReferenceGrant`: source/target
groups and optional target names must match, not only kinds/namespaces.
When the Service exists but permission is missing, KIA1402 explains the
ReferenceGrant denial rather than falsely saying the Service name is absent.

Limits are 200 route references and three simultaneous source readers, each
with four 250-item pages. Cross-namespace Gateway checks require complete
Gateway and Namespace evidence; Service checks require complete Service
evidence, and cross-namespace Service checks also require a complete
ReferenceGrant list. Selected HTTP/gRPC route evidence is captured on its exact
cluster/API version and re-read after supporting sources; UID, resourceVersion,
and spec must still match. The re-read shares the 15-second deadline and abort
signal, and stale or changed captures fail instead of returning findings. Other
unsupported groups/kinds remain explicitly unevaluated. Listener attachment,
section/port selection, protocol/hostname intersections, backend port validity,
controller acceptance, and TCP/TLS/UDP/inference route validation are not
claimed.

Nine hosted HTTP/gRPC scenarios exercised missing/shared parents, selector
matching, wrong grant groups/names/kinds, denied grants and invalid selectors.
Gateway API discovery/resources were intercepted; Service and Namespace reads
were real. No Gateway API or resource was installed. Named controls and findings
rendered without a plugin execution failure, and real absence returned after
handlers were removed. Tests are source-informed, not an independent Go checker
oracle; Desktop and populated live-Gateway evidence remain open.

The selected-object revalidation increment passed 45 focused tests in two files,
and the full suite passed 22,605 tests in 189 files with one worker. Two
concurrent/default-worker attempts encountered distinct unrelated 5-second test
timeouts; each affected test file passed when rerun alone. Type-check, lint and
production build passed. A fresh stock Headlamp run was not available: no CDP
listener was present on `:9222`. Therefore this increment's contribution
rendering, browser console, i18n and accessibility tree remain unverified; the
earlier hosted scenarios do not close those gates.

## Local helpers, outbound mode and Gateway conditions

`core/localValidation.ts` adds KIA1007 for omitted Sidecar outbound mode and
GWAPI condition-derived warnings.
Port-name and Gateway-condition predicates are independently checked against
564 original-Go cases. The port matcher retains pinned TCP/UDP exceptions and
prefix behavior, including the source regex's trailing-dash acceptance.

An activation audit found that `service_entry_checker.go`
(`9fc6c7b60be852f113a3696e19862831566a11d8`) and `gateway_checker.go`
(`f12fc368f401076f10a084662f66ef778e427da1`) do **not** enable their port-naming
helpers. The earlier native ServiceEntry KIA0601 enforcement was therefore
removed; helper tests remain as isolated parity evidence, not proof that a
checker should run. That correction reduced coverage to sixteen codes;
the ServiceEntry conflict increment below adds two active codes.
The separate Kubernetes Service `PortMappingChecker` does emit KIA0601, with
mesh-membership, appProtocol and other guards; that runtime integration is not
implemented by reusing the disabled CRD check.
The correction passed 9,516 tests in 80 files. A hosted intercepted
ServiceEntry with an arbitrary HTTP port name retained its supplied fields
and produced no KIA0601 finding; the UI still states that limited checks are
not a validity or health verdict. No fixture was written to Kubernetes.

The native JSON consumer intentionally does not mark explicit ALLOW_ANY or
REGISTRY_ONLY values ambiguous merely because a Go enum may have value zero.
An omitted mode still surfaces the pinned Unknown-severity finding. Unknown
numeric/string modes are reported as unevaluated rather than guessed.

Gateway conditions require the resource's current generation and matching
observedGeneration. Missing/stale/future/Unknown evidence is deferred. Pinned
benign Pending/listener-validation/address-pending states are not mislabeled as
spec errors. Nested listener paths identify their actual status/conditions entry
instead of the pinned checker's incorrect root path. Limits are
100 conditions per list, 64 listeners and 1,000 checked conditions overall.

Earlier hosted fixtures verified the now-removed port error, absent-vs-explicit
outbound mode, current Gateway/listener warnings and stale suppression, without
any writes. Gateway API discovery/resources were intercepted because that API
is absent. The core predicates have a Go oracle; native freshness/presence
safeguards have separate source-informed tests. Full controller health is not inferred.

## ServiceEntry host/port conflicts

`core/serviceEntryValidation.ts` implements the active KIA1211/KIA1212
multi-match checks. Both are **warnings**, matching the pinned descriptors.
The actual caller in `business/istio_validations.go` first applies namespace
exports/defaults and ambient export behavior; `service_entry_checker.go`
then filters whole ServiceEntry objects by Sidecar imports before grouping.
Importing any host retains the complete object, not just that host. Native
tests explicitly distinguish those behaviors.

`validationScope.ts` extracts the existing namespace import/export helpers
without changing DestinationRule/subset behavior. The validation reader now
collects complete ServiceEntry, Namespace and Sidecar lists, preserving UID
and cluster provenance with the existing three-worker bound. Per-source
namespace mesh defaults are loaded where needed. Missing defaults, limited
imports without a DNS domain, conflicting Sidecars, incomplete sources and
missing/stale selected UID or relevant spec defer evaluation.

Grouping uses case-insensitive exact hosts and protocols, port numbers and
original port indexes. It does not conflate distinct wildcard patterns or
guess overlap. The original Go grouping and protocol-classification functions
produce **398 independent cases** from
`business/checkers/serviceentries/multi_match_checker.go`
(`aa11fd0e2607cea9a4d62d769f74dff14fe1d3af`). The oracle records groups at the
original output callback; it does not independently cover the full export/
import pipeline or validation merging. Source-defined messages/severities are
also pinned to `models/istio_validation.go`
(`d13e0b576e9392cb7e19578c05a07f2641efc054`).

Bounds are 1,000 records/source, 100 hosts and 100 ports/object, 20,000 aggregate
host/port fields, 10,000 grouping contributions and 10,000 reference-evaluation
steps. Host/protocol normalization is intentionally limited to bounded ASCII
strings; unsupported Unicode is deferred rather than approximating Go casing.
Duplicate list identities and overflowed evaluations cannot emit partial
findings. Peer identities are deduplicated and retain namespace/name/observed
UID in a paginated, named dialog; links use the captured Headlamp cluster.
Navigation is name-based, not permanently UID-bound.

Six hosted fixture cases covered equal/different protocols, private exports,
ignore annotations, denied lists and stale UIDs, including peer navigation.
A subsequent keyboard-open/Escape-close check verified the full-width dialog;
the initial nested table was replaced because it clipped related identities.
No objects were created and interceptors were removed afterward. Actual
positive cluster fixtures and new Desktop evidence remain open.
Current coverage is **18 bounded finding codes**, with **9,937 tests in 82
files** and **9,129 independent original-Go cases**.

## DestinationRule host/subset conflicts

`core/destinationRuleValidation.ts` adds active warning KIA0201 at `spec/host`.
The checker normalizes hosts with the existing source-pinned host helpers,
honors wildcard suffix boundaries, handles absent subsets as the upstream
all-subset marker and retains input ordering for the source's literal `~`
edge case. Duplicate subsets within one rule do not become cross-rule conflicts.
The pinned `FilterAutogeneratedDestinationRules` is a no-op; no name-based
exclusion is invented.

Only exact `*.local` or `*.{rule namespace}.{identity domain}` hosts with
top-level `ISTIO_MUTUAL` are exempt. A wildcard targeting a different namespace,
or a similar host with another TLS mode, is still evaluated. The original Go
checker, host normalization, subset handling, wildcard and default-TLS helpers
produce **1,087 independent conflict-pair cases**, recording pairs at the source's
output callback. Primary checker blob:
`e91bf464b354f2d9d3da8908bb6228f7abe4c81f`.

The runtime uses complete Namespace/DestinationRule/Sidecar evidence, explicit
DNS identity, namespace exports/defaults, ambient export behavior and Sidecar
imports. Selected UID and relevant spec must match the collected object.
Shared namespaced-identity and export helpers preserve the ServiceEntry path.
Readers retain their 1,000-record/source bound; matching permits 100 subsets/
rule, 10,000 subsets overall and 20,000 pair comparisons. The normal detail
workflow compares only the selected owner against peers. Partial, malformed,
stale or over-budget data cannot emit a truncated conflict verdict.

Eleven hosted intercepted cases verified aliases, related-rule navigation,
different/all subsets, ordinary versus exempt wildcard TLS rules, suffix
boundaries, private exports, stale identity, denied lists and missing explicit
DNS identity. The temporary DNS setting was restored durably and all handlers
removed; no rule was written. Coverage is now **19 bounded finding codes**.
The full suite passed **11,162 tests in 86 files**; independent original-Go
evidence totals **10,288 cases**. Traffic-policy override analysis and full
DestinationRule semantic/operational parity remain open.

### DestinationRule TLS override patterns

KIA0204 is now wired through the same captured visibility context. The source
`traffic_policy_checker.go` (`6d3133c9c64f632dd31b81d064d8ef8571fa100f`) uses
`ParseHost`, not the broader host-alias resolver, for this check; that distinction
is retained. It considers visible non-local `ISTIO_MUTUAL` defaults and explicit
same-host/namespace-wildcard TLS peers. Only absent top-level **and** port-level
TLS settings produce the warning. An empty TLS object or `DISABLE` still counts
as supplied settings, whereas subset-only TLS does not.

The original checker and helpers produce **1,800 independent cases**, including
deduplicated related identities. Selected relevant-spec freshness now includes
TLS presence. Bounds add 100 port-level settings/rule and a combined 10,000
subset/port-setting budget; malformed evidence remains unevaluated. The UI
explicitly distinguishes the warning from observed encryption or automatic-mTLS
behavior and offers scoped related-rule links.

Twelve hosted intercepted cases covered absent/empty policy, top-level and
port-level TLS, subset-only TLS, exact peers, two-part host semantics, private
exports, denial and stale TLS evidence. No policies or rules were written.
Coverage is now **20 bounded finding codes**, with **12,969 tests in 87 files**
and **12,088 independent original-Go cases**. Full effective TLS and remaining
policy checker families are still open.

## Sidecar root-selector warning

`core/sidecarValidation.ts` adds active KIA1006 from
`business/checkers/sidecars/global_checker.go`. Its caller is explicitly enabled
in `sidecars_checker.go`; the original warning does not invalidate the resource.
The 72 source-executed Go cases preserve root equality and nil/empty/nonempty
selector behavior. Native parsing additionally bounds equality labels to 100 and
defers malformed or unsupported selectors.

The shared validation reader now resolves namespace mesh context independently
of import/export collection requirements. A nonempty Sidecar selector can
therefore use existing controller/revision/configuration/discovery provenance
without requiring DestinationRule or Sidecar list permission. No root namespace
is inferred from conventional names or missing configuration. Unknown roots,
denied sources, multiple eligible controllers and discovery exclusions defer
the finding. Empty selectors do not read mesh data. Aborted discovery cannot
publish a context; workload-selector absence checks remain separately deferred.

Nine stock hosted Headlamp scenarios passed: root/non-root using actual managed
mesh configuration, empty/nil selectors, annotation suppression, missing root,
denied configuration, ambiguous controllers and discovery exclusion. Sidecar
objects were intercepted; no resource was applied. Only failure scenarios
intercepted mesh sources. The warning rendered with named controls, translated
text and no plugin execution failure. Settings were unchanged and their stored
state was checked after removing handlers. Desktop remained unavailable.

At this checkpoint: **21 bounded finding codes**, **13,079 tests in 89 files** and
**12,160 independent original-Go cases**. Full workload-selected policy resolution and multi-match checks remain open.

## Sidecar egress registry checks

KIA1004 is wired through `sidecarEgressValidation.ts` and the reusable
`serviceRegistry.ts`. The active `sidecars.EgressHostChecker` and its actual
caller were verified. A 288-case original-Go oracle executes the checker,
host parsing, Service alias construction, annotation parsing and namespace
visibility together; it does not replace native source/provenance tests.

Services have exactly three aliases: `name.namespace.<configured-domain>`,
`name.namespace.svc` and `name.namespace`. ExternalName targets and port
definitions do not add aliases. The `networking.istio.io/exportTo` annotation
takes precedence over the source namespace's mesh `defaultServiceExportTo`.
Go whitespace is preserved, including NEL versus BOM; explicit empty annotations
mean an empty/public export list, not inheritance. Missing matching defaults
remain unknown. Unrelated unknown defaults do not hide an absent exact alias.
The DNS-label helper now rejects trailing newlines instead of accepting a
prefix match, keeping registry domains and API identities whole-string valid.

ServiceEntry matches reuse namespace export/default/ambient context, without
inventing an additional Sidecar import filter. The pinned helper deliberately
uses suffix matching even without a wildcard; this is not replaced with DNS
equality. Egress parsing uses `ParseHost`, not `GetHost`. A `namespace/*` entry
is exempt without proving that namespace exists, and the namespace prefix does
not rewrite the host's parsed namespace. Native field paths preserve the
original listener index after null entries, correcting the Go checker's
compacted-index path while retaining its predicates.

Bounds: 1,000 records/source, 100 listeners/1,000 egress hosts, 100 hosts per
ServiceEntry/20,000 total, 10,000 host comparisons and 4,096 characters/100 tokens
per Service export annotation. Denied/partial lists, malformed identities and
unknown relevant visibility defer affected checks. Existing guarded mutation
and Gateway Service-reference behavior is unchanged.

Fourteen hosted scenarios passed with intercepted Sidecar objects. Existing
Bookinfo and missing-name cases used real Service/ServiceEntry/mesh evidence;
other cases intercepted export annotations/defaults, ServiceEntry visibility,
denial and null-listener indexing. No objects were applied. DNS settings were
restored and persisted; findings are explicitly qualified as configuration
lookups, not reachability or enforcement.
The packaged checkpoint passes **13,431 tests in 92 files** with **22 bounded
finding codes** and **12,448 independent original-Go cases**. The temporary
hosted helper was stopped and browser artifacts archived outside the worktree.

## VirtualService destination registry and outbound policy

KIA1101 is implemented for HTTP/TCP/TLS forwarding destinations using the shared
scoped registry. It preserves `GetHost` aliases rather than Sidecar's narrower
`ParseHost`, Service export precedence, namespace-filtered ServiceEntries and
the original suffix predicate. It does not apply Sidecar imports or invent
mirror/redirect coverage. Bounds add 100 routes per protocol, 100 destinations
per route, 1,000 total destinations and 1,024-character host values.

The 576-case original-Go oracle executes `virtualservices.NoHostChecker`,
Service-registry/host helpers, `models.NewMeshConfig` and the actual
`IstioValidationsService.isPolicyAllowAny` classifier. It verifies all three
forwarding protocols, nil entries, aliases, export defaults/annotations,
ServiceEntries and policy-dependent severity. Collection provenance, JSON
protobuf parsing and native shared/local projection have separate source-informed
tests, not an independent full-discovery oracle.

`meshConfigFields` now retains the configured outbound mode and whether it came
from an explicit value or protobuf's zero default for a present empty policy.
The pinned `models/mesh_test.go` confirms that `{}` yields `REGISTRY_ONLY`;
`models.NewMeshConfig` supplies `ALLOW_ANY` when the entire policy is absent.
Local zero values override shared policy. The baseline
[Istio API at 23c54ad84d6e](https://github.com/istio/api/blob/23c54ad84d6e/mesh/v1alpha1/config.proto)
also defines `ALLOW_ANY_DYNAMIC_DNS = 3`. Kiali classifies only `ALLOW_ANY` as
warning severity, so dynamic-DNS findings remain errors; this is explicitly
not interpreted as actual traffic blocking or enforcement. Unresolved controller
configuration does not receive a guessed policy.

Mesh inventory shows the configured mode without silently inserting runtime
defaults. Validation reports its baseline-default/classifier behavior separately.
Specification, status, identity and exclusion annotations are cloned before
deferred reads; requested source families are captured before awaiting transport.

Fourteen hosted read-only scenarios plus mesh inventory passed. The existing
Bookinfo destination used real registry data; remaining cases intercepted the
selected VirtualService and mode/export/failure responses. No object was
written. DNS settings were restored and persistence awaited. Gates passed
**14,043 tests in 94 files**, with **23 bounded finding codes** and
**13,024 independent original-Go cases**.

## PeerAuthentication patterns and resolved roots

The four active `peerauthentications` checkers now supply KIA0401, KIA0501,
KIA0505 and KIA0506. Their 348 original-Go cases execute the original checkers
and `kubernetes/istio.go` helpers, including nil versus present selectors,
automatic mTLS, root versus namespace scope, exact legacy wildcard hosts and
DestinationRule order. Read collection/provenance and root-resolution tests
are separate from that checker oracle.

Any non-null selector excludes these checks, even `{}` or empty matchLabels;
this differs from the namespace mTLS indicator's deliberate normalization.
STRICT checks accept `ISTIO_MUTUAL`, not ordinary `MUTUAL`, as the matching
enabling pattern. DISABLE checks treat both client modes as conflicting.
Only top-level TLS contributes, not subsets or port-level policies. The
namespace-DISABLE check preserves its input-order early exit on a matching
DISABLE rule. These predicates do not certify effective policy.

Only complete bounded Namespace/DestinationRule evidence can support absence.
Relevant export/default/ambient scope is reused, without Sidecar import
filtering. Malformed sources or unresolved relevant visibility defer results;
automatic-mTLS shortcuts require resolved namespace configuration. Conflicting
rules retain observed UIDs and captured-cluster links. Common TLS decoders are
shared with configured-mTLS and DestinationRule consumers.

Pinned `istio/discovery.go` resolves an empty configured root to the observed
Istiod namespace. Native `resolvedMeshRoot` now implements that rule **only
after configuration is resolved**; it does not emulate upstream's failure
fallback. Raw fields stay unchanged, while namespace contexts retain the
resolved root and its basis. Sidecar root checks/imports, configured mTLS and
the new policy checks consume it. Mesh inventory and mTLS UI label the fallback.
This intentionally replaces the earlier missing-root deferral for otherwise
resolved configurations, without guessing `istio-system` or parsing a display
string as identity.

Nineteen hosted scenarios passed: all four findings, automatic mTLS, selector
presence, top-level/client-mode distinctions, ordering, private exports, denied
sources and root fallback through PeerAuthentication, Sidecar, mesh inventory
and configured mTLS. Policy objects and selected responses were intercepted;
no policy was applied. DNS settings were restored and persistence awaited.
Current gates pass **14,428 tests in 96 files**, with **27 bounded finding codes**
and **13,372 independent original-Go cases**.

## DestinationRule counterpart peer-policy checks

`destinationRulePolicyValidation.ts` adds active KIA0205–KIA0208. The 984-case
original-Go oracle executes all four counterpart checkers, the actual
`filterPeerAuths` namespace/root projection and shared mode helpers. It includes
root-equals-owner scopes, custom DNS suffixes, absent/empty TLS, selector
presence, automatic mTLS and policy ordering. Native provenance, freshness,
exports and group-aware collection tests remain separate evidence.

Only exact `*.local` and `*.{owner namespace}.{configured domain}` patterns
activate these checks. `ISTIO_MUTUAL` uses the resolved automatic-mTLS shortcut,
otherwise STRICT or PERMISSIVE global peer patterns satisfy the source checker.
DISABLE patterns retain the pinned namespace override logic and order-sensitive
PERMISSIVE/STRICT behavior; any present selector remains excluded. These checks
do not apply Sidecar imports and do not infer observed encryption.

Selected UID and normalized host/top-level mode/export fields must match the
collected DestinationRule before policy-dependent findings. Namespace and
policy lists are bounded and complete; unknown configuration or denied peer
lists defer findings. PeerAuthentication references use a discriminated
kind/group identity and the security resource route, retaining observed UIDs.
Legacy mesh-wide patterns work without guessing a Service DNS suffix.

Twenty-two hosted read-only scenarios passed, including all codes, overrides,
ordering, empty selectors/TLS, root fallback, stale UID/spec, denial, private
scope and suppression. Related-policy navigation and dialog closure were
checked. All policy objects were intercepted and settings restored durably.
Current gates pass **15,434 tests in 98 files**, with **31 bounded finding codes**
and **14,356 independent original-Go cases**.

### WorkloadGroup service-account provenance

KIA1701 remains deferred. The source checker compares principals assembled by
`business/istio_validations.go:getServiceAccounts` from workload-observed
`ServiceAccountNames`, not ServiceAccount object existence. Those names are
populated from each workload's `Pods.ServiceAccounts()`. `ParseWorkloadGroup`
retains VM accounts in `WorkloadEntries`, not in that Pod list. Moreover,
`fetchWorkloadsFromCluster` applies controller attribution and workload inclusion;
not every Pod with owner references necessarily produces a workload. A raw Pod
list or ServiceAccount list is not an equivalent account universe. Complete
attributed workload evidence is needed before implementing the absence check.

The native correlation layer now records `spec.serviceAccountName` from each
observed Pod and exposes positive account provenance in Applications.
Per-workload account counts use only the already UID-attributed Pod set;
missing/unresolved owners never fall back to a controller name. Missing or
malformed account fields stay explicitly unavailable, without substituting
`default` or discarding otherwise usable workload relationships. Account names
are bounded DNS subdomains, and the per-workload aggregation is limited to 1,000
scoped unique Pods. VM entry accounts are not mixed into this evidence.

Six hosted cases verified actual Bookinfo `bookinfo-reviews` account names on
the three owned reviews Pods and their ReplicaSet/Deployment UID chains,
then intercepted missing/malformed account fields, unresolved owners and a
denied Pod collection. Explicit retry restored real evidence. Four Pod lists
were intercepted, zero ServiceAccount-object GETs or writes occurred, and
the table/console were inspected. Native tests cover capture, scope/UID guards,
exact count limits and unsupported VM attribution. This is source-informed
provenance groundwork, not a new Go oracle or a complete upstream workload
inclusion/account-principal universe. KIA1701/KIA0106 and authorization verdicts
remain deferred. Gates pass **19,322 tests in 150 files**.

### Complete captured workload inclusion and account projection

The bounded application model is not the account caller's workload universe.
At pinned Kiali v2.33.0 (`0e8be887b8217bbcac5e3ae0bfcd258073949cca`),
`business/apps.go` groups `AppService.fetchNamespaceApps` results by configured
application labels; WorkloadGroups use the first matching WorkloadEntry labels
or the group template labels. Gateway status/selector paths have their own
`GetGateways`/`SelectorChecker` inclusion semantics and remain unchanged.

The KIA1701 input is different: `business/istio_validations.go:getServiceAccounts`
uses each workload's `ServiceAccountNames`, populated in
`models/workload.go:WorkloadListItem.ParseWorkload` from
`workload.Pods.ServiceAccounts()`. It does not list Kubernetes ServiceAccount
objects. `business/workloads.go:fetchWorkloadsFromCluster` supports Pods,
Deployments, ReplicaSets, StatefulSets, DaemonSets, Jobs, CronJobs,
ReplicationControllers, OpenShift DeploymentConfigs and WorkloadGroups; its
`KubernetesConfig.ExcludeWorkloads` setting controls inclusion. The pinned
default excludes Job, CronJob, ReplicationController and DeploymentConfig, so
the account projection's default set is Deployment, ReplicaSet, StatefulSet,
DaemonSet and standalone/attributed Pod. The runtime exclusion configuration is
not available to the plugin, therefore this is a complete capture for that
pinned default profile, not proof of the active Kiali runtime workload policy.
Configured exclusions/custom workload types remain downstream gates.

`src/core/workloadInclusion.ts` consumes the namespace correlation capture plus
a separate OpenShift DeploymentConfig source. This source is discovered and
versioned without entering the application resources or Gateway projection.
Completeness requires all supported list captures, source and item
resourceVersions, and owner chains that match scoped UID, kind, group, name and
API version. ReplicaSet-to-Deployment promotion is supported. Excluded
Job/CronJob/ReplicationController/DeploymentConfig ownership is not counted as
Pod-account input. Missing/stale owners, unsupported/custom chains, ambiguous
controllers, partial/truncated/denied/malformed/replaced sources, and missing or
malformed account fields leave the projection unavailable for absence claims.
The optional DeploymentConfig source has a separate five-second deadline;
timeout marks only account evidence incomplete and does not reject the
application snapshot. Caller cancellation and application namespace/label-setting
changes discard captures.
Positive captured account observations may still be shown while the projection
is incomplete.

Pod `spec.serviceAccountName` observations are aggregated only under their
captured account-workload root. WorkloadEntry `spec.serviceAccount` values are
shown separately with entry UID/resourceVersion, in captured order, only for
nonempty `WorkloadGroup.spec.metadata.labels` matches. Empty selectors do not
import entries. These VM values are not Pod accounts, do not populate the
KIA1701 input and do not establish Kubernetes ServiceAccount existence,
permissions, principals or health. No ServiceAccount-object reads, KIA1701,
KIA0106 or authorization verdicts were added. Applications now exposes the
projection's completeness and these distinct provenance classes; application
label grouping and Gateway's separate inclusion projection are not changed.

The focused local tests cover default supported/excluded kinds, standalone
Pods, ReplicaSet/Deployment and direct controller ownership, namespaces,
resource/API-version freshness, ambiguous/custom/stale/non-controller owners,
missing Pod/VM account fields, ordered VM entry matches, empty selectors,
denied/malformed/truncated/replaced/timed-out DeploymentConfig reads,
cancellation and namespace/settings invalidation. The final focused run passed
180 tests in 7 files; type-check, lint and production build also passed. The full
suite passed 22,615 of 22,616 tests; one unrelated existing `Traces.test.tsx`
test hit its 5-second timeout under full-suite load, while it passed in a
separate run alongside `ServiceTrafficWizard.test.tsx` (32 tests total). No new
original-Go oracle or live/hosted/Desktop fixture was available for this
increment; those runtime gates remain open.

## Guarded validation-exclusion editing

The configuration action bar now edits only `kiali.io/ignore-validations`.
Restore-normal removes the key, selected-code mode writes a comma-separated
list, and ignore-all explicitly writes an empty value. It is not a general
annotation editor or a specification update. Resource specs/status, labels
and unrelated metadata are preserved, including on cluster-scoped resources.

The workflow captures the opening identity/version and uses the existing
update authorization, server dry-run and explicit confirmation path. Permission
and UID/resourceVersion are checked again before each write. Annotation-only
and spec updates cannot be mixed. Response identity/version and the resulting
annotation are checked; a malformed/different acknowledgement becomes an
explicit uncertain outcome, with no automatic retry. Mutation actions and the
dry-run flag now fail closed on unsupported runtime values rather than falling
through to a different HTTP method. Scope changes synchronously remove the old
dialog and abort pending work, including when another cluster has a matching UID.

`core/validationAnnotations.ts` follows the pinned Go per-object parser and
matching behavior with **72 independent original-Go cases**. The shared linear
`trimGoSpace` helper preserves Go's Unicode whitespace set: NEL is whitespace,
BOM is not. This corrects the earlier JavaScript-trim discrepancy without
changing the authorization-pattern oracle. Reader bounds are 32,768 characters/
1,000 codes; malformed or oversized exclusions do not suppress findings and
produce an explicit skipped-check message. Editor bounds are 4,096 characters/
100 codes. Global Kiali-server ignore configuration is not introduced here.

Seven hosted interception cases covered selected codes and actual suppression,
restoration, explicit ignore-all, permission denial, stale versions, malformed
acknowledgements and uncertain writes. Each full run intercepted 12 permission
reviews and 10 dry-run/final PUTs; no fixture write reached Kubernetes. The
annotation-only Monaco preview was checked after editor/font readiness and
confirmed DOM-read-only. The normal regression suite and targeted write
guards cover these paths; actual metadata-write/Desktop evidence remains open.
The checkpoint passed **10,063 tests in 85 files**; independent original-Go
evidence totals **9,201 cases**.

## Existing-route traffic weights

`core/trafficWeights.ts` builds a weight-only proposal for an existing
VirtualService HTTP/TCP/TLS route. Inputs must be whole-number percentages in
0..100 totaling 100. Exactly the selected route's weight fields change; matches,
destinations, ports, headers, mirroring, timeouts and other protocols remain
unchanged. Bounds are 100 selectable routes and 20 destinations, with boundary
tests and explicit specification-editor fallback.

The native editor reuses the existing dry-run/review/confirm adapter. Opening
any mutation now captures an immutable original API-object snapshot, preventing
a later live object mutation from replacing the reviewed UID/resourceVersion.
The review shows old/new weights plus both full specs; Back to edit retains the
draft. Locking and automatic rebalancing remain open; the separate Service
creation and mirroring workflows are described below.

Hosted browser interception verified 50/50 to 80/20, invalid-total blocking,
field preservation, write ordering and stale-version rejection. Every PUT was
intercepted; real cluster routing was unchanged. The stock host cache can keep
an old object when a fixture generates no watch event. The explicit Reload page
action fetches fresh state without private cache access; automatic immediate
refresh after every real write is not claimed.

## Service-driven routing creation and batch outcomes

`core/serviceTraffic.ts`, `data/serviceTraffic.ts` and `ServiceTrafficWizard.tsx`
provide HTTP/gRPC or TCP creation and a bounded existing-pair edit workflow
from the Services table. Pinned
`IstioWizards/WizardActions.ts` supplies the source shape and default-weight
semantics; these tests are source-informed, not a full wizard oracle.
The workflow requires complete namespace correlation, a versioned selector-based
Service, an explicit Service DNS suffix and readable routing collections.
Potentially overlapping hosts block creation rather than being overwritten.

Workloads sharing a version are combined into one subset, preserving effective
per-workload default weights and avoiding duplicate subset definitions. Version
labels must be explicit or unambiguous. Generated resources are deliberately
namespace-local, mesh-only and scoped to a selected TCP Service port.
No gateway or external Service is generated. Optional explicit TLS and mirroring
is described below. Limits are
100 workloads, 20 versions and the existing four-page collection bounds.

The full source is refreshed before review/confirmation; Service UID/version
and permissions are rechecked before individual writes. Target absence is
checked without interpreting a denied GET as absence. Specifications are deeply
frozen, and a successful dry-run produces a single-use reviewed batch.
`data/mutationBatch.ts` runs up to five same-cluster operations sequentially,
stopping at the first failure with succeeded/blocked/failed-or-unknown/not-attempted
states. No retry or rollback occurs; these are not transactions.

Hosted checks loaded real reviews Service/version evidence, then intercepted all
authorization, dry-run and final configuration writes. They proved 80/20/0
generation, invalid-total blocking, write order, partial failure and stale-Service
rejection. Real VirtualService/DestinationRule lists remained empty afterward.
The review uses a concise weight table and two read-only Monaco JSON previews;
the original deeply nested table preview was replaced after visual inspection.
Runtime load and named controls worked in the stock hosted host.

### Bounded existing VirtualService/DestinationRule edits

The edit proposal requires exactly one captured, namespaced
`networking.istio.io/v1` VirtualService and DestinationRule, each with UID and
resourceVersion. The VirtualService must have the exact Service FQDN as its sole
host, no gateways or only `mesh`, and exactly one HTTP or TCP route whose weighted
destinations each map one-to-one to an observed Service version through the
captured DestinationRule subsets. Only the Service-targeting route and the
existing subset policy controls are edited. Other routes, match alternatives,
route order, rule fields, metadata and status are preserved. Only objects whose
spec changes are sent to the mutation batch.

The workflow fails closed before permissions for missing/ambiguous targets,
mixed existing/new pairs, multiple matching routes, multi-host or
Gateway-attached resources, TLS routes, incomplete evidence and unsupported
VM/correlation targets. HTTP match editing retains its existing OR/AND behavior
and refuses removal of the final predicate. Original objects are deeply frozen
when the dialog opens; UID/resourceVersion checks and per-object SSAR/dry-run
still precede the final explicit confirmation. Per-object outcomes and safe
continuation guidance are retained; there is no retry, rollback or conflict
overwrite. This is not a transaction and no real cluster write is claimed.

Focused source-fixture, proposal, UI and mutation-adapter tests cover
preservation, stale/replaced captures, permissions, create SSAR without a name,
dry-run ordering, denial and mid-batch failure. Runtime contribution, console,
i18n and accessibility gates were unavailable in this session and remain open.
Gateway API forms, mixed create/update, broader resource selection and remaining
traffic-policy options remain out of scope.

Live controller reconciliation, real write success, remaining traffic-policy
options, locks and new Desktop checks remain open.

### Explicit TCP Service routing

The Service wizard now also ports the pinned `WIZARD_TCP_TRAFFIC_SHIFTING`
generator: explicit `spec.tcp` destinations/weights, with the native workflow's
additional selected-port restriction. HTTP/gRPC remains the backwards-compatible
default; explicit unknown/null protocol values are rejected. Shared circuit,
load-balancing and explicit outbound TLS settings still compose only in the
DestinationRule. TCP rejects mirroring and HTTP header/cookie affinity instead
of silently deleting the user's draft choices.

The UI identifies TCP as connection routing and warns that it does not change
Service appProtocol/port names or infer Istio protocol classification. Four hosted
scenarios covered TCP generation, correction of incompatible HTTP settings,
denial and stale Service evidence. Eight specification writes and nine SSARs
were intercepted; no resources or traffic changed, and no settings were modified.
Gates pass **15,524 tests in 102 files**. Actual TCP reconciliation/telemetry
remains unverified.

## Repeatable synthetic hosted smoke

On 2026-11-03, the repository added a repeatable smoke against the actual
production bundle in stock Headlamp 0.35.0. The Docker image is pinned by digest
in `scripts/smoke/run.mjs`; Chromium is pinned through Playwright 1.56.1.
`npm run smoke:hosted` stages the built plugin and a temporary synthetic
kubeconfig, starts a loopback-only fake Kubernetes/Prometheus API, enters its
synthetic token through Headlamp's actual auth dialog, and cleans up only its
owned resources. Reproduce locally with:

```sh
npm ci
npx playwright install chromium
npm run build
npm run smoke:hosted
```

The successful run loaded the plugin bundle, manifest and English locale,
rendered the Kiali overview and its English/named controls, saved settings
through the public ConfigStore, waited for the 500 ms debounce and matching
`pluginConfigs.kiali` storage, then reloaded and confirmed persistence. It
reached the synthetic Prometheus build-info endpoint (`smoke-v1`) through
Headlamp. Both inspectors completed all four owned cases: positive
Gateway KIA0302 with controller provenance, denied namespace evidence,
incomplete Pod evidence, and stale Gateway; Service KIA0601/KIA0701,
denied namespace evidence, incomplete Pod evidence, and stale Service. One
successful run recorded 181 authenticated fixture requests and no Kubernetes
writes. The count is observational; background host requests may vary.

The runner asserts no plugin/page console errors, visible contribution,
resolved labels, named controls, and HTTP 200 for `main.js`, `package.json` and
the English locale. It distinguishes observed stock-host bootstrap 401,
CRD-v1beta1 discovery 404, synthetic watch/multiplexer diagnostics, the
fixture's expected denied namespace request, and the host parser message only
when correlated to a successful authenticated fixture read. Other console
errors, unexpected WebSocket endpoints, unauthenticated post-auth reads, or
resource writes fail. Failure-only browser artifacts are bounded, do not
include request authorization headers, clear the token field before screenshot,
and are retained by Actions for seven days.

Local type-check, lint, production build and parity inventory passed; the full
existing suite passed **22,594 tests in 189 files**.

`.github/workflows/headlamp-smoke.yml` runs type-check, lint, the existing test
suite, parity check, production build and this host smoke on push, pull request
and manual dispatch. This is synthetic hosted-web evidence only; it does not
install cluster fixtures or close Desktop, live-cluster, live-provider or
OIDC/authentication gates. No Copilot setup workflow is added: the Actions-backed
setup file only applies from the default branch and does not configure cloud
sandboxes.

## Guarded circuit-breaker workflows

`core/circuitBreaker.ts` and `CircuitBreakerEditor.tsx` port the pinned wizard's
three user controls: TCP maximum connections, HTTP/1 pending requests and
consecutive errors. Existing DestinationRules use the immutable review dialog;
new Service routing proposals include optional settings only in the
DestinationRule, retaining the ordered two-object workflow.

Native keep/set/remove actions are explicit and preserve unrelated TLS,
load-balancing, advanced pool/outlier values, subsets and port-level overrides.
Removing a group removes that whole group only after review. Setting outlier
detection intentionally writes the current `consecutive5xxErrors` field and
removes the deprecated `consecutiveErrors` alias; legacy values are read for
initialization and zero is preserved. The UI explains this compatibility choice.
Numeric bounds match signed int32 pool counts and uint32 thresholds. Invalid
values and no-op proposals fail locally rather than being coerced to zero.

The existing SSAR, server dry-run, UID/resourceVersion checks and explicit
confirmation remain the only execution path. Scope changes abort pending
reviews, and uncertain final outcomes prohibit blind retry. Source values are
captured before editing; metadata/status are not part of the proposal.

Eight hosted scenarios passed: set/remove, permission denial, stale UID/version,
server rejection, uncertain final write and Service-driven creation. Ten
specification requests and thirteen permission reviews were intercepted; no
live object changed. Service/version reads for creation used real Bookinfo
evidence. The actual read-only Monaco proposal showed canonical zero and
preserved overrides. DNS settings were restored and persistence awaited.
Gates pass **15,445 tests in 99 files**; original-Go case counts are unchanged
because this workflow has contract/preservation tests, not a Go algorithm oracle.
Full traffic-policy forms and other wizard families remain open.

## Guarded load-balancing and affinity workflows

`core/loadBalancer.ts` and `LoadBalancerEditor.tsx` add the pinned simple and
header/cookie/source-IP strategies to existing DestinationRule updates and
optional Service creation. The native editor also accepts schema-supported
`LEAST_REQUEST` and `UNSPECIFIED` while retaining `LEAST_CONN` compatibility.
Keep/set/remove actions are explicit and use the existing guarded review path.

Strategy changes remove incompatible simple/hash/affinity fields. Other
top-level policy, locality, warmup, subset and port overrides remain intact;
hash algorithm settings survive affinity changes, and cookie path/attributes
survive cookie edits. Whole-group removal explicitly includes locality/warmup.
No-op detection does not mistake object-key reordering for a change.

Names use bounded HTTP-token validation and cookie TTLs require nonnegative
protobuf seconds with up to nine fractional digits. Invalid inputs are not
silently normalized. Inputs and proposed writes remain immutable through review.
Source-IP affinity is described as the proxy-observed address, not necessarily
the original client.

Eight hosted scenarios passed: modern/legacy simple algorithms, header, cookie,
source IP, removal, no-op rejection and Service creation combined with circuit
settings. Sixteen specification requests and sixteen permission reviews were
intercepted; no live configuration changed. DNS settings were restored and
persisted. Gates pass **15,463 tests in 100 files**; original-Go evidence remains
unchanged because these are native contract/preservation tests.

## Gateway API backend weight editing

`core/gatewayRouteWeights.ts` and `GatewayWeightsEditor.tsx` extend guarded
HTTPRoute/GRPCRoute updates with relative backend weights. The source UI/caller
is pinned Kiali `K8sTrafficShifting.tsx`/`WizardActions.ts`; numeric/default/
ratio semantics were checked in Gateway API `89b3b0c3fa63f9342f43ba0fb2cf93d6aab53af7`
`apis/v1/shared_types.go` `BackendRef`.

Weights default to 1, accept decimal integers 0..1,000,000, and need not total
100. Native controls use the full API range instead of the baseline slider's
0..100 convenience bound. Effective no-ops (including omitted/default1) and
all-zero proposals are blocked; JSON remains available for an intentional
all-zero rule. Limits are 16 rules and 16 backends per rule.
Backend identities/filters, parent references, matches, other rules and metadata
are preserved. No new references or unverified links are introduced.

Seven hosted cases covered HTTP/gRPC changes, zero/max values, no-ops, all-zero
rejection, authorization denial, stale version and server rejection.
Five specification writes and seven SSARs were intercepted; no Gateway API
was installed and no real configuration changed. Gates pass **15,754 tests
in 118 files**. Actual admission/controller behavior remains unverified.

## Confirmed HTTPRoute/GRPCRoute create and attachment forms

`core/gatewayRouteProposals.ts`, `data/gatewayRouteReferences.ts` and
`components/configuration/GatewayRouteEditor.tsx` add a bounded, single-object
create form for HTTPRoute and GRPCRoute, plus an attach-existing-route form.
The source audit is Kiali v2.33.0
`0e8be887b8217bbcac5e3ae0bfcd258073949cca`: `K8sRouteHosts.tsx`,
`K8sGRPCRouteHosts.tsx`, `K8sGatewaySelector.tsx`, `K8sTrafficShifting.tsx`
and `WizardActions.ts`. The source defaults route name and hostname to the
selected Service name and its one-Service backend weight to 100. The native
form keeps those defaults, requires the Service port, and leaves same-namespace
parent/backend namespaces omitted in the resulting references. A blank parent
section or parent port remains unspecified; explicit section/port values must
match an observed Gateway listener.

Only the generated Gateway API schema subset for HTTPRoute `v1`/`v1beta1` and
GRPCRoute `v1` is available. Forms use one core Service backend and one
Gateway parent per create proposal. Attach preserves the captured route and
adds one nonduplicate parent reference. Cross-namespace Gateway parents are
checked against observed namespace-sharing rules; cross-namespace Service
backends require a matching ReferenceGrant. Route discovery, complete
reference evidence, a single unambiguous TCP Service port, and optional
listener selectors are checked before the permission review and server
dry-run. Update operations retain the original route UID/resourceVersion guard.
Before the separately confirmed operation, fresh discovery and complete reads
are repeated and captured object evidence (identity, UID, object resourceVersion,
labels, spec and relevant Service export annotation) is compared independently
of list order. Advancing collection/list resourceVersions alone does not
invalidate unchanged evidence; changed, removed, recreated or newly listed
objects do.

The review shows the complete proposed manifest and reports which existing
reference checks could not run. It explicitly does not claim controller
acceptance or listener attachment: protocol/hostname intersections, listener
status and controller-specific behavior remain unsupported. HTTP path/method
matches, GRPC service/method matches, filters, multi-backend editing, new
Gateway creation and TCP/TLS/UDP route forms are not part of this increment.
Istio Service VirtualService/DestinationRule workflows are unchanged. There is
no automatic retry, multi-object write or rollback.

Focused source-fixture, proposal, reference and UI tests cover source defaults,
invalid identities/ports, cross-namespace grants, unsupported discovery,
denied reference reads and permission review, changed references, dry-run
failure, create review and explicit confirmation. They are unit/intercepted
tests, not live API or controller evidence. Actual Headlamp contribution,
browser console, host i18n/a11y, live-cluster and Desktop verification remain
open; no Gateway API resources were installed or changed. The focused set passes
66 tests; `npm run tsc`, `npm run lint` and `npm run build` pass. Headlamp's
remote-debugging endpoint was not available, so no live contribution or browser
console check is claimed.

## Guarded inbound mTLS editing

`core/peerMtlsEditing.ts` and `PeerMtlsEditor.tsx` extend existing
PeerAuthentication actions with the pinned TrafficPolicy mode choices.
The field contract was checked against Istio API `23c54ad84d6e`
`security/v1beta1/peer_authentication.proto`. Modes are explicit, with no
health-driven default. Set preserves unknown fields in the top-level mTLS
block; remove deliberately clears that whole block. Selectors, workload-port
overrides and other specification fields remain unchanged.

The review explains broad namespace/root scope, client compatibility, plaintext
and ambient implications, and removal/UNSET inheritance. It does not update
DestinationRules or claim effective policy resolution. The existing immutable
capture, security-group SSAR/dry-run, UID/version, confirmation and uncertain-
outcome protections remain the only execution path.

Eleven hosted scenarios passed: four modes, removal, no-op/absent-mode blocking,
denial, stale resource, server rejection and uncertain final write. Thirteen
specification requests and fifteen permission reviews were intercepted; no
live policy changed. Read-only review showed preserved selector and port
overrides. Gates pass **15,739 tests in 117 files**. Source-informed form
evidence is not live mTLS enforcement or a new Go algorithm oracle.

## Guarded outbound TLS workflows

`core/outboundTls.ts` and `OutboundTlsEditor.tsx` add explicit top-level
DestinationRule mode/file-path controls, plus optional Service-create TLS.
Source references are pinned `IstioWizards/TrafficPolicy.tsx`,
`WizardActions.ts`, and `ClientTLSSettings` in Istio API commit `23c54ad84d6e`.
Unlike the baseline convenience form, no mode is automatically inferred from
partial mesh mTLS status. Keep/set/remove is distinct from the chosen TLS mode.

MUTUAL requires client-certificate/private-key paths; SIMPLE/MUTUAL accept an
optional CA path. Paths are absolute proxy-container references, bounded to
4,096 characters, with controls/contents rejected. No file or secret is read,
uploaded or installed. SIMPLE clears client credentials; these file-based
edits explicitly remove `credentialName`. SNI, SAN, CRL and verification flags
remain intact. Secret-backed and other advanced editing stays in JSON.
DISABLE and ISTIO_MUTUAL replace the entire TLS sub-block with the mode.
Removal clears the sub-block and restores inheritance; it is not DISABLE.
All sibling policy, subset/port overrides, metadata and source evidence survive.

Twelve hosted scenarios passed: four modes, system-CA omission, removal, no-op/
invalid-path blocking, denial, stale version, server rejection, uncertain final
outcome and Service creation. Nineteen specification requests and twenty-one
permission reviews were intercepted; no TLS policy was applied. Mode-specific
warnings remain visible in review, and read-only Monaco showed the actual file
references and preserved overrides. DNS settings were restored durably.
Gates pass **15,522 tests in 102 files**, with source/schema inventories unchanged.
Evidence is source-informed contract/preservation/UI testing, not live transport
encryption or an independent Go algorithm oracle.

## Guarded HTTP mirroring

`core/httpMirroring.ts` and `HttpMirroringEditor.tsx` implement the pinned
single-target wizard shape, `mirror` plus `mirrorPercentage`, using
`IstioWizards/WizardActions.ts` and `TrafficShifting.tsx` as source references.
Existing HTTP forwarding routes support explicit keep/replace/remove actions.
Replacement removes `mirrors`, `mirrorPercent` and `mirror_percent`; removal
clears all mirror forms. Other routes, weights, matches, policies and unknown
unowned fields survive. Multiple targets remain editable through JSON.

Legacy and list representations initialize drafts without enabling a change.
Zero/fractional percentages, optional target ports and subsets are preserved.
Convenience validation uses DNS hosts/labels, ports 1..65535 and decimal
percentages 0..100. No-op edits, invalid values and non-forwarding routes are
rejected before transport. The editor does not prove target existence or health.
The duplication/side-effect warning remains visible at explicit confirmation.

Service-driven creation can select one observed version as shadow-only, keeping
its subset in the DestinationRule while excluding it from forwarding and the
100-percent forwarding-weight sum. Native controls deliberately require manual
redistribution rather than silently changing other weights. Empty-label observed
versions remain selectable without colliding with the disabled-state sentinel.
Circuit/affinity settings compose independently in the DestinationRule.

Ten hosted scenarios passed: legacy/list conversion, removal, no-op/invalid
rejection, authorization denial, stale version, server rejection, uncertain
final outcome and Service creation from real Bookinfo reads. Thirteen
specification requests and fifteen permission reviews were intercepted; no
live routing changed. Settings were restored with persistence awaited.
Gates pass **15,508 tests in 101 files**. Evidence is source-informed contract,
preservation and UI testing, not an independent Go oracle or live reconciliation.

## Guarded HTTP route ordering

`core/httpRouteOrder.ts` and `HttpRouteOrderEditor.tsx` port the ordering intent
of pinned `RequestRouting.tsx` `onMoveRule`/`matchAllIndex`. Native moves can
target any position directly and preserve whole API route objects rather than
reconstructing wizard fields. Redirects, delegates, mirrors, timeouts, match
groups, unknown fields and other protocols remain unchanged.

The shared HTTP enumeration is now reused by behavior/mirroring and ordering;
only ordering includes non-forwarding rules. Bounds are 2..100 routes and up
to 100 alternatives for each non-delegated match list. Absent/null/empty match
lists, empty alternatives and metadata-only alternatives are definitely
unconditional and must be last. Delegates are not classified as unconditional
without reading their targets, and complex overlap is explicitly not analyzed.
Invalid positions, malformed lists and no-op moves are rejected.

Six hosted scenarios passed: complete-rule move, unresolved delegate preservation,
catch-all/no-op blocking, denial and stale version. Four specification writes
and six permission reviews were intercepted; no live routes changed.
Read-only review displayed the reordered objects and retained the impact
warning. Gates pass **15,544 tests in 103 files**; original-Go totals are unchanged.

The matching increment below preserves a notable pinned source behavior:
`buildHTTPMatchRequest` combines header conditions into one AND alternative,
but emits each URI/scheme/method/authority condition as a separate OR alternative.
It does not AND all of the wizard's displayed conditions. Native differences
must be explicit rather than silently changing that meaning.

## Service creation HTTP request conditions

`core/httpMatches.ts` and `HttpMatchBuilder.tsx` implement the five pinned
`RequestRouting/MatchBuilder.tsx` fields and `buildHTTPMatchRequest` grouping.
Header exact/prefix/regex/presence conditions form one AND alternative; each
URI/scheme/method/authority condition is a separate OR alternative. Creation
adds the selected Service port to every alternative, without leaving a
port-only catch-all alongside them. Existing weights, mirrors, HTTP behavior
and DestinationRule policies are preserved.

Convenience bounds are 20 conditions, 256-character lowercase hyphen-separated
header names, 1,024-character values and 512-character RE2 expressions.
RE2JS validates syntax without the health calculator's fallback. Native
validation deliberately rejects duplicate/ignored headers, duplicate alternatives
and surrounding whitespace rather than overwriting or trimming them.
Other compound arrangements remain available in the specification editor.
TCP preserves the draft but blocks review until HTTP conditions are removed.

Four hosted scenarios passed: grouped headers with URI/method OR alternatives
and mirroring, RE2 rejection/success, duplicate correction/explicit removal for
TCP, and denied creation. Twelve specification writes and thirteen SSARs were
intercepted; no resources or settings changed. The warning remains in review.
Mirrored versions are now explicitly described as shadow-only for this rule,
not globally: unmatched/default routing can send them ordinary requests.
Gates pass **15,568 tests in 104 files**; source-informed contract evidence is
not a Go oracle or a claim of live matching behavior. Multi-rule creation and
adding/removing existing alternatives remain open.

## Granular existing HTTP match editing

`core/httpMatchEditing.ts` and `HttpMatchEditEditor.tsx` set/remove one field
or named header within an existing alternative. Shared condition controls and
RE2/header guards are reused without flattening the original AND/OR structure.
Source labels/namespace, gateways, ports, query/negative-header conditions,
names, flags, unknown fields, other alternatives and other routes are preserved.
Setting a header is explicitly add/update, not a rename.

The original resource/version and original alternative are captured before
editing. Field changes load the original field value and reset the action to
keep; removals do not validate irrelevant value/regex drafts. No-op changes,
missing/malformed alternatives and removal of the last condition are rejected.
Both editing and ordering share bounded alternative parsing and recognize
metadata-only/default-empty conditions, including `statPrefix`, zero ports,
empty scope/maps/lists and documented ignored header keys. Unknown fields and
complex/delegated reachability are not interpreted as proof of a catch-all.
`ignoreUriCase` is preserved, with its exact/prefix-only effect disclosed.

Nine hosted scenarios passed: header/URI set/remove, unsupported regex,
metadata/default-only empty-alternative rejection, no-op/absent alternatives,
denial and stale version. Eight specification writes and ten SSARs were
intercepted; no live configuration changed. Read-only review showed preserved
restrictions, and gates pass **15,585 tests in 105 files**.

## HTTP behavior creation and existing-route controls

The Service wizard now composes the same verified HTTP planner after generating
weighted/mirrored destinations. This ports the pinned `WIZARD_FAULT_INJECTION`
and `WIZARD_REQUEST_TIMEOUTS` creation shapes without duplicating their field
validation. Every group is excluded by default; creation's **Not included**
omits that group instead of an existing-resource removal action.
Fault/timing conflicts and TCP-with-HTTP-policy proposals are blocked without
silently changing drafts. The DestinationRule and selected-port/namespace scope
remain unchanged. Explicit retry/fault warnings persist through confirmation
in both creation and existing-route dialogs.

Four hosted scenarios passed: timing/retries, combined mirror/fault creation,
incompatible timing/TCP drafts and denial. Eight specification writes and nine
SSARs were intercepted; no fault or other live routing was applied. Settings
were unchanged, handlers removed and the read-only rendered proposal inspected.
Gates pass **15,526 tests in 102 files**. Real admission/reconciliation and
traffic effects remain unverified.

`core/httpRouteBehavior.ts` and `HttpRouteBehaviorEditor.tsx` extend the guarded
VirtualService update dialog with timeout, retry, fixed-delay and HTTP-abort
controls. Source shapes follow the pinned RequestTimeouts/FaultInjection wizard
families. Each group defaults to keep; explicit set/remove operations affect
only the selected existing forwarding route. Other routes, weights, matches,
headers, mirrors and unknown fields survive. Known incompatible fault variants
are removed only when replacing that fault type.

Convenience bounds are 100 routes, durations from 1 ms to 24 h, retry attempts
0..10, percentages 0..100 and integer HTTP statuses 100..599. Route timeout 0
is explicitly supported even though the pinned convenience validator rejects
its literal zero forms. Removing a setting means inheritance. Mixing faults
with explicit timeout/retry settings is blocked until one group is removed;
the general specification editor remains available for other configurations.

The shared mutation review now uses named read-only Monaco current/proposed
specification views rather than deeply nested tables. Hosted interception
verified timing updates, preserved retry extensions, delay/abort proposals,
fault/timing conflict blocking and stale-version rejection. Every PUT and
authorization review was intercepted; no actual fault or routing update occurred.
Stock cache behavior still requires explicit reload when no real watch event
exists. Controller enforcement and new Desktop checks remain open.

## Local mesh inventory and selected configuration fields

`core/mesh.ts`, `data/mesh.ts` and `components/Mesh.tsx` discover `app=istiod`
Deployments, namespace injection labels, revision-tag labels and standard
revision ConfigMaps. Naming follows pinned `istio/discovery.go`; custom image
labels are not mistaken for a probed runtime version. Namespace associations
remain label hints: webhook selectors and workload overrides are not evaluated.
Configured Istio namespace discovery is assessed separately as described below.

Same-cluster literal `SHARED_MESH_CONFIG` references are read explicitly.
Selected root/trust-domain/automatic-mTLS/discovery-selector fields use local
precedence and alias union, without runtime defaults. Empty/null YAML fields
remain unset; explicit false is retained. A confirmed missing shared map is
reported and leaves only local fields. Denied/invalid sources, indirect shared
references, unsupported mounted overrides and unmapped external topology block
the merged projection. The mounted-file batch below extends source selection,
not full ProxyConfig/extensions, certificate parsing, runtime defaults,
networks topology or effective/observed security.

Namespaces use four 250-item pages; controller/tag collections use four
50-item pages. Configuration lookups and detail sections cover at most 20
controllers, with three concurrent requests and per-source errors. Parser
input is limited to 256 KiB UTF-8, with bounded alias/selector arrays.
js-yaml 4.3.2 uses JSON_SCHEMA, and parser errors omit source excerpts.
`data/collections.ts` now supplies the shared pagination/type/identity checks
used by mesh and reference validation. No Secret endpoint is requested.

The real hosted AKS check found `aks-istio-system/istiod-asm-1-30`, 2/2 replicas,
revision `asm-1-30`, image `pilot:v1.30.5-3`, controller ID `Kubernetes`, root
namespace `aks-istio-system`, trust domain and injector DNS suffix `cluster.local`.
Bookinfo had one revision-label match. The referenced shared ConfigMap is
actually absent; that 404 is surfaced, not hidden. An intercepted shared-map
payload and denial separately verified projection and incomplete-source behavior.
No cluster mutation occurred. Expected HTTP diagnostics include this missing
optional map and the host's CRD-v1beta1 probe, not plugin execution failures.
Desktop verification and complete mesh/security parity remain open.

### Mounted mesh sources — issue #3 audit and bounded implementation

The prerequisite Gateway increment (#2) is integrated into this branch; its
runtime gates remain open. The source baseline is unchanged: **Kiali v2.33.0,
`0e8be887b8217bbcac5e3ae0bfcd258073949cca`**. Exact audited blobs:

| Source | Git blob | Active evidence |
| --- | --- | --- |
| `istio/discovery.go` | `60f6f7ab41a65acc5f40ca1095ce279433e62dce` | `Mesh` first-container call chain, `parseArgsInto`, `findMeshConfigFile`, `shouldLoadMeshConfigFile`, `setControlPlaneConfig`, `setFileConfig`, `setFileMeshNetworks`, `setSharedConfig`, `fusionMeshConfigs` |
| `istio/constants.go` | `90de803c8c48862ba48b34fcfcb5c633a12c3956` | Default mesh and networks file paths |
| `models/mesh.go` | `518a4242407e27452bb199b91344456d89908ad4` | Backend defaults, source/reference models, Maistra classification |
| `istio/discovery_internal_test.go` | `3ec63ac4524f945bf7e231e8b311ec63fcbfe452` | Caller tests for arguments, mounts, file/shared precedence and failures |
| `business/tls.go` | `fd8ff28c63de87e87cd655c35e10d7ba5faaaabc` | Existing namespace/mesh-wide TLS consumer differences retained as follow-up work |
| `business/mesh.go` | `c8771bc4c0f63436b7cb47c199aa52f940f3ccb8` | Existing configured/mesh identity-domain consumer differences |
| `go.mod` / `go.sum` | `4502633e3522dacba5e50bee4fb55ee232832d7f` / `b853c35ef129a5e8d20db91bd37c67b349f51706` | Exact pflag, Istio API and legacy jsonpb dependency pins |

Pinned caller references:
[first-container pipeline](https://github.com/kiali/kiali/blob/0e8be887b8217bbcac5e3ae0bfcd258073949cca/istio/discovery.go#L809-L856),
[arguments](https://github.com/kiali/kiali/blob/0e8be887b8217bbcac5e3ae0bfcd258073949cca/istio/discovery.go#L1450-L1490),
[file reference selection](https://github.com/kiali/kiali/blob/0e8be887b8217bbcac5e3ae0bfcd258073949cca/istio/discovery.go#L310-L400),
[source loading/precedence](https://github.com/kiali/kiali/blob/0e8be887b8217bbcac5e3ae0bfcd258073949cca/istio/discovery.go#L101-L308),
[fusion](https://github.com/kiali/kiali/blob/0e8be887b8217bbcac5e3ae0bfcd258073949cca/istio/discovery.go#L402-L492).

**Chosen batch:** same-context direct ConfigMap-backed mounted mesh files.
The registered flag is `--meshConfig`, not `--meshConfigFile`; the latter is
unknown to the pinned pflag caller. Missing arguments use
`/etc/istio/config/mesh`. Repeated known flags use the final value; split and
equals forms, interspersed positionals and `--` termination are retained.
Invalid/unresolved inputs block natively rather than reproducing error fallback.

The first declared container supplies arguments, mounts and environment together.
The most-specific covering direct ConfigMap mount maps the requested file to a
key, including `items`, normalized paths and exact-file literal `subPath`.
Pinned equal-path/duplicate-volume first-match behavior is deliberately not
trusted: ambiguous mounts defer, and unsupported longer mounts cannot fall
through to a shorter valid source. Unresolved `subPathExpr`, directory subPath,
projected/Secret/host/CSI volumes, environment expansion and nonempty/malformed
`envFrom` remain guarded. No Secret, exec or container-filesystem read occurs.
The caller does not resolve `valueFrom`/`envFrom`; adding kubelet-style
indirection would not be Kiali source parity.

Shared configuration contributes first; the selected local file **or** standard
revision ConfigMap supplies local precedence. A successful alternate map/key
replaces standard configuration and does not require reading that unused map.
Standard-name/`mesh`-key mounts retain standard-source identity even at another
path. Upstream also selects its file branch for a differing logical controller
ID; external/configuration-cluster association remains unsupported here.
Shared reads switch clusters upstream only for
`ManagesExternal && ID != hostingCluster`, not either condition alone.

Local scalar/list presence and sorted alias-union behavior remain unchanged.
Display fields receive no runtime defaults. Kiali's separate backend defaults
include automatic-mTLS true and outbound ALLOW_ANY, not full Istiod defaults;
the existing resolved-root fallback remains the observed controller namespace.
Denied, malformed or missing selected local files never become standard
fallback or successful defaults. Only a confirmed missing optional shared map
keeps the documented local-only result; a later appearance invalidates capture.

**Projected field-name decoding:** Kiali's `models.MeshConfig` embeds the Istio
type and overrides only marshaling. Its inherited decoder uses legacy
`github.com/golang/protobuf/jsonpb` **v1.5.4**, not protojson. The pinned Istio API
revision is `23c54ad84d6e`:

| Dependency source | Git blob | Evidence |
| --- | --- | --- |
| `istio/api/mesh/v1alpha1/config_json.gen.go` | `20a0af3f2d044d1ee8af6782f04afb35e0081b1e` | `MeshConfig.UnmarshalJSON`, `ConfigUnmarshaler` with unknown fields allowed |
| `istio/api/mesh/v1alpha1/config.proto` | `efe2a169300f71bcad0bb17afda6a03d5b385772` | Supported top-level protobuf names; selector names already camelCase |
| `golang/protobuf/jsonpb/decode.go` at v1.5.4 | `c6f66f10393d28df299086da373edf3ba8b1041e` | Field lookup at lines 320–340: protobuf name first, present JSON name wins |

The nine projected top-level fields now accept both spellings. In particular,
`enable_auto_mtls: false` is not silently discarded and replaced by an enabled
default, and `root_namespace` / `discovery_selectors` affect the captured
namespace context. A present camelCase key wins even when null or malformed;
the snake_case value is not a fallback. Normalization occurs before the existing
bounded validation and shared/local merge. Selector `matchLabels` and
`matchExpressions` are the actual protobuf names; snake_case variants remain
unsupported, and label-map keys stay literal. This is source-inspected regression
evidence, not a full protobuf-unmarshaling oracle or an expansion of supported
ProxyConfig/extensions.

**Networks acceptance dependency:** pinned `setFileConfig` calls
`setFileMeshNetworks` before declaring file success. For the new mounted-file
branch, the native adapter resolves the direct networks-file reference
(`--networksConfigFile`, default `/etc/istio/config/meshNetworks`) and reads its
declared key. Missing keys and empty YAML/network maps are supported; missing
maps, denied/malformed inputs and nonempty/unsupported network configuration
remain unavailable. Shared-map network input receives the same bounded guard
for this branch. This is an acceptance check, not networks projection or a
claim of full parsing of the earlier standard-ConfigMap pipeline.

Mounted captures require complete versioned discovery plus controller and
ConfigMap UID/resourceVersion evidence. Selected local/shared/networks sources
and the controller are rechecked before publishing; changed/denied/invalid
evidence cannot reuse a successful capture. Read workers remain limited to three,
with twenty controllers, existing collection limits and the shared fifteen-second
deadline. Namespace contexts clone field/source metadata. Mesh, mTLS, initial
validation and scoped Gateway inspectors disclose captured source provenance.
This remains a bounded snapshot, not a transactional or continuously watched
proof of applied configuration.

`scripts/parity/mesh-config-source-oracle.mjs` extracts original pinned Go path,
reference, same-context file-selection and `parseArgsInto` helpers. Its original
**141 path/reference cases** comprise **116 comparisons plus 25 explicitly
stricter native guard cases**. The continuation adds **122 argument cases**:
**106 comparisons plus 16 native guards**, executing the original caller with
its pinned **pflag v1.0.10** dependency. They cover split/equals flags, repeated
assignments, positionals, ignored values, argument termination and explicit
rejection instead of the upstream parse/path fallback. Native guards are not
counted as matching upstream behavior.

Cache the audited generator-only dependency with
`go mod download github.com/spf13/pflag@v1.0.10`, then run
`node scripts/parity/mesh-config-source-oracle.mjs --check` (or supply
`--source <pinned-kiali>` for local source files, including `go.mod`/`go.sum`).
The generator checks all source blobs and the upstream module sums; its Go
execution disables module/network lookup and uses a temporary module outside
the repository. No plugin runtime dependency is added. `parity:check` verifies
artifact identity/counts. Transport, networks parsing and complete protobuf
parse→fusion→backend-default behavior remain **oracle gaps**.

The next bounded milestone is nonempty networks acceptance and complete
protobuf parse/fusion/default evidence, followed by separately audited
configuration-cluster mapping. Existing TLS consumer differences also remain
open: `business/tls.go:82–110` uses the Istiod namespace for its mesh-wide path,
and `business/mesh.go:94–109` resolves identity domains differently from the
native explicit/injector-domain calculation. No workload/port/subset mTLS,
principal-absence checker or new Gateway rule is enabled by this batch.

Browser contribution/console/i18n/accessibility, hosted fixtures, Desktop and
live-cluster gates remain **open**. No Headlamp endpoint or configured Kubernetes
context was available in this cloud session; no cluster install, fixture
application or cleanup occurred. Local validation is recorded in `PLAN.md`,
not substituted for live-load evidence.

### Controller container provenance

The active pinned discovery caller reads `istiod.Spec.Template.Spec.Containers[0]`
for environment, arguments, mounts and resource fields. Native controller
observation now uses that first declared container rather than preferentially
selecting a later container named `discovery`. Image, cluster ID, shared source
and override guards all use the same selected object. Mesh inventory identifies
the inspected container explicitly. Malformed first records fail discovery;
missing/empty containers remain configuration-blocked, without skipping ahead.

Verification passed **1,961 focused tests in five files**, the full **22,108-test/
181-file** suite and normal gates. Three hosted groups made twenty intercepted
GETs, checking order reversal, first-only shared reads, malformed-first rejection
and missing-source blocking. Revision-tag regressions also passed. Unintercepted
managed `aks-istio-system/istiod-asm-1-30` confirmed the displayed first container
is `discovery`, with its actual captured image. No settings or cluster objects
were changed.

This corrects container selection, not complete control-plane discovery.
Local self-management compares the observed ID to
the logical cluster name independently of `ManagesExternal`; do not infer that
logical name from the Headlamp context or saved telemetry identity.

### Ordered controller environment observations

The literal environment projection now follows the active first-container loop:
the last `CLUSTER_ID` and `SHARED_MESH_CONFIG` assignments win, including omitted/
empty values that clear earlier declarations. Exact `EXTERNAL_ISTIOD=true`
declarations accumulate; later false values do not undo them. The original loop,
constants and `kubernetes.EnvVarIsTrue` execute offline in **211 new Go cases**,
bringing independent Go evidence to **19,733 cases**. The oracle compares these
three projected fields; retaining the original gateway branch in the harness
does not claim native gateway-scope behavior.

The additional source pins are `istio/constants.go`
(`90de803c8c48862ba48b34fcfcb5c633a12c3956`) and `kubernetes/kubernetes.go`
(`b7e149defa6ac6705c089fa3445f0c6c0f388820`). Native guards deliberately remain
stricter than the literal Go model: a final indirect assignment is unknown,
not an earlier-value fallback; superseded indirection does not replace a final
literal. Any unresolved external indirection or noncanonical flag string
blocks configuration eligibility. General Go boolean aliases are not promoted
to pinned true or trusted as resolved runtime topology. Malformed environment
lists/records fail discovery instead of silently dropping entries.

Verification passed **277 focused tests in four files**, the full **22,340-test/
182-file** suite and normal gates. Four stock-hosted groups made forty
intercepted GETs across assignment/clear, indirection, exact-true accumulation,
noncanonical flags and malformed-input cases. No superseded or indirect source
was read. Unintercepted managed Istiod first-container image/name and final
literal cluster ID matched the UI. No settings or cluster objects changed.
At this prior checkpoint, logical-cluster mapping, complete managed scope and
Service checker activation remained separate prerequisites.

### Explicit logical mesh identity

An optional `meshClusterName` setting now maps a Headlamp context to an explicit
logical mesh cluster name for captured local-ID comparison. The browser-local
per-context value has no default, stays distinct from `telemetryCluster`, and
requires 1..256 characters without surrounding whitespace, controls or unpaired
surrogates. Absence remains absent; explicit clearing stores null. Other
contexts and metric settings are preserved.

Mesh inventory captures the name with an explicit discovery request. Only the
relevant logical-name/config-validity signature invalidates it, synchronously
hiding stale results and cancelling pending reads. Returning to a former value
does not resurrect the capture; unrelated telemetry changes do not refetch.
Comparison is exact and independent of external-management flags, following
the pinned `controlPlane.ID == cluster.Name` local association condition.
Unknown literal IDs/mappings stay unavailable, and matching does not clear
existing external/configuration guards.

This is declared comparison evidence, not a complete managed-context/namespace
model. It deliberately does not change Kubernetes routing or prior label-based
configuration inspection. Service validation separately requires this explicit
mapping and the complete local-scope evidence below.

Verification passed **354 focused tests in six files**, the full **22,359-test/
182-file** suite and normal gates. Four stock-hosted groups made 33 intercepted
GETs, covering no implicit fallback despite equal context/metric/controller
names, real Settings save/hard-reload/clear, exact comparison with external
guards intact, unrelated-setting stability, invalidation/no resurrection and
pending cancellation followed by explicit retry. Environment regressions also
passed. Settings were restored durably; no cluster object was changed.

### Declared local managed-namespace scope

`core/meshMembership.ts` and `localManagedNamespaceScope` supply typed evidence
for an explicitly mapped local/default-visibility scope. All three source
collections must be complete and versioned, every captured controller must have
resolved configuration, and supported controllers must have matching literal
logical IDs, known Maistra classification and no unresolved external topology.
The projection retains source controller order and all matching controllers,
rather than pretending to select a unique configuration.

The default Kiali visibility rule follows the prefix regex in pinned
`istio/discovery_selectors.go`: `kube-*`, `openshift*`, `ibm*`,
`kiali-operator*` and `istio-operator*` are excluded. Visible controller/root
namespaces retain `ControlPlaneForNamespace` exceptions. Other membership uses
the source `GetRevision` projection, first selected tag replacement, observed
Maistra namespace-key handling and validated Istio discovery selectors. This
does not reuse conservative injection-label hints as a complete membership set.
Coincident non-Maistra revision matches for Maistra membership defer rather than
silently supplying an unsupported association.

Controller Maistra classification uses presence of `maistra.io/owner`,
`maistra.io/owner-name` or `maistra-version`, including empty values. The source
is the pinned `models/mesh.go` classifier. Namespace/selector validation,
complete controller-namespace presence and existing 20-controller/1000-namespace/
200-tag bounds prevent truncated or malformed scope from becoming successful
absence evidence.

The Mesh view exposes eligible namespaces, ordered declaring controllers and
separate unmanaged/default-hidden lists. The existing configuration-inspection
path remains unchanged. Remote contexts, custom Kiali visibility overrides and
full physical membership remain open.

Verification passed **2,229 focused tests in eight files**, the full
**22,377-test/183-file** suite and normal gates. Four stock-hosted groups made
25 intercepted GETs, covering tag/selector/default visibility, own/root
exceptions, declared revision precedence alongside conflicting-label diagnostics,
Maistra presence, unsupported mappings and denied sources. No cluster objects
were changed.

### Service port checks

The explicit Service inspector consumes the declared local/default-visibility
projection. It accepts a Service only when its namespace is in the captured
projection, then reads every eligible namespace's complete, versioned Pod list
and the complete cluster-wide Deployment list. A denied, malformed, timed-out,
truncated or unversioned source aborts the whole check rather than returning
partial findings. Reads share a 15-second deadline and Pod namespace requests
are bounded to three concurrent workers. The selected Service is captured by
UID/resourceVersion and re-read after the other evidence; changed identity,
spec, labels or annotations discard the result. The all-exclusions annotation
skips discovery. The scope remains local-only; remote contexts and custom Kiali
visibility are not inferred.

The active caller is pinned to `business/checkers/service_checker.go`
(`e35d1f2dce753daae5397d602625995eced89dc7`) and
`business/checkers/services/port_mapping_checker.go`
(`904caff5e74ffa6c6559ade3070c4cecd544a78e`), with inputs assembled in
`business/istio_validations.go`. KIA0601/KIA0602 naming checks run only when
all matching pooled Pods have sidecars or any has ambient redirection.
Sidecars derive from `sidecar.istio.io/status` (including named
`istio-proxy` init containers); ambient requires the exact
`ambient.istio.io/redirection=enabled` annotation. No Pod namespace re-filter
or correlation `proxyMode` is used. Empty Pod matches preserve upstream's
vacuous all-true sidecar behavior. A present invalid `appProtocol` emits KIA0602
without falling back to the port name; valid Kubernetes/Istio app protocols
supersede name checking. UDP skips naming only, and `kiali_wizard` label
presence skips naming even when the value is empty.

KIA0701 is independent of mesh naming. The checker skips mapping only for
control-plane namespaces and the exact waypoint/gateway labels. It selects the
first cluster-wide Deployment whose **metadata labels** match a nonempty
Service selector; Deployment namespace, Pod ownership and template selector do
not participate. An empty Service selector matches every Pod in the pool
but selects no Deployment. Named target ports compare against declared
container-port names; positive integer targets compare numerically, while
omitted/zero targets fall back to the Service port. Container protocols are
not compared. The pinned caller emits no missing-Deployment finding. These
findings do not establish reachability, listener acceptance, runtime injection,
health or full mesh validity.

Bounds are 1,000 Pods and Deployments per read, 100 Service ports,
100 containers and 100 ports per container in the selected Deployment,
20,000 aggregate metadata labels, 1,000,000 annotation characters and bounded
per-object strings/maps. Malformed relevant records fail closed. These analysis
limits do not assert that the host buffers no larger initial API page.

Source-informed tests cover caller selection/port semantics, pooled inputs,
empty selectors, annotations, gateway/control-plane exclusions, first-match
ordering, exclusions, stale Service captures, pagination and completeness
guards. No new original-Go differential oracle or live positive Service fixture
was added. The Services-list link and explicit inspector have unit/UI coverage,
but this session had no running Headlamp target or configured Kubernetes
CLI/context. Browser contribution/i18n/a11y and console checks, hosted fixtures,
Desktop and live-cluster verification remain open; the inspector is not
described as live-verified. The **118 focused tests in four files** and full
**22,491-test/186-file** suite pass, as do type-check, lint, production build,
resource/dashboard generation, catalog parity and formatting gates.

### Declared managed-revision selection
`core/namespaceRevision.ts` ports the label-only `GetRevision` selector from
`istio/kubernetes.go` (blob `1ae3f6611d27f964da9d3024ee339615cddd9f5b`),
with the original ambient projection from `models/namespace.go`.
The new offline Go oracle executes **1,538 independent cases** across absent,
empty and explicit revision/injection/ambient/Maistra membership/ignore values.
All four source files are checksum-pinned. Independent original-Go evidence now
totals **19,158 cases**; this is not a full discovery or managed-namespace oracle.

Maistra membership presence wins unless the ignore label is present, regardless
of its string value. Enabled injection then wins over revision. Ambient uses
default only when the revision label is absent; an explicit empty revision
prevents that fallback. This helper is distinct from the Namespace DTO's
injection-revision projection, which has different disabled-label behavior.
Native provenance is shown alongside existing conservative injection/controller
hints, not substituted for complete controller resolution.

The mesh-labelled filter now retains Maistra-only/ignored labels. Coincident
Istiod revision hints cannot resolve a Maistra membership automatically; explicit
controller/root namespace exceptions are preserved. Assessment links require a
ready configuration context. Relevant malformed labels defer explicitly.
This does not infer runtime injection.

The shared mesh loader now captures the cluster before awaiting and applies a
fifteen-second whole-discovery deadline, including configuration enrichment.
Timeout aborts outstanding reads instead of returning a success-shaped partial
capture; caller-owned signals remain untouched. Existing partial per-source
errors still remain distinct from timeout.

Verification passed **1,713 focused tests in eight files**, type/lint/i18n/build
and source/resource/catalog/parity checks. Four hosted groups/eighteen
intercepted GETs checked precedence, empty values, ignored-label presence,
Maistra resolution blocking, filter behavior, malformed inputs and deadline/
retry (**15,544 ms**). An unintercepted Bookinfo read confirmed the rendered
`asm-1-30` candidate. No settings or cluster objects were changed.
The full shared-consumer regression suite also passed **21,564 tests in
177 files** at this increment.

The Service checker audit found an important remaining prerequisite:
`IstioValidationsService.Validate` pools Pods across all managed namespaces,
and `FilterPodsByService` matches labels without an additional namespace test.
An empty selector matches the pooled set. `HasIstioSidecar` is an all-Pod test
that returns true for an empty set; `HasAnyAmbient` is separate. Sidecar evidence
comes from the parsed status annotation (including named native init containers),
not the native correlation `proxyMode` field. Deployment port matching uses the
first cluster-wide Deployment whose **metadata** labels match, and control-plane
exclusion is namespace-only across control-plane clusters. Namespace-local Pod/
Deployment approximations are therefore insufficient for KIA0601/KIA0602/KIA0701.
These checks remain deferred pending complete managed-scope evidence.

### Same-context revision-tag precedence

The local projection now follows the original `Discovery.setTags` collection
and assignment loops in pinned `istio/discovery.go`
(`60f6f7ab41a65acc5f40ca1095ce279433e62dce`). The first captured webhook for each
raw revision wins. A selected tag replaces the raw revision for namespace
matching; later aliases are retained for inspection but never unioned. Different
revisions with the same selected tag remain ambiguous. An explicit empty tag
blocks raw-revision fallback; missing/empty controller revisions are preserved
as empty rather than synthesized `default`. ConfigMap naming separately treats
empty/default as unsuffixed.

The new offline oracle executes **364 original-Go cases**, bringing total
independent Go evidence to **19,522 cases**. Its single managed context isolates
local precedence, not full cross-cluster assignment. Production Kiali can
overwrite a control plane's tag from a later managed cluster; that topology,
logical cluster identity and full managed-namespace membership remain open.

Mesh inventory lists first/ignored captured webhooks with their raw revision
and tag values. Assessment links derive from a ready configuration context,
preserving own/root namespace exceptions even without ordinary label matches.
Links carry an explicit target context and serialized query parameters.
Malformed/incomplete evidence, conservative conflicting-label guards, Maistra
membership and discovery-selector exclusions still block automatic resolution.
No new finding code or Service checker is enabled.

Verification passed **1,958 focused tests in five files**, the full **21,932-test/
178-file** suite and type/lint/i18n/build/generation checks. Five stock-hosted
scenario groups made 37 intercepted GETs; namespace regressions made 18 GETs
with a 15,049 ms timeout/retry. An unintercepted Bookinfo read still rendered
`asm-1-30`. No settings or cluster objects were changed.

### Configured namespace discovery

The shared mesh context now evaluates valid discovery selectors instead of
deferring all nonempty selector configurations. The source contracts are
`istio/discovery_selectors.go`
(`d626f99beef4117f97aab6c62320aa989ced27a9`), its managed-namespace call in
`istio/discovery.go` (`60f6f7ab41a65acc5f40ca1095ce279433e62dce`), and the own/root
namespace exceptions in `models/mesh.go`
(`518a4242407e27452bb199b91344456d89908ad4`).

`namespaceDiscovery` reuses strict Kubernetes label-selector decoding:
selectors are ORed, each selector's requirements are ANDed, and In/NotIn/
Exists/DoesNotExist retain absent-key behavior. Keys now require whole-string
qualified-name matches; values honor the 63-character Kubernetes syntax.
Empty values and nil existence-value lists remain supported. Evaluation is
bounded to 100 selectors and 1,000 combined selectors/requirements/values.
Any malformed selector makes the assessment unavailable rather than being
silently skipped, even when another selector matches. This is intentionally
more conservative than upstream's log-and-skip handling.

Automatic configuration resolution still needs a unique label/tag-associated,
own-namespace or root-namespace local controller. Unrelated unlabelled,
ambiguous, remote and incomplete contexts are not guessed. The native
configured-selector assessment does not apply Kiali deployment visibility
overrides or its default system-namespace hiding. This is configured scope,
not actual mesh membership or enforcement.

Mesh inventory renders selector declarations and a separate namespace-context
table. Reference-validation export defaults accept only resolved context.
Explicit configured-mTLS assessment also checks these selectors before issuing
policy reads; excluded or malformed scope cannot yield a configured status.
No new per-cluster settings or cluster writes were introduced.

Real hosted reads resolved Bookinfo's unrestricted local context and the
control-plane namespace exception, while retaining the visible absent-shared-map
diagnostic. Five intercepted cases verified inclusion, root exceptions,
exclusion blocking mTLS before policy reads, malformed selectors, OR matching
and explicit empty selectors. The fixture changed only a ConfigMap GET
response; no ConfigMap was written. These tests are source-informed, not an
independent Go selector oracle. The full suite passed **9,960 tests in 83 files**;
independent original-Go evidence remains **9,129 cases**.
A matching-selector fixture also allowed real policy reads and returned the
bounded `UNSET` configuration indicator. This did not install a selector or
prove observed encryption.

## Configured mTLS composition

`core/mtls.ts` ports the configuration-status composition in pinned
`util/mtls/status.go`, with 2,600 outputs executed by the original Go functions.
Policy selection helpers follow `kubernetes/istio.go`; their source identity is
`c574a501bb73e9c479c4e5e4e07d87220325d6d3`. The Go oracle covers status
composition/inheritance, not the complete resource-selection or TLS service.

`data/mtls.ts` and `Mtls.tsx` provide a namespace-wide consumer. Controller
selection is explicit; root configuration must resolve, DNS must be configured
or reported by the injector, and policy collections must be complete.
Istio's automatic-mTLS default is labeled when used, not presented as an
explicit observation. Ambient contexts, conflicting wide policies/wildcard
rules and unknown selector fields do not produce an indicator.

The consumer deliberately treats `{selector: {matchLabels: {}}}` as
namespace-wide and refuses conflicting first-match results. The pinned
low-level `PeerAuthnHasMTLSEnabled` helper skips any present selector; the low-level
port preserves that behavior while the conservative consumer corrects scope.
Raw inherited status names are explained without equating an enabled mesh
indicator with STRICT enforcement or observed encryption.

## Observed connection-security telemetry

The pinned `graph/telemetry/istio/appender/security_policy.go` is the active graph
security caller when `securityPolicy` or all appenders are requested. It uses
destination reporter data and conditionally queries `istio_requests_total`,
gRPC message counters, and TCP byte counters, grouping by source/destination
identity, principals and `connection_security_policy`. Its mapper treats a
missing policy label as `Unknown`; the graph's `isMTLS` percentage is attached
only when the `mutual_tls` rate is positive and is calculated against all other
returned policy rates for that edge. The caller also maps policy rates to graph
edges and principals, which is not part of this bounded surface. See the pinned
[security appender](https://github.com/kiali/kiali/blob/0e8be887b8217bbcac5e3ae0bfcd258073949cca/graph/telemetry/istio/appender/security_policy.go),
[appender selection](https://github.com/kiali/kiali/blob/0e8be887b8217bbcac5e3ae0bfcd258073949cca/graph/telemetry/istio/appender/appender.go),
and [reporter/ambient filters](https://github.com/kiali/kiali/blob/0e8be887b8217bbcac5e3ae0bfcd258073949cca/graph/telemetry/istio/util/util.go).

The native traffic panel uses the saved explicit telemetry identity and one
Headlamp context. Its security query is one grouped request in the existing
bounded five-metric batch: destination reporter, `istio_requests_total`, and
`request_protocol,connection_security_policy` grouping for the selected
namespace/direction. It uses the captured 5/15/60-minute range, a five-minute
rate window, 15-second steps, a 15-second shared deadline, at most eight
returned groups and at most 241 samples per group. Additional labels,
duplicate groups, malformed samples, negative rates and over-budget results are
rejected as invalid response; decoded non-finite samples remain unavailable
rather than being treated as zero. A denied security read remains isolated from other
panels. Cancellation and the existing scope-keyed stale-completion guard are
tested. These are source-bound native fixtures, not execution of the full Go
appender or an independent security-policy oracle.

The projection reports `mutual_tls`-labeled, `none`-labeled, mixed, unknown,
unsupported-protocol and unavailable categories from positive labels observed
over the selected range; rate rows use the latest aligned sample. Unknown or
absent policy labels remain visible and contribute to returned-sample
denominators. Shares are only shown when every returned group has the expected
15-second sample grid, latest samples are aligned and finite/current to the
captured end, and Prometheus returned no warnings. Zero-only, empty, sparse,
stale and missing samples do not imply plaintext, mTLS or health. UI provenance
names the explicit metric cluster, namespace, captured
range and destination reporter. Its wording limits percentages/categories to
returned samples and separately disclaims policy intent, proxy synchronization,
certificate validity and authorization.

The pinned appender's ambient handling is a different evidence path: ambient
`total`/`ztunnel` modes can add source-reported ztunnel TCP queries, while
waypoint edges can receive a graph-specific 100% mTLS fallback without a
matching security-policy sample. Those modes depend on graph topology, ambient
rate selection and additional metric families; this request-level panel does not
have those inputs and labels TCP/ambient/waypoint coverage unsupported. It does
not infer ambient enrollment or workload/certificate identity.

Earlier hosted Bookinfo evidence observed `mutual_tls` at 100% of returned HTTP
rates; a transient request-chart HTTP 500 stayed isolated and later recovered.
That is historical evidence for the earlier instant query, not fresh verification
of this range implementation. No new hosted/real telemetry run or Desktop load
check was available for this increment. Real hosted Bookinfo configuration reads
previously yielded UNSET with no namespace/root policy; browser interception
separately proved root STRICT inheritance, denied-source suppression and
conflict handling without installing a policy. Effective per-service,
per-port/subset security, graph edge/principal mapping, TCP security, ambient and
waypoint evidence, authorization, and full validation remain open.

## Native HTTP trace browsing

`core/tracing.ts`, `data/tracing.ts` and `components/Traces.tsx` implement a
bounded Jaeger/Tempo search/detail slice. Source contracts follow pinned
`tracing/jaeger/http_client.go`, `tracing/tempo/http_client.go`,
`traceQLBuilder.go` and their Jaeger/OTLP JSON models. Tests use synthetic
contract-shaped fixtures, not an independent Go tracing oracle.

The optional version-1 per-cluster setting stores only provider and Kubernetes
Service endpoint. Capability probes, search and trace reads use Headlamp's
public Service proxy with `Accept: application/json`; no tracing service, tenant
header, credential store or external URL is introduced. Draft provider/endpoint/
enablement changes abort connection checks. Cluster and request changes cancel
old work and suppress late results. Trace deep links load directly and the same
ID can be retried after failure.

Jaeger uses microsecond query times and `/api/traces`; Tempo uses second query
times and escaped TraceQL at `/api/search`. Both detail paths are
`/api/traces/{id}`. Tempo JSON accepts pinned `batches`, OTLP `resourceSpans`,
and legacy instrumentation-library grouping, with hex/base64 IDs. Decimal
nanoseconds and OTLP int64 attributes remain exact via BigInt internally and
string DTOs; unsafe numeric integers and overflow are rejected.

Limits are 24-hour query ranges, 1..100 results, 2,000 spans/detail, 10,000 spans
per Jaeger search, 256 attributes/events/references per collection, 10,000
attribute-value budget per trace and depth 10. An additional 10,000-record
per-trace budget bounds aggregate batches/scopes/spans/events/links. Duplicate IDs/map keys and
mismatched trace identities fail explicitly. Missing parents, parent cycles,
dropped span/resource data and partial Jaeger errors remain visible; an error-only
response is not an empty success. The native table preserves unknown error
status and provides precise timing plus parent/reference navigation.

Hosted Headlamp 0.35.0 rendered both providers' synthetic search/detail results,
exact times/int64 values and named controls, without plugin execution errors.
Checks included settings persistence, deep-link reload, same-ID retry,
missing-trace and forbidden responses. Success paths were intercepted GETs,
not live traces. A real request for an absent query Service surfaced its 404.
Temporary tracing settings and interceptors were removed afterward.

Still open: live-provider and Desktop evidence, event/link/remaining
intrinsic Tempo filter coverage and cross-span expressions, workload identity correlation, trace
graph overlays, tenant/external authentication and gRPC-only transport.
The auxiliary metadata slice below is implemented, but the view is not a
lossless raw trace viewer. Tempo v2 partial/pruned trace envelopes are not
implemented. These limits prevent a full tracing-parity claim.

### Trace detail and connection-probe lifetime

All exported tracing reads now capture provider, endpoint and cluster before
deferred work. Trace detail and capability probes join search/name discovery
under linked 15-second deadlines, including SDK calls that ignore cancellation.
This also prevents caller mutation from decoding an in-flight Jaeger response
as Tempo (or vice versa). Existing not-found, malformed-response and permission
failures remain distinct; timeout is not an empty trace or successful probe.

Transport tests cover both providers, mutated caller inputs, queued and active
cancellation, ignored SDK abort, completion cleanup and retained backend errors.
Hosted fixtures held a connection probe and trace detail response, observing
the timeout at 15,119 ms from the check action and 15,440 ms from detail-page
navigation, respectively. Explicit retry displayed the expected capability/
trace result; subsequent denial removed the prior successful state. Six reads
were intercepted and all temporary settings/handlers restored. No provider
was installed. The increment passed **16,581 tests in 127 files** and normal
gates; actual provider/Desktop and overall performance closure remain open.

### Typed Tempo attribute filters

`core/traceFilters.ts` and `TraceAttributeFilters.tsx` extend searches with ten
explicitly typed span/resource/unscoped comparisons. Strings, signed 64-bit
integers, finite floats and booleans use a type-compatible operator whitelist.
String regexes use RE2 validation; string ranges are lexicographic. All clauses
are ANDed in the same spanset filter with existing service/operation/status/tags,
not composed across different spans. No raw TraceQL or user-supplied scope
syntax is accepted; span intrinsics have separate controls.

The contract was verified against
[Grafana's TraceQL documentation](https://grafana.com/docs/tempo/latest/traceql/construct-traceql-queries/)
and Tempo commit `afbbb308bbad6caa74fe33f4f122aff6275974f8`:
`pkg/traceql/lexer.go`, `expr.y`, `enum_operators.go` and `ast_execute.go`.
The parser uses `strconv.Atoi` before unary negation. Minimum int64 is therefore
serialized as `(-9223372036854775807 - 1)`, using integer-preserving subtraction
rather than an overflowing positive token or a version-specific constant.
Integer text is never converted through JavaScript numbers. Float overflow/
underflow, malformed values/keys, unsupported operators and the shared 16 KiB
URL budget fail locally. Query-like string values remain quoted data.

Captured filter rows are separate from draft edits. A connection-signature
change invalidates submitted searches before rendering a new request and
clears them so returning to the former endpoint cannot resurrect a query.
Typed drafts remain visible for explicit removal on Jaeger; they are not
silently coerced or discarded. Requests retain the existing deadline/cancellation.
The UI clarifies that filters travel in provider request URLs and can appear
in logs, despite not being saved to settings or navigation.

Six hosted checks intercepted four GETs: all scopes/types/ranges/regex, exact
large integers and escaping/history, immutable captures, invalid inputs,
minimum int64, connection invalidation/no replay, Jaeger removal and denial.
Tracing settings were restored with exact presence/value and persistence awaited.
No provider was installed or queried live. Gates pass **15,612 tests in 106 files**.
This is contract/UI evidence, not an independent Tempo parser execution or
live-provider matching proof. Array semantics and backend versions still matter.

The presence extension adds explicit `nil` equality/inequality for missing/null
versus present/non-null attributes. Selecting that type clears irrelevant prior
text, hides the value input and limits operators to `=`/`!=`; captured rows show
the value as not applicable rather than an empty string. Nil, empty string and
false remain distinct. A hosted check verified both scopes/operators, canonical
encoding, capture display and no draft refetch using one intercepted GET.
Tracing was restored durably. Gates pass **15,614 tests in 106 files**.

### Literal Tempo attribute and tag names

Typed attributes and exact tags now share a bounded identifier serializer.
Existing simple names retain their original query spelling. Punctuation,
embedded spaces, quotes, backslashes and Unicode are encoded as a complete
quoted attribute name, using only the quote/backslash escapes accepted by the
pinned Tempo `parseQuotedAtrribute` lexer. Scope is supplied separately: a
literal key `span:status` becomes `."span:status"` rather than an intrinsic.
The inspected `expr.y` and `ast.go` constructors keep these attribute identities
distinct. No Unicode normalization, case folding or scope inference is applied.

Names remain bounded to 256 JavaScript string units; controls, unpaired
surrogates, line separators and surrounding whitespace are rejected. Exact-tag
duplicates are checked before serialization, and the shared encoded URL limit
still applies. Jaeger keeps its existing literal JSON map behavior.

Five hosted scenario groups intercepted one Tempo and one Jaeger search,
verifying complete key escaping, boolean/missing predicates, captured displays,
no draft/navigation persistence and pre-request control/duplicate rejection.
The fixture used a query-like tag name as literal data, not injected syntax.
Settings/handlers were restored; no live provider was queried. Gates pass
**16,575 tests in 127 files**. This is source-informed request/UI evidence;
actual backend matching and new Desktop evidence remain unverified.

### Event, link and instrumentation attribute scopes

The existing typed-filter pipeline now accepts `event`, `link` and
`instrumentation` in addition to span/resource/unscoped attributes. The pinned
Tempo lexer/grammar explicitly define `EVENT_DOT`, `LINK_DOT` and
`INSTRUMENTATION_DOT` and construct their corresponding `NewScopedAttribute`
values. Literal quoting, string/RE2 and scalar/nil serialization use the same
existing helpers, ten-filter limit and 16 KiB URL bound. No user-provided raw
scope or query syntax is accepted.

One hundred twenty scope/type/operator cases plus transport/UI tests cover the
added combinations. An attribute named `event:name` remains a literal key:
`event."event:name"` is not the intrinsic `event:name`. Captured scopes are
independent of drafts; provider changes discard submitted results. The UI
explicitly does not promise a same-event/link join or linked-trace traversal;
backend storage/version and array semantics remain relevant.

Five hosted groups issued three intercepted GETs for all three scopes and all
five scalar types, including exact minimum int64, false, a fractional float,
nil/presence, literal punctuation and RE2. A trace-duration intrinsic was
combined without relabeling either family. Scope drafts did not mutate the
captured table; invalid integer/regex values caused no read; Jaeger rejected
the filters; denial and explicit retry retained zero. No plugin errors or
writes occurred, and settings were restored durably. These checks exercise the
stock hosted UI and wire shape, not independent parser execution or live Tempo
matching. Gates pass **18,937 tests in 145 files**; the original-Go count remains
17,080 and bounded finding codes remain 38.

### Tempo span and trace intrinsic comparisons

`core/traceIntrinsics.ts` and `TraceIntrinsicFilters.tsx` add a separate explicit
filter family for `span:name`, `span:statusMessage`, `span:duration`,
`span:status` and `span:kind`. A subsequent increment adds canonical
`trace:duration`, `trace:rootName` and `trace:rootService` from the same pinned
grammar. Existing span fields retain their serialized spelling. Trace-root
metadata is not relabeled as span metadata or a Kubernetes Service identity.
The colon syntax is not interchangeable with
attribute dot syntax. Up to ten predicates are ANDed into the same spanset
filter, retaining the shared captured window, 16 KiB URL cap and 15-second read
deadline. Existing operation/error/minimum-duration filters are not replaced.

The public contract was inspected at the same pinned Tempo commit, including
`enum_attributes.go`, `expr.y`, `lexer.go`, `enum_operators.go` and
`ast_validate.go`. Names/messages use bounded string/RE2 comparisons; reported
status and kind are unquoted whitelisted enums limited to equality/inequality.
Single-unit durations use exact integer arithmetic before serialization as
signed-range nanoseconds. The native input rejects fractional nanoseconds,
negative/composite durations and overflow instead of reproducing truncation.
This is source-informed interoperability, not copied Tempo implementation,
an independent parser run or live-provider matching evidence.

Captured result rows preserve original duration text, empty strings and enum
values independently of drafts. Changing a field retains its draft until the
user corrects an incompatible comparison/value; it never silently replaces a
predicate. Provider changes discard submitted searches and leave drafts visible
for removal on Jaeger. Reported status is explicitly not a health verdict.

Five hosted scenario groups intercepted three search GETs, covering exact
above-JavaScript-safe duration, all five fields and distinct attributes,
historical capture, empty strings, draft/provider isolation, overflow/lossy
duration/regex rejection, denial and an explicit zero-duration retry.
The rendered captured table was inspected; settings were restored durably and
no tracing provider or cluster objects were installed.
The initial span increment passed **16,548 tests in 127 files**.

The trace-wide extension passed **18,812 tests in 145 files** and normal gates.
Its hosted rerun exercised all eight fields together, including different
span/trace durations, quoted root-name query-like text and a root-service RE2.
Five scenario groups again issued three intercepted GETs. Historical scope
and original duration text stayed captured after editing drafts; provider
changes discarded results without replay; fractional/overflow duration and
unsupported regex were rejected before transport; denial and explicit retry
retained distinct zero-valued span/trace predicates. The captured table and
console were inspected. Settings were restored durably and no provider was
installed. This is contract/UI evidence, not an independent Tempo parser run
or live-provider matching proof. Subsequent sections add metadata, ID and
event-offset intrinsics; cross-span expressions and Desktop evidence remain open.

### Event and instrumentation string intrinsics

The separate intrinsic controls now also expose canonical `event:name`,
`instrumentation:name` and `instrumentation:version`. Grammar, intrinsic mapping,
validation and operand typing were inspected at the same pinned Tempo commit;
`pkg/traceql/ast.go` has blob `3a603618aab784ec0b7ca6f2fb7fecea1d9c3fda`.
Event name is a string intrinsic; instrumentation fields retain the generic
attribute operand type in that source and are deliberately offered here only
as bounded string predicates. This is not a new parser or Go oracle.

These predicates share quoting, 1024-character values, 512-character RE2
validation, ten combined intrinsic predicates, the 16 KiB URL bound and captured
deadline behavior. Eleven selectable fields do not raise the predicate limit.
Literal/range comparisons of versions do not imply semantic-version ordering.
Colon intrinsics stay distinct from same-named dot attributes. Multiple event
conditions do not claim a same-event join, and reporting-library names do not
become Kubernetes identities. Event offsets, ID/link intrinsics and cross-span
expressions are not activated by this increment.

Verification passed **382 focused tests in five files**, type/lint/i18n/build
and resource/catalog/parity checks. Four stock-hosted groups made three
intercepted search GETs, verifying exact canonical queries with query-like
quoted strings, captured-versus-draft isolation, provider invalidation,
invalid/oversized RE2 rejection, denial/retry with an empty version and the
unchanged predicate limit. Settings were restored with persistence awaited.
No live provider was installed or queried, and no matching/backend-storage
support is inferred from intercepted responses.

### ID predicates and signed event offsets

The native filter catalog now includes `trace:id`, `span:id`, `span:parentID`,
`link:traceID`, `link:spanID` and `event:timeSinceStart`. The pinned parser is not
the whole contract: the active vParquet4 byte predicates only support equality/
inequality for IDs, despite generic string operand typing. The inspected
`tempodb/encoding/vparquet4/block_traceql.go` has blob
`13e26320e47d71fbe3ceec1a42ba0b09057206be`, and `pkg/util/traceid.go` has
`6718e7a79606942486f805ab20c04daa47e2ec63`. Native inputs reject malformed IDs
before transport instead of relying on the source's nil-predicate result for
hex parse failures.

ID literals are bounded to 32 trace/16 span hex characters, without prefixes,
whitespace or base64. Empty literals and zero values are accepted separately
from the stricter trace-detail identity decoder. Case and leading zeros are
preserved, not normalized into an unverified identity. The bounded span input
does not accept arbitrarily long zero prefixes just because the source utility
trims them. Empty/zero predicates do not claim parent absence or identity
existence. Link filters neither traverse a link nor issue a trace-detail read.

Event offsets use the active signed integer/duration storage path. Single-unit
positive or negative inputs retain exact whole nanoseconds; negative zero
serializes as zero while the captured input remains original. Magnitude is
limited to 9223372036854775807ns. The negative int64 extreme cannot be emitted
as a positive duration token followed by unary negation. Duration subtraction
in the pinned executor falls through to floating-point arithmetic, so the
native builder rejects that edge instead of constructing a lossy workaround.
Span/trace duration restrictions remain unchanged. This is span-relative event
time, not trace-relative time or a timestamp, and multiple predicates still do
not claim a same-event/link join.

Seventeen available fields retain the ten-predicate, 16 KiB URL and fifteen-
second read bounds. Field changes preserve incompatible drafts until the user
corrects them. The increment passed **461 focused tests in six files** plus
type/lint/i18n/build and generation checks. Four stock-hosted groups made three
intercepted GETs, verifying all six canonical fields, exact negative values
above JavaScript safe-integer range, empty parent literals, local invalid-input
rejection, provider isolation and denial/retry. Metadata-string regressions
made three more GETs. No provider or cluster objects were installed, and no
live-provider matching or independent Tempo parser execution is claimed.

### Bounded related-span groups

`core/traceRelations.ts` composes one additional Tempo spanset with an explicit
service, optional exact operation and reported-errors-only predicate. The
whitelisted relationships are `&&`, `>`, `<`, `>>`, `<<` and `~`. Primary
service/operation/tags/typed attributes/intrinsics remain in the left group;
the additional criteria do not silently become same-span predicates.

The pinned lexer (`a3a1f7105682e36067dc4150bdf06c60f7215fb8`), grammar
(`d7e486ae6f25e8130971ebeeeca6a9f18a50491d`) and active spanset evaluator
(`3f87fb38504a339d38a207d2fb8c2863fc30f85b`) were checked against Tempo commit
`afbbb308bbad6caa74fe33f4f122aff6275974f8`. Same-trace AND requires both groups
and returns their unique spans; it does not require distinct matches.
Structural operations return matching right-side spans. They do not prove
temporal order, causality or a link to another trace.

Related service/operation strings are quoted and bounded to 256 characters.
Malformed/unknown fields and unsupported relations fail locally; omitted
related criteria preserve existing request bytes. All groups share one GET,
window, result limit, 16 KiB URL bound and fifteen-second deadline. There is
no OR branch that bypasses the primary filter, raw pipeline, nested group or
secondary provider request. Empty optional operation means unrestricted
operation within the explicit related service.

Captured clauses are immutable and displayed separately from drafts. Provider
changes discard submissions and retain the draft for explicit disabling on
Jaeger. Verification passed **484 focused tests in seven files** and normal
type/lint/i18n/build/generation checks. Three stock-hosted groups made nine
intercepted searches across all six operators, quoted query-like operations,
draft/provider isolation, denial/retry and return to primary-only Jaeger.
Primary ID/offset regressions also passed. Settings were restored durably;
these are source/transport/UI checks, not independent parser execution or
live-provider relationship matching.

### Exact tag filters and captured search time

The search form now supports ten additional string tag equalities, explicit
historical end time and a 24-hour range option. Captured tag values are copied
into the submitted query and remain visibly separate from draft edits; they
are not written to plugin settings or navigation URLs. Keys are bounded to
256 characters, values to 1,024, and the encoded path to 16 KiB. Duplicate keys,
malformed/control-character keys and contradictory `error=false` plus
errors-only conditions are rejected before transport.

Jaeger uses a literal JSON tag map, following pinned
`tracing/jaeger/http_client.go` (blob
`3e903fc62e1bb9810d2868b61c8ebe67ba70d0c7`). Tempo uses unscoped, AND-combined
string equalities based on `tracing/tempo/http_client.go` (blob
`02b35c94390a2665d98ce3cfd6e5c8c206698b51`), with a deliberately restricted
simple identifier spelling or the quoted-name extension above, and escaped string literals.
This does not expose raw TraceQL or infer numeric/boolean attribute types.
The existing native reported-status behavior is retained: `error=true/false`
maps to `status = error` / `status != error`, not upstream's HTTP-status
`!= "200"` shortcut. Non-error can include unset status and is not health.

Searches capture provider, validated endpoint, cluster, encoded query and
decode limit before deferred work, and use the shared 15-second cancellation
deadline. Tests cover ignored SDK aborts and caller mutation of captured inputs.
No deadline was silently added to the separate detail or capability APIs.

Six hosted fixture scenarios verified Jaeger/Tempo encoding, literal escaping,
duration units, historical 24-hour bounds, immutable captured filters, no draft
refetch/URL persistence, duplicate/unsupported/conflicting conditions, removal
and denied reads. All three dispatched search reads were intercepted. Fixture
settings were restored through public ConfigStore, persistence was awaited and
interceptors removed before reload. No tracing backend was installed; actual
provider matching and current Desktop evidence remain open. The increment
passed **9,515 tests in 80 files** plus type/lint/schema/parity/i18n/build/package
gates. The final regression also rejects unexpected graph aggregation labels,
preventing extra dimensions from silently inflating projected rates.

### On-demand service and operation names

`core/traceNames.ts` and `TraceNameDiscovery.tsx` add explicit service/operation
pickers while retaining free-form entry. Clicking a suggestion only updates the
draft; it does not submit a trace search, change navigation or save settings.
Lists retain pagination, support local filtering and are explicitly incomplete
backend suggestions, never Kubernetes identities.

Jaeger service names use the pinned client's `/api/services` contract. Operations
use `/api/operations?service=...`, whose result contains `{name, spanKind}` objects,
not the legacy path endpoint's string array. This was verified directly against
[Jaeger's v1.73.0 HTTP handler](https://github.com/jaegertracing/jaeger/blob/v1.73.0/cmd/query/app/http_handler.go).
Identical operation names from different span kinds are deduplicated because the
existing search filters by name, not span kind. These lists are not time-filtered.

Tempo discovery follows the official
[typed tag-value HTTP API](https://grafana.com/docs/tempo/latest/api_docs/#search-tag-values-v2):
`/api/v2/search/tag/.service.name/values` and `/api/v2/search/tag/name/values`.
It sends captured start/end **seconds**, `limit=1000`, and an escaped literal
single-spanset `.service.name` filter for operations. Responses must contain
`tagValues` entries with `type: "string"` and string `value`; no numeric/boolean
coercion or raw query syntax is accepted. This is native provider autocomplete,
not the pinned Kiali Tempo client's `/status/services` component-status path.

Names are bounded to 256 characters without controls; at most 1,000 raw entries
are accepted before deduplication. Malformed/error envelopes and unsupported
endpoints are reported explicitly, without fallback requests or truncation.
The adapter captures the provider/endpoint/cluster/kind/query before awaiting
transport and uses the existing 15-second abort deadline. Closing or changing
scope discards late results. The common Service-proxy path helper now permits
literal dots for these fixed API paths but rejects dot segments, encoded
traversal, query/fragment delimiters, backslashes and trailing newlines.

Six hosted fixture scenarios covered both providers, historical Tempo scope,
operation deduplication, local filtering, denial, invalid typed values, oversized
and empty lists. Eight name requests were intercepted; no trace search or write
was dispatched. Temporary tracing settings were restored and persistence awaited.
Actual provider and Desktop evidence remain open. The checkpoint passed
**13,115 tests in 90 files**; independent Go evidence remains **12,160 cases**.
These new HTTP/UI tests are contract-informed, not an original-Go algorithm oracle.

### Span, scope and link metadata

The native DTO/view now retains Jaeger raw/sampled/debug/firehose flags and OTLP
raw/sampled/remote-context flags. Missing flags remain unknown; explicit zero
means a reported unset sampling bit. OTLP's known-remote mask is checked before
interpreting remote/local, and unknown high bits are preserved. Status messages,
unknown codes, trace state, distinct resource/scope schema URLs, instrumentation
scope attributes and dropped counts are visible. Link metadata opens in an
accessible, bounded dialog rather than expanding into an unreadable nested cell.
Scope/link int64 values remain exact strings and share the attribute-value budget.

The OTLP metadata contract follows the dependency pinned by Kiali's `go.mod`:
[`go.opentelemetry.io/proto/otlp` v1.10.0](https://github.com/open-telemetry/opentelemetry-proto-go/blob/otlp/v1.10.0/otlp/trace/v1/trace.pb.go),
source blob `d7bfca90299a0940e275f1ac95f87c89503614d3`. Jaeger flag masks follow
[`model/v1/flags.go` at 4f6fc86](https://github.com/jaegertracing/jaeger-idl/blob/4f6fc86c5b9e20e15f82a8f9c0033563c20ec445/model/v1/flags.go).
These supplement the pinned Kiali JSON models; no runtime Go dependency is added.

Metadata text bounds are 512 characters for trace state, 1,024 for scope name/
version, 2,048 for schema URLs and 4,096 for status messages. Unsigned flags/
drop counts must fit uint32; status codes must be bounded scalar values.
Conflicting standard/legacy OTLP aliases are rejected rather than silently
discarded. Integer and identity parsing now requires a full-string match, so
trailing newline input is not normalized into another identity or timestamp.
These are source-informed tests, not a new independent Go oracle.

The increment passed 7,673 tests in 72 files and normal gates. Hosted fixtures
verified both providers, zero/false/empty metadata, exact scope/link attributes,
dialog labeling/close behavior and restored settings. An early screenshot
captured MUI's fade transition; a settled screenshot confirmed an opaque white
dialog in the light theme. New Desktop evidence remains blocked on the absent
debug target, and no live tracing provider was installed.

### Explicit trace-to-Pod verification

`core/traceCorrelation.ts` extracts only explicit `k8s.namespace.name`,
`k8s.pod.name` and `k8s.pod.uid` string attributes from resource/process and
span attributes. All three are required. Duplicate identical values retain
provenance; conflicts, malformed fields and incomplete identities disable
lookup. Service names, instrumentation-scope attributes, linked-span attributes
and reported cluster labels are not used to guess a Kubernetes identity.

`data/traceCorrelation.ts` captures an immutable target and the selected cluster,
then reuses the scoped diagnostic Pod reader. Exact UID equality is mandatory
before native Pod/diagnostic links appear. Verification is explicit, never an
automatic read on span inspection. Scope/trace/identity changes clear links and
require a new action. Links are current namespace/name navigation after a
point-in-time UID check, not permanently UID-bound URLs or proof of trace origin.
Historical objects may no longer exist.

The 15-second deadline is shared with logs/proxy snapshots and races cancellation
against SDK completion. A non-cooperative SDK cannot publish late success;
the helper also avoids starting deferred work after immediate cancellation.
This does not remove the separately documented stock-host late-socket limit.

Hosted scenarios verified one real Bookinfo Pod GET for matching/mismatching
reported UIDs, an intercepted denial, and zero lookups for missing/conflicting
attributes. Trace data was synthetic; no collected trace provenance is claimed.
The new native and diagnostic link URLs retained exact scope and serialized
query parameters. The full suite passed 7,700 tests in 75 files and normal gates.

Browser verification also exposed Headlamp's ConfigStore persistence debounce.
An earlier owned fixture endpoint survived an immediate hard reload; it was
cleared. Setup/cleanup now waits for stored `pluginConfigs.kiali` to match the
public ConfigStore value before reload, inspecting only Kiali's slice. The
test profile's tracing setting is now disabled in both memory and storage.
This was test-harness cleanup, not a host patch or a change to ConfigStore.

## Current configuration and telemetry increment

The configuration-kind inventory now covers **23** kinds: the original 14
live-schema Istio kinds plus nine upstream-schema Gateway/inference kinds.
Gateway API v1.6.0 is pinned to `89b3b0c3fa63f9342f43ba0fb2cf93d6aab53af7`;
inference-extension v1.5.0 to `df9f8909fe06fe2dfd4a6fc0bd0c01a0acabf849`.
The generator checks each source blob before sanitizing spec/status. Runtime
versions still come from cluster discovery; no CRD is installed automatically.

GatewayClass is cluster-scoped throughout discovery, routes, lists, CRUD paths,
metadata and SSAR attributes. Gateway API Gateway is distinct from Istio Gateway.
Typed status aliases supplement full supplied-field rendering. Nested parent
and listener conditions are moved to the final Conditions group while preserving
identity and the remaining status. Safe structural printer-path evaluation
supports condition equality and wildcard arrays without evaluating code.

All nine actual absent-API states loaded in stock hosted Headlamp. Populated
GatewayClass/Gateway/HTTPRoute/InferencePool pages, native references, nested
conditions and cluster-scoped create confirmation were exercised only through
browser interception. SSAR, dry-run and final writes were all intercepted.
No live Gateway configuration exists, and no controller reconciliation or real
write success is claimed. The hosted Map filter showed all 23 opt-in leaves
and real icons for the new kinds, but reference edges
beyond Services and complete semantic Gateway checks remain open.

| Surface | Implementation | Evidence | Still incomplete |
| --- | --- | --- | --- |
| 23 configuration models | `src/resources/`, generated from two schema snapshots | Live Istio and pinned upstream Gateway/inference schemas; deterministic generation and model tests | Actual Gateway resources, additional server/schema release matrix |
| Configuration lists/details | `components/configuration/Configuration.tsx` | Stock-host discovery and empty-list rendering; populated synthetic detail rendering, nested fields, unknown status, Conditions before Events | Populated real CR integration and Desktop verification for this increment |
| Discovery gate | `data/configuration.ts`, `ConfigurationGate.tsx` | 401/403/404 distinction, resource scope validation, supported version selection, separate endpoint-cache ownership | Additional cluster/server-version matrix |
| Mutations | `data/mutations.ts`, `ConfigurationActions.tsx` | Spec CRUD and annotation-only validation exclusions, scoped confirmation, UID/version/acknowledgement guards and no retry; browser writes intercepted | Real write integration, YAML forms and broader workload/namespace mutations |
| Initial checks | `core/validation.ts`, reference/Gateway/local/policy/group and Service port modules, `core/gatewayWorkloads.ts`, `data/validation.ts`, `data/gatewayValidation.ts`, `data/servicePortValidation.ts` | Forty-one bounded codes, including declared-scope KIA0302/controller flags, Gateway listener/status/class/collision checks, AuthorizationPolicy host registry, peer-policy, ServiceEntry/DestinationRule conflicts/TLS patterns and KIA0601/KIA0602/KIA0701 over complete declared local scope; source-bound oracles, source-informed tests and earlier hosted fixtures | Attachment/per-workload/principal context and remaining checkers remain; Gateway scoped and Service port browser/live/hosted verification is open; dormant Gateway port-name checks are not activated |
| Structural Map | `mapView.tsx` | Grouped parent with 23 registered leaf sources; target Service inclusion and edge de-duplication tested | Populated live CR graph and reference edge families beyond Services |
| Traffic metrics | `core/telemetry.ts`, `data/telemetry.ts`, `Traffic.tsx` | Query escaping, scoping, bounds, partial errors, fixture charts plus real hosted Bookinfo request/p95 data | Live TCP series, custom dashboards, full upstream query/default parity |
| Basic request graph | `core/trafficGraph.ts`, `TrafficGraph.tsx` | Positive-rate edges, keyboard node selection, companion table and six real Bookinfo edges | Original request-only view; advanced work is on the separate topology route |
| Traffic topology | `core/topology.ts`, `data/topology.ts`, `Topology.tsx`, graph resource candidates | Four projections, source/destination/combined reporter modes with exact paired-series identity and provenance, source-aligned unserviced ingress, separate request/byte/message units, captured history, filtering, edge metadata and explicit current-resource candidates; namespace-position stage, source-aligned table grouping and neighbor focus; 1,728 Go identity cases; hosted Bookinfo single-reporter and negative fixtures | Complete upstream query/default/missing-report parity, complete appender parity (per-appender ledger above), upstream graph boxes/node-detail routes, ambient/waypoint, historical resource identity/trace links, mixed-mode hosted/console/i18n/a11y verification and Desktop |

These are **partial implementations**, not closure of their corresponding full
milestones. The captured Istio kinds are VirtualService, DestinationRule, Gateway,
ServiceEntry, Sidecar, WorkloadEntry, WorkloadGroup, EnvoyFilter,
AuthorizationPolicy, PeerAuthentication, RequestAuthentication, WasmPlugin,
TrafficExtension and Telemetry.

Every supplied spec field is rendered in a named section; status fields,
including preserved unknown extensions, are rendered separately. Objects and
arrays retain their nesting rather than being flattened or dumped as JSON.
Multiline text uses read-only Monaco. Initial references link named
VirtualService destinations, mirrors, delegates and gateways and DestinationRule
hosts; a reference link is not proof of target existence.

A validation callback originally depended on an unstable host translation
function and repeatedly restarted its request. Live verification caught it; the
callback now depends only on resource/scope and translates the error state at
render time. A regression test deliberately returns a fresh translator each
render. Do not add a translation function to request dependencies when it is
used only to format result text.

At initial verification, Desktop CDP was not listening and the existing demo
Prometheus was crash-looping after OOM kills. The actual Service proxy returned
"no endpoints", which the metrics panels show as errors without zero-valued
fallbacks. Fixture-backed success paths are explicitly distinct from this live
failure. No configuration test resource was installed or mutated by those checks.
The user subsequently authorized deleting Prometheus history. Its emptyDir was
cleared by replacing only its exact pod; the new pod is ready with zero restarts,
six Bookinfo scrape targets are up, and a query before the reset returns no
historical samples. Configuration and the 1 GiB memory cap are unchanged. This
restores the backend but is not yet a new live chart-parity verification.

The KIA0004 core check requires a complete workload universe. The validation reader
does not provide complete mesh-workload inclusion evidence, so the UI deliberately
keeps it incomplete. Bounded application/resource correlation, including observed
WorkloadGroup labels, is separate evidence and cannot justify absence findings
for every mesh workload or custom controller.

The caller-activation audit additionally restricts the helper to the four pinned
production callers: AuthorizationPolicy, PeerAuthentication and
RequestAuthentication in `security.istio.io` use `selector.matchLabels`; Sidecar
in `networking.istio.io` uses `workloadSelector.labels`. The previous generic
selector-shape detection could emit inappropriate deferrals for inactive kinds,
and would have emitted inappropriate KIA0004 findings if given `complete: true`.
DestinationRule, ServiceEntry, EnvoyFilter, Telemetry, WasmPlugin and unrelated
groups do not activate this helper merely because a spec contains a selector.
The Sidecar `matchLabels` fallback has been removed. Empty/null selectors need no
workload evidence; malformed or oversized active selectors are explicitly deferred
using the existing bounded Kubernetes selector decoder.

All eight audited helper/caller/stub source files matched the pinned inventory
Git blobs, including `common/workload_selector_checker.go`
(`544efcbf0f0bd9abe3975f06b995bfead38c1193`). Four hosted scenarios/eight intercepted
resource GETs verified inactive Telemetry/WasmPlugin behavior, preserved
RequestAuthentication completeness gating, and malformed-input disclosure without
claiming a healthy/valid object. Gates passed **334 focused tests in five files**
plus type/lint/build and source/resource/catalog/parity checks. No cluster writes
occurred. This adds no finding code or independent Go oracle cases.

The broader dashboard checkpoint at `08b4021` passed the full suite:
**19,978 tests in 176 files**. The selector activation correction above was
subsequently checked with its targeted suite; historical full-suite counts in
earlier increment descriptions refer to those earlier checkpoints.

Hosted console observations retain the known host CRD-v1beta1 discovery 404 and
watch-close diagnostics during route changes. No plugin execution failure
remained in the exercised final views.

## Verified initial native slice

| Surface | Implementation | Desktop and hosted-web evidence | Remaining boundary |
| --- | --- | --- | --- |
| Overview | `components/Overview.tsx` | Istio served versions and Prometheus 3.10.0 shown; named controls and nonblank English labels | API presence is not control-plane health; no traffic charts |
| Settings | `config.ts`, `core/config.ts`, `components/Settings.tsx` | Actual UI saved `istio-system/prometheus:9090`; connection succeeded in each profile; Desktop reload retained it | Explicit Service reference only; no automatic endpoint discovery or external-service credential support |
| Reactive connection state | `hooks/useRequest.ts`, `data/requests.ts` | Desktop overview changed immediately when configuration was disabled or pointed at a missing Service, then recovered on restoration | Restricted-user scenarios remain fixture-tested, not live-tested with a second identity |
| Namespaces | `components/Resources.tsx` | Native rows show Bookinfo's `asm-1-30` revision and Active phase | No namespace mesh-health summary or custom namespace actions |
| Services | `components/Resources.tsx` | Namespace filter restricted rows to the four Bookinfo Services; ports rendered; name opened native Service details | Not Kiali's service correlation, health or configuration detail view |
| Workloads | `components/Resources.tsx`, `core/readiness.ts` | Six Bookinfo Deployments show `1/1`; Jobs tab is honestly empty and retains kind/namespace in the URL | Five native controller tabs; grouping now exists in the separate Applications view; OpenShift extensions and custom Kiali details remain planned |
| Scope and errors | `core/scope.ts`, `data/requests.ts`, `hooks/useRequest.ts`, cluster comparison | Explicit cluster requests; bounded read-only comparison and per-source errors, cancellation, late responses, malformed payloads, prototype-like cluster names and 401/403/404 classifications covered by tests | Configuration/mutations remain single-cluster; full graph/store normalization remains open |

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
The native slices described here are explicitly partial implementations of the
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
| Apps, workloads, Services, pods | `Resources.tsx`, `Applications.tsx`, `core/correlation.ts` | Typed resources and label/owner indexes | Partial native browsing and scoped correlation / same |
| Istio configuration, permissions and supported forms | `src/resources`, configuration views/actions | API discovery and confirmed RBAC writes | Implemented-unverified in Desktop / partial, hosted fixtures and real empty-list checks |
| Metrics, dashboards, statistics, overview rates/latency | `src/core/telemetry`, charts | Existing Prometheus-compatible endpoint | Implemented-unverified in Desktop / partial, fixture charts and real outage reporting |
| Health and annotations | `src/core/health.ts`, `healthCalculator.ts`, `WorkloadHealth.tsx` | Telemetry, normalized replica/proxy state | Calculator/workload view unverified in Desktop / partial, live Bookinfo and configurable rules verified |
| Validations, references and ignore annotations | `src/core/validation`, configuration findings | Complete or explicitly partial snapshots | Initial checks implemented-unverified / partial, limited-check fixture verified |
| Traffic graphs and summaries | `src/core/trafficGraph.ts`, `core/topology.ts`, `Topology.tsx` | Telemetry and explicit metric identity | Bounded four-mode projections verified hosted; broader graph pipeline remains partial |
| Mesh graph, control planes, Istio status and TLS | `core/mesh.ts`, `data/mesh.ts`, `Mesh.tsx` | Discovery, policy scope and observed data | Inventory unverified in Desktop / bounded real hosted inventory; full mesh graph/security remain |
| Logs and read-only Envoy observations | `core/diagnostics.ts`, `proxyHttp.ts`, `proxyConfig.ts`, `data/proxyAdmin.ts`, `Diagnostics.tsx` | Pod reads/logs/port-forward permissions; public SDK WebSocket transport | Desktop unverified / hosted live logs, server state and config entries verified; full projections, sync, ztunnel and logging mutations remain |
| Traces, spans, error traces and tracing diagnostics | `core/tracing.ts`, `data/tracing.ts`, `Traces.tsx`, `TraceMetadata.tsx` | Existing Jaeger/Tempo HTTP query Service | Desktop unverified / hosted search/detail/metadata fixture-verified; live provider, correlations, broader filters and authenticated transport remain |
| Grafana and Perses | Integration adapters and dashboard links | Existing endpoint and compatible auth | Planned / planned |
| Cluster aggregation | Scoped data adapters and cluster mapping | Headlamp cluster groups and telemetry labels | Planned / planned |
| Wizard source and action contracts | `core/trafficWeights.ts`, configuration action editor | Confirmed writes and semantic validation | Initial editor unverified in Desktop / bounded existing-route editor fixture-verified; full wizards remain |
| API authenticate/logout/auth-info and frontend Login | Headlamp's existing identity UI | Host authentication | Replaced-by-Headlamp; integration unverified |
| Backend health endpoints and test instrumentation | Host health and local tests | No Kiali server shipped | Replaced by host/test responsibilities |
| `/api/chat*`, ChatSessionUsage, AI-specific source contracts | None | Explicit scope exclusion | Excluded-by-user / excluded-by-user |
| Offline and gather/import commands | None | Explicit scope exclusion | Excluded-by-user / excluded-by-user |

Source-unit inventories intentionally retain excluded source references so their
absence is visible. A general endpoint such as `/api/config` may contain both
in-scope and excluded settings; it is not blanket-excluded.

## Application correlation slice

### WorkloadGroup-backed VM correlation

The shared namespace reader now discovers WorkloadGroups and, only when a
nonempty group selector needs them, WorkloadEntries. This extends application
membership and current graph-resource candidates while retaining the nine
standard Kubernetes sources. The same three-worker queue includes VM reads,
and the entire correlation now has a captured **15-second deadline**.
The source is complete/empty only after successful empty lists or confirmed
API absence; denial, unsupported versions, malformed or limited pages remain
explicitly incomplete. No group labels are substituted after failed entry
reads. Complete entry evidence is required before producing VM resources.

Pinned `business/workloads.go` uses group `spec.metadata.labels` with
`FilterWorkloadEntriesBySelector`; empty selectors select no entries.
`Workload.ParseWorkloadGroup` then uses the first matching entry's `spec.labels`,
otherwise group selector labels. **96 original-Go cases** execute the original
filter and extracted label-selection branch, with a small equality-selector
adapter. They do not execute VM health, Sidecar/account behavior or the full
workload fetch pipeline. Native cases preserve returned entry order, canonical/
custom label precedence, group identity, unknown health and routing safeguards.
Unlike the upstream display record, the native identity/resourceVersion remains
the WorkloadGroup's; entry UID/version is separately disclosed as label evidence
and never reused as a group mutation precondition.

Application and graph candidate tables show first-entry provenance and scoped
links. WorkloadEntries do not become Pods; a Pod owner reference to a group is
not adopted as VM ownership. No sidecar, readiness or service-account evidence
is inferred. VM application health is explicitly unavailable rather than a
fabricated replica result, and Service traffic creation/editing fails closed
before permission reviews/writes when VM versions are involved.

Bounds are 1,000 groups and 1,000 entries, four 250-item pages each, 10,000
selector comparisons and 1,000,000 aggregate label characters. Individual label
maps are limited to 256 bounded string entries. The text budget is checked
while decoding and again in the pure core; it does not bound the host's initial
response buffer. Namespace and per-kind UID/name/version identities are checked.
Partial VM evidence is not merged into a complete Kubernetes workload universe;
arbitrary custom/external/OpenShift controllers remain incomplete.

Hosted checks observed real Bookinfo applications and empty live VM lists, then
16 scenario groups with intercepted VM payloads: list order reversal, no-entry
fallback, empty selectors, no groups, denied/partial entry lists, wrong scope,
a **15,658 ms** timeout/retry, custom labels, group/entry navigation, VM health
deferral, routing refusal and graph identity provenance. There were 34 VM-list
reads and one synthetic metric GET, with no writes. Configuration discovery
and standard Kubernetes resources were real except the isolated Service
routing fixture. Screenshots/console were inspected and settings restored.
Positive VM association does not establish an installed/running VM.
The final local suite passes **19,065 tests in 147 files**; independent
original-Go evidence totals **17,176 cases**, with 38 bounded finding codes.

### Original Kubernetes correlation foundation

The next step now supplies reusable scoped label postings, UID-based ownership,
application/version grouping, Service-selector relationships and Kubernetes
Service-host resolution in `src/core/labels.ts` and `src/core/correlation.ts`.
`src/data/correlation.ts` decodes nine standard namespaced Kubernetes kinds and
collects bounded, cancellable snapshots. It preserves per-kind completeness and
errors instead of turning failed reads into empty datasets.

`Kiali > Applications` is the first consumer. It operates on one explicitly
selected namespace, supports application drill-down and native resource links,
and distinguishes native-sidecar containers from ordinary sidecars. Per-cluster
label overrides are validated and persisted alongside existing metrics settings.
Profiles without the optional new field remain valid.

Source-grounded behavior includes canonical/Kubernetes/legacy label precedence
and the use of pod-template labels for replica controllers but controller
metadata labels for Jobs/CronJobs. Empty preferred label values remain empty;
they do not trigger a fallback. The independent label oracle executes 75 pinned
Go cases. Service-selector matches are configuration relationships, not traffic.

The Desktop Bookinfo check produced four applications. Reviews contains three
Deployment versions, one selector-matching Service and three UID-owned pods,
all detected as native sidecars. Custom label settings changed the grouping
without overwriting Prometheus configuration, and the original settings were
restored afterward.
The same production package was also exercised in hosted-web mode: four
application rows, numeric workload-count sorting, reviews drill-down, native
resource links and three native-sidecar pod rows were confirmed. No plugin
execution or component error remained. The host's previously recorded
deprecated CRD-v1beta1 discovery 404 is still separate from these checks.

Intentional bounds and remaining differences:

- Supported sources are Deployments, StatefulSets, DaemonSets, ReplicaSets,
  ReplicationControllers, Jobs, CronJobs, Pods and Services, now supplemented by
  the bounded WorkloadGroup/entry source above. Arbitrary custom controllers,
  external/registry workloads and OpenShift-specific controllers remain incomplete.
- Reads use three concurrent workers, 250-item pages and a four-page limit per
  kind, now within a shared 15-second deadline. A limit, access failure or
  inconsistent pagination produces partial data.
- Owner links require matching scoped UID, group, kind and name. Unknown parents
  are not fabricated from a name; known child controllers can remain visible
  with a warning. This is stricter than Kiali's name-based parent fallback.
- A Service without a selector has no automatic pod/workload association here;
  EndpointSlice/manual endpoint and ServiceEntry enrichment remains planned.
- Kubernetes Service DNS forms are resolved only within the explicit cluster.
  External and wildcard hosts remain unresolved for later configuration work.
- Application counts are exact only for the supported, completely read snapshot
  with resolved ownership. Multi-namespace/multi-cluster UI, live subscriptions
  for derived data and the rest of Kiali application details remain planned.
- This is not mesh health, traffic analysis or semantic Istio validation.

The live test exposed another host/SDK mismatch: Headlamp 0.35.0 expects
`Link.search` to be a string, despite newer declarations allowing an object.
Application links now serialize their query parameters explicitly.

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
