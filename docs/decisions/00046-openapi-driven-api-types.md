# 00046: OpenAPI駆動のAPI型 — apps/webのhuma移行とspec駆動の型生成

## 結論

apps/web（ブラウザ向けhost）の/apiをhumaへ移行し、OpenAPI specから
TypeScriptの型を生成する。TS側の手書き型との手動同期は廃止する。

## 背景

coreにはhumaが入っていてspecも配信されていたが、consumerがいなかった
（pluginはGoで`internal/wire`を直接importするためcodegen不要）。一方で
frontendが実際に使うapps/webのAPIは素のmuxでspecが無く、TS側は
「Go側のJSONフィールド名と一致」というコメント付きの手書き型で
手動同期していた — 必要な境界と逆側にだけOpenAPIがあった。

## 構造

```
apps/web (huma) → --print-openapi → shared/app-ui/src/gen/openapi.json
                                  → openapi-typescript → gen/api-types.ts
```

- `pnpm run gen:api`で再生成。specと型は生成物としてcommitする
- 生成コマンド: `go run ./cmd/plugumi-web --print-openapi`

## 契約上の決定

- **配列はnullでなく常に配列**: `huma.DefaultArrayNullable = false`。
  Go側はresponse構築でsliceを必ず初期化する（nilはJSONでnullになる）。
  coreは既に`append([]T{}, ...)`でこれに従っている
- **wildcardの廃止**: OpenAPIはマルチセグメントのwildcardを表現
  できないため、`areas/{rest...}`・`areas/{rest...}/workspace`は
  query parameterへ再設計（`areas?path=a/b`、`workspace?path=a/b`）
- **opaque JSON**: workspaceはShell所有のopaqueなobject|null。
  humaのschema生成では[]byte=string/byteになるため、SkipValidateBodyで
  手動検証（ValidOpaque）し、specはpost-processで`type: object,
  nullable: true`に修正する（coreのrest.goのresponse修正と同じ手法）
- **エラー形**: `{"error":{"message":...}}`を維持（huma.NewErrorの
  override。codeが載る場合あり）
- **enumは未整備**: source/status等はspec上stringのまま。TS側は
  union型で絞り込む（host.tsxのCoreEntry参照）。Go側でhuma enumを
  整備すれば生成型もunionになる — 今後の改善余地

## humaの落とし穴（実装で踏んだもの）

- input structのembedded structはpath/query paramが解決されない —
  フィールドはflatに書く
- `RawBody []byte`はschema上string/byte扱いで、JSON objectが
  validationに弾かれる（上記SkipValidateBodyの理由）
