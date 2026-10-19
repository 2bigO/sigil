#![cfg(unix)]
//! `sigil lsp` as a real process: framed messages in and out over pipes, the
//! exit statuses, and a session that reaches core through the binary.
mod support;

use serde_json::{Value, json};
use std::{
    io::{Read, Write},
    path::Path,
    process::{Child, ChildStdin, Command, Stdio},
    sync::mpsc::{self, Receiver, RecvTimeoutError},
    thread,
    time::{Duration, Instant},
};
use support::Temp;

/// How long a test waits for the server before it fails instead of hanging.
const PATIENCE: Duration = Duration::from_secs(20);

/// A provider that defines no Tag named Execution.
const PROVIDER_WITHOUT_TAG: &str = "component Thing {\n  goal {\n    Represent one useful Other.\n  }\n\n  interface {\n    Other {\n      run() starts an Other.\n    }\n  }\n}\n";

/// A consumer that imports the Tag Execution from `contract.sigil`.
const CONSUMER: &str = "@contract.sigil from Thing import { Execution }\n\ncomponent Consumer {\n  goal {\n    Consume the provider contract for Execution.\n  }\n\n  constraints {\n    Consumer retries preserve Execution.\n  }\n\n  interface {\n    ConsumerSurface {\n      run() uses Execution.\n\n      execution and ExecutionCache remain prose\n      beside Execution.\n    }\n  }\n}\n";

const UNRESOLVED: &str = "SIGIL_UNRESOLVED_IMPORTED_TAG";

/// A running `sigil lsp` with its standard output cut into framed messages.
struct Session {
    child: Child,
    stdin: Option<ChildStdin>,
    stdout: Receiver<Vec<u8>>,
    stderr: Receiver<Vec<u8>>,
    pending: Vec<u8>,
    next_id: i64,
}

/// How a session ended.
struct Ended {
    code: i32,
    /// What the server sent after the last message the test read.
    messages: Vec<Value>,
    stderr: String,
}

impl Session {
    fn start(cwd: &Path) -> Self {
        let mut child = Command::new(env!("CARGO_BIN_EXE_sigil"))
            .arg("lsp")
            .current_dir(cwd)
            .env("NO_COLOR", "1")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .expect("the sigil binary runs");
        let stdin = child.stdin.take();
        let stdout = pump(child.stdout.take().expect("piped"));
        let stderr = pump(child.stderr.take().expect("piped"));
        Self {
            child,
            stdin,
            stdout,
            stderr,
            pending: Vec::new(),
            next_id: 0,
        }
    }

    /// Write one message with its header.
    fn send(&mut self, message: &Value) {
        let body = message.to_string();
        let stdin = self.stdin.as_mut().expect("standard input is open");
        write!(stdin, "Content-Length: {}\r\n\r\n{body}", body.len()).expect("the server reads");
        stdin.flush().expect("the server reads");
    }

    fn request(&mut self, method: &str, params: Value) -> i64 {
        self.next_id += 1;
        let id = self.next_id;
        self.send(&json!({"jsonrpc": "2.0", "id": id, "method": method, "params": params}));
        id
    }

    fn notify(&mut self, method: &str, params: Value) {
        self.send(&json!({"jsonrpc": "2.0", "method": method, "params": params}));
    }

    /// The next message from the server, waiting no longer than `PATIENCE`.
    fn next(&mut self) -> Value {
        let deadline = Instant::now() + PATIENCE;
        loop {
            if let Some(message) = take_frame(&mut self.pending) {
                return message;
            }
            match self
                .stdout
                .recv_timeout(deadline.saturating_duration_since(Instant::now()))
            {
                Ok(bytes) => self.pending.extend(bytes),
                Err(RecvTimeoutError::Timeout) => panic!("the server sent nothing in time"),
                Err(RecvTimeoutError::Disconnected) => panic!("the server closed its output"),
            }
        }
    }

    /// Read messages until one satisfies `found`; return the messages read.
    fn until(&mut self, found: impl Fn(&Value) -> bool) -> Vec<Value> {
        let mut read = Vec::new();
        loop {
            let message = self.next();
            let done = found(&message);
            read.push(message);
            if done {
                return read;
            }
        }
    }

