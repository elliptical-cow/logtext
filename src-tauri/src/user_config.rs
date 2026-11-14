//! User-scoped configuration stored outside any workspace.
//!
//! This file currently remembers only the last workspace. Workspace content and
//! workspace-specific preferences belong in the workspace `.config` instead.

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Deserializer, Serialize};

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct UserConfig {
    #[serde(
        rename = "lastWorkspace",
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_last_workspace"
    )]
    pub last_workspace: Option<String>,
}

fn deserialize_last_workspace<'de, D>(deserializer: D) -> Result<Option<String>, D::Error>
where
    D: Deserializer<'de>,
{
    // Experimental builds stored descriptors instead of plain paths. Only
    // folders can be reopened by this build; a vault path is not a workspace.
    #[derive(Deserialize)]
    #[serde(tag = "kind", rename_all = "camelCase")]
    enum WorkspaceDescriptor {
        Folder {
            path: String,
        },
        #[serde(other)]
        Unsupported,
    }

    #[derive(Deserialize)]
    #[serde(untagged)]
    enum CompatibleWorkspace {
        Path(String),
        Descriptor(WorkspaceDescriptor),
    }

    Ok(
        Option::<CompatibleWorkspace>::deserialize(deserializer)?.and_then(|workspace| {
            match workspace {
                CompatibleWorkspace::Path(path)
                | CompatibleWorkspace::Descriptor(WorkspaceDescriptor::Folder { path }) => {
                    Some(path)
                }
                CompatibleWorkspace::Descriptor(WorkspaceDescriptor::Unsupported) => None,
            }
        }),
    )
}

pub fn load_or_create_user_config(home_dir: &Path) -> Result<UserConfig, String> {
    load_or_create_user_config_at(&user_config_path(home_dir))
}

pub fn save_last_workspace(home_dir: &Path, path: &Path) -> Result<(), String> {
    let mut config = load_or_create_user_config(home_dir)?;
    config.last_workspace = Some(path.to_string_lossy().to_string());
    write_user_config(&user_config_path(home_dir), &config)
}

fn user_config_path(home_dir: &Path) -> PathBuf {
    home_dir.join(".logtext")
}

fn load_or_create_user_config_at(path: &Path) -> Result<UserConfig, String> {
    if !path.exists() {
        let config = UserConfig::default();
        write_user_config(path, &config)?;
        return Ok(config);
    }

    let content = fs::read_to_string(path)
        .map_err(|error| format!("Failed to read user .logtext: {error}"))?;

    if content.trim().is_empty() {
        let config = UserConfig::default();
        write_user_config(path, &config)?;
        return Ok(config);
    }

    serde_json::from_str(&content)
        .map_err(|error| format!("Failed to parse user .logtext: {error}"))
}

fn write_user_config(path: &Path, config: &UserConfig) -> Result<(), String> {
    let content = serde_json::to_string_pretty(config)
        .map_err(|error| format!("Failed to serialize user .logtext: {error}"))?;
    fs::write(path, format!("{content}\n"))
        .map_err(|error| format!("Failed to write user .logtext: {error}"))
}

#[cfg(test)]
mod tests {
    use super::{
        load_or_create_user_config, load_or_create_user_config_at, save_last_workspace,
        write_user_config, UserConfig,
    };
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn creates_missing_user_config() {
        let root = temp_dir();

        let config = load_or_create_user_config(&root).unwrap();

        assert_eq!(config, UserConfig::default());
        assert!(root.join(".logtext").exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn reads_last_workspace_from_user_config() {
        let root = temp_dir();
        let path = root.join(".logtext");
        write_user_config(
            &path,
            &UserConfig {
                last_workspace: Some("/tmp/workspace".to_string()),
            },
        )
        .unwrap();

        let config = load_or_create_user_config_at(&path).unwrap();

        assert_eq!(config.last_workspace, Some("/tmp/workspace".to_string()));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn reads_folder_descriptor_without_rewriting_user_config() {
        let root = temp_dir();
        let path = root.join(".logtext");
        let content = "{\n  \"lastWorkspace\": {\n    \"kind\": \"folder\",\n    \"path\": \"/tmp/workspace\"\n  }\n}\n";
        fs::write(&path, content).unwrap();

        let config = load_or_create_user_config(&root).unwrap();

        assert_eq!(config.last_workspace.as_deref(), Some("/tmp/workspace"));
        assert_eq!(fs::read_to_string(&path).unwrap(), content);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn saves_new_workspace_after_reading_folder_descriptor() {
        let root = temp_dir();
        let path = root.join(".logtext");
        fs::write(
            &path,
            r#"{"lastWorkspace":{"kind":"folder","path":"/tmp/old"}}"#,
        )
        .unwrap();

        save_last_workspace(&root, std::path::Path::new("/tmp/new")).unwrap();

        let saved: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(path).unwrap()).unwrap();
        assert_eq!(saved["lastWorkspace"], "/tmp/new");
        assert_eq!(
            load_or_create_user_config(&root)
                .unwrap()
                .last_workspace
                .as_deref(),
            Some("/tmp/new")
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn unsupported_workspace_descriptors_do_not_open_as_folders() {
        let root = temp_dir();
        let path = root.join(".logtext");
        for kind in ["cryptomator", "futureWorkspace"] {
            let content = format!(r#"{{"lastWorkspace":{{"kind":"{kind}","path":"/tmp/vault"}}}}"#);
            fs::write(&path, &content).unwrap();

            assert_eq!(
                load_or_create_user_config(&root).unwrap().last_workspace,
                None
            );
            assert_eq!(fs::read_to_string(&path).unwrap(), content);
            save_last_workspace(&root, std::path::Path::new("/tmp/ordinary")).unwrap();
        }
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn missing_or_null_last_workspace_remains_valid() {
        let root = temp_dir();
        for content in ["{}", r#"{"lastWorkspace":null}"#] {
            fs::write(root.join(".logtext"), content).unwrap();
            assert_eq!(
                load_or_create_user_config(&root).unwrap(),
                UserConfig::default()
            );
        }
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn malformed_user_config_is_not_overwritten_when_saving_workspace() {
        let root = temp_dir();
        let path = root.join(".logtext");
        for content in [
            "{broken",
            r#"{"lastWorkspace":{"kind":"folder"}}"#,
            r#"{"lastWorkspace":{"kind":"folder","path":42}}"#,
            r#"{"lastWorkspace":{"path":"/tmp/workspace"}}"#,
            r#"{"lastWorkspace":42}"#,
        ] {
            fs::write(&path, content).unwrap();
            let error = save_last_workspace(&root, std::path::Path::new("/tmp/new")).unwrap_err();
            assert!(error.starts_with("Failed to parse user .logtext:"));
            assert_eq!(fs::read_to_string(&path).unwrap(), content);
        }
        fs::remove_dir_all(root).unwrap();
    }

    fn temp_dir() -> PathBuf {
        let mut path = std::env::temp_dir();
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        path.push(format!("logtext-user-config-test-{nanos}"));
        fs::create_dir_all(&path).unwrap();
        path
    }
}
