//! The Sigil language server: protocol framing, parameter checks, file URIs,
//! and the server that reads a workspace and publishes its diagnostics.
pub mod diagnostics;
pub mod params;
pub mod position;
pub mod rpc;
pub mod server;
pub mod snapshot;
pub mod uri;
