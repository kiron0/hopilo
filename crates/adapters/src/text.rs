pub fn strip_injected(text: &str) -> (String, usize) {
    const OPEN: &str = "<system-reminder>";
    const CLOSE: &str = "</system-reminder>";
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    let mut removed = 0;
    while let Some(start) = rest.find(OPEN) {
        out.push_str(&rest[..start]);
        match rest[start..].find(CLOSE) {
            Some(end) => {
                rest = &rest[start + end + CLOSE.len()..];
                removed += 1;
            }
            None => {
                rest = "";
                removed += 1;
            }
        }
    }
    out.push_str(rest);
    (out.trim().to_string(), removed)
}

pub fn title_from(text: &str) -> String {
    let (clean, _) = strip_injected(text);
    let mut s = String::new();
    let mut in_tag = false;
    let mut chars = clean.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '<' if !in_tag && chars.peek().is_some_and(|n| n.is_ascii_alphabetic() || *n == '/' || *n == '!') => in_tag = true,
            '>' if in_tag => {
                in_tag = false;
                s.push(' ');
            }
            _ if !in_tag => s.push(c),
            _ => {}
        }
    }
    let collapsed = s.split_whitespace().collect::<Vec<_>>().join(" ");
    if collapsed.chars().count() > 80 {
        format!("{}…", collapsed.chars().take(79).collect::<String>())
    } else {
        collapsed
    }
}

pub const MAX_RECOVERED_FILE: u64 = 25 * 1024 * 1024;

pub fn read_local_file(reference: &str) -> Option<hopilo_core::CapturedFile> {
    let raw = reference.strip_prefix("file://").unwrap_or(reference);
    if raw.is_empty() || raw.contains("://") {
        return None;
    }
    let decoded = percent_decode(raw);
    let path = std::path::Path::new(&decoded);
    if !path.is_absolute() {
        return None;
    }
    if crate::macos_protected_user_path(path) {
        return None;
    }
    let meta = std::fs::metadata(path).ok()?;
    if !meta.is_file() || meta.len() == 0 || meta.len() > MAX_RECOVERED_FILE {
        return None;
    }
    let bytes = std::fs::read(path).ok()?;
    let name = path.file_name()?.to_string_lossy().into_owned();
    Some(hopilo_core::CapturedFile { media_type: media_type_for(&name).into(), name, bytes })
}

pub(crate) fn percent_decode(s: &str) -> String {
    fn hex(b: u8) -> Option<u8> {
        match b {
            b'0'..=b'9' => Some(b - b'0'),
            b'a'..=b'f' => Some(b - b'a' + 10),
            b'A'..=b'F' => Some(b - b'A' + 10),
            _ => None,
        }
    }

    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            if let (Some(hi), Some(lo)) = (hex(b[i + 1]), hex(b[i + 2])) {
                out.push((hi << 4) | lo);
                i += 3;
                continue;
            }
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

pub fn media_type_for(name: &str) -> &'static str {
    let ext = name.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
    match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "pdf" => "application/pdf",
        "md" | "markdown" => "text/markdown",
        "txt" | "log" => "text/plain",
        "csv" => "text/csv",
        "json" => "application/json",
        "html" | "htm" => "text/html",
        "rs" | "ts" | "tsx" | "js" | "jsx" | "py" | "go" | "java" | "rb" | "c" | "h" | "cpp" | "swift" | "kt" | "sh" | "toml" | "yaml" | "yml" | "css" | "sql" => "text/plain",
        _ => "application/octet-stream",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_reminders() {
        let (t, n) = strip_injected("hi <system-reminder>x</system-reminder> there");
        assert_eq!(t, "hi  there");
        assert_eq!(n, 1);
    }

    #[test]
    fn titles_are_short_and_tag_free() {
        assert_eq!(title_from("<command-name>/x</command-name> fix   bug"), "/x fix bug");
        assert_eq!(title_from(&"a".repeat(100)).chars().count(), 80);
        assert_eq!(title_from("why is a < b false"), "why is a < b false");
    }

    #[test]
    fn decodes_percent_escapes_without_panicking_on_unicode() {
        assert_eq!(percent_decode("/tmp/a%20b.png"), "/tmp/a b.png");
        assert_eq!(percent_decode("/tmp/%C3%A9.txt"), "/tmp/é.txt");
        assert_eq!(percent_decode("/tmp/%aé.txt"), "/tmp/%aé.txt");
        assert_eq!(percent_decode("/tmp/100%"), "/tmp/100%");
    }
}
