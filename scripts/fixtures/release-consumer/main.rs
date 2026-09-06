//! Source-independent release smoke harness.
//!
//! The build workflow compiles this file on the matching target runner and
//! uploads only the resulting executable, the tested archive, and the small
//! fixture directory. The consumer job does not check out the repository or
//! invoke Deno, Node, npm, Cargo, or a compiler from the host PATH.

use std::env;
use std::ffi::{OsStr, OsString};
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};
use std::time::{SystemTime, UNIX_EPOCH};

struct RemoveOnDrop(PathBuf);

impl Drop for RemoveOnDrop {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn main() {
    if let Err(error) = run() {
        eprintln!("release artifact consumer failed: {error}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), String> {
    let arguments: Vec<String> = env::args().collect();
    let distribution = required_argument(&arguments, "--distribution")?;
    let fixture = required_argument(&arguments, "--fixture")?;
    let distribution = PathBuf::from(distribution);
    let fixture = PathBuf::from(fixture);
    let executable_name = if cfg!(windows) { "sigil.exe" } else { "sigil" };
    let cli = distribution.join("bin").join(executable_name);
    if !cli.is_file() {
        return Err(format!("archive is missing {}", cli.display()));
    }

    let scratch = unique_temp_dir("sigil-artifact-consumer")?;
    fs::create_dir_all(&scratch).map_err(io_error)?;
    let _cleanup = RemoveOnDrop(scratch.clone());
    let unrelated = scratch.join("unrelated working directory");
    let home = scratch.join("empty home");
    let cache = scratch.join("empty cache");
    let shims = scratch.join("hostile shims");
    let target = scratch.join("fixture project");
    let marker = shims.join("unexpected-invocation.log");
    for path in [&unrelated, &home, &cache, &shims, &target] {
        fs::create_dir_all(path).map_err(io_error)?;
    }
    install_hostile_shims(&shims, &marker)?;
    install_fixture(&fixture, &target)?;

    let path = isolated_path(&shims);
    let environment = isolated_environment(&path, &home, &cache);

    let version = run_cli(&cli, &["--version"], &unrelated, &environment)?;
    if !version.status.success() {
        return Err(format!(
            "version failed with {}: {}",
            exit_code(&version),
            output_text(&version)
        ));
    }
    let version_output = stdout_text(&version);
    let version_text = version_output.trim();
    if !is_semver(version_text) {
        return Err(format!("version returned invalid text: {version_text:?}"));
    }

    let doctor = run_cli(
        &cli,
        &["doctor", "--format", "json"],
        &unrelated,
        &environment,
    )?;
    if !doctor.status.success() {
        return Err(format!(
            "doctor failed with {}: {}",
            exit_code(&doctor),
            output_text(&doctor)
        ));
    }
    if !compact(&stdout_text(&doctor)).contains("\"ok\":true") {
        return Err(format!(
            "doctor did not report ok=true: {}",
            stdout_text(&doctor)
        ));
    }

    let target_text = path_string(&target);
    let semantic = run_cli(
        &cli,
        &["semantic", "status", &target_text, "--format", "json"],
        &unrelated,
        &environment,
    )?;
    if semantic.status.code() != Some(1) {
        return Err(format!(
            "semantic fixture returned {}, expected 1: {}",
            exit_code(&semantic),
            output_text(&semantic)
        ));
    }
    if !compact(&stdout_text(&semantic)).contains("\"status\":\"yellow\"") {
        return Err(format!(
            "semantic fixture did not report yellow: {}",
            stdout_text(&semantic)
        ));
    }

    if marker.is_file() {
        let invocations = fs::read_to_string(&marker).map_err(io_error)?;
        if !invocations.trim().is_empty() {
            return Err(format!(
                "packaged CLI invoked forbidden host tools: {invocations}"
            ));
        }
    }
    println!(
        "{{\"artifactConsumer\":true,\"version\":\"{version_text}\",\"doctor\":true,\"semantic\":\"yellow\",\"hostToolsInvoked\":false}}"
    );
    Ok(())
}

fn required_argument(arguments: &[String], name: &str) -> Result<String, String> {
    let index = arguments
        .iter()
        .position(|argument| argument == name)
        .ok_or_else(|| format!("missing {name}"))?;
    arguments
        .get(index + 1)
        .cloned()
        .ok_or_else(|| format!("missing value for {name}"))
}

fn unique_temp_dir(prefix: &str) -> Result<PathBuf, String> {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_nanos();
    Ok(env::temp_dir().join(format!("{prefix}-{}-{nanos}", std::process::id())))
}

fn install_fixture(source: &Path, target: &Path) -> Result<(), String> {
    let sigil = target.join(".sigil");
    fs::create_dir_all(&sigil).map_err(io_error)?;
    fs::copy(source.join("main.sigil"), target.join("main.sigil")).map_err(io_error)?;
    fs::copy(
        source.join("fixture-config.json"),
        sigil.join("config.json"),
    )
    .map_err(io_error)?;
    Ok(())
}

fn install_hostile_shims(shims: &Path, marker: &Path) -> Result<(), String> {
    for name in [
        "deno", "node", "npm", "npx", "cargo", "rustc", "tsc", "tsgo",
    ] {
        let filename = if cfg!(windows) {
            format!("{name}.cmd")
        } else {
            name.to_owned()
        };
        let path = shims.join(filename);
        let script = if cfg!(windows) {
            format!(
                "@echo off\necho {name}>>\"{}\"\nexit /b 97\n",
                marker.display()
            )
        } else {
            format!(
                "#!/bin/sh\nprintf '%s\\n' '{name}' >> {}\nexit 97\n",
                shell_quote(marker)
            )
        };
        fs::write(&path, script).map_err(io_error)?;
        make_executable(&path)?;
    }
    Ok(())
}

fn make_executable(path: &Path) -> Result<(), String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut permissions = fs::metadata(path).map_err(io_error)?.permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(path, permissions).map_err(io_error)?;
    }
    Ok(())
}

fn isolated_path(shims: &Path) -> OsString {
    if cfg!(windows) {
        let system_root =
            env::var_os("SystemRoot").unwrap_or_else(|| OsString::from(r"C:\Windows"));
        let system32 = PathBuf::from(&system_root).join("System32");
        let mut value = shims.as_os_str().to_os_string();
        value.push(";");
        value.push(system32);
        value.push(";");
        value.push(&system_root);
        value
    } else {
        let mut value = shims.as_os_str().to_os_string();
        value.push(":/usr/local/bin:/usr/bin:/bin");
        value
    }
}

fn isolated_environment(path: &OsStr, home: &Path, cache: &Path) -> Vec<(OsString, OsString)> {
    let mut values = vec![
        (OsString::from("PATH"), path.to_os_string()),
        (OsString::from("HOME"), home.as_os_str().to_os_string()),
        (
            OsString::from("USERPROFILE"),
            home.as_os_str().to_os_string(),
        ),
        (OsString::from("DENO_DIR"), cache.as_os_str().to_os_string()),
        (OsString::from("TMPDIR"), cache.as_os_str().to_os_string()),
        (OsString::from("TEMP"), cache.as_os_str().to_os_string()),
        (OsString::from("TMP"), cache.as_os_str().to_os_string()),
    ];
    if cfg!(windows) {
        for name in ["SystemRoot", "WINDIR", "ComSpec"] {
            if let Some(value) = env::var_os(name) {
                values.push((OsString::from(name), value));
            }
        }
    }
    values
}

fn run_cli(
    cli: &Path,
    arguments: &[&str],
    cwd: &Path,
    environment: &[(OsString, OsString)],
) -> Result<Output, String> {
    let mut command = Command::new(cli);
    command
        .args(arguments)
        .current_dir(cwd)
        .env_clear()
        .envs(environment.iter().map(|(key, value)| (key, value)));
    command.output().map_err(io_error)
}

fn stdout_text(output: &Output) -> String {
    String::from_utf8_lossy(&output.stdout).into_owned()
}

fn output_text(output: &Output) -> String {
    let stdout = stdout_text(output);
    let stderr = String::from_utf8_lossy(&output.stderr);
    if stderr.trim().is_empty() {
        stdout
    } else {
        format!("{stdout}{stderr}")
    }
}

fn exit_code(output: &Output) -> String {
    output
        .status
        .code()
        .map(|code| code.to_string())
        .unwrap_or_else(|| "signal".to_owned())
}

fn compact(value: &str) -> String {
    value
        .chars()
        .filter(|character| !character.is_whitespace())
        .collect()
}

fn is_semver(value: &str) -> bool {
    let mut parts = value.split('.');
    parts.next().is_some_and(|part| {
        !part.is_empty() && part.chars().all(|character| character.is_ascii_digit())
    }) && parts.next().is_some_and(|part| {
        !part.is_empty() && part.chars().all(|character| character.is_ascii_digit())
    }) && parts.next().is_some_and(|part| {
        !part.is_empty() && part.chars().all(|character| character.is_ascii_digit())
    }) && parts.next().is_none()
}

fn path_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

fn shell_quote(path: &Path) -> String {
    format!("'{}'", path.to_string_lossy().replace('\'', "'\\''"))
}

fn io_error(error: io::Error) -> String {
    error.to_string()
}
