#![cfg(unix)]
//! What the loop does with a queue: requests overtaken by a change, requests
//! cancelled before they start, and a burst of edits read once.
//!
//! The requests used here read the workspace: `textDocument/definition` where
//! only staleness matters, and `textDocument/documentSymbol` where the answer
//! depends on the text, so a request that is not stale is also checked to be
//! answered from the text it should see.
mod support;

use serde_json::{Value, json};
use sigil_lsp::{serve::serve_with, server::ServerOptions};
use std::{
    io::{self, Cursor, Read, Write},
    sync::{
        Arc, Mutex,
        mpsc::{Receiver, Sender, channel},
    },
    thread::{self, JoinHandle, sleep},
    time::{Duration, Instant},
};
use support::{
    BROKEN, CLEAN, Disk, LONG_DELAY, Temp, decode, frames, message, published, published_for,
    request,
};

const STALE: i64 = -32801;
const CANCELLED: i64 = -32800;

fn initialize(temp: &Temp) -> Vec<Value> {
    vec![
        request(1, "initialize", json!({"rootUri": temp.uri("")})),
        message("initialized", json!({})),
    ]
}

fn open(uri: &str, version: i64, text: &str) -> Value {
    message(
        "textDocument/didOpen",
        json!({"textDocument": {"uri": uri, "languageId": "sigil", "version": version, "text": text}}),
    )
}

fn change(uri: &str, version: i64, text: &str) -> Value {
    message(
        "textDocument/didChange",
        json!({"textDocument": {"uri": uri, "version": version}, "contentChanges": [{"text": text}]}),
    )
}

fn watched(uri: &str) -> Value {
    message(
        "workspace/didChangeWatchedFiles",
        json!({"changes": [{"uri": uri, "type": 2}]}),
    )
}

fn definition(id: i64, uri: &str) -> Value {
    request(
        id,
        "textDocument/definition",
        json!({"textDocument": {"uri": uri}, "position": {"line": 0, "character": 0}}),
    )
}

fn document_symbol(id: i64, uri: &str) -> Value {
    request(
        id,
        "textDocument/documentSymbol",
        json!({"textDocument": {"uri": uri}}),
    )
}

fn cancel(id: i64) -> Value {
    message("$/cancelRequest", json!({"id": id}))
}

/// Serve everything in one read, so the whole input is one queue, and return
/// the status and what was written.
fn run_queue(options: ServerOptions, messages: &[Value]) -> (i32, Vec<Value>) {
    let mut written = Vec::new();
    let code = serve_with(Cursor::new(frames(messages)), &mut written, options);
    (code, decode(&written))
}

fn options(temp: &Temp) -> ServerOptions {
    ServerOptions {
        cwd: temp.root.clone(),
        ..ServerOptions::default()
    }
}

fn answer(output: &[Value], id: i64) -> &Value {
    output
        .iter()
        .find(|message| message["id"] == id && message.get("method").is_none())
        .unwrap_or_else(|| panic!("no answer to {id} in {output:?}"))
}

fn error_code(response: &Value) -> Option<i64> {
    response["error"]["code"].as_i64()
}

/// Answered with a result: neither an error, stale and cancelled included, nor
/// an answer without one.
fn answered_normally(response: &Value) -> bool {
    response.get("error").is_none() && response.get("result").is_some()
}

/// What `textDocument/documentSymbol` answers for a buffer that holds `text`
/// and nothing else, from a run of its own.
fn symbols_for(temp: &Temp, uri: &str, text: &str) -> Value {
    let mut input = initialize(temp);
    input.extend([open(uri, 1, text), document_symbol(2, uri)]);
    let (_, output) = run_queue(options(temp), &input);
    let response = answer(&output, 2);
    assert!(answered_normally(response), "{response}");
    response["result"].clone()
}

fn position(output: &[Value], wanted: impl Fn(&Value) -> bool) -> usize {
    output
        .iter()
        .position(wanted)
        .unwrap_or_else(|| panic!("nothing wanted in {output:?}"))
}

fn workspace_with_buffer() -> (Temp, String) {
    let temp = Temp::workspace();
    temp.write("a.sigil", CLEAN);
    let uri = temp.uri("a.sigil");
    (temp, uri)
}

