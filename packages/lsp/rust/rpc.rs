//! JSON-RPC over `Content-Length` frames, as the TypeScript server speaks it.
use serde_json::{Number, Value, json};
use std::io::Write;

/// Malformed JSON, or a frame that could not be read.
pub const PARSE_ERROR: i64 = -32700;
/// A message that is not a request, notification or response.
pub const INVALID_REQUEST: i64 = -32600;
pub const METHOD_NOT_FOUND: i64 = -32601;
pub const INVALID_PARAMS: i64 = -32602;
pub const INTERNAL_ERROR: i64 = -32603;
pub const SERVER_NOT_INITIALIZED: i64 = -32002;
pub const REQUEST_CANCELLED: i64 = -32800;
/// A request answered after the workspace changed under it.
pub const CONTENT_MODIFIED: i64 = -32801;

/// A request id, which is a string or a number.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum Id {
    Number(Number),
    String(String),
}

impl Id {
    /// The id held by a JSON value, or `None` for anything but a string or number.
    pub fn from_value(value: &Value) -> Option<Self> {
        match value {
            Value::Number(number) => Some(Self::Number(number.clone())),
            Value::String(text) => Some(Self::String(text.clone())),
            _ => None,
        }
    }

    pub fn to_value(&self) -> Value {
        match self {
            Self::Number(number) => Value::Number(number.clone()),
            Self::String(text) => Value::String(text.clone()),
        }
    }
}

/// What the framer found in the byte stream.
#[derive(Debug, Clone, PartialEq)]
pub enum Item {
    /// A frame whose body is JSON.
    Message(Value),
    /// A frame with a bad header or a body that is not JSON.
    ParseError,
}

/// An incremental reader of `Content-Length` frames.
///
/// The TypeScript framer throws on a missing or invalid length and the server
/// turns that into one parse error. This one yields one `ParseError`, drops the
/// header block, and skips ahead to the next `Content-Length` header, so one
/// bad frame costs one error and neither stalls nor drops the frames after it.
/// A length must be plain decimal digits; TypeScript's `Number()` also accepts
/// an empty value, hex and exponents.
#[derive(Debug, Default)]
pub struct Framer {
    buffer: Vec<u8>,
    skipping: bool,
}

impl Framer {
    pub fn new() -> Self {
        Self::default()
    }

    /// The bytes held back because they do not yet make a whole frame.
    pub fn pending(&self) -> &[u8] {
        &self.buffer
    }

    /// Add bytes and return every frame they complete, in order.
    pub fn feed(&mut self, chunk: &[u8]) -> Vec<Item> {
        self.buffer.extend_from_slice(chunk);
        let mut items = Vec::new();
        let mut start = 0;
        loop {
            let rest = &self.buffer[start..];
            if self.skipping {
                match find_ignore_case(rest, HEADER_NAME) {
                    Some(offset) => {
                        start += offset;
                        self.skipping = false;
                    }
                    None => {
                        start += rest.len().saturating_sub(HEADER_NAME.len() - 1);
                        break;
                    }
                }
                continue;
            }
            let Some(end) = find(rest, b"\r\n\r\n") else {
                break;
            };
            let body_start = end + 4;
            let Some(length) = content_length(&rest[..end]) else {
                items.push(Item::ParseError);
                start += body_start;
                self.skipping = true;
                continue;
            };
            let Some(body_end) = body_start
                .checked_add(length)
                .filter(|body_end| *body_end <= rest.len())
            else {
                break;
            };
            items.push(parse_body(&rest[body_start..body_end]));
            start += body_end;
        }
        self.buffer.drain(..start);
        items
    }
}

const HEADER_NAME: &[u8] = b"content-length:";

fn find(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack
        .windows(needle.len())
        .position(|window| window == needle)
}

fn find_ignore_case(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack
        .windows(needle.len())
        .position(|window| window.eq_ignore_ascii_case(needle))
}

