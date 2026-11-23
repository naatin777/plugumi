// window.prompt/confirmはElectronで使えないため、名前入力と削除確認は
// inlineの部品で行う。2つの領域で重複実装しないようここにまとめる。
import { createSignal, Show } from "solid-js";
import type { JSX } from "@solidjs/web";

export interface NameFormProps {
  label: string;
  // 送信時の処理。失敗したらErrorを投げる（messageをinlineに表示する）。
  submit: (name: string) => Promise<void>;
  cancel: () => void;
}

// Enter=作成、Esc=取りやめ。サーバーのエラーはその場に出す。
export function NameForm(props: NameFormProps): JSX.Element {
  const [name, setName] = createSignal("");
  const [error, setError] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const submit = async (event: Event) => {
    event.preventDefault();
    const value = name().trim();
    if (!value || busy()) return;
    setError("");
    setBusy(true);
    try {
      await props.submit(value);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setBusy(false);
    }
  };
  return (
    <form class="name-form" onSubmit={submit}>
      <input
        ref={(node) => node.focus()}
        aria-label={props.label}
        placeholder={props.label}
        value={name()}
        disabled={busy()}
        onInput={(event) => setName(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") props.cancel();
        }}
        onBlur={() => {
          // 未入力のまま外れたら閉じる（入力中のblurは残す）
          if (!busy() && name().trim() === "") props.cancel();
        }}
      />
      <button type="submit" disabled={busy() || name().trim() === ""}>作成</button>
      <Show when={error()}>
        <p class="name-form-error">{error()}</p>
      </Show>
    </form>
  );
}

export interface ConfirmButtonProps {
  label: string;
  confirmLabel: string;
  class?: string;
  confirm: () => void;
  children?: JSX.Element;
}

// 2段階の削除確認。1回目のclickで数秒だけ確認表示になり、
// 2回目で実行する（dialogを開かない）。
export function ConfirmButton(props: ConfirmButtonProps): JSX.Element {
  const [confirming, setConfirming] = createSignal(false);
  let timer = 0;
  const press = (event: MouseEvent) => {
    event.stopPropagation();
    if (confirming()) {
      window.clearTimeout(timer);
      setConfirming(false);
      props.confirm();
      return;
    }
    setConfirming(true);
    window.clearTimeout(timer);
    timer = window.setTimeout(() => setConfirming(false), 4000);
  };
  return (
    <button
      class={{
        [props.class ?? "icon-button"]: true,
        "confirm-armed": confirming(),
      }}
      aria-label={confirming() ? props.confirmLabel : props.label}
      onClick={press}
    >
      <Show when={confirming()} fallback={props.children}>
        <span class="confirm-text">{props.confirmLabel}</span>
      </Show>
    </button>
  );
}
