//! filesystem/read・write・list: ファイル読み書きと一覧のoperation。

use serde_json::{json, Value};

pub async fn read(input: &Value) -> Result<Value, String> {
    let path = input["path"].as_str().unwrap_or("");
    if path.is_empty() {
        return Err("input.path is required".into());
    }
    tokio::fs::read_to_string(path)
        .await
        .map(|content| json!({"path": path, "content": content}))
        .map_err(|e| e.to_string())
}

pub async fn write(input: &Value) -> Result<Value, String> {
    let path = input["path"].as_str().unwrap_or("");
    if path.is_empty() {
        return Err("input.path is required".into());
    }
    let Some(content) = input["content"].as_str() else {
        return Err("input.content must be a string".into());
    };
    let bytes = content.len();
    tokio::fs::write(path, content)
        .await
        .map(|_| json!({"path": path, "bytes": bytes}))
        .map_err(|e| e.to_string())
}

struct Entry {
    name: String,
    kind: &'static str,
    size: u64,
}

/// filesystem/list: ディレクトリ一覧。entriesはディレクトリを先に、
/// 同種内では名前順。
pub async fn list(input: &Value) -> Result<Value, String> {
    let path = input["path"].as_str().unwrap_or(".");
    let entries = list_directory(path).await?;
    Ok(json!({
        "path": path,
        "entries": entries
            .iter()
            .map(|entry| json!({"name": entry.name, "kind": entry.kind, "size": entry.size}))
            .collect::<Vec<_>>(),
    }))
}

async fn list_directory(path: &str) -> Result<Vec<Entry>, String> {
    let mut directory = tokio::fs::read_dir(path).await.map_err(|e| e.to_string())?;
    let mut entries = Vec::new();
    while let Some(entry) = directory.next_entry().await.map_err(|e| e.to_string())? {
        let file_type = entry.file_type().await.map_err(|e| e.to_string())?;
        let kind = if file_type.is_dir() {
            "directory"
        } else if file_type.is_symlink() {
            "symlink"
        } else if file_type.is_file() {
            "file"
        } else {
            "other"
        };
        let size = entry.metadata().await.map(|meta| meta.len()).unwrap_or(0);
        entries.push(Entry {
            name: entry.file_name().to_string_lossy().into_owned(),
            kind,
            size,
        });
    }
    entries.sort_by(|a, b| {
        (b.kind == "directory")
            .cmp(&(a.kind == "directory"))
            .then_with(|| a.name.cmp(&b.name))
    });
    Ok(entries)
}

#[cfg(test)]
mod tests {
    use super::list_directory;

    #[tokio::test]
    async fn list_returns_directories_first_then_by_name() {
        let root = std::env::temp_dir().join(format!("plugumi-fs-list-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("z-dir")).unwrap();
        std::fs::create_dir_all(root.join("a-dir")).unwrap();
        std::fs::write(root.join("b.txt"), "hello").unwrap();
        std::fs::write(root.join("a.txt"), "hi").unwrap();

        let path = root.to_str().unwrap().to_string();
        let entries = list_directory(&path).await.unwrap();
        let names: Vec<&str> = entries.iter().map(|entry| entry.name.as_str()).collect();
        assert_eq!(names, ["a-dir", "z-dir", "a.txt", "b.txt"]);
        assert_eq!(entries[0].kind, "directory");
        assert_eq!(entries[2].kind, "file");
        assert_eq!(entries[2].size, 2);
        assert!(list_directory(&root.join("missing").to_string_lossy())
            .await
            .is_err());
        let _ = std::fs::remove_dir_all(&root);
    }
}
