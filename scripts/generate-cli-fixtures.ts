/**
 * Writes `packages/cli/tests/fixtures/cli-parity.json`, the recorded behavior
 * of the TS `sigil` command line that the Rust CLI tests replay.
 *
 * Each case is a small workspace written to a fresh temp directory, one
 * argument list and a working directory inside that workspace. The script runs
 * the TS CLI (`packages/cli/src/main.ts`) as a subprocess with that working
 * directory, because the TS path display reads the process directory, and
 * records its exit status, standard output, standard error and the files that
 * exist afterwards. The temp directory is replaced by the literal `<ROOT>` in
 * everything recorded, and an `argv` entry may name `<ROOT>` to mean the
 * workspace directory.
 *
 * Only the commands the Rust CLI keeps are recorded: `init`, `version`,
 * `parse`, `check`, `fmt` and `glossary`. Left out on purpose: the root help,
 * a missing or unknown command, errors about options that belong only to a
 * removed command (`graph`, `context`, `retrieve`, `render`), markdown output,
 * the raw `parse` document, and anything that needs the implementation
 * annotation scan.
 *
 * Case flags: `fieldsOnly` marks `version` output that the Rust replay compares
 * field by field (the Rust core version differs from the TS one on purpose);
 * `statusOnly` marks `parse` output that is recorded as an exit status alone;
 * `engineText` marks output that quotes a Deno or V8 message (an operating
 * system error, a JSON parser error) that another runtime cannot reproduce.
 *
 * Run it after a change to the TS CLI or to this case list
 * (`deno task generate:cli-fixtures`) and commit the result. A stale fixture
 * is a silent drift risk, so the Rust replay never needs Deno.
 */

const root = new URL("..", import.meta.url).pathname;
const OUTPUT = `${root}packages/cli/tests/fixtures/cli-parity.json`;
const CLI_ENTRY = `${root}packages/cli/src/main.ts`;
const CONFIG_FILE = `${root}deno.json`;
const SIGIL_VERSION = "0.9.0";
const PLACEHOLDER = "<ROOT>";

type Files = Record<string, string>;
type Command = "init" | "version" | "parse" | "check" | "fmt" | "glossary";

interface Case {
  name: string;
  command: Command;
  /** Files of the temp workspace, by path relative to `<ROOT>`. */
  files: Files;
  /** Directories that exist beforehand and hold no file. */
  dirs?: string[];
  argv: string[];
  /** Working directory, relative to `<ROOT>`. */
  cwd?: string;
  fieldsOnly?: true;
  statusOnly?: true;
}

// ---------------------------------------------------------------------------
// Sources

const config = (name: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    sigilVersion: SIGIL_VERSION,
    workspace: { name, members: [] },
    files: { include: ["**/*.sigil"] },
    tools: {},
    ...extra,
  });

/** A workspace configured at `<ROOT>/<prefix>`, plus the given files. */
function workspace(
  name: string,
  files: Files = {},
  prefix = "",
  extra: Record<string, unknown> = {},
): Files {
  const out: Files = { [`${prefix}.sigil/config.json`]: config(name, extra) };
  for (const [path, text] of Object.entries(files)) {
    out[`${prefix}${path}`] = text;
  }
  return out;
}

const valid = (name: string) =>
  `component ${name} {\n  goal {\n    Test ${name}.\n  }\n\n  interface {\n    run()\n  }\n}\n`;

const noncanonical = (name: string) =>
  valid(name).replace(
    `Test ${name}.`,
    "These words need wrapping. ".repeat(5).trim(),
  );

const broken = "component Broken {\n  mystery {\n    bad\n  }\n}\n";

/** A parent workspace that does not exclude the workspace nested in `child/`. */
const nestedWorkspaces = (): Files => ({
  ...workspace("parent", { "p.sigil": valid("Parent") }),
  ...workspace("child", { "c.sigil": valid("Kid") }, "child/"),
});

const longGoal = `component Example {
  goal {
    This prose is intentionally long enough that deterministic formatting must wrap it while excluding structural indentation from its width calculation.
  }

  interface {
    Read {
      read()
    }
  }
}
`;

const component = (name: string, prose: string) =>
  `component ${name} {\ngoal {\nOwn a responsibility.\n}\ninterface {\n${prose}\n}\n}\n`;

/** The two sources of the core `design-input-080` fixture, as the TS tests use. */
const designInput = JSON.parse(
  await Deno.readTextFile(
    `${root}packages/core/tests/fixtures/design-input-080.json`,
  ),
) as { sources: { path: string; text: string }[] };
const providerSources: Files = Object.fromEntries(
  designInput.sources.map((source) => [source.path, source.text]),
);
const providerWorkspace = (prefix = ""): Files =>
  workspace("provider-context", providerSources, prefix);

const collisionSources = (): Files => {
  const consumer = providerSources["consumer.sigil"];
  const out: Files = {};
  for (const path of ["consumer.sigil", "_module.sigil"]) {
    out[path] = consumer.replace(
      "component Consumer",
      path === "consumer.sigil" ? "component Consumer" : "component Module",
    ).replace("interface {", "interface {\nresult {\nA local collision.\n}\n");
  }
  return out;
};

const untaggedFacets = `component Feature {
  goal {
    Keep the current record available.
  }

  state {
    Track the current record.
  }

  logic {
    Calculate the next record.
  }

  constraints {
    Preserve record consistency.
  }

  cases {
    Handle an unavailable record.
  }

  interface {
    Record {
      read() returns the stored value.
    }

    Operations complete synchronously.
  }

  decisions {
    Prefer the current record.
  }
}
`;

const ungroupedInterface = `component Feature {
  goal {
    Test each *feature run*.
  }

  interface {
    run() starts a feature run.
  }
}
`;

const mixedInterface = `component Feature {
  goal {
    Read and update each *Record*.
  }

  interface {
    Record is a stored value.

    Reading {
      read() returns Record.
    }

    Writing {
      write(Record) updates the stored value.
    }

    Operations on a Record complete synchronously.
  }
}
`;

const boundaryProvider = `component Provider {
  goal {
    Own a provider.
  }

  state {
    A *private state* exists.
  }

  interface {
    Provide the provider.
  }
}
`;

const boundaryConsumer = `@provider.sigil from Provider import { private state }

component Consumer {
  goal {
    Use private state.
  }

  interface {
    Use private state.
  }
}
`;

const glossaryJson = JSON.stringify(
  {
    schemaVersion: 1,
    terms: [{
      term: "workspace root",
      definition: "The configured workspace directory.",
    }],
    contexts: [{
      id: "booking",
      include: ["booking/**/*.sigil"],
      exclude: [],
      terms: [{
        term: "hold",
        definition: "Booking capacity before confirmation.",
        aliases: ["temporary reservation"],
      }],
    }],
  },
  null,
  2,
);

const bookingSource = `component Booking {
  goal {
    Use the workspace root for each temporary reservation.
  }

  interface {
    Hold {
      A hold is visible.
    }
  }
}
`;

const existingGlossary = JSON.stringify(
  {
    schemaVersion: 1,
    terms: [{ term: "project term", definition: "Project vocabulary." }],
    contexts: [],
  },
  null,
  2,
);

// ---------------------------------------------------------------------------
// Cases

