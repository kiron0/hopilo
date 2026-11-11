use std::io::{self, BufRead, BufReader, Read, Write};
use std::process::ExitCode;

use hopilo_agent_cli::mcp::{handle_line, MAX_LINE};
use hopilo_agent_cli::{handoff, open_library, parse_level, search, AgentError};

const USAGE: &str = "hopilo-cli: read-only access to Hopilo sessions for coding agents

Usage:
  hopilo-cli sessions [--project <folder>] [--query <text>] [--limit <1-50>] [--json]
  hopilo-cli handoff <session-id>... [--level minimal|balanced|full] [--json]
  hopilo-cli mcp
  hopilo-cli --help | --version

Agent access must be turned on in Hopilo → Settings → Agent access.
It reads sessions saved in Hopilo (all of them, or only those selected there), never hidden ones.
`hopilo-cli mcp` serves the Model Context Protocol over stdin/stdout.";

enum Failure {
    Usage(String),
    Agent(AgentError),
}

impl From<AgentError> for Failure {
    fn from(e: AgentError) -> Self {
        Failure::Agent(e)
    }
}

fn value<'a>(args: &'a [String], i: &mut usize, flag: &str) -> Result<&'a str, Failure> {
    *i += 1;
    args.get(*i).map(String::as_str).ok_or_else(|| Failure::Usage(format!("{flag} needs a value")))
}

fn sessions(args: &[String]) -> Result<(), Failure> {
    let (mut project, mut query, mut limit, mut as_json) = (None, String::new(), None, false);
    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "--project" => project = Some(value(args, &mut i, "--project")?.to_string()),
            "--query" | "-q" => query = value(args, &mut i, "--query")?.to_string(),
            "--limit" => {
                limit = Some(
                    value(args, &mut i, "--limit")?
                        .parse::<usize>()
                        .map_err(|_| Failure::Usage("--limit must be a number".into()))?,
                )
            }
            "--json" => as_json = true,
            other => return Err(Failure::Usage(format!("unknown option {other}"))),
        }
        i += 1;
    }
    let store = open_library()?;
    let rows = search(&store, project.as_deref(), &query, limit)?;
    let mut out = io::stdout().lock();
    if as_json {
        let _ = writeln!(out, "{}", serde_json::to_string_pretty(&rows).unwrap_or_default());
        return Ok(());
    }
    if rows.is_empty() {
        let _ = writeln!(out, "No sessions found.");
    }
    for r in rows {
        let _ = writeln!(
            out,
            "{}  {}  {:<12}  {}  ({} messages, ~{} tokens)  {}",
            r.id,
            r.updated_at.get(..16).unwrap_or(&r.updated_at),
            r.provider,
            r.title,
            r.message_count,
            r.token_estimate,
            r.project.unwrap_or_default()
        );
    }
    Ok(())
}

fn handoff_cmd(args: &[String]) -> Result<(), Failure> {
    let (mut ids, mut level, mut as_json) = (Vec::new(), None, false);
    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "--level" => level = Some(value(args, &mut i, "--level")?.to_string()),
            "--json" => as_json = true,
            other if other.starts_with('-') => return Err(Failure::Usage(format!("unknown option {other}"))),
            id => ids.push(id.to_string()),
        }
        i += 1;
    }
    if ids.is_empty() {
        return Err(Failure::Usage("give at least one session id".into()));
    }
    let level = parse_level(level.as_deref())?;
    let store = open_library()?;
    let h = handoff(&store, &ids, level)?;
    let mut out = io::stdout().lock();
    if as_json {
        let _ = writeln!(out, "{}", serde_json::to_string_pretty(&h).unwrap_or_default());
    } else {
        let _ = writeln!(out, "{}", h.text);
        if !h.attach_manually.is_empty() {
            eprintln!("Not included (binary files): {}", h.attach_manually.join(", "));
        }
    }
    Ok(())
}

fn read_line(input: &mut impl BufRead, buf: &mut Vec<u8>) -> io::Result<Option<bool>> {
    buf.clear();
    let n = input.by_ref().take(MAX_LINE as u64 + 1).read_until(b'\n', buf)?;
    if n == 0 {
        return Ok(None);
    }
    if buf.len() > MAX_LINE && buf.last() != Some(&b'\n') {
        let mut sink = Vec::new();
        loop {
            sink.clear();
            let m = input.by_ref().take(64 * 1024).read_until(b'\n', &mut sink)?;
            if m == 0 || sink.last() == Some(&b'\n') {
                break;
            }
        }
        return Ok(Some(false));
    }
    Ok(Some(true))
}

fn serve() -> Result<(), Failure> {
    let mut input = BufReader::new(io::stdin().lock());
    let mut out = io::stdout().lock();
    let mut buf = Vec::new();
    while let Some(fits) = read_line(&mut input, &mut buf).map_err(|e| Failure::Usage(e.to_string()))? {
        let line = if fits { String::from_utf8_lossy(&buf).into_owned() } else { " ".repeat(MAX_LINE + 1) };
        if let Some(resp) = handle_line(&line, &open_library) {
            let text = serde_json::to_string(&resp).unwrap_or_default();
            if writeln!(out, "{text}").and_then(|_| out.flush()).is_err() {
                break;
            }
        }
    }
    Ok(())
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let result = match args.first().map(String::as_str) {
        Some("sessions") => sessions(&args[1..]),
        Some("handoff") => handoff_cmd(&args[1..]),
        Some("mcp") if args.len() == 1 => serve(),
        Some("--version" | "-V") => {
            println!("hopilo-cli {}", env!("CARGO_PKG_VERSION"));
            Ok(())
        }
        Some("--help" | "-h" | "help") => {
            println!("{USAGE}");
            Ok(())
        }
        _ => Err(Failure::Usage("missing or unknown command".into())),
    };
    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(Failure::Usage(m)) => {
            eprintln!("hopilo-cli: {m}\n\n{USAGE}");
            ExitCode::from(2)
        }
        Err(Failure::Agent(e)) => {
            eprintln!("hopilo-cli: {e}");
            ExitCode::from(1)
        }
    }
}
