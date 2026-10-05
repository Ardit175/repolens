# CLAUDE.md: repolens

repolens indexes a codebase into embeddings and a symbol graph and serves it to LLMs as an MCP server. Read PLAN.md (what's next) and DECISIONS.md (settled choices) before working.

## Stack
TypeScript on Node 22 (ESM, strict), @modelcontextprotocol/sdk, web-tree-sitter, Azure OpenAI or transformers.js embeddings, Qdrant (Docker) plus an in-memory store for tests, Vitest, GitHub Actions.

## Commands
_Fill in as they're created in M1 (install, build, lint, typecheck, test, coverage)._

## Environment notes (cloud runs)
- If Docker isn't running: `(dockerd >/tmp/dockerd.log 2>&1 &)`, then wait for `docker info`. Start Qdrant with `docker compose up -d qdrant`.
- Downloads from GitHub release pages are blocked. Use npm, PyPI or Docker Hub instead.

## Working rules (all scheduled runs)

These rules come from Ardit's setup brief and his answers in DECISIONS.md. Follow DECISIONS.md without asking again.

### Team shape
- The main session is the orchestrator. It plans the run, writes precise instructions for each sub-agent, and reviews every diff before it is committed. It does not write bulk code itself.
- Builder sub-agents use `model: "sonnet"`. At most two at a time, working in parallel on separate files, each with one small, clear task and exact acceptance criteria.
- Mechanical sub-agents use `model: "haiku"`: running tests and lint, updating docs and CHANGELOG, renaming, formatting.
- Never more than 3 sub-agents in one run. If the work is small, skip sub-agents and do it directly.
- Budget per run: about one feature on a weekday, two to three on a weekend. Stop when that is done, even if there is time left.

### Definition of done (checked by the orchestrator before every commit)
- The feature works end to end. No stubs, fake data presented as real, commented-out code, or TODOs standing in for finished work.
- Tests cover the new behavior: unit tests at minimum, integration tests for every API route. The whole suite, lint and type checks pass.
- New or changed code has at least 70% line coverage. There is no global coverage target to chase.
- Code follows the existing structure and naming. No new library without a one-line reason in DECISIONS.md.
- If something can't be done properly in this run, leave it unchecked in PLAN.md with the reason. Never ship a half version.
- Keep the code explainable in an interview: clear structure, tests, and no clever tricks for their own sake.

### Commits and pushes
- Conventional commits (`feat:`, `fix:`, `test:`, `refactor:`, `docs:`, `chore:`), in logical units. Every commit builds and passes the tests.
- Roughly 4 to 10 commits on a weekday and up to about 15 on a weekend, but only as many as the real work produces. Never make filler commits (whitespace-only, typo-only or empty) to raise the count.
- No "Generated with Claude" lines and no Co-Authored-By trailers.
- Push directly to `main`. Never rewrite history on main: no force-push, no rebase or amend of commits that are already pushed.

### Secrets and paid services
- Never commit secrets, real API keys or `.env` files. Keep `.env.example` current and read keys from environment variables.
- Tests mock paid APIs behind interfaces. One opt-in smoke test per provider is allowed (it runs only when `RUN_SMOKE=1` and the key is present), at most once per run.
- Keys come from the cloud environment's environment variables. If one is missing, the item is blocked (see below). Never ask for a key in chat.

### Contacting Ardit
- Only through the "Needs Ardit" section of PLAN.md. If something is blocked (it needs a key, a paid service or a decision), skip it and add a clear multiple-choice question there, then continue with the next item.
- Send a push notification for the run only when a new "Needs Ardit" item was added. Otherwise the run stays silent.

### End of every run
- Tick the finished items in PLAN.md and add a line to CHANGELOG.md.
- Append to PROGRESS.md: the date, what was built, what's next, and one plain-words sentence Ardit could use in a LinkedIn post (no hype, no em dashes).
- Keep the final message to two lines.
