use std::io::{stdin, stdout};

use hopilo_database::Store;
use hopilo_native_host::{allowed_ids, caller_allowed, default_data_dir, read_message, write_message, Host};
use serde_json::json;

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let mut out = stdout().lock();
    let Some(dir) = default_data_dir() else {
        let _ = write_message(&mut out, &json!({ "ok": false, "error": { "code": "no_library", "message": "Hopilo's data folder could not be located." } }));
        return;
    };
    let store = match Store::open(&dir) {
        Ok(s) => s,
        Err(e) => {
            let _ = write_message(&mut out, &json!({ "ok": false, "error": { "code": "no_library", "message": format!("Could not open the Hopilo library: {e}") } }));
            return;
        }
    };
    if !caller_allowed(&args, &allowed_ids(&store)) {

        let _ = write_message(&mut out, &json!({ "ok": false, "error": { "code": "forbidden", "message": "This extension is not allowed to use Hopilo." } }));
        return;
    }
    let mut host = Host { store };
    let mut input = stdin().lock();
    while let Ok(Some(req)) = read_message(&mut input) {
        let resp = host.handle(&req);
        if write_message(&mut out, &resp).is_err() {
            break;
        }
    }
}
