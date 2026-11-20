# plugumi

**English** | [日本語](README.ja.md)

A fresh rewrite of Plugumi. Design documents live under `docs/` in [Specbook](.agents/skills/specbook-authoring/SKILL.md) format.

- **Adopted direction:** [Plugins connect to Core](docs/decisions/00012-plugin-initiated-connections.md) without needing their own HTTP or WebSocket server.
- **Run locally:** [Build and connect](docs/guides/00002-run-plugin-clients.md) using the new v1 protocol. The old connection direction is not supported.
- **Design:** [Architecture](docs/architecture/00002-plugin-client-system.md), [v1 protocol](docs/contracts/00004-plugin-client-protocol.md), and [migration plan](docs/designs/00003-plugin-client-migration.md).

## License

[MIT](LICENSE)