const cases: Case[] = [];
const add = (
  command: Command,
  name: string,
  argv: string[],
  files: Files = {},
  options: Partial<Pick<Case, "cwd" | "dirs" | "fieldsOnly" | "statusOnly">> =
    {},
) => {
  cases.push({ name: `${command}-${name}`, command, files, argv, ...options });
};
const R = PLACEHOLDER;

// --- version ---------------------------------------------------------------
{
  const files = providerWorkspace();
  const fields = { fieldsOnly: true } as const;
  add("version", "json", ["version", R, "--format", "json"], files, fields);
  add("version", "text", ["version", R], files, fields);
  add("version", "text-explicit", ["version", R, "--format", "text"], files, {
    ...fields,
  });
  add(
    "version",
    "json-pretty",
    [
      "version",
      R,
      "--format",
      "json",
      "--pretty",
    ],
    files,
    fields,
  );
  add("version", "quiet", ["version", R, "--quiet"], files, fields);
  add("version", "cwd-json", ["version", "--format", "json"], files, fields);
  add("version", "cwd-text", ["version"], files, fields);
  add("version", "nested-cwd-text", ["version"], {
    ...files,
    "nested/placeholder.txt": "",
  }, { ...fields, cwd: "nested" });
  add("version", "relative-path", ["version", "sub", "--format", "json"], {
    ...providerWorkspace("sub/"),
  }, fields);
  add(
    "version",
    "root-flag-absolute",
    [
      "version",
      "--root",
      R,
      "--format",
      "json",
    ],
    { ...files, "nested/placeholder.txt": "" },
    { ...fields, cwd: "nested" },
  );
  add(
    "version",
    "root-flag-relative",
    [
      "version",
      "--root",
      "..",
      "--format",
      "json",
    ],
    { ...files, "nested/placeholder.txt": "" },
    { ...fields, cwd: "nested" },
  );
  add(
    "version",
    "config-not-found-json",
    [
      "version",
      R,
      "--format",
      "json",
    ],
    {},
    fields,
  );
  add("version", "config-not-found-text", ["version", R], {}, fields);
  add("version", "invalid-config-json", ["version", R, "--format", "json"], {
    ".sigil/config.json": "{",
  }, fields);
  add("version", "invalid-config-text", ["version", R], {
    ".sigil/config.json": "{",
  }, fields);
  const brokenSource = workspace("version-broken", { "broken.sigil": broken });
  add(
    "version",
    "broken-source-json",
    [
      "version",
      R,
      "--format",
      "json",
    ],
    brokenSource,
    fields,
  );
  add("version", "broken-source-text", ["version", R], brokenSource, fields);
  const brokenSources = workspace("version-broken-many", {
    "a-unclosed.sigil": "component Open {\n  goal {\n    x\n  }\n",
    "b-wide.sigil": longGoal.replace(
      "interface {\n    Read {",
      "interface {\n    Read {\n      " + "word ".repeat(40) + "\n",
    ),
    "c-structure.sigil": "component Plain {\n  goal {\n    Do it.\n  }\n}\n",
    "d-import.sigil": `@missing.sigil from Gone import { thing }\n\n${
      valid("Importer")
    }`,
  });
  add(
    "version",
    "broken-sources-json",
    [
      "version",
      R,
      "--format",
      "json",
    ],
    brokenSources,
    fields,
  );
  add("version", "broken-sources-text", ["version", R], brokenSources, fields);
  const nestedFiles = nestedWorkspaces();
  add(
    "version",
    "nested-workspace-parent-text",
    ["version"],
    nestedFiles,
    fields,
  );
  add(
    "version",
    "nested-workspace-parent-json",
    [
      "version",
      "--format",
      "json",
    ],
    nestedFiles,
    fields,
  );
  add("version", "nested-workspace-child-text", ["version"], nestedFiles, {
    ...fields,
    cwd: "child",
  });
  add(
    "version",
    "nested-workspace-child-json",
    [
      "version",
      "--format",
      "json",
    ],
    nestedFiles,
    { ...fields, cwd: "child" },
  );
  add("version", "runtime-non-sigil-file", ["version", "notes.txt"], {
    ...workspace("version-file"),
    "notes.txt": "plain text\n",
  }, fields);
  add("version", "flag", ["--version"]);
  add("version", "help", ["version", "--help"]);
  add("version", "help-after-bad-option", ["version", "--bogus", "--help"]);
  add("version", "usage-two-paths", ["version", "first", "second"]);
  add("version", "usage-unsupported-option", ["version", "--bogus"]);
  add("version", "usage-root-without-value", ["version", "--root"]);
  add("version", "usage-root-value-is-flag", ["version", "--root", "--pretty"]);
  add("version", "usage-format-invalid", ["version", "--format", "yaml"]);
  add("version", "usage-format-without-value", ["version", "--format"]);
  add("version", "usage-check-outside-fmt", ["version", "--check"]);
  add("version", "usage-show-locations-outside-check", [
    "version",
    "--show-locations",
  ]);
  add("version", "usage-init-options", ["version", "--name", "example"]);
  add("version", "usage-include-option", [
    "version",
    "--include",
    "**/*.sigil",
  ]);
}

// --- parse -----------------------------------------------------------------
{
  const files = providerWorkspace();
  const status = { statusOnly: true } as const;
  add("parse", "valid-file", ["parse", `${R}/consumer.sigil`], files, status);
  add(
    "parse",
    "valid-file-json",
    [
      "parse",
      `${R}/consumer.sigil`,
      "--format",
      "json",
    ],
    files,
    status,
  );
  add("parse", "valid-relative-from-cwd", ["parse", "consumer.sigil"], files, {
    ...status,
  });
  add(
    "parse",
    "valid-with-root",
    [
      "parse",
      "../consumer.sigil",
      "--root",
      R,
    ],
    { ...files, "nested/placeholder.txt": "" },
    { ...status, cwd: "nested" },
  );
  add(
    "parse",
    "valid-quiet",
    [
      "parse",
      `${R}/consumer.sigil`,
      "--quiet",
    ],
    files,
    status,
  );
  add("parse", "source-with-errors", ["parse", `${R}/broken.sigil`], {
    ...workspace("parse-errors"),
    "broken.sigil": broken,
  }, status);
  add("parse", "config-failure", [
    "parse",
    `${R}/item.sigil`,
    "--format",
    "json",
  ], { ".sigil/config.json": "{", "item.sigil": valid("Item") });
  add("parse", "config-failure-quiet", [
    "parse",
    `${R}/item.sigil`,
    "--quiet",
  ], { ".sigil/config.json": "{", "item.sigil": valid("Item") });
  add("parse", "config-not-found", [
    "parse",
    `${R}/item.sigil`,
    "--format",
    "json",
  ], { "item.sigil": valid("Item") });
  add("parse", "missing-file", ["parse", `${R}/does-not-exist.sigil`], {
    ...workspace("missing-file"),
  });
  add("parse", "missing-file-relative", ["parse", "does-not-exist.sigil"], {
    ...workspace("missing-file"),
  });
  {
    // A file that is not a `.sigil` source cannot start the workspace search:
    // looking for `<file>/.sigil/config.json` fails with the system's error.
    const notes = {
      ...workspace("non-sigil"),
      "notes.txt": "plain text\n",
      "sub/inner.txt": "plain text\n",
    };
    add("parse", "non-sigil-file", ["parse", "notes.txt"], notes);
    add("parse", "non-sigil-file-absolute-json", [
      "parse",
      `${R}/notes.txt`,
      "--format",
      "json",
    ], notes);
    // With an explicit root no search starts at the file, so it parses.
    add(
      "parse",
      "non-sigil-file-with-root",
      [
        "parse",
        "notes.txt",
        "--root",
        R,
      ],
      notes,
      { statusOnly: true },
    );
    add("parse", "directory-target", ["parse", "sub"], notes);
  }
  {
    const nestedFiles = nestedWorkspaces();
    add(
      "parse",
      "nested-workspace-parent-file",
      ["parse", "p.sigil"],
      nestedFiles,
      status,
    );
    add("parse", "nested-workspace-child-file-from-parent", [
      "parse",
      "child/c.sigil",
    ], nestedFiles);
    add(
      "parse",
      "nested-workspace-child-file-default",
      ["parse", "c.sigil"],
      nestedFiles,
      { cwd: "child" },
    );
    add(
      "parse",
      "nested-workspace-child-file-json",
      [
        "parse",
        "c.sigil",
        "--format",
        "json",
      ],
      nestedFiles,
      { cwd: "child" },
    );
  }
  add("parse", "help", ["parse", "--help"]);
  add("parse", "usage-no-file", ["parse"]);
  add("parse", "usage-two-files", ["parse", "first.sigil", "second.sigil"]);
  add("parse", "usage-unsupported-option", ["parse", "item.sigil", "--bogus"]);
  add("parse", "usage-root-without-value", ["parse", "item.sigil", "--root"]);
  add("parse", "usage-format-invalid", [
    "parse",
    "item.sigil",
    "--format",
    "yaml",
  ]);
  add("parse", "usage-check-outside-fmt", ["parse", "item.sigil", "--check"]);
  add("parse", "usage-show-locations-outside-check", [
    "parse",
    "item.sigil",
    "--show-locations",
  ]);
  add("parse", "usage-init-options", [
    "parse",
    "item.sigil",
    "--name",
    "example",
  ]);
}