    fn response(&mut self, id: i64) -> Value {
        let read = self.until(|message| is_response(message, id));
        read.into_iter().next_back().expect("a response")
    }

    /// Close standard input unless the session has ended, wait for the process,
    /// and read what is left of both outputs. Standard output must hold only
    /// whole framed messages.
    fn end(mut self) -> Ended {
        self.stdin = None;
        let deadline = Instant::now() + PATIENCE;
        let status = loop {
            if let Some(status) = self.child.try_wait().expect("the process can be polled") {
                break status;
            }
            assert!(Instant::now() < deadline, "the server did not exit in time");
            thread::sleep(Duration::from_millis(10));
        };
        let mut pending = std::mem::take(&mut self.pending);
        while let Ok(bytes) = self.stdout.recv_timeout(PATIENCE) {
            pending.extend(bytes);
        }
        let mut messages = Vec::new();
        while let Some(message) = take_frame(&mut pending) {
            messages.push(message);
        }
        assert!(
            pending.is_empty(),
            "standard output holds more than framed messages: {:?}",
            String::from_utf8_lossy(&pending)
        );
        let mut stderr = Vec::new();
        while let Ok(bytes) = self.stderr.recv_timeout(PATIENCE) {
            stderr.extend(bytes);
        }
        Ended {
            code: status.code().expect("sigil exits with a status"),
            messages,
            stderr: String::from_utf8(stderr).expect("stderr is UTF-8"),
        }
    }
}

