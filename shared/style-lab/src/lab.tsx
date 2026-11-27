// Style Lab本体。design libraryの形: 左にresizableなsidebar、
// component単位のentryを並べ、選択すると詳細（状態の描画 + 使って
// いるtokenのspec表）を出す。token referenceもentryとして末尾に。
// token一覧はcontract objectをruntimeに走査するので契約に自動追従し、
// 色はliveのvar()参照なのでテーマ切替に追従する。
import { For, createSignal, onCleanup } from "solid-js";
import { render, type JSX } from "@solidjs/web";
import { tokens, type ViewContext, type ViewHandle } from "@plugumi/view";
import { usedTokens } from "./usage.ts";

const entries = Object.entries(tokens) as [string, string][];
const prefixed = (prefix: string) => entries.filter(([key]) => key.startsWith(prefix));

// token名（spec表ではcss流のhyphenatedで書く: radii-sm, colors-text-muted）
// からentryへの対応。spec表のtoken参照をlinkにするために使う。
const tokenEntryOf = (hyphenated: string): string | null => {
  if (hyphenated.startsWith("colors-")) return "color";
  if (hyphenated.startsWith("radii-")) return "shape";
  if (hyphenated.startsWith("spacing-")) return "spacing";
  if (hyphenated.startsWith("font")) return "typography";
  return null;
};

// spec表の値文字列に出てくるtoken名（colors-x, radii-x, spacing-x,
// font-size-x等）を検出してlink化する。%や混色の数値は対象外。
const TOKEN_REF = /\b((?:colors|radii|spacing|font-size|font-family|font-weight)-[a-z0-9-]+?)(?=[\s/%]|$)/g;

// ---- spec表: 部品がどのtokenをどう使っているか ----
// 描画は共有cssで真実が保証されるが、spec表は手書きの注釈。
// shell側を変えたらここも更新する — ずれたら表が嘘になるので、
// 変更時はlabを開いて目視で突き合わせる運用。
// ナビゲーションはLabがsetterを登録する。spec表はcomponentの外で
// 定義されているため、直接はsignalに触れられない — 簡単なmodule級の
// 委譲で十分（labは同時に1つしかmountされない想定ではないが、
// 各panelは自分のhashしか読まないので実害はない）。
let navigateTo: ((id: string) => void) | null = null;

function SpecValue(props: { text: string }): JSX.Element {
  // token名を検出してlinkにする。linkでない部分はtextのまま。
  const parts = () => {
    const out: { text: string; entry: string | null }[] = [];
    let last = 0;
    for (const match of props.text.matchAll(TOKEN_REF)) {
      const index = match.index ?? 0;
      if (index > last) out.push({ text: props.text.slice(last, index), entry: null });
      out.push({ text: match[1], entry: tokenEntryOf(match[1]) });
      last = index + match[1].length;
    }
    if (last < props.text.length) out.push({ text: props.text.slice(last), entry: null });
    return out;
  };
  return (
    <For each={parts()}>
      {(part) => part.entry && navigateTo
        ? <a class="lab-token-link" href={`#${part.entry}`}
            onClick={(event) => { event.preventDefault(); navigateTo?.(part.entry!); }}
          >{part.text}</a>
        : <>{part.text}</>}
    </For>
  );
}

function Spec(props: { rows: [string, string][] }): JSX.Element {
  return (
    <table class="lab-spec">
      <tbody>
        <For each={props.rows}>
          {([property, value]) => (
            <tr>
              <td class="lab-spec-prop">{property}</td>
              <td class="lab-spec-value"><SpecValue text={value} /></td>
            </tr>
          )}
        </For>
      </tbody>
    </table>
  );
}

function Labeled(props: { label: string; children: JSX.Element }): JSX.Element {
  return (
    <div class="lab-state">
      <div class="lab-state-label">{props.label}</div>
      <div class="lab-state-body">{props.children}</div>
    </div>
  );
}

const circleIcon = (
  <svg width="14" height="14" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.5" /></svg>
);

