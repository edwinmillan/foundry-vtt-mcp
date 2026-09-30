# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

npm workspaces monorepo (`shared`, `packages/mcp-server`, `packages/foundry-module`). Node >=18.

```bash
npm install
npm run build              # builds all workspaces (shared must build before mcp-server; mcp-server's build does this)
npm run typecheck
npm run lint               # eslint over the repo; lint:fix to autofix
npm run format:check       # prettier; pre-commit hook runs lint-staged (prettier --write)
npm test                   # vitest in every workspace

# Single test file / test name
npx vitest run packages/mcp-server/src/lock.test.ts
npm test -w @foundry-mcp/server -- -t "test name"

npm run version:check      # all 5 manifests must share one version (enforced in CI)
npm run test:mcp:schema    # tool-schema smoke test; build the server first
npm run bundle:server      # esbuild -> dist/index.bundle.cjs + dist/backend.bundle.cjs (release artifact)
```

Note: `npm test -w @foundry-mcp/server` runs vitest in watch mode; pass `run` or use `npx vitest run` for one-shot.

## Architecture

```
Claude Desktop ─stdio─> index.ts (wrapper) ─TCP 127.0.0.1:31414─> backend.ts ─WS/WebRTC :31415─> Foundry module (browser, GM client)
```

### MCP server (`packages/mcp-server`) is two processes

- `src/index.ts` is the thin MCP stdio server Claude Desktop launches. It forwards `tools/list` and `tools/call` over a JSON-lines control socket on port 31414, spawning `backend.js` if nothing is listening.
- `src/backend.ts` is the long-lived singleton (guarded by a lock file, `lock.ts`). It owns the Foundry connection on port 31415 (`foundry-connector.ts`, WebSocket for local, `webrtc-peer.ts` for remote) and all tool instances. Multiple Claude windows share one backend.
- Logs go to `os.tmpdir()/foundry-mcp-server/` (`wrapper.log` etc.), not stdout: stdout belongs to the MCP protocol.

### Adding or changing a tool

Tools live in `src/tools/*.ts` as classes exposing `getToolDefinitions()` (name, description, JSON schema) and handler methods, usually validating args with zod. Wiring a new tool takes three edits in `backend.ts`: instantiate the class, spread its definitions into the tool list, and add a `case '<tool-name>':` to the big dispatch `switch`. Tools don't touch Foundry directly; they call `foundryClient.query('foundry-mcp-bridge.<method>', data)`.

### Foundry module (`packages/foundry-module`)

- Runs in the GM's browser. Module ID `foundry-mcp-bridge` must not change: it's the query prefix and the install folder name.
- `socket-bridge.ts` / `webrtc-connection.ts` receive `mcp-query` messages and dispatch them to handlers registered in `CONFIG.queries['foundry-mcp-bridge.<method>']` by `queries.ts`.
- `queries.ts` handlers mostly delegate to `data-access.ts` (very large; the actual Foundry document reads/writes and serialization, with branches on `game.system.id`). `permissions.ts` enforces GM-only access and the "Allow Write Operations" setting; `transaction-manager.ts` handles rollback for multi-step writes.
- Built with plain `tsc` to `dist/`; `module.json` loads `dist/main.js`.

So a new capability usually spans: a tool class + `backend.ts` wiring (server) and a query handler + `data-access.ts` method (module).

### Game-system support

- Server side: `src/systems/<system>/adapter.ts` implements `SystemAdapter` (`systems/types.ts`) for filters, creature formatting, power level, character stats. Adapters are registered in `backend.ts` into the `SystemRegistry`. Supported: dnd5e, pf2e, dsa5, cosmere-rpg, wfrp4e, mgt2e, fate-core-official, abfalter (Anima Beyond Fantasy). A new system id must also be added to `SystemId` (`systems/types.ts`) and to `GameSystem` + `detectGameSystem` (`utils/system-detection.ts`), or `manage-actors` won't find its adapter. The module's enhanced creature index is built per system inside `data-access.ts` (`buildEnhancedIndex`); the `systems/*/index-builder.ts` files are not used at runtime.
- System-exclusive tools live under `src/tools/<system>/` (e.g. `dnd5e/`, `wfrp4e/`) and in `systems/dsa5/character-creator.ts`.
- Most tools are system-agnostic and should stay that way; put system specifics in the adapter.

### Optional module integrations

Integrations with other Foundry modules (currently Calendaria) go through that module's public API, gated on `game.modules.get(id)?.active`. Calendaria lives in `packages/foundry-module/src/calendaria.ts` (queries registered in `queries.ts`) and `src/tools/calendaria.ts` on the server.

### Versioning and releases

Bump the version in all five manifests together (root, `shared`, `mcp-server`, `foundry-module` package.json, plus `packages/foundry-module/module.json`); `npm run version:check` and the `version-consistency` workflow fail otherwise. Pushing a `v*` tag runs `.github/workflows/release.yml`, which attaches `foundry-vtt-mcp.zip`, `module.json`, and a server bundle zip to the GitHub release (`module.json`'s manifest/download URLs point at `releases/latest/download/`).

## Local-only dependencies

This fork deliberately avoids runtime dependencies on third-party hosted services: no map generation/ComfyUI, no installers that download runtimes or models, no default public STUN servers, and no publishing to the Foundry package registry. Keep new features within that constraint.
