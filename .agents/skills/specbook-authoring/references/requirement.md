# Requirement — 外部から観測可能な必要性

**置き場所:** `docs/requirements/`。**Type:** `requirement`。**必須relation:** なし。

**何を満たさなければならないか**を定義する。それをたまたま満たすコード構造ではない。ドキュメントごとに一貫した検証可能な1つのcapabilityを好む。人工的な一文のmicro-requirementに分割したり、無関係な要求を束ねたりしない。

## 推奨する内容

- **コンテキスト・行為者:** 誰が、どんな条件で必要とするか。
- **規範的振る舞い:** 有用なら正確な MUST / MUST NOT / SHOULD。
- **受入基準:** 反証可能な具体的観測。エラーや拒否のケースを含む。
- **制約・非目標:** 信頼性・可搬性・信頼境界、あるいは意図的に除外する振る舞い。
- **未解決の問い:** 未解決の方針やトレードオフ。

`relations.goal: ['00001']` で requirement を Goal へリンクできる（任意）。前提requirementや同type階層は `relations.requirement` で指し、関係の意味は本文で記述する。

## レビュー

それ自体がプロダクト要件でない限り、特定のフレームワーク・トランスポート・パッケージ構造を要求しない。requirementを思い込みで `accepted` にしない。後でdesignがこのrequirementを `address` し得る。