// ---- entry定義。sidebarにはこの順で並ぶ ----
const ENTRIES: { group: string; id: string; title: string; render: () => JSX.Element }[] = [
  {
    group: "foundations", id: "color", title: "Color",
    render: () => (
      <div class="lab-swatches">
        <For each={prefixed("colors")}>
          {([key, cssVar]) => (
            <div class={{ "lab-swatch": true, unused: !usedTokens.has(key) }} title={cssVar}>
              <div class="lab-chip" style={{ background: `var(${cssVar})` }} />
              <div class="lab-swatch-name">{key}</div>
            </div>
          )}
        </For>
      </div>
    ),
  },
  {
    group: "foundations", id: "typography", title: "Typography",
    render: () => (
      <>
        <h3>font family</h3>
        <For each={prefixed("fontFamily")}>
          {([key, cssVar]) => (
            <div class={{ "lab-row": true, unused: !usedTokens.has(key) }}>
              <span class="lab-key">{key}</span>
              <span style={{ "font-family": `var(${cssVar})` }}>あいうえお ABCabc 123</span>
            </div>
          )}
        </For>
        <h3>font weight</h3>
        <For each={prefixed("fontWeight")}>
          {([key, cssVar]) => (
            <div class={{ "lab-row": true, unused: !usedTokens.has(key) }}>
              <span class="lab-key">{key}</span>
              <span style={{ "font-weight": `var(${cssVar})` }}>あいうえお ABCabc 123</span>
            </div>
          )}
        </For>
        <h3>font size</h3>
        <For each={prefixed("fontSize")}>
          {([key, cssVar]) => (
            <div class={{ "lab-row": true, unused: !usedTokens.has(key) }}>
              <span class="lab-key">{key}</span>
              <span style={{ "font-size": `var(${cssVar})` }}>あいうえお ABCabc 123</span>
            </div>
          )}
        </For>
      </>
    ),
  },
  {
    group: "foundations", id: "spacing", title: "Spacing",
    render: () => (
      <For each={prefixed("spacing")}>
        {([key, cssVar]) => (
          <div class={{ "lab-row": true, unused: !usedTokens.has(key) }}>
            <span class="lab-key">{key}</span>
            <span class="lab-bar" style={{ width: `var(${cssVar})` }} />
          </div>
        )}
      </For>
    ),
  },
  {
    group: "foundations", id: "shape", title: "Shape",
    render: () => (
      <For each={prefixed("radii")}>
        {([key, cssVar]) => (
          <div class={{ "lab-row": true, unused: !usedTokens.has(key) }}>
            <span class="lab-key">{key}</span>
            <span class="lab-radiusbox" style={{ "border-radius": `var(${cssVar})` }} />
          </div>
        )}
      </For>
    ),
  },
  {
    group: "components", id: "buttons", title: "Buttons",
    render: () => (
      <>
        {/* buttonはfamily。text button（plugumi-button、plugin-facing）と
            icon button（shell chrome）をvariantとして並べる。 */}
        <h3>text button — .plugumi-button / pluginでも使える</h3>
        <div class="lab-states">
          <Labeled label="default">
            <button class="plugumi-button">button</button>
          </Labeled>
          <Labeled label="disabled">
            <button class="plugumi-button" disabled>button</button>
          </Labeled>
        </div>
        <p class="lab-note">実使用はdemo pluginのみ。accent/danger variantは契約にあるが使われていない。</p>
        <h3>icon button — .icon-button / shell専有</h3>
        <div class="lab-states">
          <Labeled label="off">
            <button class="icon-button" aria-label="off">{circleIcon}</button>
          </Labeled>
          <Labeled label="hover — 実際に触って">
            <button class="icon-button" aria-label="hover">{circleIcon}</button>
          </Labeled>
          <Labeled label="on (aria-pressed)">
            <button class="icon-button" aria-label="on" aria-pressed="true">{circleIcon}</button>
          </Labeled>
        </div>
        <Spec rows={[
          ["size", "26×26px 固定"],
          ["radius", "radii-md"],
          ["border", "なし"],
          ["off", "transparent / colors-text-muted"],
          ["hover", "colors-background-tertiary / colors-text"],
          ["on", "background-tertiary + text 8%混色 / colors-text"],
        ]} />
        <p class="lab-note">frameの上のbuttonは不透明fill。透過fillはcardの内側だけ。</p>
      </>
    ),
  },
  {
    group: "components", id: "tabs", title: "Tabs",
    render: () => (
      <>
        {/* 実物と同じ構造: header.leaf-strip > .tab-strip。
            tabはstripの高さとhairlineの文脈でこそ正しく見える部品で、
            裸で描くと別物になる。--shell-strip-hは:root定義なので
            shadow越しに継承され、そのまま使える。 */}
        <header class="leaf-strip">
          <div class="tab-strip">
            <button class="tab"><span class="tab-title">非選択</span></button>
            <button class="tab selected"><span class="tab-title">選択中</span><span class="tab-close">×</span></button>
          </div>
        </header>
        <Spec rows={[
          ["class", ".tab — shell専有"],
          ["radius", "radii-sm — icon-buttonのmdと違う点に注意"],
          ["border", "なし。輪郭はinset box-shadow: colors-raised-edge 35%"],
          ["off", "transparent / colors-text-muted / font-size-xs"],
          ["hover", "colors-raised 30%混色"],
          ["on", "colors-raised 50% + 強い輪郭"],
          ["close", "選択中のみ常時表示。非選択はhover/focusで出る"],
        ]} />
      </>
    ),
  },
  {
    group: "components", id: "menus", title: "Menus",
    render: () => (
      <>
        <div class="panel-picker" style={{ position: "static", border: "none" }}>
          <button class="picker-item">
            <span>Files</span>
            <span class="picker-plugin">shell</span>
          </button>
        </div>
        <Spec rows={[
          ["class", ".picker-item — shell専有"],
          ["hover", "background-tertiary + text 8%混色 — icon-buttonのonと同じ"],
          ["provider名", "colors-text-muted / font-size-2xs"],
        ]} />
      </>
    ),
  },
  {
    group: "components", id: "text-fields", title: "Text fields",
    render: () => (
      <>
        <div class="lab-states">
          <Labeled label="placeholder">
            <input class="plugumi-input" placeholder="placeholder" />
          </Labeled>
          <Labeled label="disabled">
            <input class="plugumi-input" placeholder="disabled" disabled />
          </Labeled>
        </div>
        <Spec rows={[
          ["class", ".plugumi-input — pluginでも使える"],
        ]} />
        <p class="lab-note">focus ringは実際にfocusして確認。</p>
      </>
    ),
  },
];

