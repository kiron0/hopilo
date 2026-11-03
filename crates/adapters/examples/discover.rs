//! Print a summary of locally discovered sessions (counts only, no content).
use hopilo_adapters::all_adapters;

fn main() {
    for a in all_adapters() {
        for root in a.default_roots() {
            let found = a.discover(&root).unwrap_or_default();
            println!("{} @ {}: {} sessions", a.id(), root.display(), found.len());
            for s in found.iter().take(3) {
                let cap = a.read(std::path::Path::new(&s.path)).expect("read");
                println!(
                    "  {} msgs={} status={:?} missing={} omitted={:?}",
                    s.session_id,
                    cap.messages.len(),
                    cap.source.capture_status,
                    cap.source.missing_items.len(),
                    cap.source.omitted.iter().map(|o| (o.what.as_str(), o.count)).collect::<Vec<_>>()
                );
            }
        }
    }
}
