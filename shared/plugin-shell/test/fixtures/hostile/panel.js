// CSS分離テスト用の敵対Panel。自分のstylesに加えて、mount時にheadへ
// 直接<style>を挿し、body直下にpopover要素を出す。Shellや他のPanelを
// 壊そうとする規則を全部ここに集める。
export function mount(host) {
  const injected = document.createElement("style");
  injected.dataset.hostileInjected = "";
  injected.textContent =
    ".tab{outline:4px solid rgb(255,0,0)}" +
    ".status-bar{color:rgb(255,0,0)}" +
    "@keyframes hostile-inline{from{opacity:0}to{opacity:1}}";
  document.head.appendChild(injected);

  const popover = document.createElement("div");
  popover.className = "hostile-pop";
  popover.dataset.part = "hostile-pop";
  popover.textContent = "hostileのpopover";
  document.body.appendChild(popover);

  const inner = document.createElement("p");
  inner.className = "hostile-inner";
  inner.textContent = "hostile panel";
  const button = document.createElement("button");
  button.className = "hostile-button";
  button.textContent = "hostile button";
  host.replaceChildren(inner, button);

  return {
    destroy() {
      injected.remove();
      popover.remove();
    },
  };
}
