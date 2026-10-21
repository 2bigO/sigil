#![allow(dead_code)]
//! Shared test support: temporary workspaces, a runner for the `sigil` binary,
//! and the replay of the cases recorded from the TypeScript command line.
use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
    process::Command,
    sync::atomic::{AtomicUsize, Ordering},
};

pub const CONFIG: &str = r#"{"sigilVersion":"0.9.0","workspace":{"name":"test","members":[]},"files":{"include":["**/*.sigil"]},"tools":{}}"#;

/// A component with one Tag, for tests that need a valid source to import from.
pub const BASE_SOURCE: &str = "component Base {\n  goal {\n    Ship it.\n  }\n  interface {\n    value {\n      A value.\n    }\n  }\n}\n";

/// The commands the Rust command line no longer has.
pub const REMOVED: [&str; 4] = ["graph", "context", "retrieve", "render"];

/// A temporary directory with a canonical path, removed when dropped.
pub struct Temp {
    pub root: PathBuf,
}

impl Temp {
    pub fn new() -> Self {
        static NEXT: AtomicUsize = AtomicUsize::new(0);
        let path = std::env::temp_dir().join(format!(
            "sigil-cli-test-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&path).unwrap();
        Self {
            root: path.canonicalize().unwrap(),
        }
    }

    /// A temporary workspace with a minimal config.
    pub fn workspace() -> Self {
        let temp = Self::new();
        temp.write(".sigil/config.json", CONFIG);
        temp
    }

    pub fn path(&self, relative: &str) -> PathBuf {
        self.root.join(relative)
    }

    pub fn text(&self) -> String {
        self.root.to_string_lossy().into_owned()
    }

    pub fn write(&self, relative: &str, text: &str) {
        let path = self.path(relative);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, text).unwrap();
    }

    pub fn mkdir(&self, relative: &str) {
        fs::create_dir_all(self.path(relative)).unwrap();
    }

    /// Every file now under the directory, by `/`-separated relative path.
    pub fn files(&self) -> BTreeMap<String, String> {
        let mut files = BTreeMap::new();
        collect(&self.root, "", &mut files);
        files
    }

    /// Run `command --format json` with `args` after it, expect nothing on
    /// standard error, and return the exit code with the parsed output.
    pub fn json(&self, command: &str, args: &[&str]) -> (i32, serde_json::Value) {
        let mut all = vec![command, "--format", "json"];
        all.extend_from_slice(args);
        let ran = self.sigil(&all);
        assert_eq!(ran.stderr, "");
        (ran.code, serde_json::from_str(&ran.stdout).expect("JSON"))
    }

    /// Run `sigil` with this directory as the working directory.
    pub fn sigil(&self, args: &[&str]) -> Ran {
        run(&self.root, args)
    }
}

impl Default for Temp {
    fn default() -> Self {
        Self::new()
    }
}

impl Drop for Temp {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

fn collect(dir: &Path, prefix: &str, files: &mut BTreeMap<String, String>) {
    for entry in fs::read_dir(dir).unwrap() {
        let entry = entry.unwrap();
        let name = entry.file_name().to_string_lossy().into_owned();
        let path = format!("{prefix}{name}");
        let kind = entry.file_type().unwrap();
        if kind.is_dir() {
            collect(&entry.path(), &format!("{path}/"), files);
        } else if kind.is_file() {
            let bytes = fs::read(entry.path()).unwrap();
            files.insert(path, String::from_utf8_lossy(&bytes).into_owned());
        }
    }
}

/// What a run of the binary printed and how it ended.
#[derive(Debug)]
pub struct Ran {
    pub code: i32,
    pub stdout: String,
    pub stderr: String,
}

pub fn run<S: AsRef<str>>(cwd: &Path, args: &[S]) -> Ran {
    let output = Command::new(env!("CARGO_BIN_EXE_sigil"))
        .args(args.iter().map(AsRef::as_ref))
        .current_dir(cwd)
        .env("NO_COLOR", "1")
        .output()
        .expect("the sigil binary runs");
    Ran {
        code: output.status.code().expect("sigil exits with a status"),
        stdout: String::from_utf8(output.stdout).expect("stdout is UTF-8"),
        stderr: String::from_utf8(output.stderr).expect("stderr is UTF-8"),
    }
}

/// Replay of `tests/fixtures/cli-parity.json`, the output recorded from the
/// TypeScript command line.
pub mod replay {
    use super::{Temp, run};
    use serde::Deserialize;
    use serde_json::Value;
    use std::{collections::BTreeMap, path::Path};

