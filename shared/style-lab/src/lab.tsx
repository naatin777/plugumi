// Style Lab本体。tokenはcontract object（@plugumi/viewのtokens）を
// runtimeに走査して一覧を作る — 契約に追加されれば自動で並ぶので、
// カタログが契約からずれることがない。色はliveのvar()参照で描くので、
// テーマ切替にそのまま追従する。
import { For } from "solid-js";
import { render, type JSX } from "@solidjs/web";
import { tokens, type ViewContext, type ViewHandle } from "@plugumi/view";

// カテゴリはkeyのprefixで判定する。fontSizeはfont+Size+Smと分解不能な
// camelCaseなのでregex groupingは不可能 — 明示prefixのstartsWithで
// 選ぶ。既存カテゴリへの追加は自動で並び、新カテゴリは見せ方の設計を
// 伴うのでsection追加を要する、という線引き。
const entries = Object.entries(tokens) as [string, string][];
const prefixed = (prefix: string) => entries.filter(([key]) => key.startsWith(prefix));
const colorGroups = () => prefixed("colors");

function Swatches(): JSX.Element {
  return (
    <div class="lab-swatches">
      <For each={colorGroups()}>
        {([key, cssVar]) => (
          <div class="lab-swatch" title={cssVar}>
            <div class="lab-chip" style={{ background: `var(${cssVar})` }} />
            <div class="lab-swatch-name">{key}</div>
          </div>
        )}
      </For>
    </div>
  );
}

function Scale(props: { title: string; prefix: string; sample: (cssVar: string) => JSX.Element }): JSX.Element {
  return (
    <section class="lab-section">
      <h3>{props.title}</h3>
      <For each={prefixed(props.prefix)}>
        {([key, cssVar]) => (
          <div class="lab-row">
            <span class="lab-key">{key}</span>
            {props.sample(cssVar)}
          </div>
        )}
      </For>
    </section>
  );
}

// typographyはfamily/size/weight/height/letterSpacingを横断した
// specimenとして1つにまとめて見せる。個別scaleより文章で見た方が
// 組み合わせの確認になる。
function Typography(): JSX.Element {
  return (
    <section class="lab-section">
      <h3>font family</h3>
      <For each={prefixed("fontFamily")}>
        {([key, cssVar]) => (
          <div class="lab-row">
            <span class="lab-key">{key}</span>
            <span style={{ "font-family": `var(${cssVar})` }}>あいうえお ABCabc 123</span>
          </div>
        )}
      </For>
      <h3>font weight</h3>
      <For each={prefixed("fontWeight")}>
        {([key, cssVar]) => (
          <div class="lab-row">
            <span class="lab-key">{key}</span>
            <span style={{ "font-weight": `var(${cssVar})` }}>あいうえお ABCabc 123</span>
          </div>
        )}
      </For>
    </section>
  );
}

function Lab(): JSX.Element {
  return (
    <div class="lab">
      <h2>Components</h2>
      <section class="lab-section">
        <h3>button</h3>
        <div class="lab-row">
          <button class="plugumi-button">default</button>
          <button class="plugumi-button plugumi-button--accent">accent</button>
          <button class="plugumi-button plugumi-button--danger">danger</button>
          <button class="plugumi-button" disabled>disabled</button>
        </div>
        <h3>input</h3>
        <div class="lab-row">
          <input class="plugumi-input" placeholder="placeholder" />
          <input class="plugumi-input" placeholder="disabled" disabled />
        </div>
        <h3>scrollbar</h3>
        <div class="lab-scrollbox">
          <div class="lab-scrollcontent" />
        </div>
      </section>
      <h2>Colors</h2>
      <Swatches />
      <h2>Typography</h2>
      <Typography />
      <Scale title="Font size" prefix="fontSize" sample={(v) => (
        <span style={{ "font-size": `var(${v})` }}>あいうえお ABCabc 123</span>
      )} />
      <h2>Scales</h2>
      <Scale title="Spacing" prefix="spacing" sample={(v) => (
        <span class="lab-bar" style={{ width: `var(${v})` }} />
      )} />
      <Scale title="Radii" prefix="radii" sample={(v) => (
        <span class="lab-radiusbox" style={{ "border-radius": `var(${v})` }} />
      )} />
    </div>
  );
}

export function mount(host: ShadowRoot, _context: ViewContext): ViewHandle {
  const dispose = render(() => <Lab />, host);
  return { destroy: () => dispose() };
}
