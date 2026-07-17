# AgentNexus Agent Notes

Use this checklist at the start of every new session before making changes.

## Session Prep

1. Read `README.md` first.
   - Treat the "Project tracking board" URL in `README.md` as the source of truth for Deck/Lakon updates.
   - Current board: `https://repository.lumintulogic.com/apps/deck/board/146`.

2. Read `prd.md` when task scope is unclear.
   - Use it to align feature work with the product direction and milestones.

3. Check the worktree before editing.
   - Run `git status --short`.
   - Do not revert or overwrite existing user/agent changes unless explicitly asked.

4. If using Lakon/Deck, verify the board before updating anything.
   - List or search for the board ID from `README.md`.
   - For this repo, use AgentNexus board `146`.
   - Do not update any other board unless the user explicitly asks.
   - Add progress comments to the relevant cards after meaningful work or verification.

5. Review planned tasks from the board before expanding scope.
   - Current planned AgentNexus cards include mock MCP WebSocket server, real MCP SDK handshake, auth/token mock flow, MCP tool execution pipeline, storage/provider decision, and Cloudflare deployment workflow.

## Development Commands

- Install dependencies: `npm install`
- Run app: `npm run dev`
- Build/type-check: `npm run build`
- Run mock MCP WebSocket server: `npm run mock:mcp`
- Run E2E tests: `cd e2e && npm test`

Notes:
- Playwright may need permission to bind a local test server outside the sandbox.
- The mock MCP server listens on `ws://127.0.0.1:8787/mcp/postgres`.

## Verification Expectations

Before finalizing code changes, run:

1. `npm run build`
2. `cd e2e && npm test` when UI behavior changed
3. For MCP server work, smoke-test `npm run mock:mcp` and SDK `tools/list` if relevant

When reporting back, include what passed, what could not be run, and which Deck cards were updated.
