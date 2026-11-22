// --core <url>（複数可・--core=urlも可）とPLUGUMI_CORE_URLから
// 起動時のCore URLを取る。位置引数は受けない（electron CLIは
// appのパスを位置引数として渡すため、URLと区別できない）。
export function parseCoreArgs(argv: string[]): string[] {
  const urls: string[] = [];
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--core") {
      if (++index >= argv.length) throw new Error("--core: missing value");
      urls.push(argv[index]);
    } else if (arg.startsWith("--core=")) {
      urls.push(arg.slice("--core=".length));
    }
  }
  if (urls.length === 0 && process.env.PLUGUMI_CORE_URL) {
    urls.push(process.env.PLUGUMI_CORE_URL);
  }
  return urls;
}
