//! Pluginプロセス自身のログ。stderrにも出すが、1プロセスが複数Coreに
//! 繋がり得るためCore側ではなくregistryの記録にlog pathを載せ、
//! TUI・CLIはそれを読む。plugumi経由の起動でなくてもpathが記録されるよう、
//! ファイルの場所はPluginが自分で決める。

use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};

struct LogFile {
    path: PathBuf,
    file: File,
}

static LOG: OnceLock<Option<Mutex<LogFile>>> = OnceLock::new();

fn open() -> Option<Mutex<LogFile>> {
    let directory = crate::registration::cache_directory()?
        .join("plugumi")
        .join("logs");
    fs::create_dir_all(&directory).ok()?;
    let path = directory.join(format!("environment-{}.log", std::process::id()));
    let file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .ok()?;
    Some(Mutex::new(LogFile { path, file }))
}

/// registryの記録に載せるログファイルの場所。開けなければNone。
pub fn path() -> Option<String> {
    LOG.get_or_init(open)
        .as_ref()
        .and_then(|log| log.lock().ok())
        .map(|log| log.path.display().to_string())
}

/// stderrと自分のlogファイルの両方へ1行書く。
pub fn line(message: &str) {
    eprintln!("{message}");
    if let Some(log) = LOG.get_or_init(open).as_ref() {
        if let Ok(mut log) = log.lock() {
            let _ = writeln!(log.file, "{message}");
        }
    }
}

// eprintln!と同じ感覚でformatできるようにする。
macro_rules! logln {
    ($($arg:tt)*) => { $crate::log::line(&format!($($arg)*)) };
}
pub(crate) use logln;