    /// The core version the recording was made with. The Rust core has its own
    /// version, so cases marked `fieldsOnly` are compared with this swapped out.
    const RECORDED_CORE_VERSION: &str = "0.8.0";

    #[derive(Debug, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct Case {
        pub name: String,
        pub command: String,
        #[serde(default)]
        pub files: BTreeMap<String, String>,
        #[serde(default)]
        pub dirs: Vec<String>,
        pub argv: Vec<String>,
        pub cwd: String,
        pub exit_code: i32,
        pub stdout: Option<String>,
        pub stderr: String,
        pub files_after: BTreeMap<String, String>,
        #[serde(default)]
        pub fields_only: bool,
        #[serde(default)]
        pub status_only: bool,
        #[serde(default)]
        pub engine_text: bool,
    }

    /// Which recorded cases of a command to replay.
    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    pub enum Selector {
        /// Usage errors, `--help` and `--version`: decided by the arguments alone.
        Args,
        /// Every other case: these read a workspace.
        Workspace,
    }

    pub fn is_args_case(case: &Case) -> bool {
        case.exit_code == 2
            || case.argv.iter().any(|arg| arg == "--help")
            || case.argv == ["--version"]
    }

    pub fn load() -> Vec<Case> {
        let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/cli-parity.json");
        let text = std::fs::read_to_string(path).expect("the recording is present");
        serde_json::from_str(&text).expect("the recording parses")
    }

    pub fn select(command: &str, selector: Selector) -> Vec<Case> {
        load()
            .into_iter()
            .filter(|case| case.command == command)
            .filter(|case| is_args_case(case) == (selector == Selector::Args))
            .collect()
    }

    /// Replay the cases of `command` that `selector` picks. There must be at
    /// least `floor` of them, so a regenerated recording cannot quietly shrink
    /// the proof. Every mismatch is reported together.
    pub fn run_cases(command: &str, selector: Selector, floor: usize) {
        let cases = select(command, selector);
        assert!(
            cases.len() >= floor,
            "{command} {selector:?}: {} recorded cases, expected at least {floor}",
            cases.len()
        );
        let mut failures = Vec::new();
        for case in &cases {
            let problems = replay(case);
            if !problems.is_empty() {
                failures.push(format!("{}:\n  {}", case.name, problems.join("\n  ")));
            }
        }
        eprintln!(
            "replay {command} {selector:?}: {} of {} cases match",
            cases.len() - failures.len(),
            cases.len()
        );
        assert!(
            failures.is_empty(),
            "{} of {} cases differ from the recording\n\n{}",
            failures.len(),
            cases.len(),
            failures.join("\n\n")
        );
    }

    /// Run one case in a fresh temporary workspace; the problems found.
    pub fn replay(case: &Case) -> Vec<String> {
        let temp = Temp::new();
        let root = temp.text();
        let sub = |text: &str| text.replace("<ROOT>", &root);
        for dir in &case.dirs {
            temp.mkdir(dir);
        }
        for (path, text) in &case.files {
            temp.write(path, text);
        }
        let args: Vec<String> = case.argv.iter().map(|arg| sub(arg)).collect();
        let cwd = if case.cwd == "." {
            temp.root.clone()
        } else {
            temp.path(&case.cwd)
        };
        let ran = run(&cwd, &args);

        let mut problems = Vec::new();
        if ran.code != case.exit_code {
            problems.push(format!(
                "exit status {} instead of {}\nstdout: {:?}\nstderr: {:?}",
                ran.code, case.exit_code, ran.stdout, ran.stderr
            ));
        }
        let expected_files: BTreeMap<String, String> = case
            .files_after
            .iter()
            .map(|(path, text)| (path.clone(), sub(text)))
            .collect();
        let files = temp.files();
        if files != expected_files {
            problems.push(format!(
                "files after differ\nexpected: {expected_files:?}\nactual:   {files:?}"
            ));
        }
        if case.status_only {
            return problems;
        }
        let mut expected_out = sub(case.stdout.as_deref().unwrap_or(""));
        let expected_err = sub(&case.stderr);
        if case.fields_only {
            expected_out = swap_core_version(&expected_out);
        }
        if case.engine_text {
            if let Some(difference) = engine_text_difference(&ran.stdout, &expected_out) {
                problems.push(format!(
                    "stdout differs outside the runtime message: {difference}\nexpected: {expected_out:?}\nactual:   {:?}",
                    ran.stdout
                ));
            }
        } else if ran.stdout != expected_out {
            problems.push(format!(
                "stdout differs\nexpected: {expected_out:?}\nactual:   {:?}",
                ran.stdout
            ));
        }
        // Standard error is never masked: where a recording quotes an
        // operating system message, the Rust command line words it the same
        // way, and every other line is Sigil's own.
        if ran.stderr != expected_err {
            problems.push(format!(
                "stderr differs\nexpected: {expected_err:?}\nactual:   {:?}",
                ran.stderr
            ));
        }
        problems
    }

