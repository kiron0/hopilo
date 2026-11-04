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
    for c in clean.chars() {
        match c {
            '<' => in_tag = true,
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
    let meta = std::fs::metadata(path).ok()?;
    if !meta.is_file() || meta.len() == 0 || meta.len() > MAX_RECOVERED_FILE {
        return None;
    }
    let bytes = std::fs::read(path).ok()?;
    let name = path.file_name()?.to_string_lossy().into_owned();
    Some(hopilo_core::CapturedFile { media_type: media_type_for(&name).into(), name, bytes })
}

fn percent_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            if let Ok(v) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                out.push(v);
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