fn diagnostic_codes(diagnostics: &[Value]) -> Vec<&str> {
    diagnostics
        .iter()
        .map(|d| d["code"].as_str().unwrap())
        .collect()
}

#[test]
fn a_request_before_a_change_in_the_same_input_is_stale_and_the_change_still_publishes() {
    let (temp, uri) = workspace_with_buffer();
    let mut input = initialize(&temp);
    input.extend([
        open(&uri, 1, CLEAN),
        definition(2, &uri),
        change(&uri, 2, BROKEN),
    ]);
    let (_, output) = run_queue(options(&temp), &input);
    assert_eq!(error_code(answer(&output, 2)), Some(STALE));
    assert_eq!(
        answer(&output, 2)["error"]["message"],
        "Workspace content changed."
    );
    // The open and the change are read once, and publish the new text.
    let published = published_for(&output, &uri).unwrap();
    assert!(diagnostic_codes(&published).contains(&"SIGIL_UNKNOWN_SECTION"));
}

#[test]
fn the_same_request_after_the_change_is_answered_from_the_new_text() {
    let (temp, uri) = workspace_with_buffer();
    let mut input = initialize(&temp);
    input.extend([
        open(&uri, 1, CLEAN),
        change(&uri, 2, BROKEN),
        document_symbol(2, &uri),
    ]);
    let (_, output) = run_queue(options(&temp), &input);
    let response = answer(&output, 2);
    assert!(answered_normally(response), "{response}");
    // The symbols are those of the new text, not of the clean one.
    let from_new = symbols_for(&temp, &uri, BROKEN);
    assert_eq!(response["result"], from_new);
    assert_ne!(from_new, symbols_for(&temp, &uri, CLEAN));
    // The edits are published before the answer.
    let published_at = position(&output, |m| {
        m["method"] == "textDocument/publishDiagnostics"
            && m["params"]["uri"] == uri
            && !m["params"]["diagnostics"].as_array().unwrap().is_empty()
    });
    let answered_at = position(&output, |m| m["id"] == 2);
    assert!(published_at < answered_at);
}

#[test]
fn a_watch_event_for_a_file_that_does_not_reload_leaves_the_request_alone() {
    let (temp, uri) = workspace_with_buffer();
    let mut input = initialize(&temp);
    input.extend([
        open(&uri, 1, CLEAN),
        document_symbol(2, &uri),
        watched(&temp.uri("build/output.js")),
        document_symbol(3, &uri),
        watched(&temp.uri("notes.txt")),
        // A file that only looks like the config.
        watched(&temp.uri("other/.sigil/notes.json")),
    ]);
    let (_, output) = run_queue(options(&temp), &input);
    let expected = symbols_for(&temp, &uri, CLEAN);
    for id in [2, 3] {
        assert!(answered_normally(answer(&output, id)), "{output:?}");
        assert_eq!(answer(&output, id)["result"], expected);
    }
}

#[test]
fn a_watch_event_for_a_sigil_file_or_the_config_makes_the_request_stale() {
    let (temp, uri) = workspace_with_buffer();
    for changed in [
        temp.uri("b.sigil"),
        temp.uri(".sigil/config.json"),
        temp.uri(".sigil/glossary.json"),
        temp.uri(".sigil/local.json"),
    ] {
        let mut input = initialize(&temp);
        input.extend([open(&uri, 1, CLEAN), definition(2, &uri), watched(&changed)]);
        let (_, output) = run_queue(options(&temp), &input);
        assert_eq!(error_code(answer(&output, 2)), Some(STALE), "{changed}");
    }
}

#[test]
fn a_request_never_goes_stale_over_a_change_the_server_would_ignore() {
    let (temp, uri) = workspace_with_buffer();
    let mut input = initialize(&temp);
    input.extend([
        open(&uri, 5, CLEAN),
        document_symbol(2, &uri),
        // Not newer than the open buffer's version, and for a document that is
        // not open: neither starts a reload.
        change(&uri, 5, BROKEN),
        change(&temp.uri("never-opened.sigil"), 9, BROKEN),
    ]);
    let (_, output) = run_queue(options(&temp), &input);
    assert!(answered_normally(answer(&output, 2)), "{output:?}");
    assert_eq!(
        answer(&output, 2)["result"],
        symbols_for(&temp, &uri, CLEAN)
    );
}

