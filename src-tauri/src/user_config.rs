//! User-scoped configuration stored outside any workspace.
//!
//! Workspace descriptors deliberately contain only paths and their source
//! kind. Vault passwords, temporary mount points, and process state must never
//! be persisted here.

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Deserializer, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum LastWorkspace {
    Folder { path: String },
    Cryptomator { path: String },
}

impl LastWorkspace {
    pub fn folder(path: &Path) -> Self {
        Self::Folder {
            path: path.to_string_lossy().to_string(),
        }
    }

    pub fn cryptomator(path: &Path) -> Self {
        Self::Cryptomator {
            path: path.to_string_lossy().to_string(),
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserConfig {
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_last_workspace"
    )]
    pub last_workspace: Option<LastWorkspace>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cryptomator_cli_path: Option<String>,
}

pub fn load_or_create_user_config(home_dir: &Path) -> Result<UserConfig, String> {
    load_or_create_user_config_at(&user_config_path(home_dir))
}

pub fn save_last_workspace(home_dir: &Path, workspace: LastWorkspace) -> Result<(), String> {
    let mut config = load_or_create_user_config(home_dir)?;
    config.last_workspace = Some(workspace);
    write_user_config(&user_config_path(home_dir), &config)
}

pub fn save_cryptomator_workspace(
    home_dir: &Path,
    vault_path: &Path,
    explicit_cli_path: Option<&Path>,
) -> Result<(), String> {
    let mut config = load_or_create_user_config(home_dir)?;
    config.last_workspace = Some(LastWorkspace::cryptomator(vault_path));
    if let Some(cli_path) = explicit_cli_path {
        config.cryptomator_cli_path = Some(cli_path.to_string_lossy().to_string());
    }
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

fn deserialize_last_workspace<'de, D>(deserializer: D) -> Result<Option<LastWorkspace>, D::Error>
where
    D: Deserializer<'de>,
{
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum CompatibleLastWorkspace {
        Descriptor(LastWorkspace),
        LegacyPath(String),
    }

    Option::<CompatibleLastWorkspace>::deserialize(deserializer).map(|workspace| {
        workspace.map(|workspace| match workspace {
            CompatibleLastWorkspace::Descriptor(workspace) => workspace,
            CompatibleLastWorkspace::LegacyPath(path) => LastWorkspace::Folder { path },
        })
    })
}

#[cfg(test)]
mod tests {
    use super::{
        load_or_create_user_config, load_or_create_user_config_at, save_cryptomator_workspace,
        write_user_config, LastWorkspace, UserConfig,
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
    fn reads_workspace_descriptor() {
        let root = temp_dir();
        let path = root.join(".logtext");
        write_user_config(
            &path,
            &UserConfig {
                last_workspace: Some(LastWorkspace::Cryptomator {
                    path: "/tmp/vault".to_string(),
                }),
                cryptomator_cli_path: Some("/opt/cryptomator-cli".to_string()),
            },
        )
        .unwrap();

        let config = load_or_create_user_config_at(&path).unwrap();

        assert_eq!(
            config.last_workspace,
            Some(LastWorkspace::Cryptomator {
                path: "/tmp/vault".to_string()
            })
        );
        assert_eq!(
            config.cryptomator_cli_path.as_deref(),
            Some("/opt/cryptomator-cli")
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn migrates_legacy_workspace_string() {
        let root = temp_dir();
        let path = root.join(".logtext");
        fs::write(&path, "{\"lastWorkspace\":\"/tmp/workspace\"}\n").unwrap();

        let config = load_or_create_user_config_at(&path).unwrap();

        assert_eq!(
            config.last_workspace,
            Some(LastWorkspace::Folder {
                path: "/tmp/workspace".to_string()
            })
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn stores_only_an_explicit_cryptomator_cli_path() {
        let root = temp_dir();
        let selected_cli = PathBuf::from("/opt/cryptomator-cli");

        save_cryptomator_workspace(
            &root,
            PathBuf::from("/tmp/first-vault").as_path(),
            Some(&selected_cli),
        )
        .unwrap();
        save_cryptomator_workspace(&root, PathBuf::from("/tmp/second-vault").as_path(), None)
            .unwrap();

        let config = load_or_create_user_config(&root).unwrap();
        assert_eq!(
            config.last_workspace,
            Some(LastWorkspace::Cryptomator {
                path: "/tmp/second-vault".to_string()
            })
        );
        assert_eq!(
            config.cryptomator_cli_path.as_deref(),
            Some("/opt/cryptomator-cli")
        );
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
