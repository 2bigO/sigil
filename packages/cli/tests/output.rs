//! The shared output helpers: JSON, `--quiet`, and the markdown builder.
use serde::Serialize;
use sigil_cli::{
    args::{Format, Global},
    display::Display,
    model::{self, diagnostic_line, exit_code},
    output::{Markdown, json_string, render},
};
use sigil_core::{
    language::diagnostics::{Location, diagnostic},
    types::{Range, Severity},
};
use std::path::Path;

#[derive(Serialize)]
struct Sample {
    command: &'static str,
    list: Vec<u8>,
}

fn sample() -> Sample {
    Sample {
        command: "sample",
        list: vec![1, 2],
    }
}

fn global(format: Option<Format>, pretty: bool, quiet: bool) -> Global {
    Global {
        root: None,
        format,
        pretty,
        quiet,
    }
}

#[test]
fn json_is_compact_with_a_newline_or_indented_by_two_spaces() {
    assert_eq!(
        json_string(&sample(), false).unwrap(),
        "{\"command\":\"sample\",\"list\":[1,2]}\n"
    );
    assert_eq!(
        json_string(&sample(), true).unwrap(),
        "{\n  \"command\": \"sample\",\n  \"list\": [\n    1,\n    2\n  ]\n}\n"
    );
}

#[test]
fn render_picks_the_format_and_the_default() {
    let run = |g: Global| {
        render(
            &g,
            Format::Text,
            1,
            &sample(),
            || "text\n".into(),
            || "md\n".into(),
        )
    };
    assert_eq!(run(global(None, false, false)), Ok((1, "text\n".into())));
    assert_eq!(
        run(global(Some(Format::Markdown), false, false)),
        Ok((1, "md\n".into()))
    );
    assert_eq!(
        run(global(Some(Format::Json), false, false)),
        Ok((1, "{\"command\":\"sample\",\"list\":[1,2]}\n".into()))
    );
}

#[test]
fn quiet_prints_nothing_in_every_format_and_keeps_the_exit_status() {
    for format in [
        None,
        Some(Format::Json),
        Some(Format::Text),
        Some(Format::Markdown),
    ] {
        let out = render(
            &global(format, true, true),
            Format::Json,
            1,
            &sample(),
            || "text\n".into(),
            || "md\n".into(),
        );
        assert_eq!(out, Ok((1, String::new())));
    }
}

#[test]
fn the_renderers_run_only_when_chosen() {
    let out = render(
        &global(Some(Format::Json), false, false),
        Format::Text,
        0,
        &sample(),
        || panic!("text is not chosen"),
        || panic!("markdown is not chosen"),
    );
    assert!(out.is_ok());
}

fn view_of(
    severity: Severity,
    code: &str,
    message: &str,
    at: Option<(&str, usize)>,
) -> model::DiagnosticView {
    let mut raw = diagnostic(
        code,
        message,
        match at {
            Some((path, start)) => Location::at(
                path,
                Some(Range {
                    start,
                    end: start + 1,
                }),
            ),
            None => Location::default(),
        },
    );
    raw.severity = severity;
    let display = Display::new(Path::new("/w"), Path::new("/w"), None, None);
    model::view(&raw, &display, None)
}

#[test]
fn a_diagnostic_line_is_severity_code_and_message() {
    let item = view_of(
        Severity::Warning,
        "SIGIL_UNTAGGED_FACET",
        "No tag.",
        Some(("a.sigil", 3)),
    );
    assert_eq!(
        diagnostic_line(&item, false),
        "warning SIGIL_UNTAGGED_FACET: No tag."
    );
    assert_eq!(
        diagnostic_line(&item, true),
        "warning SIGIL_UNTAGGED_FACET a.sigil: No tag."
    );
    let mut located = item.clone();
    located.source_location = Some(model::LocationView { line: 2, column: 5 });
    assert_eq!(
        diagnostic_line(&located, true),
        "warning SIGIL_UNTAGGED_FACET a.sigil:2:5: No tag."
    );
    let bare = view_of(Severity::Error, "SIGIL_X", "Bad.", None);
    assert_eq!(diagnostic_line(&bare, true), "error SIGIL_X: Bad.");
}

#[test]
fn counts_and_exit_code_follow_severity() {
    let items = vec![
        view_of(Severity::Warning, "A", "a", None),
        view_of(Severity::Info, "B", "b", None),
        view_of(Severity::Warning, "C", "c", None),
    ];
    let counts = model::counts(&items);
    assert_eq!((counts.error, counts.warning, counts.info), (0, 2, 1));
    assert_eq!(exit_code(&items), 0);
    let mut with_error = items;
    with_error.push(view_of(Severity::Error, "D", "d", None));
    assert_eq!(model::counts(&with_error).error, 1);
    assert_eq!(exit_code(&with_error), 1);
    assert_eq!(exit_code(&[]), 0);
}

#[test]
fn a_diagnostic_serializes_with_the_recorded_key_order() {
    let item = view_of(Severity::Error, "SIGIL_X", "Bad.", Some(("a.sigil", 3)));
    assert_eq!(
        serde_json::to_string(&item).unwrap(),
        "{\"code\":\"SIGIL_X\",\"stage\":\"parsing\",\"severity\":\"error\",\"message\":\"Bad.\",\"filePath\":\"a.sigil\",\"range\":{\"start\":3,\"end\":4},\"related\":[]}"
    );
    let bare = view_of(Severity::Info, "SIGIL_X", "Bad.", None);
    assert_eq!(
        serde_json::to_string(&bare).unwrap(),
        "{\"code\":\"SIGIL_X\",\"stage\":\"parsing\",\"severity\":\"info\",\"message\":\"Bad.\",\"related\":[]}"
    );
    let mut located = item;
    located.source_location = Some(model::LocationView { line: 1, column: 4 });
    assert!(
        serde_json::to_string(&located)
            .unwrap()
            .ends_with(",\"related\":[],\"sourceLocation\":{\"line\":1,\"column\":4}}")
    );
}

#[test]
fn markdown_is_a_heading_facts_and_a_list() {
    let items = vec![
        view_of(
            Severity::Error,
            "SIGIL_X",
            "First line.\nSecond line.",
            None,
        ),
        view_of(Severity::Warning, "SIGIL_Y", "Other.", None),
    ];
    let text = Markdown::new("Sigil check")
        .facts(&[("Workspace root", ".".into()), ("Errors", "1".into())])
        .diagnostics(&items, false)
        .finish();
    assert_eq!(
        text,
        "# Sigil check\n\n- Workspace root: .\n- Errors: 1\n\n## Diagnostics\n\n- error SIGIL_X: First line.\n  Second line.\n- warning SIGIL_Y: Other.\n"
    );
    let none = Markdown::new("T").diagnostics(&[], false).finish();
    assert_eq!(none, "# T\n\n## Diagnostics\n\nNone.\n");
}