// --- check -----------------------------------------------------------------
{
  const provider = providerWorkspace();
  const empty = workspace("diagnostics");
  const brokenWorkspace = {
    ...workspace("show-locations"),
    "broken.sigil": broken,
  };
  const untagged = {
    ...workspace("untagged-facets"),
    "contract.sigil": untaggedFacets,
  };
  add("check", "valid-json", ["check", R, "--format", "json"], provider);
  add("check", "valid-text", ["check", R], provider);
  add("check", "valid-json-pretty", [
    "check",
    R,
    "--format",
    "json",
    "--pretty",
  ], provider);
  add("check", "valid-quiet", ["check", R, "--quiet"], provider);
  add("check", "empty-workspace-json", ["check", R, "--format", "json"], empty);
  add("check", "empty-workspace-text", ["check", R], empty);
  add("check", "cwd-json", ["check", "--format", "json"], provider);
  add("check", "cwd-text", ["check"], provider);
  add("check", "nested-cwd-json", ["check", "--format", "json"], {
    ...provider,
    "nested/placeholder.txt": "",
  }, { cwd: "nested" });
  add("check", "nested-cwd-text", ["check"], {
    ...provider,
    "nested/placeholder.txt": "",
  }, { cwd: "nested" });
  add("check", "nested-cwd-path-up", ["check", "..", "--format", "json"], {
    ...provider,
    "nested/placeholder.txt": "",
  }, { cwd: "nested" });
  add("check", "relative-path", ["check", "sub", "--format", "json"], {
    ...providerWorkspace("sub/"),
  });
  add("check", "relative-path-text", ["check", "sub"], {
    ...providerWorkspace("sub/"),
  });
  add(
    "check",
    "root-flag-absolute",
    [
      "check",
      "--root",
      R,
      "--format",
      "json",
    ],
    { ...provider, "nested/placeholder.txt": "" },
    { cwd: "nested" },
  );
  add(
    "check",
    "root-flag-relative",
    [
      "check",
      "--root",
      "..",
      "--format",
      "json",
    ],
    { ...provider, "nested/placeholder.txt": "" },
    { cwd: "nested" },
  );
  add("check", "root-flag-relative-text", ["check", "--root", ".."], {
    ...broken_in(provider),
    "nested/placeholder.txt": "",
  }, { cwd: "nested" });
  add("check", "path-and-root-flag", [
    "check",
    "nested",
    "--root",
    R,
    "--format",
    "json",
  ], { ...provider, "nested/placeholder.txt": "" });
  add(
    "check",
    "unknown-section-json",
    ["check", R, "--format", "json"],
    brokenWorkspace,
  );
  add(
    "check",
    "unknown-section-text",
    ["check", R, "--format", "text"],
    brokenWorkspace,
  );
  add("check", "unknown-section-show-locations", [
    "check",
    R,
    "--format",
    "text",
    "--show-locations",
  ], brokenWorkspace);
  add("check", "unknown-section-show-locations-default-format", [
    "check",
    "--show-locations",
  ], brokenWorkspace);
  add("check", "unknown-section-show-locations-json", [
    "check",
    R,
    "--format",
    "json",
    "--show-locations",
  ], brokenWorkspace);
  add(
    "check",
    "unknown-section-show-locations-cwd-nested",
    [
      "check",
      "--root",
      "..",
      "--show-locations",
    ],
    { ...brokenWorkspace, "nested/placeholder.txt": "" },
    { cwd: "nested" },
  );
  add("check", "unknown-section-show-locations-absolute-root", [
    "check",
    R,
    "--show-locations",
  ], brokenWorkspace);
  add(
    "check",
    "untagged-facets-json",
    ["check", R, "--format", "json"],
    untagged,
  );
  add("check", "untagged-facets-text", ["check", R], untagged);
  add("check", "untagged-facets-show-locations", [
    "check",
    R,
    "--show-locations",
  ], untagged);
  add("check", "untagged-facets-pretty", [
    "check",
    R,
    "--format",
    "json",
    "--pretty",
  ], untagged);
  add("check", "ungrouped-interface-json", ["check", R, "--format", "json"], {
    ...workspace("optional-concepts"),
    "contract.sigil": ungroupedInterface,
  });
  add("check", "mixed-interface-json", ["check", R, "--format", "json"], {
    ...workspace("optional-concepts"),
    "contract.sigil": mixedInterface,
  });
  add("check", "interface-boundary-json", ["check", R, "--format", "json"], {
    ...workspace("interface-import-boundary"),
    "provider.sigil": boundaryProvider,
    "consumer.sigil": boundaryConsumer,
  });
  add("check", "interface-boundary-text", [
    "check",
    R,
    "--show-locations",
  ], {
    ...workspace("interface-import-boundary"),
    "provider.sigil": boundaryProvider,
    "consumer.sigil": boundaryConsumer,
  });
  const collisions = {
    ...providerWorkspace(),
    ...collisionSources(),
  };
  add(
    "check",
    "tag-collisions-json",
    ["check", R, "--format", "json"],
    collisions,
  );
  add("check", "tag-collisions-text", ["check", R], collisions);
  add("check", "tag-collisions-show-locations", [
    "check",
    R,
    "--show-locations",
  ], collisions);
  add("check", "imports-only-module-json", ["check", R, "--format", "json"], {
    ...provider,
    "internal/_module.sigil": "@base.sigil from Base import { result }\n",
  });
  add("check", "invalid-config-json", ["check", R, "--format", "json"], {
    ".sigil/config.json": "{",
    "item.sigil": valid("Item"),
  });
  add("check", "invalid-config-text", ["check", R], {
    ".sigil/config.json": "{",
    "item.sigil": valid("Item"),
  });
  add("check", "config-not-found-json", ["check", R, "--format", "json"], {
    "item.sigil": valid("Item"),
  });
  add("check", "config-not-found-text", ["check", R], {
    "item.sigil": valid("Item"),
  });
  add("check", "config-not-found-cwd", ["check", "--format", "json"], {
    "item.sigil": valid("Item"),
  });
  add("check", "config-not-found-relative", [
    "check",
    "sub",
    "--format",
    "json",
  ], {
    "sub/item.sigil": valid("Item"),
  });
  add("check", "unsupported-version-json", ["check", R, "--format", "json"], {
    ".sigil/config.json": JSON.stringify({
      sigilVersion: "0.8.0",
      workspace: { name: "old" },
      files: { include: ["**/*.sigil"] },
    }),
    "item.sigil": valid("Item"),
  });
  add("check", "invalid-config-shape-json", ["check", R, "--format", "json"], {
    ".sigil/config.json": JSON.stringify({ workspace: "no" }),
    "item.sigil": valid("Item"),
  });
  add("check", "missing-path", [
    "check",
    `${R}/does-not-exist`,
    "--format",
    "json",
  ], {
    ...workspace("missing"),
  });
  add(
    "check",
    "excluded-source-not-checked",
    ["check", R, "--format", "json"],
    {
      ...workspace("excluded", {}, "", {
        files: { include: ["**/*.sigil"], exclude: ["skip/**"] },
      }),
      "contract.sigil": valid("Feature"),
      "skip/broken.sigil": broken,
    },
  );
  add("check", "help", ["check", "--help"]);
  add("check", "help-after-bad-option", ["check", "--unknown", "--help"]);
  add("check", "usage-unsupported-option", ["check", "--unknown"]);
  add("check", "usage-two-paths", ["check", "first.sigil", "second.sigil"]);
  add("check", "usage-root-without-value", ["check", "--root"]);
  add("check", "usage-root-value-is-flag", ["check", "--root", "--pretty"]);
  add("check", "usage-format-invalid", ["check", "--format", "yaml"]);
  add("check", "usage-format-without-value", ["check", "--format"]);
  add("check", "usage-check-outside-fmt", ["check", "--check"]);
  add("check", "usage-init-options", ["check", "--name", "example"]);
  {
    const nestedFiles = nestedWorkspaces();
    add("check", "nested-workspace-parent-text", ["check"], nestedFiles);
    add("check", "nested-workspace-parent-json", [
      "check",
      "--format",
      "json",
    ], nestedFiles);
    add("check", "nested-workspace-child-text", ["check"], nestedFiles, {
      cwd: "child",
    });
    add(
      "check",
      "nested-workspace-child-json",
      [
        "check",
        "--format",
        "json",
      ],
      nestedFiles,
      { cwd: "child" },
    );
    const members = workspace(
      "members",
      { "sub/s.sigil": valid("Member") },
      "",
      {
        workspace: { name: "members", members: ["sub"] },
      },
    );
    add("check", "member-with-config-text", ["check"], {
      ...members,
      ...workspace("member", {}, "sub/"),
    });
  }
  add("check", "runtime-non-sigil-file", ["check", "notes.txt"], {
    ...workspace("check-file"),
    "notes.txt": "plain text\n",
  });
  add("check", "usage-exclude-option", ["check", "--exclude", "x"]);
}

