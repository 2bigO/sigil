#![cfg(unix)]
//! The loop over byte streams: framing across reads, exit statuses, and what
//! happens when reading or writing fails.
mod support;

use serde_json::{Value, json};
use sigil_lsp::{
    serve::{serve, serve_with},
    server::ServerOptions,
};
use std::io::{self, Cursor, Read, Write};
use support::{CLEAN, Temp, decode, frames, message, published_for, request};

fn initialize(temp: &Temp) -> Value {
    request(1, "initialize", json!({"rootUri": temp.uri("")}))
}

fn shutdown() -> Value {
    request(2, "shutdown", Value::Null)
}

fn exit() -> Value {
    message("exit", Value::Null)
}

fn run(temp: &Temp, input: Vec<u8>) -> (i32, Vec<Value>) {
    let mut written = Vec::new();
    let code = serve(Cursor::new(input), &mut written, temp.root.clone());
    (code, decode(&written))
}

fn run_messages(temp: &Temp, messages: &[Value]) -> (i32, Vec<Value>) {
    run(temp, frames(messages))
}

/// Gives the bytes in reads of at most `size` bytes.
struct Trickle {
    bytes: Vec<u8>,
    at: usize,
    size: usize,
}

impl Read for Trickle {
    fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
        let count = self.size.min(self.bytes.len() - self.at).min(buffer.len());
        buffer[..count].copy_from_slice(&self.bytes[self.at..self.at + count]);
        self.at += count;
        Ok(count)
    }
}

/// Gives the bytes, then fails.
struct Failing {
    bytes: Option<Vec<u8>>,
}

impl Read for Failing {
    fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
        match self.bytes.take() {
            Some(bytes) => {
                buffer[..bytes.len()].copy_from_slice(&bytes);
                Ok(bytes.len())
            }
            None => Err(io::Error::other("input closed badly")),
        }
    }
}

struct BrokenPipe;

impl Write for BrokenPipe {
    fn write(&mut self, _bytes: &[u8]) -> io::Result<usize> {
        Err(io::Error::from(io::ErrorKind::BrokenPipe))
    }

    fn flush(&mut self) -> io::Result<()> {
        Err(io::Error::from(io::ErrorKind::BrokenPipe))
    }
}

/// Accepts writes and fails the flush.
struct FlushFails;

impl Write for FlushFails {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        Ok(bytes.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        Err(io::Error::from(io::ErrorKind::BrokenPipe))
    }
}

#[test]
fn initialize_shutdown_exit_returns_zero_and_only_frames_are_written() {
    let temp = Temp::workspace();
    let (code, output) = run_messages(&temp, &[initialize(&temp), shutdown(), exit()]);
    assert_eq!(code, 0);
    assert_eq!(output.len(), 2);
    assert!(output[0]["result"]["capabilities"].is_object());
    assert_eq!(
        output[1],
        json!({"jsonrpc": "2.0", "id": 2, "result": null})
    );
}

#[test]
fn exit_without_shutdown_returns_one() {
    let temp = Temp::workspace();
    let (code, output) = run_messages(&temp, &[initialize(&temp), exit()]);
    assert_eq!(code, 1);
    assert_eq!(output.len(), 1);
}

#[test]
fn exit_before_initialize_returns_one() {
    let temp = Temp::workspace();
    let (code, output) = run_messages(&temp, &[exit()]);
    assert_eq!(code, 1);
    assert!(output.is_empty());
}

#[test]
fn end_of_input_without_exit_returns_zero() {
    let temp = Temp::workspace();
    let (code, output) = run_messages(&temp, &[initialize(&temp)]);
    assert_eq!(code, 0);
    assert_eq!(output.len(), 1);
    let (code, output) = run(&temp, Vec::new());
    assert_eq!(code, 0);
    assert!(output.is_empty());
}

#[test]
fn messages_after_exit_are_not_processed() {
    let temp = Temp::workspace();
    temp.write("a.sigil", CLEAN);
    let uri = temp.uri("a.sigil");
    let (code, output) = run_messages(
        &temp,
        &[
            initialize(&temp),
            shutdown(),
            exit(),
            request(3, "textDocument/hover", json!({})),
            message(
                "textDocument/didOpen",
                json!({"textDocument": {"uri": uri, "languageId": "sigil", "version": 1, "text": CLEAN}}),
            ),
            // Not even a frame that is broken.
            json!("garbage"),
        ],
    );
    assert_eq!(code, 0);
    assert_eq!(output.len(), 2);
    assert!(published_for(&output, &uri).is_none());
}

