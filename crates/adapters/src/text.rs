//! Text helpers shared by adapters.

/// Remove `<system-reminder>…</system-reminder>` spans that agents inject
/// into user turns. Returns the cleaned text and how many spans were removed.
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

/// One-line title from the first user prompt.
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