#[test]
fn initialize_and_shutdown_are_never_stale() {
    let (temp, uri) = workspace_with_buffer();
    let mut input = vec![
        request(1, "initialize", json!({"rootUri": temp.uri("")})),
        open(&uri, 1, CLEAN),
        message("initialized", json!({})),
        open(&uri, 2, CLEAN),
        request(2, "shutdown", Value::Null),
        change(&uri, 3, BROKEN),
        message("exit", Value::Null),
    ];
    let (code, output) = run_queue(options(&temp), &input);
    assert!(output[0]["result"]["capabilities"].is_object());
    assert_eq!(answer(&output, 2)["result"], Value::Null);
    assert_eq!(code, 0);

    // A request that follows initialize is judged by the state it finds.
    input = initialize(&temp);
    input.extend([request(3, "shutdown", Value::Null), change(&uri, 3, BROKEN)]);
    let (_, output) = run_queue(options(&temp), &input);
    assert_eq!(answer(&output, 3)["result"], Value::Null);
}

#[test]
fn three_changes_in_one_input_read_once_and_publish_the_last_text() {
    let (temp, uri) = workspace_with_buffer();
    let disk = Disk::new();
    let mut input = initialize(&temp);
    input.extend([
        open(&uri, 1, CLEAN),
        change(&uri, 2, "component Thing {\n  mystery {\n  }\n}\n"),
        change(&uri, 3, "not a component"),
        change(&uri, 4, BROKEN),
    ]);
    let (_, output) = run_queue(disk.options(&temp.root, LONG_DELAY), &input);
    // One load for initialize and one for the open and the three changes.
    assert_eq!(disk.loads(), 2);
    let for_uri: Vec<_> = published(&output)
        .into_iter()
        .filter(|(published_uri, _)| *published_uri == uri)
        .collect();
    assert_eq!(for_uri.len(), 1, "{for_uri:?}");
    assert_eq!(
        diagnostic_codes(&for_uri[0].1),
        [
            "SIGIL_MISSING_GOAL",
            "SIGIL_MISSING_INTERFACE",
            "SIGIL_UNKNOWN_SECTION"
        ]
    );
}

#[test]
fn edits_around_a_stale_request_are_still_read_once() {
    let (temp, uri) = workspace_with_buffer();
    let disk = Disk::new();
    let mut input = initialize(&temp);
    input.extend([
        open(&uri, 1, CLEAN),
        change(&uri, 2, BROKEN),
        definition(2, &uri),
        change(&uri, 3, CLEAN),
    ]);
    let (_, output) = run_queue(disk.options(&temp.root, LONG_DELAY), &input);
    assert_eq!(error_code(answer(&output, 2)), Some(STALE));
    assert_eq!(disk.loads(), 2);
    assert_eq!(published_for(&output, &uri), Some(Vec::new()));
}

#[test]
fn a_request_cancelled_in_the_queue_answers_cancelled_before_it_starts() {
    let (temp, uri) = workspace_with_buffer();
    // The cancellation arrives before the request and after it.
    let mut input = initialize(&temp);
    input.extend([
        cancel(2),
        definition(2, &uri),
        definition(3, &uri),
        cancel(3),
    ]);
    let (_, output) = run_queue(options(&temp), &input);
    for id in [2, 3] {
        assert_eq!(error_code(answer(&output, id)), Some(CANCELLED));
        assert_eq!(
            answer(&output, id)["error"]["message"],
            "Request cancelled."
        );
    }
}

#[test]
fn a_request_that_is_both_cancelled_and_overtaken_answers_cancelled() {
    let (temp, uri) = workspace_with_buffer();
    let mut input = initialize(&temp);
    input.extend([
        open(&uri, 1, CLEAN),
        document_symbol(2, &uri),
        change(&uri, 2, BROKEN),
        cancel(2),
        // The first request spent the mark, so this one with the same id is not cancelled.
        document_symbol(2, &uri),
    ]);
    let (_, output) = run_queue(options(&temp), &input);
    let answers: Vec<_> = output
        .iter()
        .filter(|m| m["id"] == 2 && m.get("method").is_none())
        .collect();
    assert_eq!(answers.len(), 2);
    assert_eq!(error_code(answers[0]), Some(CANCELLED));
    assert!(answered_normally(answers[1]), "{:?}", answers[1]);
    assert_eq!(answers[1]["result"], symbols_for(&temp, &uri, BROKEN));
}

