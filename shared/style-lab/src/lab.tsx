// Style Lab本体。design libraryの形: 左にresizableなsidebar、
// component単位のentryを並べ、選択すると詳細（状態の描画 + 使って
// いるtokenのspec表）を出す。token referenceもentryとして末尾に。
// token一覧はcontract objectをruntimeに走査するので契約に自動追従し、
// 色はliveのvar()参照なのでテーマ切替に追従する。
import { For, createSignal, onCleanup } from "solid-js";
import { render, type JSX } from "@solidjs/web";
import { tokens, widths, type ViewContext, type ViewHandle } from "@plugumi/view";
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
  if (hyphenated.startsWith("motion")) return "motion";
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
// 自分自身の幅を表示する箱。ResizeObserverで実測する —
// container queryが効かない「数値としての幅」はこうやって取る。
function WidthProbe(): JSX.Element {
  const [width, setWidth] = createSignal(0);
  const observer = new ResizeObserver((records) => {
    for (const record of records) setWidth(Math.round(record.contentRect.width));
  });
  onCleanup(() => observer.disconnect());
  return (
    <div class="lab-rq-probe" ref={(node) => observer.observe(node)}>
      この箱の幅: {width()}px {width() < widths.compact ? "→ compact" : ""}
    </div>
  );
}

