//! Provider-neutral domain types (CTX-01). Serialized form is the portable
//! Context Pack schema; field names are camelCase to match the JSON envelope
//! in the product specification (section 9.3).

use serde::{Deserialize, Serialize};

pub const SCHEMA_VERSION: &str = "1.0.0";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Role {
    User,
    Assistant,
    System,
    Tool,
}

/// One piece of a message. Text is kept verbatim, including Markdown code
/// fences, so literals (paths, commands, errors) survive untouched.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum Block {
    Text {
        text: String,
    },
    ToolCall {
        name: String,
        input: String,
    },
    ToolResult {
        #[serde(default)]
        name: Option<String>,
        output: String,
        #[serde(default)]
        is_error: bool,
    },
    /// A reference to content that was not recovered (CAP-12, ATT "Referenced
    /// but not recovered"). Never pretend it was transferred.
    Missing {
        description: String,
    },
    /// A file or image shared in the conversation and recovered with it. The
    /// bytes live in the library's attachment store under `sha256`.
    #[serde(rename_all = "camelCase")]
    File {
        name: String,
        media_type: String,
        sha256: String,
        size: u64,
    },
}

impl Block {
    pub fn text(s: impl Into<String>) -> Self {
        Block::Text { text: s.into() }
    }

    pub fn plain_text(&self) -> &str {
        match self {
            Block::Text { text } => text,
            Block::ToolCall { input, .. } => input,
            Block::ToolResult { output, .. } => output,
            Block::Missing { description } => description,
            Block::File { name, .. } => name,
        }
    }
}

/// Bytes of a file recovered during capture, kept beside the messages until
/// the library stores them as an attachment.
#[derive(Debug, Clone, PartialEq)]
pub struct CapturedFile {
    pub name: String,
    pub media_type: String,
    pub bytes: Vec<u8>,
}

impl CapturedFile {
    pub fn sha256(&self) -> String {
        use sha2::{Digest, Sha256};
        hex::encode(Sha256::digest(&self.bytes))
    }

    /// The message block that points at this file.
    pub fn block(&self) -> Block {
        Block::File { name: self.name.clone(), media_type: self.media_type.clone(), sha256: self.sha256(), size: self.bytes.len() as u64 }
    }

    /// Library attachment record; text-like files keep their text so it can
    /// be inlined into handoffs.
    pub fn attachment(&self) -> Attachment {
        let texty = self.media_type.starts_with("text/")
            || matches!(self.media_type.as_str(), "application/json" | "application/xml" | "application/x-yaml" | "application/javascript");
        Attachment {
            id: crate::new_id(),
            file_name: self.name.clone(),
            media_type: self.media_type.clone(),
            size: self.bytes.len() as u64,
            sha256: self.sha256(),
            origin_path: None,
            text: if texty { String::from_utf8(self.bytes.clone()).ok() } else { None },
        }
    }

    /// Decode base64 (standard or URL-safe, with or without a `data:` URL
    /// prefix). Returns None for anything that does not decode.
    pub fn from_base64(name: impl Into<String>, media_type: impl Into<String>, data: &str) -> Option<Self> {
        use base64::Engine;
        let mut media_type = media_type.into();
        let mut data = data.trim();
        if let Some(rest) = data.strip_prefix("data:") {
            let (meta, payload) = rest.split_once(',')?;
            if media_type.is_empty() {
                media_type = meta.split(';').next().unwrap_or("").to_string();
            }
            data = payload;
        }
        let clean: String = data.chars().filter(|c| !c.is_whitespace()).collect();
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(&clean)
            .or_else(|_| base64::engine::general_purpose::URL_SAFE.decode(&clean))
            .or_else(|_| base64::engine::general_purpose::STANDARD_NO_PAD.decode(clean.trim_end_matches('=')))
            .ok()?;
        if bytes.is_empty() {
            return None;
        }
        if media_type.is_empty() {
            media_type = "application/octet-stream".into();
        }
        let name = name.into();
        let name = if name.contains('.') { name } else { format!("{name}.{}", extension_for(&media_type)) };
        Some(CapturedFile { name, media_type, bytes })
    }
}

