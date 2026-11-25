//! Coreとの接続と独立したローカル実行記録。待受なしで時刻を更新する。

use serde_json::{json, Value};
use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

pub struct Registration {
    path: PathBuf,
    temp: PathBuf,
    record: Value,
}

impl Registration {
    pub fn refresh(&self) -> bool {
        let mut record = self.record.clone();
        record["heartbeatUnixSeconds"] = json!(SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0, |duration| duration.as_secs()));
        if fs::write(&self.temp, record.to_string()).is_err()
            || fs::rename(&self.temp, &self.path).is_err()
        {
            let _ = fs::remove_file(&self.temp);
            return false;
        }
        true
    }
}

impl Drop for Registration {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.path);
    }
}

/// プロセスごとの識別子。Coreのinstance id相当。opaqueなので形は問わない。
pub fn new_instance_id() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("plugin-{}-{:x}", std::process::id(), nanos)
}

// Go側のos.UserCacheDir()と同じ場所に揃える。依存を増やさないよう自前で分岐。
pub(crate) fn cache_directory() -> Option<PathBuf> {
    #[cfg(target_os = "macos")]
    {
        std::env::var_os("HOME").map(|home| PathBuf::from(home).join("Library/Caches"))
    }
    #[cfg(target_os = "windows")]
    {
        std::env::var_os("LOCALAPPDATA").map(PathBuf::from)
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        std::env::var_os("XDG_CACHE_HOME")
            .map(PathBuf::from)
            .or_else(|| std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".cache")))
    }
}

pub fn register(name: &str, id: &str, version: &str) -> Option<Registration> {
    let directory = cache_directory()?.join("plugumi").join("plugins");
    if fs::create_dir_all(&directory).is_err() {
        return None;
    }
    let path = directory.join(format!("{id}.json"));
    let record = json!({
        "name": name,
        "id": id,
        "version": version,
        "pid": std::process::id(),
        // 1プロセスが複数Coreに繋がるため、logはCoreではなくPluginの記録に持つ。
        "log": crate::log::path(),
    });
    // 読みかけの不完全ファイルを見せないよう、別名で書いてからrenameする。
    let temp = directory.join(format!(".{}", std::process::id()));
    let registration = Registration { path, temp, record };
    registration.refresh().then_some(registration)
}
