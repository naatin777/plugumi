// CSS分離テスト用の素のPanel。自分のCSSは最小限で、Shellや他のPluginの
// CSSが中身へ漏れないことを確かめる。
export function mount(host) {
  const p = document.createElement("p");
  p.className = "victim-text";
  p.textContent = "victimの文章";
  const button = document.createElement("button");
  button.className = "victim-button";
  button.textContent = "victimのbutton";
  const input = document.createElement("input");
  input.className = "victim-input";
  input.value = "victimのinput";
  host.replaceChildren(p, button, input);
  return { destroy() {} };
}
