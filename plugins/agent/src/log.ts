// Pluginプロセスの診断ログ。Toolの出力は含めない。1プロセスが複数Coreに
// 繋がり得るためCore側ではなくregistryの記録にlog pathを載せ、
// TUI・CLIはそれを読む。plugumi経由の起動でなくてもpathが記録されるよう、
// ファイルの場所はPluginが自分で決める。
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import { cacheDirectory } from "plugumi-plugin-client";

let logFile: string | undefined;

export function logPath(): string | undefined {
  if (logFile === undefined) {
    try {
      const directory = join(cacheDirectory(), "plugumi", "logs");
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      logFile = join(directory, `agent-${process.pid}.log`);
    } catch {
      // logファイルを開けなくてもPlugin自体は動かす
      return undefined;
    }
  }
  return logFile;
}

// 診断を標準エラーと自分のログファイルの両方へ書く。
export function logDiagnostic(message: string): void {
  console.error(message);
  const path = logPath();
  if (path === undefined) {
    return;
  }
  try {
    appendFileSync(path, message + "\n", { mode: 0o600 });
  } catch {
    // 書き込み失敗も本体の処理を止めない
  }
}
