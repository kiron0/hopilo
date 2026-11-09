use std::io::Read;

use hopilo_rich::{highlight, parse_markdown, Node};

fn code_blocks<'a>(nodes: &'a [Node], out: &mut Vec<(&'a str, &'a str)>) {
    for node in nodes {
        match node {
            Node::Code { lang, v } => out.push((lang, v)),
            Node::El { c, .. } | Node::Link { c, .. } => code_blocks(c, out),
            _ => {}
        }
    }
}

fn main() {
    let mut text = String::new();
    std::io::stdin().read_to_string(&mut text).expect("read stdin");
    let tree = parse_markdown(&text).expect("markdown too large");
    let mut blocks = Vec::new();
    code_blocks(&tree, &mut blocks);
    let highlights: Vec<_> = blocks
        .into_iter()
        .filter_map(|(lang, code)| highlight(code, lang).map(|tokens| serde_json::json!({ "lang": lang, "code": code, "tokens": tokens })))
        .collect();
    println!("{}", serde_json::json!({ "tree": tree, "highlights": highlights }));
}
