//! The stdio loop: the server run over a byte reader and a byte writer.
//!
//! A reader thread frames what arrives and hands it over in chunks. The loop
//! takes one chunk, then whatever else has already arrived, and treats that
//! batch as its queue: it applies cancellations first, answers a request that
//! a later change in the queue overtakes with content modified, and reads the
//! workspace once for a run of edits. It writes and flushes once per batch.
use crate::{
    params,
    rpc::{self, Framer, Id, Incoming, Item},
    server::{Server, ServerOptions, State},
};
use serde_json::Value;
use std::{
    collections::HashSet,
    io::{self, ErrorKind, Read, Write},
    path::PathBuf,
    sync::mpsc::{self, Receiver, TryRecvError},
    thread,
};

/// The status when standard input or output fails.
const IO_FAILURE: i32 = 3;
const READ_SIZE: usize = 64 * 1024;

/// How the input ended, when it did.
enum End {
    Eof,
    Failed,
}

/// The frames one read completed, and how the input ended after them.
struct Chunk {
    items: Vec<Item>,
    end: Option<End>,
}

/// Run the language server over `reader` and `writer`, with workspaces looked
/// for from `cwd`, and return the process's exit status.
pub fn serve<R, W>(reader: R, writer: W, cwd: PathBuf) -> i32
where
    R: Read + Send + 'static,
    W: Write,
{
    serve_with(
        reader,
        writer,
        ServerOptions {
            cwd,
            ..ServerOptions::default()
        },
    )
}

/// Like `serve`, with the server's options given.
///
/// The status is the server's after `exit`, 0 when the input ends first, and 3
/// when reading or writing fails. After `exit` nothing more is read or
/// processed; the reader thread is left to end with the process.
pub fn serve_with<R, W>(reader: R, mut writer: W, options: ServerOptions) -> i32
where
    R: Read + Send + 'static,
    W: Write,
{
    let (sender, receiver) = mpsc::channel();
    thread::spawn(move || read_chunks(reader, &sender));
    let mut server = Server::new(options);
    loop {
        let (items, end) = next_batch(&receiver);
        let (mut out, exited) = process(&mut server, items);
        out.extend(server.settle());
        if write_all(&mut writer, &out).is_err() {
            return IO_FAILURE;
        }
        if exited {
            return server.exit_code().unwrap_or(0);
        }
        match end {
            Some(End::Eof) => return server.exit_code().unwrap_or(0),
            Some(End::Failed) => return IO_FAILURE,
            None => {}
        }
    }
}

fn read_chunks<R: Read>(mut reader: R, sender: &mpsc::Sender<Chunk>) {
    let mut framer = Framer::new();
    let mut buffer = vec![0; READ_SIZE];
    loop {
        let (items, end) = match reader.read(&mut buffer) {
            Ok(0) => (Vec::new(), Some(End::Eof)),
            Ok(count) => (framer.feed(&buffer[..count]), None),
            Err(error) if error.kind() == ErrorKind::Interrupted => continue,
            Err(_) => (Vec::new(), Some(End::Failed)),
        };
        let ended = end.is_some();
        if sender.send(Chunk { items, end }).is_err() || ended {
            return;
        }
    }
}

/// Wait for one chunk, then take every chunk that has already arrived, up to
/// the end of the input.
fn next_batch(receiver: &Receiver<Chunk>) -> (Vec<Item>, Option<End>) {
    let Ok(first) = receiver.recv() else {
        return (Vec::new(), Some(End::Failed));
    };
    let mut items = first.items;
    let mut end = first.end;
    while end.is_none() {
        match receiver.try_recv() {
            Ok(chunk) => {
                items.extend(chunk.items);
                end = chunk.end;
            }
            Err(TryRecvError::Empty) => break,
            Err(TryRecvError::Disconnected) => end = Some(End::Failed),
        }
    }
    (items, end)
}

/// What the loop knows about one queued item.
enum Queued {
    Garbled,
    Message(Incoming),
}

/// Apply a batch in order and return what to send, and whether `exit` ended
/// it. Changes are recorded and read once by the caller's `settle`.
fn process(server: &mut Server, items: Vec<Item>) -> (Vec<Value>, bool) {
    let queue: Vec<Queued> = items
        .into_iter()
        .map(|item| match item {
            Item::Message(value) => Queued::Message(rpc::classify(value)),
            Item::ParseError => Queued::Garbled,
        })
        .collect();
    let mut cancelled = cancelled_in(server, &queue);
    let mut out = Vec::new();
    for (index, queued) in queue.iter().enumerate() {
        let message = match queued {
            Queued::Garbled => {
                out.push(rpc::parse_error());
                continue;
            }
            Queued::Message(Incoming::Invalid) => {
                out.push(rpc::invalid_request());
                continue;
            }
            Queued::Message(message) => message,
        };
        match message {
            Incoming::Request { method, .. } | Incoming::Notification { method, .. }
                if method == "$/cancelRequest" => {}
            Incoming::Request { id, method, .. } => {
                let spent = cancelled.remove(id);
                if !spent && uses_workspace(method) && overtaken(server, &queue[index + 1..]) {
                    out.push(rpc::failure(
                        Some(id),
                        rpc::CONTENT_MODIFIED,
                        "Workspace content changed.",
                    ));
                } else {
                    out.extend(server.handle(message.clone()));
                }
            }
            Incoming::Notification { .. } if server.would_reload(message) => {
                out.extend(server.handle_deferred(message.clone()));
            }
            _ => out.extend(server.handle(message.clone())),
        }
        if server.exit_code().is_some() {
            return (out, true);
        }
    }
    (out, false)
}

/// Mark the requests of the batch that a `$/cancelRequest` of the batch names,
/// and return their ids. A cancellation of any other id is dropped, so the
/// server holds no mark for a request that is gone.
fn cancelled_in(server: &mut Server, queue: &[Queued]) -> HashSet<Id> {
    let mut named = HashSet::new();
    for queued in queue {
        if let Queued::Message(
            Incoming::Request { method, params, .. } | Incoming::Notification { method, params },
        ) = queued
            && method == "$/cancelRequest"
            && let Some(id) = params::cancellation_id(params)
        {
            named.insert(id);
        }
    }
    let mut marked = HashSet::new();
    for queued in queue {
        if let Queued::Message(Incoming::Request { id, method, .. }) = queued
            && named.contains(id)
            && method != "$/cancelRequest"
            && method != "exit"
        {
            server.cancel(id);
            marked.insert(id.clone());
        }
    }
    marked
}

fn uses_workspace(method: &str) -> bool {
    method != "initialize" && method != "shutdown"
}

/// Whether a message behind a request changes the workspace, so that the
/// request's answer would be thrown away.
fn overtaken(server: &Server, behind: &[Queued]) -> bool {
    server.state() == State::Running
        && behind.iter().any(|queued| match queued {
            Queued::Message(message) => server.would_reload(message),
            Queued::Garbled => false,
        })
}

fn write_all<W: Write>(writer: &mut W, messages: &[Value]) -> io::Result<()> {
    if messages.is_empty() {
        return Ok(());
    }
    let bytes: Vec<u8> = messages.iter().flat_map(rpc::encode).collect();
    writer.write_all(&bytes)?;
    writer.flush()
}