fn content_length(header: &[u8]) -> Option<usize> {
    let header = String::from_utf8_lossy(header);
    let line = header.split("\r\n").find(|line| {
        line.as_bytes()
            .get(..HEADER_NAME.len())
            .is_some_and(|name| name.eq_ignore_ascii_case(HEADER_NAME))
    })?;
    let value = line[HEADER_NAME.len()..].trim();
    if value.is_empty() || !value.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    value.parse().ok()
}

fn parse_body(body: &[u8]) -> Item {
    let text = String::from_utf8_lossy(body);
    let text = text.strip_prefix('\u{feff}').unwrap_or(&text);
    match serde_json::from_str(text) {
        Ok(value) => Item::Message(value),
        Err(_) => Item::ParseError,
    }
}

/// A message with its `Content-Length` header, the length in UTF-8 bytes.
pub fn encode(message: &Value) -> Vec<u8> {
    let mut bytes = Vec::new();
    encode_into(&mut bytes, message);
    bytes
}

/// Append the frame of a message to `out`.
pub fn encode_into(out: &mut Vec<u8>, message: &Value) {
    let body = message.to_string();
    write!(out, "Content-Length: {}\r\n\r\n", body.len()).expect("a Vec takes any write");
    out.extend_from_slice(body.as_bytes());
}

/// What a decoded JSON value is, by the TypeScript `parseIncoming` rules.
#[derive(Debug, Clone, PartialEq)]
pub enum Incoming {
    Request {
        id: Id,
        method: String,
        /// `Null` when the message carries no params.
        params: Value,
    },
    Notification {
        method: String,
        params: Value,
    },
    /// A reply to a request the server sent; its id may be null.
    Response {
        id: Option<Id>,
    },
    Invalid,
}

pub fn classify(value: Value) -> Incoming {
    let Value::Object(mut object) = value else {
        return Incoming::Invalid;
    };
    if object.get("jsonrpc") != Some(&Value::String("2.0".into())) {
        return Incoming::Invalid;
    }
    if let Some(Value::String(method)) = object.get("method") {
        let method = method.clone();
        let params = object.remove("params").unwrap_or(Value::Null);
        return match object.get("id") {
            None => Incoming::Notification { method, params },
            Some(id) => match Id::from_value(id) {
                Some(id) => Incoming::Request { id, method, params },
                None => Incoming::Invalid,
            },
        };
    }
    let answered = object.contains_key("result") || is_failure(object.get("error"));
    let id = object.get("id");
    match id {
        Some(Value::Null) if answered => Incoming::Response { id: None },
        Some(id) if answered => match Id::from_value(id) {
            Some(id) => Incoming::Response { id: Some(id) },
            None => Incoming::Invalid,
        },
        _ => Incoming::Invalid,
    }
}

fn is_failure(error: Option<&Value>) -> bool {
    error.and_then(Value::as_object).is_some_and(|error| {
        error.get("code").is_some_and(Value::is_number)
            && error.get("message").is_some_and(Value::is_string)
    })
}

/// A successful response.
pub fn success(id: &Id, result: Value) -> Value {
    json!({"jsonrpc": "2.0", "id": id.to_value(), "result": result})
}

/// A failed response; the id is `None` when the request had none to answer.
pub fn failure(id: Option<&Id>, code: i64, message: &str) -> Value {
    json!({
        "jsonrpc": "2.0",
        "id": id.map_or(Value::Null, Id::to_value),
        "error": {"code": code, "message": message},
    })
}

pub fn notification(method: &str, params: Value) -> Value {
    json!({"jsonrpc": "2.0", "method": method, "params": params})
}

/// A request the server sends to the client.
pub fn request(id: &Id, method: &str, params: Value) -> Value {
    json!({"jsonrpc": "2.0", "id": id.to_value(), "method": method, "params": params})
}

/// The answer to a frame that is not JSON.
pub fn parse_error() -> Value {
    failure(None, PARSE_ERROR, "Parse error")
}

/// The answer to JSON that is not a JSON-RPC message.
pub fn invalid_request() -> Value {
    failure(None, INVALID_REQUEST, "Invalid Request")
}