    fn swap_core_version(text: &str) -> String {
        let core = sigil_core::language::CORE_VERSION;
        text.replace(
            &format!("\"coreVersion\":\"{RECORDED_CORE_VERSION}\""),
            &format!("\"coreVersion\":\"{core}\""),
        )
        .replace(
            &format!("\"coreVersion\": \"{RECORDED_CORE_VERSION}\""),
            &format!("\"coreVersion\": \"{core}\""),
        )
        .replace(
            &format!("Core: {RECORDED_CORE_VERSION}"),
            &format!("Core: {core}"),
        )
    }

    /// Text that comes from the JavaScript or operating system runtime, not
    /// from Sigil: what the recording quotes that another runtime words
    /// differently. Keep this in step with `ENGINE_TEXT` of the generator.
    fn is_engine_text(text: &str) -> bool {
        [
            "in JSON at position",
            "Unexpected token",
            "Expected property name",
        ]
        .iter()
        .any(|marker| text.contains(marker))
    }

    /// Why `actual` differs from `expected`, or None. Only the message of a
    /// diagnostic whose recorded message is runtime text is not compared; the
    /// rest, including the diagnostic's code, file and range, is exact.
    fn engine_text_difference(actual: &str, expected: &str) -> Option<String> {
        match (
            serde_json::from_str::<Value>(actual),
            serde_json::from_str::<Value>(expected),
        ) {
            (Ok(actual), Ok(expected)) => json_difference("$", &actual, &expected),
            (Err(_), Err(_)) => text_difference(actual, expected),
            _ => Some("one side is JSON and the other is not".to_owned()),
        }
    }

    fn json_difference(path: &str, actual: &Value, expected: &Value) -> Option<String> {
        match (actual, expected) {
            (Value::Object(actual), Value::Object(expected)) => {
                if actual.keys().ne(expected.keys()) {
                    return Some(format!("{path} has other keys"));
                }
                expected.iter().find_map(|(key, want)| {
                    let have = &actual[key];
                    let runtime_message = key == "message"
                        && want.as_str().is_some_and(is_engine_text)
                        && have.is_string();
                    if runtime_message {
                        None
                    } else {
                        json_difference(&format!("{path}.{key}"), have, want)
                    }
                })
            }
            (Value::Array(actual), Value::Array(expected)) => {
                if actual.len() != expected.len() {
                    return Some(format!(
                        "{path} has {} items, not {}",
                        actual.len(),
                        expected.len()
                    ));
                }
                actual
                    .iter()
                    .zip(expected)
                    .enumerate()
                    .find_map(|(index, (have, want))| {
                        json_difference(&format!("{path}[{index}]"), have, want)
                    })
            }
            _ => (actual != expected).then(|| format!("{path} is {actual}, not {expected}")),
        }
    }

    /// Text compares line by line. A diagnostic line (`error`, `warning` or
    /// `info`) whose recorded message is runtime text is compared up to its
    /// first `: `, which holds the severity and code.
    fn text_difference(actual: &str, expected: &str) -> Option<String> {
        let (actual, expected): (Vec<&str>, Vec<&str>) =
            (actual.lines().collect(), expected.lines().collect());
        if actual.len() != expected.len() {
            return Some(format!("{} lines, not {}", actual.len(), expected.len()));
        }
        actual.iter().zip(&expected).find_map(|(have, want)| {
            let diagnostic = ["error ", "warning ", "info "]
                .iter()
                .any(|severity| want.starts_with(severity));
            let same = if diagnostic && is_engine_text(want) {
                have.split_once(": ").map(|(head, _)| head)
                    == want.split_once(": ").map(|(head, _)| head)
            } else {
                have == want
            };
            (!same).then(|| format!("line {have:?}, not {want:?}"))
        })
    }
}
