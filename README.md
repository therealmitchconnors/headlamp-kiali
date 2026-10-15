# Kiali

A Headlamp plugin for Kiali, scaffolded with
`@kinvolk/headlamp-plugin@0.14.0` following the
[Headlamp getting-started guide](https://headlamp.dev/docs/latest/development/plugins/getting-started/).

This is the initial plugin scaffold: it adds **Kiali** to Headlamp's app bar.
Kiali API integration, service-mesh views, and cluster installation are not implemented yet.
The repository root is the plugin directory.

## Development

Use Node.js 22 LTS or 24 LTS and npm 11 or later, with a running Headlamp instance.
Run these commands from the repository root:

```sh
npm ci
npm start
```

The lockfile pins dependency versions and integrity hashes without hard-coding
a registry mirror; `.npmrc` keeps it portable across npm registry configurations.

`npm start` watches the source and builds into Headlamp's development-plugin
directory. For a packaged Headlamp Desktop app, enable **Settings > Plugins >
Plugin Development Mode**, then check the app bar for **Kiali**.

```sh
npm run tsc
npm run lint
npm run build
npm run package
```

The production build is written to `dist/main.js`; packaging creates a tarball
for installation into Headlamp's plugins directory. The scaffold also provides
formatting, Storybook, i18n, and Vitest commands in `package.json`; no tests have
been authored yet. A successful build alone does not verify loading in Headlamp:
check the app bar contribution and browser console in a running instance.

## Agent skills

Project skills live in [`.github/skills/`](.github/skills/), Copilot's
repository-local skill discovery directory. Each has its own `SKILL.md`.
[AGENTS.md](AGENTS.md) supplies the always-on plugin guidance and compatibility
notes for the upstream Claude-oriented workflows.

| Skill | Purpose |
| --- | --- |
| `create-crd-plugin` | Orchestrate the initial CRD-plugin buildout |
| `plan-plugin` | Plan resource coverage and navigation |
| `define-resource` | Model typed custom resources |
| `add-list-view` | Add list pages, routes, sidebar entries, and topology |
| `add-detail-view` | Add resource detail pages |
| `add-settings` | Add persisted plugin settings |
| `ensure-dependency` | Check or install a project's cluster dependencies |
| `seed-test-data` | Prepare cluster fixtures |
| `run-and-verify` | Verify the plugin in a running Headlamp instance |
| `document-plugin` | Document implemented resource coverage |
| `pr-triage` | Read-only repository PR triage |

### Source and compatibility

All 11 skill files were extracted without content changes from
[kubernetes-sigs/headlamp#6096](https://github.com/kubernetes-sigs/headlamp/pull/6096),
pinned to commit
[`0de15ca93a4fa345be1bc4afc4346fc977523198`](https://github.com/kubernetes-sigs/headlamp/commit/0de15ca93a4fa345be1bc4afc4346fc977523198).
Their Git blob hashes were checked against that commit during extraction.
The 10 plugin workflows came from
`plugins/headlamp-plugin/template-claude/.claude/skills/`; `pr-triage` came
from the upstream repository's `.claude/skills/`.

The skills were reviewed before installation. They are **medium risk** when
executed: some workflows install packages, modify a selected Kubernetes cluster,
change the active kubectl context, or manage Headlamp development artifacts.
Installing the skill files does not execute those operations.
Obtain explicit approval for cluster mutations and use an explicit target
context rather than changing shared kubeconfig state.

The upstream skill bodies retain references to `CLAUDE.md`, Claude slash
commands, permission metadata, and Kubernetes/Helm/Chrome DevTools MCP servers.
These are not Copilot permissions or automatically available tools; see
`AGENTS.md` for the mapping. No Claude settings, permission allowlists, or MCP
server configuration were imported.

Upstream material is licensed under Apache-2.0; see [LICENSE](LICENSE) and
[NOTICE](NOTICE).