/// An input that the test feeds one write at a time, and an output it reads.
struct Session {
    sender: Option<Sender<Vec<u8>>>,
    written: Arc<Mutex<Vec<u8>>>,
    thread: Option<JoinHandle<i32>>,
}

struct Pipe {
    receiver: Receiver<Vec<u8>>,
}

impl Read for Pipe {
    fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
        match self.receiver.recv() {
            Ok(bytes) => {
                assert!(bytes.len() <= buffer.len());
                buffer[..bytes.len()].copy_from_slice(&bytes);
                Ok(bytes.len())
            }
            Err(_) => Ok(0),
        }
    }
}

struct Shared(Arc<Mutex<Vec<u8>>>);

impl Write for Shared {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        self.0.lock().unwrap().extend_from_slice(bytes);
        Ok(bytes.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

impl Session {
    fn start(options: ServerOptions) -> Self {
        let (sender, receiver) = channel();
        let written = Arc::new(Mutex::new(Vec::new()));
        let output = Shared(written.clone());
        let thread = thread::spawn(move || serve_with(Pipe { receiver }, output, options));
        Self {
            sender: Some(sender),
            written,
            thread: Some(thread),
        }
    }

    fn send(&self, messages: &[Value]) {
        self.sender
            .as_ref()
            .unwrap()
            .send(frames(messages))
            .unwrap();
    }

    fn output(&self) -> Vec<Value> {
        decode(&self.written.lock().unwrap())
    }

    /// Wait until the server has written `count` messages, and return them.
    fn wait_for(&self, count: usize) -> Vec<Value> {
        let deadline = Instant::now() + Duration::from_secs(20);
        loop {
            let output = self.output();
            if output.len() >= count {
                return output;
            }
            assert!(Instant::now() < deadline, "waiting for {count}: {output:?}");
            sleep(Duration::from_millis(2));
        }
    }

    fn finish(mut self) -> i32 {
        self.sender = None;
        self.thread.take().unwrap().join().unwrap()
    }
}

#[test]
fn a_cancellation_that_comes_after_the_answer_does_nothing_and_leaves_no_mark() {
    let (temp, uri) = workspace_with_buffer();
    let session = Session::start(options(&temp));
    session.send(&initialize(&temp));
    session.wait_for(1);
    session.send(&[document_symbol(2, &uri)]);
    let before = session.wait_for(2);
    assert!(answered_normally(answer(&before, 2)), "{before:?}");
    // Too late: the answer is out. The request after it makes the loop answer
    // something, so the next request is known to be read after the
    // cancellation. A request that reuses the id is not cancelled.
    session.send(&[cancel(2)]);
    session.send(&[document_symbol(3, &uri)]);
    session.wait_for(3);
    session.send(&[document_symbol(2, &uri)]);
    let after = session.wait_for(4);
    assert_eq!(after.len(), 4);
    assert!(answered_normally(answer(&after, 3)), "{after:?}");
    assert!(answered_normally(&after[3]), "{after:?}");
    assert_eq!(after[3]["id"], 2);
    assert_eq!(after[3]["result"], answer(&before, 2)["result"]);
    assert_eq!(answer(&after, 3)["result"], answer(&before, 2)["result"]);
    assert_eq!(session.finish(), 0);
}

#[test]
fn a_request_read_before_a_change_is_answered_when_the_change_comes_later() {
    // Two reads: the request is answered before the change is read. Nothing
    // overtakes it, because the loop only looks at what has arrived.
    let (temp, uri) = workspace_with_buffer();
    let session = Session::start(options(&temp));
    session.send(&initialize(&temp));
    session.send(&[open(&uri, 1, CLEAN)]);
    // The initialize result and the open's publication.
    session.wait_for(2);
    session.send(&[document_symbol(2, &uri)]);
    let output = session.wait_for(3);
    assert!(answered_normally(answer(&output, 2)), "{output:?}");
    assert_eq!(
        answer(&output, 2)["result"],
        symbols_for(&temp, &uri, CLEAN)
    );
    session.send(&[change(&uri, 2, BROKEN)]);
    let output = session.wait_for(output.len() + 1);
    assert!(published_for(&output, &uri).is_some());
    assert_eq!(session.finish(), 0);
}