/** Add an unrelated broken source so a text case shows an error line. */
function broken_in(files: Files): Files {
  return { ...files, "broken.sigil": broken };
}

// --- glossary --------------------------------------------------------------
{
  const present = {
    ...workspace("glossary"),
    ".sigil/glossary.json": glossaryJson,
    "booking/contract.sigil": bookingSource,
  };
  add("glossary", "present-json", ["glossary", R, "--format", "json"], present);
  add("glossary", "present-text", ["glossary", R], present);
  add("glossary", "present-json-pretty", [
    "glossary",
    R,
    "--format",
    "json",
    "--pretty",
  ], present);
  add("glossary", "present-quiet", ["glossary", R, "--quiet"], present);
  add(
    "glossary",
    "present-cwd-json",
    ["glossary", "--format", "json"],
    present,
  );
  add("glossary", "present-cwd-text", ["glossary"], present);
  add("glossary", "present-nested-cwd-text", ["glossary"], present, {
    cwd: "booking",
  });
  add(
    "glossary",
    "present-root-flag",
    [
      "glossary",
      "--root",
      "..",
      "--format",
      "json",
    ],
    present,
    { cwd: "booking" },
  );
  add("glossary", "present-relative-path", [
    "glossary",
    "sub",
    "--format",
    "json",
  ], {
    ...workspace("glossary", {
      ".sigil/glossary.json": glossaryJson,
      "booking/contract.sigil": bookingSource,
    }, "sub/"),
  });
  add("glossary", "absent-json", ["glossary", R, "--format", "json"], {
    ...workspace("glossary-errors"),
  });
  add("glossary", "absent-text", ["glossary", R], {
    ...workspace("glossary-errors"),
  });
  add("glossary", "invalid-json-parse-json", [
    "glossary",
    R,
    "--format",
    "json",
  ], {
    ...workspace("glossary-errors"),
    ".sigil/glossary.json": "{",
  });
  add("glossary", "invalid-json-parse-text", ["glossary", R], {
    ...workspace("glossary-errors"),
    ".sigil/glossary.json": "{",
  });
  add("glossary", "invalid-schema-json", ["glossary", R, "--format", "json"], {
    ...workspace("glossary-errors"),
    ".sigil/glossary.json": JSON.stringify({ schemaVersion: 2, terms: "none" }),
  });
  add("glossary", "invalid-schema-text", ["glossary", R], {
    ...workspace("glossary-errors"),
    ".sigil/glossary.json": JSON.stringify({ schemaVersion: 2, terms: "none" }),
  });
  const withCollision = {
    ...providerWorkspace(),
    ...collisionSources(),
    ".sigil/glossary.json": JSON.stringify({
      schemaVersion: 1,
      terms: [{ term: "collision", definition: "Two Tags with one name." }],
      contexts: [],
    }),
  };
  add("glossary", "valid-with-unrelated-error-json", [
    "glossary",
    R,
    "--format",
    "json",
  ], withCollision);
  add(
    "glossary",
    "valid-with-unrelated-error-text",
    ["glossary", R],
    withCollision,
  );
  add("glossary", "valid-with-unrelated-error-quiet", [
    "glossary",
    R,
    "--quiet",
  ], withCollision);
  add("glossary", "invalid-config-json", ["glossary", R, "--format", "json"], {
    ".sigil/config.json": "{",
  });
  add("glossary", "config-not-found-json", ["glossary", R, "--format", "json"]);
  add("glossary", "config-not-found-text", ["glossary", R]);
  const glossaryBroken = broken_in(present);
  add("glossary", "broken-source-json", [
    "glossary",
    R,
    "--format",
    "json",
  ], glossaryBroken);
  add("glossary", "broken-source-text", ["glossary", R], glossaryBroken);
  const glossaryNested = {
    ...nestedWorkspaces(),
    ".sigil/glossary.json": glossaryJson,
  };
  add("glossary", "nested-workspace-parent-text", ["glossary"], glossaryNested);
  add("glossary", "nested-workspace-parent-json", [
    "glossary",
    "--format",
    "json",
  ], glossaryNested);
  add("glossary", "nested-workspace-child-text", ["glossary"], glossaryNested, {
    cwd: "child",
  });
  add(
    "glossary",
    "nested-workspace-child-json",
    [
      "glossary",
      "--format",
      "json",
    ],
    glossaryNested,
    { cwd: "child" },
  );
  add("glossary", "runtime-non-sigil-file", ["glossary", "notes.txt"], {
    ...workspace("glossary-file"),
    "notes.txt": "plain text\n",
  });
  add("glossary", "help", ["glossary", "--help"]);
  add("glossary", "usage-unsupported-option", ["glossary", "--bogus"]);
  add("glossary", "usage-two-paths", ["glossary", "first", "second"]);
  add("glossary", "usage-root-without-value", ["glossary", "--root"]);
  add("glossary", "usage-format-invalid", ["glossary", "--format", "yaml"]);
  add("glossary", "usage-check-outside-fmt", ["glossary", "--check"]);
  add("glossary", "usage-show-locations-outside-check", [
    "glossary",
    "--show-locations",
  ]);
  add("glossary", "usage-init-options", [
    "glossary",
    "--include",
    "**/*.sigil",
  ]);
}

