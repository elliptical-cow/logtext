use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use percent_encoding::percent_decode_str;
use tauri::http::{header, Request, Response, StatusCode};
use tauri::ipc::{InvokeBody, Request as InvokeRequest};
use tauri::{AppHandle, Manager, Runtime, State};

use crate::app_state::{AppState, WorkspaceState};
use crate::workspace::paths::resolve_workspace_relative_path;

const MAX_PASTED_IMAGE_BYTES: usize = 20 * 1024 * 1024;

#[tauri::command]
pub fn save_pasted_image(
    state: State<'_, AppState>,
    request: InvokeRequest<'_>,
) -> Result<String, String> {
    let document_path = decoded_header(&request, "document-path")?;
    let mime_type = header_value(&request, "mime-type")?;
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("Pasted image data must be sent as binary data".to_string());
    };

    state.with_workspace(|workspace| {
        save_pasted_image_in_workspace(workspace, &document_path, &mime_type, bytes)
    })?
}

pub fn workspace_media_response<R: Runtime>(
    app_handle: &AppHandle<R>,
    request: Request<Vec<u8>>,
) -> Response<Vec<u8>> {
    let result = app_handle
        .state::<AppState>()
        .with_workspace(|workspace| read_workspace_image(workspace, request.uri().path()))
        .and_then(|result| result);

    match result {
        Ok((bytes, content_type)) => Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, content_type)
            .header(
                header::CACHE_CONTROL,
                "private, max-age=31536000, immutable",
            )
            .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
            .body(bytes)
            .unwrap_or_else(|_| Response::new(Vec::new())),
        Err(message) => Response::builder()
            .status(StatusCode::NOT_FOUND)
            .header(header::CONTENT_TYPE, "text/plain; charset=utf-8")
            .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
            .body(message.into_bytes())
            .unwrap_or_else(|_| Response::new(Vec::new())),
    }
}

pub fn save_pasted_image_in_workspace(
    workspace: &WorkspaceState,
    document_path: &str,
    mime_type: &str,
    bytes: &[u8],
) -> Result<String, String> {
    if workspace.pages.get_by_path(document_path).is_none() {
        return Err("Paste images only into an open Markdown page".to_string());
    }
    if bytes.is_empty() || bytes.len() > MAX_PASTED_IMAGE_BYTES {
        return Err("Pasted images must be between 1 byte and 20 MiB".to_string());
    }

    let extension = validated_image_extension(mime_type, bytes)?;
    let media_directory = safe_media_directory(workspace)?;
    let source_slug = document_slug(document_path);
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| "System clock is before the Unix epoch".to_string())?
        .as_millis();
    let fingerprint = image_fingerprint(bytes);

    for collision in 0..100_u8 {
        let suffix = if collision == 0 {
            String::new()
        } else {
            format!("--{collision}")
        };
        let file_name = format!("{source_slug}--{timestamp}--{fingerprint}{suffix}.{extension}");
        let absolute_path = media_directory.join(&file_name);
        let mut file = match OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&absolute_path)
        {
            Ok(file) => file,
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => {
                return Err(format!(
                    "Failed to create pasted image '{}': {error}",
                    absolute_path.display()
                ))
            }
        };
        if let Err(error) = file.write_all(bytes) {
            drop(file);
            let cleanup = fs::remove_file(&absolute_path);
            return Err(format!(
                "Failed to write pasted image '{}': {error}. Cleanup result: {cleanup:?}",
                absolute_path.display()
            ));
        }

        let workspace_path = format!("{}/{file_name}", workspace.config.media_folder);
        return Ok(workspace_path);
    }

    Err("Could not allocate a unique pasted image filename".to_string())
}

fn read_workspace_image(
    workspace: &WorkspaceState,
    encoded_path: &str,
) -> Result<(Vec<u8>, &'static str), String> {
    let decoded = percent_decode_str(encoded_path.trim_start_matches('/'))
        .decode_utf8()
        .map_err(|_| "Image path is not valid UTF-8".to_string())?;
    let absolute_path = safe_existing_workspace_file(workspace, &decoded)?;
    let bytes = fs::read(&absolute_path).map_err(|error| {
        format!(
            "Failed to read image '{}': {error}",
            absolute_path.display()
        )
    })?;
    let content_type = image_content_type(&absolute_path, &bytes)?;
    Ok((bytes, content_type))
}

fn safe_media_directory(workspace: &WorkspaceState) -> Result<PathBuf, String> {
    let directory =
        resolve_workspace_relative_path(&workspace.root, &workspace.config.media_folder)
            .ok_or_else(|| "Invalid configured media folder".to_string())?;
    fs::create_dir_all(&directory).map_err(|error| {
        format!(
            "Failed to create media folder '{}': {error}",
            directory.display()
        )
    })?;

    let canonical_root = workspace
        .root
        .canonicalize()
        .map_err(|error| format!("Failed to resolve workspace path: {error}"))?;
    let canonical_directory = directory
        .canonicalize()
        .map_err(|error| format!("Failed to resolve media folder: {error}"))?;
    if !canonical_directory.starts_with(canonical_root) {
        return Err("Configured media folder resolves outside the workspace".to_string());
    }

    Ok(canonical_directory)
}

