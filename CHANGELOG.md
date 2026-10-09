# Changelog

## 1.0.0 (2026-10-09)


### Features

* add gitignore-aware file walker ([2be8e0a](https://github.com/Ardit175/repolens/commit/2be8e0a079e38f061a49ced08415a3c7b52e986a))
* add repolens index command ([499869b](https://github.com/Ardit175/repolens/commit/499869b2986ac45d733058e0bbd96359f4da7454))
* chunk TS/JS files by symbol (M2) ([a8acd5a](https://github.com/Ardit175/repolens/commit/a8acd5a6570dec2d710441ccd56400cf6832d9fb))
* chunk TS/JS files by symbol with fallback windows ([85c58e0](https://github.com/Ardit175/repolens/commit/85c58e03643fc3c037a03d6c1dc7ed84ad630c97))
* detect language by extension and shebang ([658dfc0](https://github.com/Ardit175/repolens/commit/658dfc0cd5c709b65fea97cd98e1cb3c33510043))
* M1 scaffold with index command, walker and CI ([e9c2437](https://github.com/Ardit175/repolens/commit/e9c243760d048875b73e51f122024d2bdf354599))


### Bug Fixes

* pass GITHUB_TOKEN to gitleaks so pull requests can be scanned ([be8c3ca](https://github.com/Ardit175/repolens/commit/be8c3ca0d0584621d65694e29a3aeb9a5b6aef03))
* pass GITHUB_TOKEN to the PR title check ([21e1874](https://github.com/Ardit175/repolens/commit/21e1874cbeb284017046cd38e9e269757e5aa078))

## Changelog

## Unreleased
- 2026-10-09: M2 start: web-tree-sitter parser layer, TS/TSX/JS/JSX symbol chunking with metadata and hashes, line-window fallback chunking.
- 2026-10-07: Pre-commit hook, release-please workflow and docker-compose for Qdrant.
- 2026-10-05: M1 scaffold: TypeScript tooling, `repolens index`, gitignore-aware walker, language detection, CI and security workflows.
- 2026-10-05: Project plan, working rules and decisions added.