// --- init ------------------------------------------------------------------
{
  const base = { dirs: ["project"] };
  add(
    "init",
    "defaults-json",
    ["init", `${R}/project`, "--format", "json"],
    {},
    base,
  );
  add("init", "defaults-text", ["init", `${R}/project`], {}, base);
  add(
    "init",
    "defaults-json-pretty",
    [
      "init",
      `${R}/project`,
      "--format",
      "json",
      "--pretty",
    ],
    {},
    base,
  );
  add("init", "defaults-quiet", ["init", `${R}/project`, "--quiet"], {}, base);
  add(
    "init",
    "name-json",
    [
      "init",
      `${R}/project`,
      "--name",
      "example",
      "--format",
      "json",
    ],
    {},
    base,
  );
  add(
    "init",
    "name-text",
    ["init", `${R}/project`, "--name", "example"],
    {},
    base,
  );
  add(
    "init",
    "include-exclude-repeated-json",
    [
      "init",
      `${R}/project`,
      "--include",
      "docs/**/*.sigil",
      "--include",
      "design/**/*.sigil",
      "--exclude",
      "vendor/**",
      "--exclude",
      "tmp/**",
      "--format",
      "json",
    ],
    {},
    base,
  );
  add(
    "init",
    "include-exclude-repeated-files",
    [
      "init",
      `${R}/project`,
      "--include",
      "docs/**/*.sigil",
      "--include",
      "design/**/*.sigil",
      "--exclude",
      "vendor/**",
      "--exclude",
      "tmp/**",
      "--name",
      "multi",
      "--quiet",
    ],
    {},
    base,
  );
  add(
    "init",
    "exclude-only",
    [
      "init",
      `${R}/project`,
      "--exclude",
      "vendor/**",
      "--quiet",
    ],
    {},
    base,
  );
  add(
    "init",
    "basename-default-json",
    [
      "init",
      `${R}/sample-project`,
      "--format",
      "json",
    ],
    {},
    { dirs: ["sample-project"] },
  );
  add("init", "basename-default-relative", ["init", "sample-project"], {}, {
    dirs: ["sample-project"],
  });
  add("init", "basename-default-cwd", ["init", "--format", "json"], {}, {
    dirs: ["sample-project"],
    cwd: "sample-project",
  });
  add("init", "basename-default-cwd-text", ["init"], {}, {
    dirs: ["sample-project"],
    cwd: "sample-project",
  });
  add("init", "creates-missing-directory", [
    "init",
    `${R}/new/deep`,
    "--format",
    "json",
  ]);
  add("init", "relative-creates-missing-directory", ["init", "new/deep"]);
  add(
    "init",
    "existing-glossary-kept",
    [
      "init",
      `${R}/project`,
      "--format",
      "json",
    ],
    { "project/.sigil/glossary.json": existingGlossary },
    base,
  );
  add("init", "existing-glossary-kept-text", ["init", `${R}/project`], {
    "project/.sigil/glossary.json": existingGlossary,
  }, base);
  const existingConfig = {
    "project/.sigil/config.json": config("already-here"),
  };
  add(
    "init",
    "refuses-existing-config-json",
    [
      "init",
      `${R}/project`,
      "--format",
      "json",
    ],
    existingConfig,
    base,
  );
  add(
    "init",
    "refuses-existing-config-text",
    ["init", `${R}/project`],
    existingConfig,
    base,
  );
  add(
    "init",
    "refuses-existing-config-quiet",
    [
      "init",
      `${R}/project`,
      "--quiet",
    ],
    existingConfig,
    base,
  );
  add("init", "refuses-existing-config-cwd", ["init", "--format", "json"], {
    ".sigil/config.json": config("already-here"),
  });
  add(
    "init",
    "refuses-existing-invalid-config",
    [
      "init",
      `${R}/project`,
      "--format",
      "json",
    ],
    { "project/.sigil/config.json": "{" },
    base,
  );
  add(
    "init",
    "then-nothing-else-written",
    [
      "init",
      `${R}/project`,
      "--name",
      "keep",
      "--quiet",
    ],
    { "project/main.sigil": valid("Main") },
    base,
  );
  add("init", "help", ["init", "--help"]);
  add("init", "help-after-bad-option", ["init", "--root", "--help"]);
  add("init", "usage-root", ["init", "--root", R]);
  add("init", "usage-two-paths", ["init", "first", "second"]);
  add("init", "usage-unsupported-option", ["init", "--bogus"]);
  add("init", "usage-name-without-value", ["init", "--name"]);
  add("init", "usage-name-value-is-flag", ["init", "--name", "--quiet"]);
  add("init", "usage-include-without-value", ["init", "--include"]);
  add("init", "usage-exclude-without-value", ["init", "--exclude"]);
  add("init", "usage-format-invalid", ["init", "--format", "yaml"]);
  add("init", "usage-check-outside-fmt", ["init", "--check"]);
  add("init", "usage-show-locations-outside-check", [
    "init",
    "--show-locations",
  ]);
}

