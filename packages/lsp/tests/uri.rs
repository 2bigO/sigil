use serde_json::Value;
use sigil_lsp::uri::{file_uri_to_path, path_to_file_uri};

#[test]
fn a_posix_uri_becomes_a_path() {
    assert_eq!(
        file_uri_to_path("file:///work/a.sigil").unwrap(),
        "/work/a.sigil"
    );
    assert_eq!(file_uri_to_path("file:///").unwrap(), "/");
}

#[test]
fn a_windows_drive_uri_drops_the_leading_slash() {
    assert_eq!(
        file_uri_to_path("file:///C:/work/a.sigil").unwrap(),
        "C:/work/a.sigil"
    );
    assert_eq!(
        file_uri_to_path("file:///c%3A/work/a.sigil").unwrap(),
        "c:/work/a.sigil"
    );
    assert_eq!(file_uri_to_path("file:///C:/").unwrap(), "C:/");
}

#[test]
fn a_unc_host_stays_in_the_path() {
    assert_eq!(
        file_uri_to_path("file://server/share/a.sigil").unwrap(),
        "//server/share/a.sigil"
    );
}

#[test]
fn localhost_is_an_empty_host_and_hosts_are_lowercased() {
    assert_eq!(
        file_uri_to_path("file://localhost/work/a.sigil").unwrap(),
        "/work/a.sigil"
    );
    assert_eq!(
        file_uri_to_path("file://LocalHost/work/a.sigil").unwrap(),
        "/work/a.sigil"
    );
    assert_eq!(
        file_uri_to_path("file://SERVER/share/a.sigil").unwrap(),
        "//server/share/a.sigil"
    );
}

#[test]
fn another_scheme_is_an_error_with_the_ts_text() {
    let error = file_uri_to_path("http://x/a.sigil").unwrap_err();
    assert_eq!(
        error.message(),
        "Only file URIs are supported: http://x/a.sigil"
    );
    assert_eq!(
        error.to_string(),
        "Only file URIs are supported: http://x/a.sigil"
    );
    assert!(file_uri_to_path("untitled:Untitled-1").is_err());
    assert!(file_uri_to_path("/work/a.sigil").is_err());
    assert!(file_uri_to_path("").is_err());
}

#[test]
fn the_scheme_is_case_insensitive() {
    assert_eq!(file_uri_to_path("FILE:///work/a").unwrap(), "/work/a");
}

#[test]
fn percent_escapes_are_decoded() {
    assert_eq!(
        file_uri_to_path("file:///work/a%20b%23c%25d%C3%A9.sigil").unwrap(),
        "/work/a b#c%dé.sigil"
    );
    assert_eq!(file_uri_to_path("file:///work/a%2fb").unwrap(), "/work/a/b");
}

#[test]
fn a_query_and_fragment_are_not_part_of_the_path() {
    assert_eq!(
        file_uri_to_path("file:///work/a.sigil#frag").unwrap(),
        "/work/a.sigil"
    );
    assert_eq!(
        file_uri_to_path("file:///work/a.sigil?q=1").unwrap(),
        "/work/a.sigil"
    );
}

#[test]
fn invalid_utf8_or_broken_escapes_do_not_panic() {
    assert!(file_uri_to_path("file:///work/%FF.sigil").is_err());
    assert!(file_uri_to_path("file:///work/%ZZ.sigil").is_err());
    assert!(file_uri_to_path("file:///work/%4").is_err());
}

#[test]
fn the_decoded_path_is_normalized() {
    assert_eq!(
        file_uri_to_path("file:///work/./x/../a.sigil").unwrap(),
        "/work/a.sigil"
    );
    assert_eq!(
        file_uri_to_path("file:///work//a.sigil").unwrap(),
        "/work/a.sigil"
    );
}

#[test]
fn a_posix_path_becomes_a_uri() {
    assert_eq!(path_to_file_uri("/work/a.sigil"), "file:///work/a.sigil");
    assert_eq!(path_to_file_uri("/"), "file:///");
}

#[test]
fn a_windows_drive_path_becomes_a_uri() {
    assert_eq!(
        path_to_file_uri("C:/work/a.sigil"),
        "file:///C:/work/a.sigil"
    );
    assert_eq!(
        path_to_file_uri("C:\\work\\a.sigil"),
        "file:///C:/work/a.sigil"
    );
}

#[test]
fn reserved_and_unicode_text_is_percent_encoded() {
    assert_eq!(
        path_to_file_uri("/w/a b#c%d?e\"f<g>h`i{j}k.sigil"),
        "file:///w/a%20b%23c%25d%3Fe%22f%3Cg%3Eh%60i%7Bj%7Dk.sigil"
    );
    assert_eq!(
        path_to_file_uri("/w/é\u{4e2d}\u{1f600}"),
        "file:///w/%C3%A9%E4%B8%AD%F0%9F%98%80"
    );
    assert_eq!(path_to_file_uri("/w/a\tb\nc"), "file:///w/a%09b%0Ac");
}

#[test]
fn harmless_punctuation_stays_literal() {
    assert_eq!(
        path_to_file_uri("/w/(a)+b,c;d=e@f:g!h$i&j'k*l~m-n_o.sigil"),
        "file:///w/(a)+b,c;d=e@f:g!h$i&j'k*l~m-n_o.sigil"
    );
}

#[test]
fn a_unc_path_keeps_its_host() {
    assert_eq!(
        path_to_file_uri("//server/share/a.sigil"),
        "file://server/share/a.sigil"
    );
}

#[test]
fn paths_round_trip() {
    for path in [
        "/work/a.sigil",
        "/w/a b.sigil",
        "/w/a#b.sigil",
        "/w/100%.sigil",
        "/w/%41.sigil",
        "/w/é\u{4e2d}\u{1f600}.sigil",
        "/w/a?b\"c<d>e`f{g}h.sigil",
        "C:/work/a b/é.sigil",
        "//server/share/a b.sigil",
    ] {
        assert_eq!(
            file_uri_to_path(&path_to_file_uri(path)).unwrap(),
            path,
            "{path}"
        );
    }
}

#[test]
fn the_crate_version_equals_the_deno_version() {
    let manifest = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("deno.json");
    let text = std::fs::read_to_string(manifest).unwrap();
    let json: Value = serde_json::from_str(&text).unwrap();
    assert_eq!(json["version"], env!("CARGO_PKG_VERSION"));
}
