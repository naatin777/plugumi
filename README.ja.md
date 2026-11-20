# plugumi

[English](README.md) | **日本語**

Plugumi の作り直し版。設計ドキュメントは `docs/` 以下に [Specbook](.agents/skills/specbook-authoring/SKILL.md) 形式で置く。

- **採用した方針:** [PluginからCoreへ接続する](docs/decisions/00012-plugin-initiated-connections.md)。PluginにHTTP/WSサーバーを求めない。
- **ローカルで動かす:** [ビルドと接続](docs/guides/00002-run-plugin-clients.md)。開発中のv1をPlugin起点の方式に置き換えた。旧方式との互換はない。
- **設計:** [システム構成](docs/architecture/00002-plugin-client-system.md)、[v1プロトコル](docs/contracts/00004-plugin-client-protocol.md)、[移行計画](docs/designs/00003-plugin-client-migration.md)。

## ライセンス

[MIT](LICENSE)