#[test]
fn edits_before_exit_are_still_published() {
    let temp = Temp::workspace();
    temp.write("a.sigil", CLEAN);
    let uri = temp.uri("a.sigil");
    let (code, output) = run_messages(
        &temp,
        &[
            initialize(&temp),
            message("initialized", json!({})),
            message(
                "textDocument/didOpen",
                json!({"textDocument": {"uri": uri, "languageId": "sigil", "version": 1, "text": CLEAN}}),
            ),
            exit(),
        ],
    );
    assert_eq!(code, 1);
    assert_eq!(published_for(&output, &uri), Some(Vec::new()));
}

#[test]
fn input_split_in_every_way_across_reads_gives_the_same_answers() {
    let temp = Temp::workspace();
    let input = frames(&[initialize(&temp), shutdown(), exit()]);
    let (_, expected) = run(&temp, input.clone());
    for size in [1, 2, 7, 25, input.len() - 1] {
        let mut written = Vec::new();
        let code = serve_with(
            Trickle {
                bytes: input.clone(),
                at: 0,
                size,
            },
            &mut written,
            ServerOptions {
                cwd: temp.root.clone(),
                ..ServerOptions::default()
            },
        );
        assert_eq!(code, 0, "size {size}");
        assert_eq!(decode(&written), expected, "size {size}");
    }
}

#[test]
fn two_frames_in_one_read_are_both_answered() {
    let temp = Temp::workspace();
    let (code, output) = run_messages(&temp, &[initialize(&temp), shutdown()]);
    assert_eq!(code, 0);
    assert_eq!(output.len(), 2);
    assert_eq!(output[0]["id"], 1);
    assert_eq!(output[1]["id"], 2);
}

#[test]
fn a_malformed_frame_between_valid_ones_costs_one_error() {
    let temp = Temp::workspace();
    let mut input = frames(&[initialize(&temp)]);
    // A header without a usable length, a body that is not JSON, and JSON that
    // is not a message.
    input.extend(b"Content-Type: x\r\n\r\n");
    input.extend(b"Content-Length: 5\r\n\r\n{nope");
    input.extend(frames(&[json!({"hello": 1})]));
    input.extend(frames(&[shutdown(), exit()]));
    let (code, output) = run(&temp, input);
    assert_eq!(code, 0);
    let ids: Vec<&Value> = output.iter().map(|m| &m["id"]).collect();
    assert_eq!(
        ids,
        [
            &json!(1),
            &Value::Null,
            &Value::Null,
            &Value::Null,
            &json!(2)
        ]
    );
    assert_eq!(
        output[1]["error"],
        json!({"code": -32700, "message": "Parse error"})
    );
    assert_eq!(
        output[2]["error"],
        json!({"code": -32700, "message": "Parse error"})
    );
    assert_eq!(
        output[3]["error"],
        json!({"code": -32600, "message": "Invalid Request"})
    );
    assert_eq!(output[4]["result"], Value::Null);
}

#[test]
fn a_failing_writer_ends_the_loop_with_three() {
    let temp = Temp::workspace();
    let input = frames(&[initialize(&temp), shutdown(), exit()]);
    let code = serve(Cursor::new(input.clone()), BrokenPipe, temp.root.clone());
    assert_eq!(code, 3);
    let code = serve(Cursor::new(input), FlushFails, temp.root.clone());
    assert_eq!(code, 3);
}

#[test]
fn a_failing_reader_ends_the_loop_with_three_after_what_was_read() {
    let temp = Temp::workspace();
    let mut written = Vec::new();
    let code = serve(
        Failing {
            bytes: Some(frames(&[initialize(&temp)])),
        },
        &mut written,
        temp.root.clone(),
    );
    assert_eq!(code, 3);
    let output = decode(&written);
    assert_eq!(output.len(), 1);
    assert_eq!(output[0]["id"], 1);
    // Nothing read at all.
    let code = serve(Failing { bytes: None }, Vec::new(), temp.root.clone());
    assert_eq!(code, 3);
}

#[test]
fn a_cancel_or_exit_sent_as_a_request_is_a_notification() {
    let temp = Temp::workspace();
    let (code, output) = run_messages(
        &temp,
        &[
            initialize(&temp),
            request(5, "$/cancelRequest", json!({"id": 99})),
            shutdown(),
            request(7, "exit", Value::Null),
        ],
    );
    assert_eq!(code, 0);
    assert_eq!(output.len(), 2);
}
