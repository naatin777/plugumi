---
name: web-ui-dev-loop
description: web版UIの開発ループ。vite dev serverのreverse proxyでfrontend・shared packageの変更が即座に反映されるため、Go binaryの再build・再起動はGoコード変更時だけでよい。UIをいじる作業では必ずこの loop を使う。
---

# web UIの開発ループ

UI（shared/app-ui・shared/theme・apps/web/frontend等）を変更するとき、**毎回buildしてGo binaryを再起動してはいけない**。vite dev serverがreverse proxyを兼ねるloopを使う。

## なぜbuildが要らないのか

- workspace package（`@plugumi/app-ui`等）のexportsは**sourceのtsを直接指す**（`"./src/index.ts"`）。vite devがsourceからコンパイルするので、shared packageの変更も即座にHMRされる
- browser frontendはwebsocketを使わず`/api`と`/ui`へのfetchだけなので、viteのstring shorthand proxyで十分

## loopの立ち上げ

```sh
# 1. core（既に動いていれば不要）
plugumi start

# 2. Go web server — API・/ui中継・本番相当の静的配信を担う。
#    Goコードを触らない限り起動しっぱなしでよい
(cd apps/web && go build -o /tmp/plugumi-web ./cmd/plugumi-web)
/tmp/plugumi-web --core http://127.0.0.1:18110 --listen 127.0.0.1:18210 &

# 3. vite dev — こちらを開発中は開く
(cd apps/web/frontend && PLUGUMI_WEB_URL=http://127.0.0.1:18210 npm run dev -- --port 5174 --strictPort)
```

ブラウザでは `http://localhost:5174/...` を開く（viteは`localhost`でbindするので`127.0.0.1`ではなく`localhost`を使う）。

## 注意

- `localhost:5174`と`127.0.0.1:18210`は**別origin** — localStorageのprefsは共有されない
- panelのCSSは`?inline` importでshadow DOMにadoptされる。HMRでcss文字列は更新されるが、**開いているpanelには再適用されない** — panelを開き直すかreloadする
- Goコード（apps/web/cmd・internal）を変えたときだけ go buildし直して再起動する。頻繁にやるならair等を入れてもよいが、依存追加なのでユーザーに確認すること
- 本番相当の確認（embedした静的配信の確認など）が必要なときだけ、`vite build && go build`して`18210`側を使う