fn safe_existing_workspace_file(
    workspace: &WorkspaceState,
    relative_path: &str,
) -> Result<PathBuf, String> {
    let candidate = resolve_workspace_relative_path(&workspace.root, relative_path)
        .ok_or_else(|| "Invalid workspace image path".to_string())?;
    let canonical_root = workspace
        .root
        .canonicalize()
        .map_err(|error| format!("Failed to resolve workspace path: {error}"))?;
    let canonical_path = candidate
        .canonicalize()
        .map_err(|_| "Workspace image does not exist".to_string())?;
    if !canonical_path.starts_with(canonical_root) || !canonical_path.is_file() {
        return Err("Workspace image resolves outside the workspace".to_string());
    }
    Ok(canonical_path)
}

fn document_slug(document_path: &str) -> String {
    let without_extension = document_path
        .strip_suffix(".md")
        .or_else(|| document_path.strip_suffix(".MD"))
        .unwrap_or(document_path);
    let mut slug = String::new();
    let mut previous_separator = false;
    for character in without_extension.chars() {
        if slug.chars().count() >= 72 {
            break;
        }
        if character.is_alphanumeric() {
            slug.extend(character.to_lowercase());
            previous_separator = false;
        } else if !previous_separator && !slug.is_empty() {
            slug.push('-');
            previous_separator = true;
        }
    }
    let trimmed = slug.trim_matches('-');
    if trimmed.is_empty() {
        "image".to_string()
    } else {
        trimmed.to_string()
    }
}

fn image_fingerprint(bytes: &[u8]) -> String {
    let mut hash = 0xcbf29ce484222325_u64;
    for byte in bytes {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("{hash:016x}")[..8].to_string()
}

fn validated_image_extension(mime_type: &str, bytes: &[u8]) -> Result<&'static str, String> {
    match (mime_type, detected_image_format(bytes)) {
        ("image/png", Some("png")) => Ok("png"),
        ("image/jpeg", Some("jpeg")) => Ok("jpg"),
        ("image/webp", Some("webp")) => Ok("webp"),
        ("image/gif", Some("gif")) => Ok("gif"),
        _ => Err("Clipboard image must be PNG, JPEG, WebP, or GIF".to_string()),
    }
}

fn image_content_type(path: &Path, bytes: &[u8]) -> Result<&'static str, String> {
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    match (extension.as_str(), detected_image_format(bytes)) {
        ("png", Some("png")) => Ok("image/png"),
        ("jpg" | "jpeg", Some("jpeg")) => Ok("image/jpeg"),
        ("webp", Some("webp")) => Ok("image/webp"),
        ("gif", Some("gif")) => Ok("image/gif"),
        _ => Err("Unsupported or invalid workspace image".to_string()),
    }
}

fn detected_image_format(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some("png")
    } else if bytes.starts_with(b"\xff\xd8\xff") {
        Some("jpeg")
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        Some("gif")
    } else if bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        Some("webp")
    } else {
        None
    }
}

fn header_value(request: &InvokeRequest<'_>, name: &str) -> Result<String, String> {
    request
        .headers()
        .get(name)
        .and_then(|value| value.to_str().ok())
        .map(str::to_string)
        .ok_or_else(|| format!("Missing {name} header"))
}

fn decoded_header(request: &InvokeRequest<'_>, name: &str) -> Result<String, String> {
    let value = header_value(request, name)?;
    percent_decode_str(&value)
        .decode_utf8()
        .map(|value| value.to_string())
        .map_err(|_| format!("Invalid {name} header"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::content_snapshot::ContentSnapshot;
    use crate::index::backlink_index::BacklinkIndex;
    use crate::index::page_index::PageIndex;
    use crate::workspace_config::WorkspaceConfig;

    #[test]
    fn saves_validated_images_with_traceable_unique_names() {
        let root = temp_workspace();
        let mut pages = PageIndex::default();
        pages.insert_page("projects/Roadmap.md".to_string(), "# Roadmap");
        let workspace = WorkspaceState {
            root: root.clone(),
            config: WorkspaceConfig::default(),
            folders: Vec::new(),
            pages,
            backlinks: BacklinkIndex::default(),
            contents: ContentSnapshot::default(),
        };

        let link = save_pasted_image_in_workspace(
            &workspace,
            "projects/Roadmap.md",
            "image/png",
            b"\x89PNG\r\n\x1a\nimage",
        )
        .unwrap();

        assert!(link.starts_with("media/projects-roadmap--"));
        assert!(link.ends_with(".png"));
        assert_eq!(
            fs::read(root.join("projects").join("missing.png")).ok(),
            None
        );
        let stored_path = root.join(link);
        assert_eq!(fs::read(stored_path).unwrap(), b"\x89PNG\r\n\x1a\nimage");
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rejects_mismatched_or_active_image_formats() {
        assert!(validated_image_extension("image/jpeg", b"\x89PNG\r\n\x1a\n").is_err());
        assert!(validated_image_extension("image/svg+xml", b"<svg></svg>").is_err());
    }

    fn temp_workspace() -> PathBuf {
        let root = std::env::temp_dir().join(format!(
            "logtext-media-test-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(root.join("projects")).unwrap();
        root
    }
}
