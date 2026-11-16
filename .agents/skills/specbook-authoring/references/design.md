# Design — 1つの具体的な解法

**置き場所:** `docs/designs/`。**Type:** `design`。**必須relation:** `relations.requirement` は**少なくとも1つの既存 Requirement** を指さなければならない。

システムが1つ以上のrequirementをどう満たすかを記述する。DesignはArchitectureより狭く、状態機械・アルゴリズム・並行性・障害時の振る舞い・責務を規定できる。歴史的な決定ログにしない。

## 推奨する内容

- **対応するrequirement:** このdesignが存在する理由とrequirement IDへのリンク。
- **モデルと不変条件:** エンティティ・所有・ライフサイクル・状態遷移。
- **振る舞い:** 正常系と異常系、順序、キャンセル、再試行、冪等性。
- **境界:** API/Contract参照、認可、検証の責務。
- **代替案と帰結:** 簡潔に。実質的な選択が承認されたらDecision artifactを使う。
- **未解決の問いと検証への示唆:**

frontmatter relation の例:

```yaml
relations:
  requirement:
    - '00002'
```

例のIDは**実在の**IDに置き換える。捏造した対象でdesignを作らない。`perspective` は明示的に有用な場合に現行/提案の解釈へ使ってよいが、acceptanceの標識は `status` が正である。

## レビュー

永続的な意味上の決定と一時的なコード構成を区別する。既存Contractをinterfaceの正本として使い、そのschemaをinlineに複製しない。