impl Drop for Session {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

/// Send what a pipe holds in chunks until it closes.
fn pump(mut pipe: impl Read + Send + 'static) -> Receiver<Vec<u8>> {
    let (sender, receiver) = mpsc::channel();
    thread::spawn(move || {
        let mut buffer = [0u8; 8192];
        while let Ok(count) = pipe.read(&mut buffer) {
            if count == 0 || sender.send(buffer[..count].to_vec()).is_err() {
                break;
            }
        }
    });
    receiver
}

/// Remove one framed message from the front of `bytes`, if a whole one is there.
fn take_frame(bytes: &mut Vec<u8>) -> Option<Value> {
    let end = bytes.windows(4).position(|window| window == b"\r\n\r\n")?;
    let header = std::str::from_utf8(&bytes[..end]).expect("the header is ASCII");
    let length: usize = header
        .lines()
        .find_map(|line| line.strip_prefix("Content-Length: "))
        .unwrap_or_else(|| panic!("a frame without Content-Length: {header:?}"))
        .parse()
        .expect("a numeric Content-Length");
    let start = end + 4;
    if bytes.len() < start + length {
        return None;
    }
    let message = serde_json::from_slice(&bytes[start..start + length]).expect("a JSON body");
    bytes.drain(..start + length);
    Some(message)
}

fn is_response(message: &Value, id: i64) -> bool {
    message["id"] == json!(id) && message.get("method").is_none()
}

fn is_publish_with(message: &Value, uri: &str, code: &str) -> bool {
    message["method"] == "textDocument/publishDiagnostics"
        && message["params"]["uri"] == uri
        && message["params"]["diagnostics"]
            .as_array()
            .is_some_and(|all| all.iter().any(|d| d["code"] == code))
}

fn uri(temp: &Temp, relative: &str) -> String {
    format!("file://{}", temp.path(relative).display())
}

/// A workspace whose consumer imports a Tag its provider does not define.
fn broken_workspace() -> Temp {
    let temp = Temp::workspace();
    temp.write("contract.sigil", PROVIDER_WITHOUT_TAG);
    temp.write("consumer.sigil", CONSUMER);
    temp
}

#[test]
fn a_complete_session_answers_each_request_in_order_and_exits_0() {
    let temp = Temp::new();
    let mut session = Session::start(&temp.root);
    let initialize = session.request("initialize", json!({"rootUri": null}));
    session.notify("initialized", json!({}));
    let shutdown = session.request("shutdown", json!(null));
    session.notify("exit", json!(null));
    let ended = session.end();
    assert_eq!(ended.code, 0);
    assert_eq!(ended.stderr, "");
    let responses: Vec<&Value> = ended
        .messages
        .iter()
        .filter(|message| message.get("method").is_none())
        .collect();
    assert_eq!(responses.len(), 2, "{responses:?}");
    assert_eq!(responses[0]["id"], json!(initialize));
    assert!(responses[0]["result"]["capabilities"].is_object());
    assert_eq!(responses[1]["id"], json!(shutdown));
    assert_eq!(responses[1]["result"], Value::Null);
    assert!(
        ended
            .messages
            .iter()
            .all(|message| message["jsonrpc"] == "2.0")
    );
}

#[test]
fn a_response_arrives_before_the_next_message_is_sent() {
    let temp = Temp::new();
    let mut session = Session::start(&temp.root);
    let initialize = session.request("initialize", json!({"rootUri": null}));
    let response = session.response(initialize);
    assert!(response["result"]["capabilities"].is_object());
    let shutdown = session.request("shutdown", json!(null));
    assert_eq!(session.response(shutdown)["result"], Value::Null);
    session.notify("exit", json!(null));
    assert_eq!(session.end().code, 0);
}

#[test]
fn exit_without_shutdown_exits_1() {
    let temp = Temp::new();
    let mut session = Session::start(&temp.root);
    session.request("initialize", json!({"rootUri": null}));
    session.notify("exit", json!(null));
    let ended = session.end();
    assert_eq!(ended.code, 1);
    assert_eq!(ended.stderr, "");
}

#[test]
fn input_that_closes_at_once_exits_0_with_nothing_printed() {
    let temp = Temp::new();
    let session = Session::start(&temp.root);
    let ended = session.end();
    assert_eq!(ended.code, 0);
    assert!(ended.messages.is_empty());
    assert_eq!(ended.stderr, "");
}

#[test]
fn input_that_closes_after_initialize_exits_0() {
    let temp = Temp::new();
    let mut session = Session::start(&temp.root);
    session.request("initialize", json!({"rootUri": null}));
    let ended = session.end();
    assert_eq!(ended.code, 0);
    assert_eq!(ended.messages.len(), 1);
}

#[test]
fn a_session_in_a_workspace_publishes_diagnostics_and_lists_symbols() {
    let temp = broken_workspace();
    let consumer = uri(&temp, "consumer.sigil");
    let mut session = Session::start(&temp.root);
    let initialize = session.request("initialize", json!({"rootUri": uri(&temp, "")}));
    session.response(initialize);
    session.notify("initialized", json!({}));
    session.notify(
        "textDocument/didOpen",
        json!({"textDocument": {"uri": consumer, "languageId": "sigil", "version": 1, "text": CONSUMER}}),
    );
    session.until(|message| is_publish_with(message, &consumer, UNRESOLVED));

    let symbols = session.request(
        "textDocument/documentSymbol",
        json!({"textDocument": {"uri": consumer}}),
    );
    let response = session.response(symbols);
    let result = response["result"].as_array().expect("symbols");
    assert!(!result.is_empty(), "{response}");
    assert_eq!(result[0]["name"], "Consumer");

    let shutdown = session.request("shutdown", json!(null));
    session.response(shutdown);
    session.notify("exit", json!(null));
    let ended = session.end();
    assert_eq!(ended.code, 0);
    assert_eq!(ended.stderr, "");
}

#[test]
fn a_session_without_a_root_finds_the_workspace_from_the_process_directory() {
    let temp = broken_workspace();
    temp.mkdir("pkg/sub");
    let consumer = uri(&temp, "consumer.sigil");
    let mut session = Session::start(&temp.path("pkg/sub"));
    let initialize = session.request("initialize", json!({}));
    session.response(initialize);
    session.notify("initialized", json!({}));
    session.until(|message| is_publish_with(message, &consumer, UNRESOLVED));
    let shutdown = session.request("shutdown", json!(null));
    session.response(shutdown);
    session.notify("exit", json!(null));
    assert_eq!(session.end().code, 0);
}
