//! `file:` URIs and workspace paths.
//!
//! Unlike the TypeScript server, a path keeps a UNC host through
//! normalization, and `%` and control characters are percent-encoded so every
//! path survives a round trip.
use sigil_core::language::path::normalize_path;
use std::fmt;

/// A URI that is not a usable `file:` URI.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UriError(String);

impl UriError {
    pub fn message(&self) -> &str {
        &self.0
    }
}

impl fmt::Display for UriError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for UriError {}

/// The normalized path a `file:` URI names.
///
/// `file:///C:/x` gives `C:/x`, and `file://host/x` gives `//host/x`; a
/// `localhost` host is the same as none.
pub fn file_uri_to_path(uri: &str) -> Result<String, UriError> {
    let not_file = || UriError(format!("Only file URIs are supported: {uri}"));
    let (scheme, rest) = uri.split_once(':').ok_or_else(not_file)?;
    if !scheme.eq_ignore_ascii_case("file") {
        return Err(not_file());
    }
    let (host, path) = match rest.strip_prefix("//") {
        Some(after) => {
            let end = after.find(['/', '?', '#']).unwrap_or(after.len());
            (&after[..end], &after[end..])
        }
        None => ("", rest),
    };
    let path = &path[..path.find(['?', '#']).unwrap_or(path.len())];
    let mut path = percent_decode(path).ok_or_else(|| UriError(format!("URI malformed: {uri}")))?;
    if !path.starts_with('/') {
        path.insert(0, '/');
    }
    let host = host.to_ascii_lowercase();
    if !host.is_empty() && host != "localhost" {
        return Ok(format!("//{host}{}", normalize_path(&path)));
    }
    if has_drive_prefix(&path[1..]) {
        path.remove(0);
    }
    Ok(normalize_path(&path))
}

/// The `file:` URI for a path, using `/` separators.
pub fn path_to_file_uri(path: &str) -> String {
    let slashed = path.replace('\\', "/");
    if let Some(unc) = slashed.strip_prefix("//")
        && !unc.is_empty()
        && !unc.starts_with('/')
    {
        let (host, rest) = unc.split_at(unc.find('/').unwrap_or(unc.len()));
        return format!("file://{host}{}", encode(&normalize_path(rest)));
    }
    let normalized = normalize_path(&slashed);
    let prefix = if has_drive_prefix(&normalized) {
        "file:///"
    } else {
        "file://"
    };
    format!("{prefix}{}", encode(&normalized))
}

/// Whether a path starts with a drive letter and a separator, as `C:/` or `C:\`.
pub(crate) fn has_drive_prefix(path: &str) -> bool {
    let bytes = path.as_bytes();
    bytes.len() >= 3
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && (bytes[2] == b'/' || bytes[2] == b'\\')
}

fn percent_decode(text: &str) -> Option<String> {
    let bytes = text.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' {
            let pair = bytes.get(index + 1..index + 3)?;
            let high = (pair[0] as char).to_digit(16)?;
            let low = (pair[1] as char).to_digit(16)?;
            decoded.push((high * 16 + low) as u8);
            index += 3;
        } else {
            decoded.push(bytes[index]);
            index += 1;
        }
    }
    String::from_utf8(decoded).ok()
}

/// Whether a path byte is written as `%XX`: not printable ASCII, or one of
/// `"`, `#`, `<`, `>`, `?`, `` ` ``, `{`, `}`. A `%` is not in the set; `encode`
/// adds it.
pub(crate) fn in_path_set(byte: u8) -> bool {
    byte <= b' '
        || byte > 0x7e
        || matches!(byte, b'"' | b'#' | b'<' | b'>' | b'?' | b'`' | b'{' | b'}')
}

/// Percent-encode the UTF-8 bytes that `encoded` selects as `%XX`; the others
/// stay as they are.
pub(crate) fn percent_encode(text: &str, encoded: fn(u8) -> bool) -> String {
    const HEX: &[u8; 16] = b"0123456789ABCDEF";
    let mut out = String::with_capacity(text.len());
    for byte in text.bytes() {
        if encoded(byte) {
            out.push('%');
            out.push(HEX[usize::from(byte >> 4)] as char);
            out.push(HEX[usize::from(byte & 15)] as char);
        } else {
            out.push(byte as char);
        }
    }
    out
}

/// A path as it is written in a URI: `%` is encoded too, so a path round trips.
fn encode(path: &str) -> String {
    percent_encode(path, |byte| in_path_set(byte) || byte == b'%')
}
