//! Command-line parsing: one request type per command, and the help text.
//!
//! The rules follow the TypeScript parser: options may appear anywhere after
//! the command, a flag value never starts with `-`, `--help` anywhere after a
//! command shows that command's help, and the checks that name an option the
//! command does not accept run before the checks on positional arguments.

/// A command's output format. Each command has its own default.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Format {
    Json,
    Text,
    Markdown,
}

/// The options every command accepts.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Global {
    pub root: Option<String>,
    pub format: Option<Format>,
    pub pretty: bool,
    pub quiet: bool,
}

impl Global {
    /// The requested format, or `default` when none was given.
    pub fn format_or(&self, default: Format) -> Format {
        self.format.unwrap_or(default)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InitRequest {
    pub global: Global,
    pub path: Option<String>,
    pub name: Option<String>,
    pub include: Vec<String>,
    pub exclude: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VersionRequest {
    pub global: Global,
    pub path: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParseRequest {
    pub global: Global,
    pub file: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CheckRequest {
    pub global: Global,
    pub path: Option<String>,
    pub show_locations: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FmtRequest {
    pub global: Global,
    pub paths: Vec<String>,
    pub check: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GlossaryRequest {
    pub global: Global,
    pub path: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Request {
    Init(InitRequest),
    Version(VersionRequest),
    Parse(ParseRequest),
    Check(CheckRequest),
    Fmt(FmtRequest),
    Glossary(GlossaryRequest),
    Lsp,
}

/// Which help text a usage error or `--help` prints.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Topic {
    Root,
    Init,
    Version,
    Parse,
    Check,
    Fmt,
    Glossary,
    Lsp,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Usage {
    pub message: String,
    pub topic: Topic,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Parsed {
    Run(Request),
    Help(Topic),
    CliVersion,
    Usage(Usage),
}

fn usage(message: impl Into<String>, topic: Topic) -> Parsed {
    Parsed::Usage(Usage {
        message: message.into(),
        topic,
    })
}

fn command_topic(name: &str) -> Option<Topic> {
    Some(match name {
        "init" => Topic::Init,
        "version" => Topic::Version,
        "parse" => Topic::Parse,
        "check" => Topic::Check,
        "fmt" => Topic::Fmt,
        "glossary" => Topic::Glossary,
        "lsp" => Topic::Lsp,
        _ => return None,
    })
}

fn parse_format(value: &str) -> Option<Format> {
    match value {
        "json" => Some(Format::Json),
        "text" => Some(Format::Text),
        "markdown" => Some(Format::Markdown),
        _ => None,
    }
}

/// Parse the arguments after the program name.
pub fn parse(argv: &[String]) -> Parsed {
    match argv.first().map(String::as_str) {
        Some("--help") => return Parsed::Help(Topic::Root),
        Some("--version") => return Parsed::CliVersion,
        _ => {}
    }
    let Some(name) = argv.first() else {
        return usage(
            "Expected command: init, version, parse, check, fmt, glossary, or lsp.",
            Topic::Root,
        );
    };
    let Some(topic) = command_topic(name) else {
        return usage(format!("Unknown command \"{name}\"."), Topic::Root);
    };
    let rest = &argv[1..];
    if rest.iter().any(|arg| arg == "--help") {
        return Parsed::Help(topic);
    }
    if topic == Topic::Lsp {
        return match rest.first() {
            None => Parsed::Run(Request::Lsp),
            Some(arg) if arg.starts_with('-') => {
                usage(format!("Unsupported option {arg}."), Topic::Lsp)
            }
            Some(_) => usage("lsp accepts no arguments.", Topic::Lsp),
        };
    }
    parse_command(name, topic, rest)
}

fn parse_command(name: &str, topic: Topic, rest: &[String]) -> Parsed {
    let mut positional: Vec<String> = Vec::new();
    let mut global = Global::default();
    let mut show_locations = false;
    let mut check = false;
    let mut init_name: Option<String> = None;
    let mut include: Vec<String> = Vec::new();
    let mut exclude: Vec<String> = Vec::new();

    let mut index = 0;
    while index < rest.len() {
        let arg = rest[index].as_str();
        // A flag value is the next argument unless it is empty or looks like a flag.
        let mut take = |flag: &str| -> Result<String, Parsed> {
            index += 1;
            match rest.get(index) {
                Some(value) if !value.is_empty() && !value.starts_with('-') => Ok(value.clone()),
                _ => Err(usage(format!("{flag} requires a value."), topic)),
            }
        };
        match arg {
            "--root" => match take(arg) {
                Ok(value) => global.root = Some(value),
                Err(error) => return error,
            },
            "--format" => match take(arg) {
                Ok(value) => match parse_format(&value) {
                    Some(format) => global.format = Some(format),
                    None => return usage("--format must be json, text, or markdown.", topic),
                },
                Err(error) => return error,
            },
            "--pretty" => global.pretty = true,
            "--quiet" => global.quiet = true,
            "--show-locations" => show_locations = true,
            "--check" => check = true,
            "--name" => match take(arg) {
                Ok(value) => init_name = Some(value),
                Err(error) => return error,
            },
            "--include" => match take(arg) {
                Ok(value) => include.push(value),
                Err(error) => return error,
            },
            "--exclude" => match take(arg) {
                Ok(value) => exclude.push(value),
                Err(error) => return error,
            },
            _ if arg.starts_with('-') => {
                return usage(format!("Unsupported option {arg}."), topic);
            }
            _ => positional.push(arg.to_owned()),
        }
        index += 1;
    }

    if topic != Topic::Fmt && check {
        return usage(format!("{name} does not accept --check."), topic);
    }
    if topic != Topic::Init && (init_name.is_some() || !include.is_empty() || !exclude.is_empty()) {
        return usage(format!("{name} does not accept init options."), topic);
    }
    if topic != Topic::Check && show_locations {
        return usage(format!("{name} does not accept --show-locations."), topic);
    }

    let at_most_one = |positional: &[String], message: String| -> Result<Option<String>, Parsed> {
        if positional.len() > 1 {
            Err(usage(message, topic))
        } else {
            Ok(positional.first().cloned())
        }
    };
    match topic {
        Topic::Init => {
            if global.root.is_some() {
                return usage(
                    "init uses its path argument and does not accept --root.",
                    topic,
                );
            }
            match at_most_one(&positional, "init accepts at most one path.".into()) {
                Ok(path) => Parsed::Run(Request::Init(InitRequest {
                    global,
                    path,
                    name: init_name,
                    include,
                    exclude,
                })),
                Err(error) => error,
            }
        }
        Topic::Version => {
            match at_most_one(&positional, "version accepts at most one path.".into()) {
                Ok(path) => Parsed::Run(Request::Version(VersionRequest { global, path })),
                Err(error) => error,
            }
        }
        Topic::Parse => {
            if positional.len() != 1 {
                return usage("parse requires exactly one file.", topic);
            }
            Parsed::Run(Request::Parse(ParseRequest {
                global,
                file: positional.remove(0),
            }))
        }
        Topic::Fmt => {
            if global.format == Some(Format::Markdown) {
                return usage("--format must be text or json for fmt.", topic);
            }
            Parsed::Run(Request::Fmt(FmtRequest {
                global,
                paths: positional,
                check,
            }))
        }
        Topic::Check => match at_most_one(&positional, "check accepts at most one path.".into()) {
            Ok(path) => Parsed::Run(Request::Check(CheckRequest {
                global,
                path,
                show_locations,
            })),
            Err(error) => error,
        },
        Topic::Glossary => {
            match at_most_one(&positional, "glossary accepts at most one path.".into()) {
                Ok(path) => Parsed::Run(Request::Glossary(GlossaryRequest { global, path })),
                Err(error) => error,
            }
        }
        Topic::Root | Topic::Lsp => unreachable!("handled before option parsing"),
    }
}

/// The help text for a topic, ending in a newline.
pub fn help(topic: Topic) -> &'static str {
    match topic {
        Topic::Root => ROOT_HELP,
        Topic::Init => INIT_HELP,
        Topic::Version => VERSION_HELP,
        Topic::Parse => PARSE_HELP,
        Topic::Check => CHECK_HELP,
        Topic::Fmt => FMT_HELP,
        Topic::Glossary => GLOSSARY_HELP,
        Topic::Lsp => LSP_HELP,
    }
}

const ROOT_HELP: &str = "Usage: sigil <command> [options]

Commands:
  init              Create a workspace configuration
  version           Report workspace and contract versions
  parse             Parse one Sigil file
  check             Report workspace diagnostics
  fmt               Format selected Sigil source
  glossary          Inspect reviewed glossary terms and occurrences
  lsp               Start the language server

Options:
  --help            Show this help
  --version         Show the sigil version
";

const INIT_HELP: &str = "Usage: sigil init [path] [options]

Options:
  --name <value>    Set the workspace name
  --include <glob>  Include a source glob; may be repeated
  --exclude <glob>  Exclude a source glob; may be repeated
  --format <value>  Output json, text, or markdown
  --pretty          Pretty-print JSON output
  --quiet           Suppress command output
  --help            Show this help
";

const VERSION_HELP: &str = "Usage: sigil version [path] [options]

Options:
  --root <path>     Use an explicit workspace root
  --format <value>  Output json, text, or markdown
  --pretty          Pretty-print JSON output
  --quiet           Suppress command output
  --help            Show this help
";

const PARSE_HELP: &str = "Usage: sigil parse <file> [options]

Options:
  --root <path>     Use an explicit workspace root
  --format <value>  Output json, text, or markdown
  --pretty          Pretty-print JSON output
  --quiet           Suppress command output
  --help            Show this help
";

const CHECK_HELP: &str = "Usage: sigil check [path] [options]

Options:
  --root <path>     Use an explicit workspace root
  --format <value>  Output json, text, or markdown
  --pretty          Pretty-print JSON output
  --quiet           Suppress command output
  --show-locations  Add file path, line, and column to text diagnostics
  --help            Show this help
";

const FMT_HELP: &str = "Usage: sigil fmt [paths...] [options]

Select files or directories in one workspace; overlapping targets are deduplicated.
With no paths, select the current directory. At the workspace root, this selects
all included workspace sources. Only changed selected .sigil files are written.
All targets and combined replacements are validated before writing any file.
Paths resolve from the current directory; --root only anchors workspace discovery.

Options:
  --check           Report noncanonical source without writing
  --root <path>     Use an explicit workspace root
  --format <value>  Output json or text
  --pretty          Pretty-print JSON output
  --quiet           Suppress command output
  --help            Show this help
";

const GLOSSARY_HELP: &str = "Usage: sigil glossary [path] [options]

Options:
  --root <path>     Use an explicit workspace root
  --format <value>  Output json, text, or markdown
  --pretty          Pretty-print JSON output
  --quiet           Suppress command output
  --help            Show this help
";

const LSP_HELP: &str = "Usage: sigil lsp

Start the language server on standard input and output.

Options:
  --help            Show this help
";