/// A file extension for common media types (used to name unnamed images).
pub fn extension_for(media_type: &str) -> &'static str {
    match media_type {
        "image/png" => "png",
        "image/jpeg" | "image/jpg" => "jpg",
        "image/gif" => "gif",
        "image/webp" => "webp",
        "image/svg+xml" => "svg",
        "application/pdf" => "pdf",
        "text/plain" => "txt",
        "text/markdown" => "md",
        "application/json" => "json",
        "text/csv" => "csv",
        _ => "bin",
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Message {
    pub id: String,
    pub source_id: String,
    pub role: Role,
    #[serde(default)]
    pub created_at: Option<String>,
    pub blocks: Vec<Block>,
}

impl Message {
    pub fn has_text(&self) -> bool {
        self.blocks.iter().any(|b| matches!(b, Block::Text { text } if !text.trim().is_empty()))
    }

    pub fn is_tool_only(&self) -> bool {
        !self.blocks.is_empty()
            && self
                .blocks
                .iter()
                .all(|b| matches!(b, Block::ToolCall { .. } | Block::ToolResult { .. }))
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SourceKind {
    LocalAgent,
    BrowserChat,
    /// A conversation from a provider's account data export.
    ChatExport,
    Clipboard,
    Manual,
    File,
    Pack,
}

/// Capture health (CAP-12).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum CaptureStatus {
    Complete,
    Partial,
    Unsupported,
    PermissionsNeeded,
    Failed,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Source {
    pub source_id: String,
    pub kind: SourceKind,
    /// e.g. "claude-code", "codex", "clipboard", "manual".
    pub provider: String,
    pub title: String,
    /// File path or other origin descriptor, when known.
    #[serde(default)]
    pub origin: Option<String>,
    #[serde(default)]
    pub project: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
    pub captured_at: String,
    pub capture_status: CaptureStatus,
    #[serde(default)]
    pub missing_items: Vec<String>,
    /// Counts of items deliberately not carried over (hidden reasoning,
    /// injected system context...), for the transfer record.
    #[serde(default)]
    pub omitted: Vec<OmittedCount>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OmittedCount {
    pub what: String,
    pub count: usize,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Attachment {
    pub id: String,
    pub file_name: String,
    pub media_type: String,
    pub size: u64,
    pub sha256: String,
    #[serde(default)]
    pub origin_path: Option<String>,
    /// Extracted text for text-like files; None for binaries.
    #[serde(default)]
    pub text: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextBrief {
    #[serde(default)]
    pub goal: Option<String>,
    #[serde(default)]
    pub decisions: Vec<String>,
    #[serde(default)]
    pub constraints: Vec<String>,
    #[serde(default)]
    pub current_state: Option<String>,
    #[serde(default)]
    pub next_steps: Vec<String>,
    /// Free-form user note added in the Builder.
    #[serde(default)]
    pub note: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Mode {
    Full,
    Selected,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Integrity {
    pub algorithm: String,
    /// sha256 over the canonical JSON of messages + attachments hashes.
    #[serde(default)]
    pub content_hash: Option<String>,
}

impl Default for Integrity {
    fn default() -> Self {
        Self { algorithm: "sha256".into(), content_hash: None }
    }
}

/// An immutable Context Pack snapshot (one version).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Pack {
    pub schema_version: String,
    pub pack_id: String,
    pub title: String,
    pub version: u32,
    pub created_at: String,
    pub mode: Mode,
    pub sources: Vec<Source>,
    pub messages: Vec<Message>,
    #[serde(default)]
    pub context: ContextBrief,
    #[serde(default)]
    pub attachments: Vec<Attachment>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub integrity: Integrity,
}

pub fn new_id() -> String {
    ulid::Ulid::new().to_string()
}

pub fn now_rfc3339() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}
