//! The path display rule. These unit tests run on every platform.
use sigil_cli::display::{Display, fmt_controlling_path, is_absolute, normalize, relative_from};
use std::path::Path;

fn display(cwd: &str, root: &str, explicit: Option<&str>, controlling: Option<&str>) -> Display {
    Display::new(Path::new(cwd), Path::new(root), explicit, controlling)
}

#[test]
fn a_relative_invocation_shows_the_root_as_dot() {
    let shown = display("/work/app", "/work/app", None, None);
    assert!(!shown.is_absolute());
    assert_eq!(shown.root(), ".");
    assert_eq!(shown.path(".sigil/config.json"), ".sigil/config.json");
    assert_eq!(shown.path("src/a.sigil"), "src/a.sigil");
    assert_eq!(shown.path("."), ".");
    assert_eq!(shown.path(""), ".");
}

#[test]
fn a_root_above_the_current_directory_is_shown_with_dot_dot() {
    let shown = display("/work/app/nested", "/work/app", None, Some("sub"));
    assert_eq!(shown.root(), "..");
    assert_eq!(shown.path(".sigil/config.json"), "../.sigil/config.json");
    let deeper = display("/work/app/a/b", "/work", None, None);
    assert_eq!(deeper.root(), "../../..");
    assert_eq!(deeper.path("x.sigil"), "../../../x.sigil");
}

#[test]
fn a_root_below_the_current_directory_is_shown_relative() {
    let shown = display("/work", "/work/app/sub", Some("app/sub"), None);
    assert_eq!(shown.root(), "app/sub");
    assert_eq!(shown.path("a.sigil"), "app/sub/a.sigil");
    assert_eq!(shown.path("."), "app/sub");
    let sibling = display("/work/one", "/work/two", None, Some("../two"));
    assert_eq!(sibling.root(), "../two");
}

#[test]
fn an_absolute_path_argument_keeps_absolute_paths() {
    let by_path = display("/work", "/work/app", None, Some("/work/app/x.sigil"));
    assert!(by_path.is_absolute());
    assert_eq!(by_path.root(), "/work/app");
    assert_eq!(
        by_path.path(".sigil/config.json"),
        "/work/app/.sigil/config.json"
    );
    assert_eq!(by_path.path("."), "/work/app");
}

#[test]
fn an_absolute_root_option_wins_over_a_relative_path_argument() {
    let shown = display("/work", "/elsewhere", Some("/elsewhere"), Some("rel"));
    assert!(shown.is_absolute());
    assert_eq!(shown.root(), "/elsewhere");
    // A relative root option makes it relative even when the path is absolute.
    let relative = display("/work", "/work/app", Some("app"), Some("/anything"));
    assert!(!relative.is_absolute());
    assert_eq!(relative.root(), "app");
}

#[test]
fn the_filesystem_root_joins_without_a_double_slash() {
    let shown = display("/work", "/", Some("/"), None);
    assert_eq!(shown.root(), "/");
    assert_eq!(shown.path("a.sigil"), "/a.sigil");
}

#[test]
fn an_absolute_path_is_never_rewritten() {
    let shown = display("/work", "/work", None, None);
    assert_eq!(shown.path("/other/a.sigil"), "/other/a.sigil");
}

#[test]
fn relative_from_climbs_and_descends() {
    assert_eq!(relative_from("/a/b", "/a/b"), ".");
    assert_eq!(relative_from("/a/b", "/a"), "..");
    assert_eq!(relative_from("/a/b", "/a/b/c/d"), "c/d");
    assert_eq!(relative_from("/a/b", "/a/c"), "../c");
    assert_eq!(relative_from("/a/b/c", "/x"), "../../../x");
    assert_eq!(relative_from("/", "/a"), "a");
}

#[test]
fn paths_on_another_drive_stay_absolute() {
    assert_eq!(relative_from("C:/work", "D:/other"), "D:/other");
    assert_eq!(relative_from("C:/work", "C:/work/app"), "app");
}

#[test]
fn absolute_means_a_slash_or_a_drive() {
    assert!(is_absolute("/a"));
    assert!(is_absolute("C:/a"));
    assert!(is_absolute("c:\\a"));
    assert!(!is_absolute("a/b"));
    assert!(!is_absolute("./a"));
    assert!(!is_absolute("C:a"));
    assert!(!is_absolute(""));
}

#[test]
fn normalize_uses_slashes_and_drops_the_trailing_one() {
    assert_eq!(normalize("a\\b\\"), "a/b");
    assert_eq!(normalize("/a/b/"), "/a/b");
    assert_eq!(normalize("/"), "/");
}

#[test]
fn fmt_is_controlled_by_the_first_absolute_path_else_the_first_path() {
    let paths = |items: &[&str]| items.iter().map(|s| (*s).to_owned()).collect::<Vec<_>>();
    assert_eq!(fmt_controlling_path(&paths(&[])), None);
    assert_eq!(fmt_controlling_path(&paths(&["a", "b"])), Some("a"));
    assert_eq!(fmt_controlling_path(&paths(&["a", "/b", "/c"])), Some("/b"));
    assert_eq!(fmt_controlling_path(&paths(&["/b", "a"])), Some("/b"));
}

#[cfg(unix)]
#[test]
fn targets_resolve_from_the_current_directory_with_dots_removed() {
    use sigil_cli::display::resolve_target;
    let cwd = Path::new("/work/app");
    assert_eq!(resolve_target(cwd, "."), Path::new("/work/app"));
    assert_eq!(resolve_target(cwd, "../x"), Path::new("/work/x"));
    assert_eq!(
        resolve_target(cwd, "a/./b/../c"),
        Path::new("/work/app/a/c")
    );
    assert_eq!(resolve_target(cwd, "/abs/../y"), Path::new("/y"));
    assert_eq!(resolve_target(cwd, "../../../.."), Path::new("/"));
}