// --- fmt -------------------------------------------------------------------
{
  const single = {
    ...workspace("fmt"),
    "main.sigil": longGoal,
  };
  add("fmt", "check-noncanonical-json", [
    "fmt",
    R,
    "--check",
    "--format",
    "json",
  ], single);
  add("fmt", "check-noncanonical-text", ["fmt", R, "--check"], single);
  add(
    "fmt",
    "check-noncanonical-quiet",
    ["fmt", R, "--check", "--quiet"],
    single,
  );
  add(
    "fmt",
    "check-noncanonical-cwd",
    ["fmt", "--check", "--format", "json"],
    single,
  );
  add("fmt", "check-noncanonical-pretty", [
    "fmt",
    R,
    "--check",
    "--format",
    "json",
    "--pretty",
  ], single);
  add("fmt", "write-json", ["fmt", R, "--format", "json"], single);
  add("fmt", "write-text", ["fmt", R], single);
  add("fmt", "write-quiet", ["fmt", R, "--quiet"], single);
  add("fmt", "write-cwd-text", ["fmt"], single);
  add(
    "fmt",
    "write-pretty",
    ["fmt", R, "--format", "json", "--pretty"],
    single,
  );
  add("fmt", "write-dot", ["fmt", ".", "--format", "json"], single);
  const canonicalOnly = {
    ...workspace("fmt-canonical"),
    "first.sigil": valid("First"),
    "second.sigil": valid("Second"),
  };
  add(
    "fmt",
    "check-canonical-quiet",
    ["fmt", R, "--check", "--quiet"],
    canonicalOnly,
  );
  add(
    "fmt",
    "check-canonical-json",
    ["fmt", R, "--check", "--format", "json"],
    canonicalOnly,
  );
  add("fmt", "check-canonical-text", ["fmt", R, "--check"], canonicalOnly);
  add(
    "fmt",
    "write-canonical-json",
    ["fmt", R, "--format", "json"],
    canonicalOnly,
  );
  const errors = {
    ...workspace("fmt-invalid"),
    "valid.sigil": noncanonical("Valid"),
    "invalid.sigil": valid("Invalid").replace("Test Invalid.", "x".repeat(80)),
  };
  add("fmt", "error-writes-nothing-json", [
    "fmt",
    `${R}/valid.sigil`,
    `${R}/invalid.sigil`,
    "--format",
    "json",
  ], errors);
  add("fmt", "error-writes-nothing-text", [
    "fmt",
    `${R}/valid.sigil`,
    `${R}/invalid.sigil`,
  ], errors);
  add("fmt", "error-check-json", [
    "fmt",
    `${R}/valid.sigil`,
    `${R}/invalid.sigil`,
    "--check",
    "--format",
    "json",
  ], errors);
  add("fmt", "error-whole-workspace-text", ["fmt", R], errors);
  add("fmt", "error-parse-failure-json", [
    "fmt",
    `${R}/valid.sigil`,
    `${R}/broken.sigil`,
    "--format",
    "json",
  ], {
    ...workspace("fmt-broken"),
    "valid.sigil": noncanonical("Valid"),
    "broken.sigil": "component Broken {\n",
  });
  add("fmt", "error-unknown-section-text", ["fmt", R], {
    ...workspace("fmt-broken"),
    "valid.sigil": noncanonical("Valid"),
    "broken.sigil": broken,
  });

  // Absolute and cwd-relative output paths.
  const absolute = {
    ...workspace("fmt-absolute-output"),
    "first.sigil": valid("First"),
    "second.sigil": valid("Second"),
  };
  add("fmt", "absolute-single-json", [
    "fmt",
    `${R}/first.sigil`,
    "--check",
    "--format",
    "json",
  ], absolute);
  add(
    "fmt",
    "absolute-single-text",
    ["fmt", `${R}/first.sigil`, "--check"],
    absolute,
  );
  add("fmt", "absolute-mixed-json", [
    "fmt",
    `${R}/first.sigil`,
    "second.sigil",
    "--check",
    "--format",
    "json",
  ], absolute);
  add("fmt", "absolute-mixed-reversed-json", [
    "fmt",
    "second.sigil",
    `${R}/first.sigil`,
    "--check",
    "--format",
    "json",
  ], absolute);
  add("fmt", "absolute-mixed-text", [
    "fmt",
    `${R}/first.sigil`,
    "second.sigil",
    "--check",
  ], absolute);
  add("fmt", "relative-single-json", [
    "fmt",
    "first.sigil",
    "--check",
    "--format",
    "json",
  ], absolute);
  add("fmt", "absolute-root-flag-json", [
    "fmt",
    "first.sigil",
    "--root",
    R,
    "--check",
    "--format",
    "json",
  ], absolute);

  // Paths with spaces, cwd-relative, reversed order and an explicit root.
  const spaces = {
    ...workspace("fmt-batch"),
    "selected/alpha file.sigil": noncanonical("Alpha"),
    "selected/beta.sigil": noncanonical("Beta"),
    "other.sigil": valid("Other"),
  };
  const spaceTargets = ["beta.sigil", "alpha file.sigil"];
  for (
    const [label, targets] of [
      ["forward", spaceTargets],
      ["reversed", [...spaceTargets].reverse()],
    ] as const
  ) {
    add(
      "fmt",
      `spaces-${label}-check-json`,
      [
        "fmt",
        ...targets,
        "--root",
        "..",
        "--check",
        "--format",
        "json",
      ],
      spaces,
      { cwd: "selected" },
    );
    add(
      "fmt",
      `spaces-${label}-check-text`,
      [
        "fmt",
        ...targets,
        "--root",
        "..",
        "--check",
      ],
      spaces,
      { cwd: "selected" },
    );
    add(
      "fmt",
      `spaces-${label}-write-json`,
      [
        "fmt",
        ...targets,
        "--root",
        "..",
        "--format",
        "json",
      ],
      spaces,
      { cwd: "selected" },
    );
  }
  add(
    "fmt",
    "spaces-no-root-flag-json",
    [
      "fmt",
      "alpha file.sigil",
      "--check",
      "--format",
      "json",
    ],
    spaces,
    { cwd: "selected" },
  );

  // Every target that must fail with exit 3, in both orders and with flags.
  const bad = {
    ...workspace("fmt-bad-target", {}, "main/", {
      files: { include: ["**/*.sigil"], exclude: ["excluded/**"] },
    }),
    "main/selected.sigil": noncanonical("Selected"),
    "main/excluded/skip.sigil": valid("Skip"),
    "main/empty/readme.txt": "No Sigil source here.",
    "main/notes.txt": "No Sigil source here.",
    ...workspace("fmt-foreign", {
      "foreign.sigil": noncanonical("Foreign"),
    }, "foreign/"),
  };
  const selected = `${R}/main/selected.sigil`;
  const badTargets: [string, string][] = [
    ["missing-file", `${R}/main/missing.sigil`],
    ["excluded-file", `${R}/main/excluded/skip.sigil`],
    ["excluded-directory", `${R}/main/excluded`],
    ["empty-directory", `${R}/main/empty`],
    ["non-sigil-file", `${R}/main/notes.txt`],
    ["foreign-workspace", `${R}/foreign/foreign.sigil`],
  ];
  for (const [label, target] of badTargets) {
    const flagSets: [string, string[]][] = [
      ["plain", []],
      ["root", ["--root", `${R}/main`]],
      ["check", ["--check"]],
    ];
    for (const [flagLabel, flags] of flagSets) {
      add(
        "fmt",
        `runtime-${label}-${flagLabel}-after`,
        [
          "fmt",
          selected,
          target,
          ...flags,
        ],
        bad,
        { cwd: "main" },
      );
      add(
        "fmt",
        `runtime-${label}-${flagLabel}-before`,
        [
          "fmt",
          target,
          selected,
          ...flags,
        ],
        bad,
        { cwd: "main" },
      );
    }
  }
  add("fmt", "runtime-missing-file-alone", ["fmt", "missing.sigil"], bad, {
    cwd: "main",
  });
  add(
    "fmt",
    "runtime-non-sigil-file-json",
    [
      "fmt",
      "notes.txt",
      "--format",
      "json",
    ],
    bad,
    { cwd: "main" },
  );

  // Undiscovered ancestor of the workspace.
  const ancestor = {
    ...workspace("fmt-ancestor-target", {
      "selected.sigil": noncanonical("Selected"),
      "other.sigil": noncanonical("Other"),
    }, "ws/"),
  };
  for (
    const [label, targets] of [
      ["after", ["selected.sigil", ".."]],
      ["before", ["..", "selected.sigil"]],
    ] as const
  ) {
    for (
      const [flagLabel, flags] of [["plain", []], ["check", [
        "--check",
      ]]] as const
    ) {
      add(
        "fmt",
        `ancestor-${label}-${flagLabel}`,
        [
          "fmt",
          ...targets,
          ...flags,
        ],
        ancestor,
        { cwd: "ws" },
      );
    }
  }
  add("fmt", "ancestor-with-root-flag", [
    "fmt",
    "..",
    "--root",
    "ws",
    "--check",
    "--format",
    "json",
  ], ancestor);

  // An omitted target stays at the working directory, with or without --root.
  const omitted = {
    ...workspace("fmt-default"),
    "selected/main.sigil": noncanonical("Selected"),
    "other.sigil": valid("Other"),
  };
  for (
    const [label, flags] of [["plain", []], ["root", ["--root", ".."]]] as const
  ) {
    add(
      "fmt",
      `omitted-target-${label}-check-json`,
      [
        "fmt",
        ...flags,
        "--check",
        "--format",
        "json",
      ],
      omitted,
      { cwd: "selected" },
    );
    add(
      "fmt",
      `omitted-target-${label}-check-text`,
      [
        "fmt",
        ...flags,
        "--check",
      ],
      omitted,
      { cwd: "selected" },
    );
  }
  add(
    "fmt",
    "omitted-target-root-write-json",
    [
      "fmt",
      "--root",
      "..",
      "--format",
      "json",
    ],
    omitted,
    { cwd: "selected" },
  );
  add("fmt", "omitted-target-at-root-check-json", [
    "fmt",
    "--check",
    "--format",
    "json",
  ], omitted);
  add(
    "fmt",
    "omitted-target-absolute-root-check-text",
    [
      "fmt",
      "--root",
      R,
      "--check",
    ],
    omitted,
    { cwd: "selected" },
  );

  // Ancestor directory selection with an explicit workspace root.
  const nested = {
    ...workspace("format", {
      "main.sigil": component("Main", "words ".repeat(30) + "end."),
    }, "nested/"),
  };
  for (
    const [label, targets] of [
      ["none", []],
      ["dot", ["."]],
      ["file-and-dots", ["nested/main.sigil", ".", "."]],
    ] as const
  ) {
    add("fmt", `explicit-root-ancestor-${label}-json`, [
      "fmt",
      ...targets,
      "--root",
      "nested",
      "--check",
      "--format",
      "json",
    ], nested);
  }
  add("fmt", "explicit-root-ancestor-none-write-json", [
    "fmt",
    "--root",
    "nested",
    "--format",
    "json",
  ], nested);
  add("fmt", "no-config-text", ["fmt"], { "item.sigil": noncanonical("Item") });
  add("fmt", "no-config-json-root", ["fmt", R, "--format", "json"], {
    "item.sigil": noncanonical("Item"),
  });

  // Mixed providers and consumers, and overlapping targets.
  const provider = component("Provider", "A *search results* has meaning.");
  const mixed = {
    ...workspace("format"),
    "provider.sigil": provider,
    "consumer.sigil":
      "@provider.sigil from Provider import { search results }\n" +
      component("Consumer", "prefix ".repeat(12) + "search results follow."),
    "other.sigil": component("Other", "word ".repeat(30) + "ends."),
  };
  add("fmt", "mixed-providers-check-json", [
    "fmt",
    ".",
    "--check",
    "--format",
    "json",
  ], mixed);
  add("fmt", "mixed-providers-check-text", ["fmt", ".", "--check"], mixed);
  add(
    "fmt",
    "mixed-providers-write-json",
    ["fmt", ".", "--format", "json"],
    mixed,
  );
  add("fmt", "mixed-providers-write-text", ["fmt", "."], mixed);
  const overlap = {
    ...workspace("format"),
    "sources/provider.sigil": component(
      "Provider",
      "prefix ".repeat(12) + "A *search results* has meaning.",
    ),
    "sources/consumer.sigil":
      "@sources/provider.sigil from Provider import { search results }\n" +
      component("Consumer", "prefix ".repeat(12) + "search results follow."),
    "other.sigil": component("Other", "Keep this source untouched."),
  };
  const overlapTargets = [
    "sources/provider.sigil",
    "sources",
    "sources/consumer.sigil",
    "./sources/",
  ];
  add("fmt", "incomplete-provider-only-json", [
    "fmt",
    "sources/provider.sigil",
    "--format",
    "json",
  ], overlap);
  add(
    "fmt",
    "incomplete-provider-only-text",
    ["fmt", "sources/provider.sigil"],
    overlap,
  );
  add("fmt", "overlap-check-json", [
    "fmt",
    ...overlapTargets,
    "--check",
    "--format",
    "json",
  ], overlap);
  add("fmt", "overlap-reversed-check-json", [
    "fmt",
    ...[...overlapTargets].reverse(),
    "--check",
    "--format",
    "json",
  ], overlap);
  add("fmt", "overlap-write-json", [
    "fmt",
    ...overlapTargets,
    "--format",
    "json",
  ], overlap);
  add("fmt", "overlap-write-text", ["fmt", ...overlapTargets], overlap);
  add("fmt", "directory-target-text", ["fmt", "sources", "--check"], overlap);

  {
    const nestedFiles = nestedWorkspaces();
    add("fmt", "nested-workspace-parent-text", ["fmt"], nestedFiles);
    add("fmt", "nested-workspace-parent-json", [
      "fmt",
      "--format",
      "json",
    ], nestedFiles);
    add("fmt", "nested-workspace-parent-file", ["fmt", "p.sigil"], nestedFiles);
    add("fmt", "nested-workspace-child-text", ["fmt"], nestedFiles, {
      cwd: "child",
    });
    add(
      "fmt",
      "nested-workspace-child-json",
      [
        "fmt",
        "--format",
        "json",
      ],
      nestedFiles,
      { cwd: "child" },
    );
    add("fmt", "nested-workspace-child-file", ["fmt", "c.sigil"], nestedFiles, {
      cwd: "child",
    });
    add("fmt", "nested-workspace-child-file-from-parent", [
      "fmt",
      "child/c.sigil",
    ], nestedFiles);
  }

  // A selection that is already canonical still fails while another file of
  // the workspace has a line that is too long.
  const unchangedWithLongLine = {
    ...workspace("fmt-unchanged-long-line"),
    "a.sigil": valid("Canonical"),
    "b.sigil": noncanonical("Wide"),
  };
  add("fmt", "unchanged-selection-long-line-elsewhere-text", [
    "fmt",
    "a.sigil",
  ], unchangedWithLongLine);
  add("fmt", "unchanged-selection-long-line-elsewhere-json", [
    "fmt",
    "a.sigil",
    "--format",
    "json",
  ], unchangedWithLongLine);
  add("fmt", "unchanged-selection-long-line-elsewhere-check", [
    "fmt",
    "a.sigil",
    "--check",
  ], unchangedWithLongLine);
  add("fmt", "help", ["fmt", "--help"]);
  add("fmt", "help-after-bad-option", ["fmt", "--show-locations", "--help"]);
  add("fmt", "usage-unsupported-option", ["fmt", "--bogus"]);
  add("fmt", "usage-format-markdown", ["fmt", "--format", "markdown"]);
  add("fmt", "usage-format-invalid", ["fmt", "--format", "yaml"]);
  add("fmt", "usage-format-without-value", ["fmt", "--format"]);
  add("fmt", "usage-root-without-value", ["fmt", "--root"]);
  add("fmt", "usage-show-locations-outside-check", ["fmt", "--show-locations"]);
  add("fmt", "usage-init-options", ["fmt", "--name", "example"]);
  add("fmt", "usage-exclude-option", ["fmt", "--exclude", "x"]);
}

