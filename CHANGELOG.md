# Changelog

All notable changes to this project are recorded here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Fixed

- `type: 'json'` tool arguments are parsed and shape-checked before the request leaves the plugin. The harness renders that
  parameter type as an annotation-only schema, so a model may send JSON text; forwarding it verbatim made Notion answer
  `Couldn't find editable properties for these identifiers: 0,1,2,...`. A malformed or wrongly shaped value now fails with
  the parameter name instead of `Unexpected token` or a Notion 400.
- `notion_append_blocks` rejects an empty `children` array instead of sending a body Notion cannot accept.
- `scripts/install.mjs` installs into `~/.dsh/profiles/<profile>/node_modules/dsh-notion-connector` (it pointed at
  `~/.dsh/profiles/node_modules/dsh-notion`, a path no profile resolves). Profile defaults to `web`, overridable with
  `node scripts/install.mjs <profile>` or `$DSH_PROFILE`.

## [0.1.2] - 2026-09-29

### Compatibility

- Declared compatibility with **DSH 0.2.0-rc.2**: the official DSH package ranges in `peerDependencies` now accept `^0.2.0-rc.2`. No functional or behavioural change; this only silences the compatibility warning on newer DSH.