const GROUPS = [...new Set(ENTRIES.map((entry) => entry.group))];

function Lab(): JSX.Element {
  const [active, setActive] = createSignal(ENTRIES[0].id);
  const [width, setWidth] = createSignal(180);
  // 幅が狭いときはsidebarを畳む。ResizeObserverでpanel自体の幅を見る —
  // media queryではなくpanelの実サイズ基準（splitで狭くなることがある）。
  const [narrow, setNarrow] = createSignal(false);
  const [navOpen, setNavOpen] = createSignal(false);
  const current = () => ENTRIES.find((entry) => entry.id === active()) ?? ENTRIES[0];
  const observer = new ResizeObserver((records) => {
    for (const record of records) setNarrow(record.contentRect.width < 560);
  });
  onCleanup(() => observer.disconnect());
  const select = (id: string) => {
    setActive(id);
    setNavOpen(false); // narrow時に項目を選んだら畳む
    // 選択はURL hashに載せる — reloadで復元され、token linkが
    // shareableになる。path routing（browserHistory）と衝突しない。
    history.replaceState(null, "", `#${id}`);
  };
  navigateTo = select;
  onCleanup(() => { if (navigateTo === select) navigateTo = null; });
  // 初期選択はhashから復元する。無効なhashなら先頭。
  const initialHash = location.hash.slice(1);
  if (initialHash && ENTRIES.some((entry) => entry.id === initialHash)) {
    setActive(initialHash);
  }

  // sidebarのresize。handleを掴んで動かす — shellのsplit resizerと
  // 同じくpointer captureで追う。幅はpanel localで永続化しない。
  const startResize = (event: PointerEvent) => {
    if (narrow()) return;
    const startX = event.clientX;
    const startWidth = width();
    const move = (moveEvent: PointerEvent) => {
      setWidth(Math.min(400, Math.max(120, startWidth + moveEvent.clientX - startX)));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    event.preventDefault();
  };

  return (
    <div class={{ "lab": true, narrow: narrow(), "nav-open": navOpen() }} ref={((el) => observer.observe(el)) as (el: HTMLDivElement) => void}>
      <nav class="lab-nav" style={narrow() ? undefined : { width: `${width()}px` }}>
        <For each={GROUPS}>
          {(group) => (
            <>
              <div class="lab-nav-group">{group}</div>
              <For each={ENTRIES.filter((entry) => entry.group === group)}>
                {(entry) => (
                  <button
                    class={{ "lab-nav-item": true, selected: active() === entry.id }}
                    onClick={() => select(entry.id)}
                  >
                    {entry.title}
                  </button>
                )}
              </For>
            </>
          )}
        </For>
      </nav>
      <div class="lab-resizer" onPointerDown={startResize} />
      <div class="lab-content">
        <div class="lab-topbar">
          <button class="lab-hamburger" aria-label="menu" onClick={() => setNavOpen(!navOpen())}>☰</button>
          <div class="lab-summary">{usedTokens.size} / {entries.length} tokens in use — 薄いものは未使用</div>
        </div>
        <h2>{current().title}</h2>
        {current().render()}
      </div>
    </div>
  );
}

export function mount(host: ShadowRoot, _context: ViewContext): ViewHandle {
  const dispose = render(() => <Lab />, host);
  return { destroy: () => dispose() };
}
