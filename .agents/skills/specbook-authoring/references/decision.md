# Decision: 明示的な選択と理由

**置き場所:** `docs/decisions/`。**Type:** `decision`。**必須relation:** なし。**同typeキーによる階層（parent相当）は禁止。**

重要な選択が実際の代替案の間で行われた（または提案された）ときに Decision を書く。**なぜ**かをトレードオフ込みで説明し、後で再検討できるようにする。

## 推奨する内容

- **コンテキストと要因:** 何がこの決定を促したか。
- **決定:** 選んだ選択肢を正確に。明示承認されるまでは `draft`。
- **検討した代替案:** 藁人形ではなく現実的な競合案。
- **理由とトレードオフ:** 利点・コスト・棄却理由。
- **帰結:** 移行や将来の制約、リスク、再検討の引き金。

関連する Requirement・Design・Architecture・Contract は該当typeキーで指す。同typeのDecisionを新しいものが置き換えるときは `relations.decision` で旧版を指し、本文で置換関係を明記する。Deprecated decisionは読める状態で残し、作り直しの副作用として履歴を消さない。

## レビュー

旧accepted ADRを新しいPlugumiで自動的に拘束力あるものとして扱わない。再評価し、新たに承認されたdecisionを `docs/decisions/` に記録する。decisionの推論を複数のdesignへコピーしない。