// --- other commands: positional limits next to fmt's variadic paths ---------
add("init", "usage-three-paths", ["init", "first", "second", "third"]);
add("check", "usage-three-paths", ["check", "first", "second", "third"]);
add("version", "usage-three-paths", ["version", "first", "second", "third"]);

// ---------------------------------------------------------------------------
// Running

interface Record_ {
  name: string;
  command: Command;
  fieldsOnly?: true;
  statusOnly?: true;
  engineText?: true;
  files: Files;
  dirs?: string[];
  argv: string[];
  cwd: string;
  exitCode: number;
  stdout: string | null;
  stderr: string;
  filesAfter: Files;
}

function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function sorted(files: Files): Files {
  return Object.fromEntries(
    Object.keys(files).sort(byCodeUnit).map((path) => [path, files[path]]),
  );
}

async function walk(base: string, dir = ""): Promise<Files> {
  const out: Files = {};
  for await (const entry of Deno.readDir(`${base}${dir}`)) {
    const path = `${dir}${entry.name}`;
    if (entry.isDirectory) Object.assign(out, await walk(base, `${path}/`));
    else if (entry.isFile) {
      out[path] = await Deno.readTextFile(`${base}${path}`);
    }
  }
  return sorted(out);
}

/** Text that comes from the JavaScript or operating system runtime, not from Sigil. */
const ENGINE_TEXT =
  /\(os error \d+\)|in JSON at position|Unexpected token|Expected property name/;

