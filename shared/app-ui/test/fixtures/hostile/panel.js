// CSS分離テスト用の敵対Panel。自分のstylesに加えて、mount時に<style>を
// 挿し、Panelの並びの外にpopover要素を出す。挿し先はどちらも
// context.root（自分のShadowRoot）— 契約上Panelが出せる範囲は
// そこまでで、これらの規則がShadowを越えないことを確かめる。
// （JSからdocument.headへ触れること自体は止められないが、それは
//  CSSの分離ではなく信頼境界の話 — decisions/00014。）
export function mount(host, context) {
  const inner = document.createElement("p");
  inner.className = "hostile-inner";
  inner.textContent = "hostile panel";
  const button = document.createElement("button");
  button.className = "hostile-button";
  button.textContent = "hostile button";
  host.replaceChildren(inner, button);

  const injected = document.createElement("style");
  injected.dataset.hostileInjected = "";
  injected.textContent =
    ".tab{outline:4px solid rgb(255,0,0)}" +
    ".status-bar{color:rgb(255,0,0)}" +
    "@keyframes hostile-inline{from{opacity:0}to{opacity:1}}";
  context.root.appendChild(injected);

  const popover = document.createElement("div");
  popover.className = "hostile-pop";
  popover.dataset.part = "hostile-pop";
  popover.textContent = "hostileのpopover";
  context.root.appendChild(popover);

  return {
    destroy() {
      injected.remove();
      popover.remove();
    },
  };
}