// drawerのminiature demo。実物はshellのgrid文脈に深く埋まっているため
// cssの直接共有はできず、ここはpatternを忠実に写したminiature —
// 台の扱い（不透明・影なし・内側の辺だけ1px線）とtransformによる
// 開閉はshell.module.css/work-shape.module.cssの実装に対応させる。
// ずれたら嘘になるので、shell側を変えたらここも更新する。
function DrawerDemo(): JSX.Element {
  const [open, setOpen] = createSignal(false);
  const [drawerWidth, setDrawerWidth] = createSignal(180);
  // 外をpointerdownしたら畳む — shellと同じ作法。drawer自身と
  // toggle buttonは「内側」扱い。
  const outsideDown = (event: PointerEvent) => {
    const target = event.target as HTMLElement | null;
    if (target?.closest("[data-drawer-keep]")) return;
    setOpen(false);
  };
  // drawerのresizer — 内側の辺を掴んで動かす。実物はinline表示と
  // 幅prefを共有する設計だが、miniatureにはinline側がないので
  // demo内で閉じた値として持つ。
  const startDrawerResize = (event: PointerEvent) => {
    const startX = event.clientX;
    const startWidth = drawerWidth();
    const move = (moveEvent: PointerEvent) => {
      // 右端のdrawerなので、左へ動かすと広がる
      setDrawerWidth(Math.min(320, Math.max(100, startWidth + startX - moveEvent.clientX)));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    event.preventDefault();
    event.stopPropagation();
  };
  return (
    <div class="lab-drawer-frame" onPointerDown={outsideDown}>
      <div class="lab-drawer-behind">
        <p class="lab-note" style={{ margin: "0 0 0.5em" }}>背後のcontent — scrimで薄く暗くなる</p>
        <button class="plugumi-button" data-drawer-keep onClick={() => setOpen(!open())}>
          {open() ? "drawerを畳む" : "drawerを開く"}
        </button>
      </div>
      {/* scrim — drawerが開いている間、背後を暗くする薄い幕。
          pointer-eventsは通す（畳むのは外click判定の仕事） */}
      <div class="lab-drawer-scrim" data-closed={open() ? undefined : ""} />
      <div class="lab-drawer" data-drawer-keep data-closed={open() ? undefined : ""} style={{ width: `${drawerWidth()}px` }}>
        <div class="lab-drawer-resizer" onPointerDown={startDrawerResize} />
        <p class="lab-note" style={{ margin: 0 }}>drawer</p>
        <p class="lab-note">端にぴったり・不透明・影なし。左辺をdragするとresizeできる。</p>
      </div>
    </div>
  );
}

// Responsive entryの本体。panelはsplitで幅が変わるのでviewportではなく
// containerの幅が基準、というplugumiのresponsiveの原則をカタログする。
function ResponsiveEntry(): JSX.Element {
  return (
    <>
      <p class="lab-note">
        panelはsplitやwindow resizeで幅が変わる。つまりresponsiveの基準は
        viewportではなくpanel（container）の幅 — viewport基準のmedia queryは
        panelに対してはほぼ誤りで、splitで狭くなったpanelに気付けない。
      </p>

      <h3>widths — 幅の契約</h3>
      <p class="lab-note">
        実証された境界だけを置く。CSS変数はqueryの条件式で使えないため、
        値はTSの数値としてexportされる（view-coreのwidths）。
      </p>
      <table class="lab-spec">
        <tbody>
          <tr>
            <td class="lab-spec-prop">widths.compact</td>
            <td class="lab-spec-value">560px — これ未満ではsidebar等の副構造を畳む。Style Lab自身のsidebarで実証</td>
          </tr>
        </tbody>
      </table>
      <div class="lab-rq-widthbar" style={{ width: "560px" }}>compact境界 = 560px（実寸）</div>

      <h3>機構の使い分け</h3>
      <table class="lab-spec">
        <tbody>
          <tr>
            <td class="lab-spec-prop">container query</td>
            <td class="lab-spec-value">既定。CSSだけで完結し、部品が置かれた幅に反応する。下のdemoが実例</td>
          </tr>
          <tr>
            <td class="lab-spec-prop">ResizeObserver</td>
            <td class="lab-spec-value">DOM構造やJS stateが変わる場合（sidebarのhamburger化など）。境界にはwidthsの値を使う</td>
          </tr>
          <tr>
            <td class="lab-spec-prop">media query</td>
            <td class="lab-spec-value">viewport基準。panelにはほぼ誤り — window全体に関係するshellレベルだけ</td>
          </tr>
        </tbody>
      </table>

      <h3>demo — container query（panelを狭くすると反応する）</h3>
      <div class="lab-rq-demo">
        <div class="lab-rq-card">
          <div class="lab-rq-visual" />
          <div>
            <div>container queryのdemo。</div>
            <div class="lab-note">
              このカードは自分のcontainerの幅がcompact未満だと縦積みになる —
              CSSだけで書かれ、JSは介在しない。panelをsplitで狭くするか、
              sidebarを広げると反応が見える。
            </div>
          </div>
        </div>
      </div>

      <h3>demo — 実測（ResizeObserver）</h3>
      <WidthProbe />
    </>
  );
}

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
    group: "foundations", id: "responsive", title: "Responsive",
    render: () => <ResponsiveEntry />,
  },
  {
    group: "foundations", id: "motion", title: "Motion",
    render: () => (
      <>
        <p class="lab-note">
          shellの--work-anim（180ms）が昇格したもの。panelがアニメーション
          するときも同じ感覚を使う — hoverのchipに触れるとこの速度で動く。
        </p>
        <For each={prefixed("motion")}>
          {([key, cssVar]) => (
            <div class={{ "lab-row": true, unused: !usedTokens.has(key) }}>
              <span class="lab-key">{key}</span>
              <span class="lab-motionchip" style={{ "transition-duration": `var(${cssVar})` }} />
            </div>
          )}
        </For>
        <table class="lab-spec">
          <tbody>
            <tr><td class="lab-spec-prop">easing</td><td class="lab-spec-value">ease（css keyword）— 専用のbezierはまだ実績がない</td></tr>
            <tr><td class="lab-spec-prop">visibilityの遅延</td><td class="lab-spec-value">閉じる側にだけ書く — drawer/scrimの開閉で使われている技法</td></tr>
          </tbody>
        </table>
      </>
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
  {
    group: "components", id: "drawers", title: "Drawers",
    render: () => (
      <>
        <p class="lab-note">
          幅が足りないときに副構造（Sub / Area list）を重ねるpattern。
          shell専有 — 発動はshell幅で、Subは1100px未満・Area listは800px未満
          （幅の適応はResponsive entry参照）。
        </p>
        <h3>demo — 開いて外をclickしてみる</h3>
        <DrawerDemo />
        <table class="lab-spec">
          <tbody>
            <tr><td class="lab-spec-prop">台</td><td class="lab-spec-value">shell-frame-color — 不透明。影・角丸・blurは付けない（明示的にbox-shadow: none）</td></tr>
            <tr><td class="lab-spec-prop">線</td><td class="lab-spec-value">colors-border — 内側の辺にだけ1px（右drawerはborder-left、左はborder-right）</td></tr>
            <tr><td class="lab-spec-prop">幅</td><td class="lab-spec-value">min(raw幅, 85-90%) — 全面を覆わず背後を残す</td></tr>
            <tr><td class="lab-spec-prop">閉じ方</td><td class="lab-spec-value">transform: translateX(±100%+16px) + visibility — unmountせずstateを保つ</td></tr>
            <tr><td class="lab-spec-prop">畳み方</td><td class="lab-spec-value">Escape / 外をpointerdown（開くbuttonとdrawer自身はdata-drawer-keepで内側扱い）</td></tr>
            <tr><td class="lab-spec-prop">重なり</td><td class="lab-spec-value">z-side-drawer / z-sub-drawer — scrim（z-scrim）の上、列線はscrimより下で一緒に暗くなる</td></tr>
            <tr><td class="lab-spec-prop">scrim</td><td class="lab-spec-value">colors-scrim — 作業域を薄く暗くする幕。pointer-eventsは通す</td></tr>
            <tr><td class="lab-spec-prop">resize</td><td class="lab-spec-value">幅prefはinline表示と共有 — drawerは別物ではなく同じ列が重なった姿</td></tr>
            <tr><td class="lab-spec-prop">animation</td><td class="lab-spec-value">--work-anim 180ms ease — shell内部変数。visibilityの遅延は閉じる側にだけ書く</td></tr>
          </tbody>
        </table>
        <p class="lab-note">
          描画はminiature — 実物はshell.module.css（Sub）とwork-shape.module.css
          （Area list）。spec表は手書き注釈なのでshell側を変えたら更新する。
        </p>
      </>
    ),
  },
];

const GROUPS = [...new Set(ENTRIES.map((entry) => entry.group))];

function Lab(props: { initialSelected?: string; saveState?: (state: unknown) => void }): JSX.Element {
  const saveState = props.saveState;
  const [active, setActive] = createSignal(ENTRIES[0].id);
  const [width, setWidth] = createSignal(180);
  // 幅が狭いときはsidebarを畳む。ResizeObserverでpanel自体の幅を見る —
  // media queryではなくpanelの実サイズ基準（splitで狭くなることがある）。
  const [narrow, setNarrow] = createSignal(false);
  const [navOpen, setNavOpen] = createSignal(false);
  const current = () => ENTRIES.find((entry) => entry.id === active()) ?? ENTRIES[0];
  const observer = new ResizeObserver((records) => {
    for (const record of records) setNarrow(record.contentRect.width < widths.compact);
  });
  onCleanup(() => observer.disconnect());
  const select = (id: string) => {
    setActive(id);
    setNavOpen(false); // narrow時に項目を選んだら畳む
    // 選択はrestorable stateへ — workspaceと一緒に永続化され
    // reloadで復元される。URLはshellの名前空間なのでpanelは触らない。
    saveState?.({ selected: id });
  };
  navigateTo = select;
  onCleanup(() => { if (navigateTo === select) navigateTo = null; });
  // 初期選択はrestorable stateから。無効な値なら先頭のまま。
  if (props.initialSelected && ENTRIES.some((entry) => entry.id === props.initialSelected)) {
    setActive(props.initialSelected);
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

  // narrow時に開いているoverlay navはdrawer — 外をpointerdownしたら畳む。
  // shellと同じく、nav自身とhamburgerはdata-drawer-keepで内側扱い。
  const outsideDown = (event: PointerEvent) => {
    if (!narrow() || !navOpen()) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest("[data-drawer-keep]")) return;
    setNavOpen(false);
  };

  return (
    <div class={{ "lab": true, narrow: narrow(), "nav-open": navOpen() }} ref={((el) => observer.observe(el)) as (el: HTMLDivElement) => void} onPointerDown={outsideDown}>
      <nav class="lab-nav" data-drawer-keep style={narrow() ? undefined : { width: `${width()}px` }}>
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
          <button class="lab-hamburger" data-drawer-keep aria-label="menu" onClick={() => setNavOpen(!navOpen())}>☰</button>
          <div class="lab-summary">{usedTokens.size} / {entries.length} tokens in use — 薄いものは未使用</div>
        </div>
        <h2>{current().title}</h2>
        {current().render()}
      </div>
    </div>
  );
}

export function mount(host: ShadowRoot, context: ViewContext): ViewHandle {
  const saved = context.state as { selected?: string } | undefined;
  const dispose = render(() => (
    <Lab initialSelected={saved?.selected} saveState={context.saveState} />
  ), host);
  return { destroy: () => dispose() };
}