async function run(testCase: Case): Promise<Record_> {
  const raw = await Deno.makeTempDir({ prefix: "sigil-parity-" });
  // Use the real path throughout so the process directory and every argument
  // spell the same path (macOS `/var` is a link to `/private/var`).
  const real = await Deno.realPath(raw);
  try {
    for (const dir of testCase.dirs ?? []) {
      await Deno.mkdir(`${real}/${dir}`, { recursive: true });
    }
    for (const [path, text] of Object.entries(testCase.files)) {
      const target = `${real}/${path}`;
      await Deno.mkdir(target.slice(0, target.lastIndexOf("/")), {
        recursive: true,
      });
      await Deno.writeTextFile(target, text);
    }
    const cwd = testCase.cwd ?? ".";
    const output = await new Deno.Command(Deno.execPath(), {
      args: [
        "run",
        "--quiet",
        "--no-prompt",
        "--allow-read",
        "--allow-write",
        "--allow-env",
        `--config=${CONFIG_FILE}`,
        CLI_ENTRY,
        ...testCase.argv.map((arg) => arg.replaceAll(PLACEHOLDER, real)),
      ],
      cwd: cwd === "." ? real : `${real}/${cwd}`,
      env: { NO_COLOR: "1", DENO_NO_UPDATE_CHECK: "1" },
      stdout: "piped",
      stderr: "piped",
    }).output();
    const scrub = (text: string) => {
      let out = text;
      for (
        const form of new Set([real, raw].sort((a, b) => b.length - a.length))
      ) {
        out = out.replaceAll(form, PLACEHOLDER);
      }
      return out;
    };
    const decode = (bytes: Uint8Array) =>
      scrub(new TextDecoder().decode(bytes));
    const stderr = decode(output.stderr);
    const filesAfter: Files = {};
    for (const [path, text] of Object.entries(await walk(`${real}/`))) {
      filesAfter[path] = scrub(text);
    }
    const stdout = decode(output.stdout);
    return {
      name: testCase.name,
      command: testCase.command,
      ...(testCase.fieldsOnly ? { fieldsOnly: true as const } : {}),
      ...(testCase.statusOnly ? { statusOnly: true as const } : {}),
      ...(ENGINE_TEXT.test(stdout + stderr)
        ? { engineText: true as const }
        : {}),
      files: sorted(testCase.files),
      ...(testCase.dirs?.length
        ? { dirs: [...testCase.dirs].sort(byCodeUnit) }
        : {}),
      argv: testCase.argv,
      cwd,
      exitCode: output.code,
      stdout: testCase.statusOnly ? null : stdout,
      stderr,
      filesAfter,
    };
  } finally {
    await Deno.remove(raw, { recursive: true });
  }
}

// Case names identify cases, so a duplicate would silently shadow a recording.
const names = new Set<string>();
for (const testCase of cases) {
  if (names.has(testCase.name)) {
    throw new Error(`duplicate case name: ${testCase.name}`);
  }
  names.add(testCase.name);
}

const records: Record_[] = new Array(cases.length);
let next = 0;
async function worker() {
  while (next < cases.length) {
    const index = next++;
    records[index] = await run(cases[index]);
  }
}
await Promise.all(Array.from({ length: 6 }, worker));

// A recording must never carry the machine it was made on.
for (const record of records) {
  const text = JSON.stringify(record);
  if (
    /sigil-parity-/.test(text) || /\/(?:private\/)?var\/folders\//.test(text)
  ) {
    throw new Error(`${record.name}: a temp path leaked into the recording`);
  }
  if (record.exitCode > 3) {
    throw new Error(
      `${record.name}: unexpected exit status ${record.exitCode}`,
    );
  }
  if (record.exitCode === 3 && record.stdout) {
    throw new Error(`${record.name}: exit 3 printed on standard output`);
  }
}

await Deno.mkdir(OUTPUT.slice(0, OUTPUT.lastIndexOf("/")), { recursive: true });
await Deno.writeTextFile(OUTPUT, JSON.stringify(records, null, 2) + "\n");

const perCommand = new Map<string, number>();
const statuses = new Map<number, number>();
for (const record of records) {
  perCommand.set(record.command, (perCommand.get(record.command) ?? 0) + 1);
  statuses.set(record.exitCode, (statuses.get(record.exitCode) ?? 0) + 1);
}
console.log(`${records.length} cases written to ${OUTPUT}`);
console.log(
  "per command: " +
    [...perCommand].sort().map(([k, v]) => `${k}=${v}`).join(" "),
);
console.log(
  "exit status: " +
    [...statuses].sort((a, b) => a[0] - b[0]).map(([k, v]) => `${k}=${v}`)
      .join(" "),
);
