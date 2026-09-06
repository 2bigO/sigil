import { resolve } from "node:path";
import {
  artifactPayload,
  canonicalWorkspacePath,
  CommandSemanticProvider,
  compileSemanticWorld,
  createImplementationHandoff,
  createSemanticWorkspaceContext,
  implementationSlice,
  initializeCompileArtifacts,
  inspectManagedViews,
  loadCompilationWorkspace,
  migrateSemanticState,
  projectGreenSemanticWorld,
  proposeSemanticIntent,
  readImplementationHandoff,
  readImplementationPolicy,
  readWorldBeam,
  recordCompilationRun,
  recordSemanticStage,
  recoverManagedViews,
  renderImplementationSlice,
  renderManagedViewSet,
  renderReturnedImplementationMarkdown,
  resumeWorldBeam,
  SemanticInputError,
  type SemanticProposalProvider,
  serializeEggWorld,
  serializeSemanticWorld,
  type StoredWorldBeam,
  summarizeReturnedImplementation,
  verifyImplementationWorld,
  verifyReturnedImplementation,
  type WorldBeamCheckpoint,
  type WorldSearchResult,
  writeManagedViews,
  writeReceiptSubmission,
  writeSemanticState,
  writeWorldBeam,
} from "@qoherent/sigil-compiler";
import { CoreAdapter } from "./core-adapter.ts";
import type { CliRunResult } from "./main.ts";
import { configuredSemanticProvider } from "./semantic-providers.ts";

export const SEMANTIC_HELP = `Usage: sigil semantic <command> [path] [options]

Commands:
  intent     Interpret --text using --generator or --proposals; save a viable beam
  status     Recompute the canonical world or a saved --beam
  answer     Answer --fact with --value yes|no in a saved --beam
  accept     Accept a uniquely selected green --beam as canonical assertions
  project    Project the canonical green world as paired Turtle and Sigil
  slice      Return a focused implementation slice for --component
  verify     Check current code or a retained --handoff with optional --receipts
  artifacts  Initialize .sigil artifact directories and Git ignore policy
  migrate    Migrate accepted-state metadata to receipt version 2
  receipts   Import --claims Turtle and --locations JSON against a retained --handoff

Options:
  --text <intent>          Natural-language intent
  --generator <program>   Executable reading a prompt on stdin and writing proposal JSON
  --generator-arg <value>  Argument to the executable; repeatable
  --proposals <file>      Read a generated candidate envelope instead of invoking a provider
  --provider <name>       Use the named configured semantic provider
  --beam <name>           Named checkpoint (intent defaults to a fresh name)
  --fact <id>             Exact current question's fact identity
  --value <yes|no>        Answer to that exact proposition
  --component <name|iri>  Component for an implementation slice
  --handoff <id>          Exact retained assignment identity
  --handoff-root <path>   Original workspace retaining that assignment (defaults to path)
  --receipts <id>         Imported receipt bundle for verification; omission checks all obligations
  --claims <file>         Returned untrusted Turtle receipt claims
  --locations <file>      Matching receipt source-location sidecar
  --format <value>        json (default); project: sigil|turtle; slice: text|egg|turtle; verify: turtle|markdown
  --write                 Install managed project views, or write metadata migration
  --check                 Inspect managed project views without writing (project only)
  --recover               Recover a prepared managed-view transaction (project only)
  --expected-revision <revision>  Expected accepted world revision for --write
  --transaction <id>      Managed-view transaction identity for --recover
  --help                  Show this help

A candidate envelope is {"version":1,"candidates":[{"id":"name","additions":"Turtle","retractions":""}]}.
Only acceptance replaces canonical meaning. Status and project are read-only.
Slice and verify retain ignored artifacts and report their identities.
`;

type Action =
  | "intent"
  | "status"
  | "answer"
  | "accept"
  | "project"
  | "slice"
  | "verify"
  | "artifacts"
  | "migrate"
  | "receipts";
interface Arguments {
  action: Action;
  path: string;
  values: Record<string, string>;
  generatorArgs: string[];
}
class UsageError extends Error {}

function parse(argv: readonly string[]): Arguments {
  const action = argv[0];
  if (
    ![
      "intent",
      "status",
      "answer",
      "accept",
      "project",
      "slice",
      "verify",
      "artifacts",
      "migrate",
      "receipts",
    ]
      .includes(
        action,
      )
  ) throw new UsageError("Choose a semantic command.");
  const values: Record<string, string> = {};
  const generatorArgs: string[] = [];
  let path: string | undefined;
  for (let index = 1; index < argv.length; index++) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      if (path !== undefined) {
        throw new UsageError("Only one workspace path is allowed.");
      }
      path = arg;
      continue;
    }
    if (
      ![
        "--text",
        "--generator",
        "--generator-arg",
        "--proposals",
        "--provider",
        "--beam",
        "--fact",
        "--value",
        "--component",
        "--format",
        "--handoff",
        "--handoff-root",
        "--receipts",
        "--claims",
        "--locations",
        "--write",
        "--check",
        "--recover",
        "--expected-revision",
        "--transaction",
      ].includes(arg)
    ) throw new UsageError(`Unknown option ${arg}.`);
    const booleanFlag = ["--write", "--check", "--recover"].includes(arg);
    const value = booleanFlag ? "true" : argv[++index];
    if (value === undefined) throw new UsageError(`${arg} requires a value.`);
    if (arg === "--generator-arg") generatorArgs.push(value);
    else {
      if (Object.hasOwn(values, arg)) {
        throw new UsageError(`${arg} may only be supplied once.`);
      }
      values[arg] = value;
    }
  }
  const allowed: Record<string, readonly string[]> = {
    intent: [
      "--text",
      "--generator",
      "--proposals",
      "--provider",
      "--beam",
      "--format",
    ],
    status: ["--beam", "--format"],
    answer: ["--beam", "--fact", "--value", "--format"],
    accept: ["--beam", "--format"],
    project: [
      "--format",
      "--write",
      "--check",
      "--recover",
      "--expected-revision",
      "--transaction",
    ],
    slice: ["--component", "--format"],
    verify: ["--format", "--handoff", "--handoff-root", "--receipts"],
    artifacts: ["--format"],
    migrate: ["--format", "--write", "--expected-revision"],
    receipts: [
      "--handoff",
      "--handoff-root",
      "--claims",
      "--locations",
      "--format",
    ],
  };
  for (const key of Object.keys(values)) {
    if (!allowed[action].includes(key)) {
      throw new UsageError(`${key} is not valid for ${action}.`);
    }
  }
  const format = values["--format"] ?? "json";
  if (
    format !== "json" &&
    !(action === "project" && ["sigil", "turtle"].includes(format)) &&
    !(action === "slice" && ["text", "turtle", "egg"].includes(format)) &&
    !(action === "verify" && ["turtle", "markdown"].includes(format))
  ) throw new UsageError(`Unsupported ${action} format ${format}.`);
  if (
    action === "intent" &&
      !values["--text"] ||
    Number(!!values["--generator"]) + Number(!!values["--proposals"]) +
          Number(!!values["--provider"]) > 1
  ) {
    throw new UsageError(
      "intent requires --text and at most one of --provider, --generator or --proposals.",
    );
  }
  if (generatorArgs.length && (action !== "intent" || !values["--generator"])) {
    throw new UsageError("--generator-arg requires an intent generator.");
  }
  if (["answer", "accept"].includes(action) && !values["--beam"]) {
    throw new UsageError(`${action} requires --beam.`);
  }
  if (
    action === "answer" &&
    (!values["--fact"] || !["yes", "no"].includes(values["--value"]))
  ) throw new UsageError("answer requires --fact and --value yes|no.");
  if (action === "slice" && !values["--component"]) {
    throw new UsageError("slice requires --component.");
  }
  const projectMutations = ["--write", "--check", "--recover"].filter((flag) =>
    values[flag]
  );
  if (
    !["project", "migrate"].includes(action) &&
    (projectMutations.length || values["--expected-revision"] ||
      values["--transaction"])
  ) {
    throw new UsageError("Managed-view flags are valid only for project.");
  }
  if (projectMutations.length > 1) {
    throw new UsageError(
      "project --write, --check and --recover are mutually exclusive.",
    );
  }
  if (values["--write"] && !values["--expected-revision"]) {
    throw new UsageError(`${action} --write requires --expected-revision.`);
  }
  if (values["--recover"] && !values["--transaction"]) {
    throw new UsageError("project --recover requires --transaction.");
  }
  if (!values["--recover"] && values["--transaction"]) {
    throw new UsageError("--transaction requires project --recover.");
  }
  if (!values["--write"] && values["--expected-revision"]) {
    throw new UsageError("--expected-revision requires --write.");
  }
  if (projectMutations.length && format !== "json") {
    throw new UsageError(
      "Managed-view project mutations require --format json.",
    );
  }
  if (
    action === "receipts" &&
    (!values["--handoff"] || !values["--claims"] || !values["--locations"])
  ) {
    throw new UsageError(
      "receipts requires --handoff, --claims and --locations.",
    );
  }
  if (
    action === "verify" && !values["--handoff"] &&
    (values["--receipts"] || values["--handoff-root"] || format === "markdown")
  ) {
    throw new UsageError(
      "--receipts, --handoff-root and verify Markdown require --handoff.",
    );
  }
  return { action: action as Action, path: path ?? ".", values, generatorArgs };
}

async function workspaceContext(path: string, core: CoreAdapter) {
  const resolved = await core.resolveWorkspace(path);
  const errors = resolved.diagnostics.filter((d) => d.severity === "error");
  if (errors.length) {
    throw new SemanticInputError(
      "INVALID_SOURCE",
      errors.map((d) => d.message).join("\n"),
    );
  }
  const root = resolve(resolved.workspace.root);
  return await createSemanticWorkspaceContext({ root, resolved });
}

function current(
  checkpoint: WorldBeamCheckpoint,
  context: Awaited<ReturnType<typeof workspaceContext>>,
): void {
  if (
    !checkpoint.context ||
    checkpoint.context.sourceFingerprint !==
      context.receipt.sourceFingerprint ||
    checkpoint.context.canonicalFingerprint !==
      context.receipt.canonicalFingerprint
  ) {
    throw new SemanticInputError(
      "STALE_INTENT",
      "Source contracts or canonical assertions changed since this intent was generated. Generate a new beam against the current state.",
    );
  }
}

function searchSummary(search: WorldSearchResult) {
  return {
    result: search.status,
    status: search.status === "rejected"
      ? "red"
      : search.status === "ambiguous"
      ? "yellow"
      : search.selected!.compilation.status,
    candidates: search.survivors.map((candidate) => ({
      id: candidate.id,
      status: candidate.compilation.status,
      worldFingerprint: candidate.compilation.world.fingerprint,
      objective: candidate.objective,
      diagnostics: candidate.compilation.diagnostics,
    })),
    rejected: search.rejected,
    question: search.proposition
      ? {
        factId: search.proposition.fact.id,
        text: search.proposition.question,
        fact: search.proposition.fact,
        informationGainBits: search.proposition.informationGainBits,
      }
      : undefined,
  };
}

export interface SemanticCommandOptions {
  readonly core?: CoreAdapter;
  readonly signal?: AbortSignal;
  /** Hosts may inject a provider while preserving the normal command invocation. */
  readonly proposalProvider?: SemanticProposalProvider;
}

/** Canonical acceptance stays separate from compilation and its result artifacts. */
// @sigil implements packages/cli/_module.sigil::SigilCli::SemanticWorldCommand interface,logic,constraints,cases
export async function runSemanticCommand(
  argv: readonly string[],
  options: SemanticCommandOptions = {},
): Promise<CliRunResult> {
  if (argv.includes("--help")) {
    return { exitCode: 0, stdout: SEMANTIC_HELP, stderr: "" };
  }
  try {
    const { action, path, values, generatorArgs } = parse(argv);
    options.signal?.throwIfAborted();
    const json = (value: unknown, exitCode = 0): CliRunResult => ({
      exitCode,
      stdout: JSON.stringify(value, null, 2) + "\n",
      stderr: "",
    });
    if (
      action === "intent" && !values["--proposals"] &&
      !values["--generator"] && !values["--provider"] &&
      !options.proposalProvider
    ) {
      let root: string;
      try {
        root = (await loadCompilationWorkspace(path)).root;
      } catch {
        throw new UsageError(
          "No semantic provider is configured. Select --provider <name>, --generator <executable>, or --proposals <file>.",
        );
      }
      let configured: unknown;
      try {
        configured = JSON.parse(
          await Deno.readTextFile(resolve(root, ".sigil/config.json")),
        );
      } catch {
        throw new UsageError(
          "No semantic provider is configured. Select --provider <name>, --generator <executable>, or --proposals <file>.",
        );
      }
      const semantic = configured && typeof configured === "object" &&
          !Array.isArray(configured)
        ? (configured as Record<string, unknown>).tools &&
            typeof (configured as Record<string, unknown>).tools === "object"
          ? ((configured as Record<string, unknown>).tools as Record<
            string,
            unknown
          >).semantic
          : undefined
        : undefined;
      if (
        !semantic || typeof semantic !== "object" ||
        !(semantic as Record<string, unknown>).defaultProvider
      ) {
        throw new UsageError(
          "No semantic provider is configured. Select --provider <name>, --generator <executable>, or --proposals <file>.",
        );
      }
    }
    if (action === "artifacts") {
      const { root } = await loadCompilationWorkspace(path);
      options.signal?.throwIfAborted();
      return json({
        root,
        directories: await initializeCompileArtifacts(root),
      });
    }
    if (action === "migrate") {
      const { root } = await loadCompilationWorkspace(path);
      return json(
        await migrateSemanticState(root, {
          write: values["--write"] === "true",
          expectedRevision: values["--expected-revision"],
          engine: { signal: options.signal },
        }),
      );
    }
    if (action === "receipts") {
      const { root } = await loadCompilationWorkspace(path);
      const retainedRoot = values["--handoff-root"]
        ? resolve(values["--handoff-root"])
        : root;
      const handoff = await readImplementationHandoff(
        retainedRoot,
        values["--handoff"],
        { signal: options.signal },
      );
      const [claims, locations] = await Promise.all([
        Deno.readTextFile(resolve(values["--claims"])),
        Deno.readTextFile(resolve(values["--locations"])),
      ]);
      options.signal?.throwIfAborted();
      const imported = await writeReceiptSubmission(
        root,
        handoff,
        claims,
        locations,
      );
      return json({
        handoff: handoff.id,
        untrusted: true,
        claims: imported.submission.claims,
        artifacts: { receipts: imported.id },
      });
    }
    if (action === "verify" && values["--handoff"]) {
      const { root } = await loadCompilationWorkspace(path);
      const verified = await verifyReturnedImplementation({
        root,
        handoff: values["--handoff"],
        receipts: values["--receipts"],
        handoffRoot: values["--handoff-root"]
          ? resolve(values["--handoff-root"])
          : undefined,
        resolved: await (options.core ?? new CoreAdapter()).resolveWorkspace(
          root,
        ),
        engine: { signal: options.signal },
      });
      const exitCode = verified.report.status === "green" ? 0 : 1;
      if (values["--format"] === "turtle") {
        return {
          exitCode,
          stdout: verified.report.evidence.turtle + "\n" +
            verified.report.commandEvidence.turtle,
          stderr: "",
        };
      }
      if (values["--format"] === "markdown") {
        return {
          exitCode,
          stdout: renderReturnedImplementationMarkdown(
            summarizeReturnedImplementation(verified.report),
          ),
          stderr: "",
        };
      }
      return json(verified.report, exitCode);
    }
    const context = await workspaceContext(
      path,
      options.core ?? new CoreAdapter(),
    );
    const engine = { signal: options.signal };
    if (action === "intent") {
      const file = values["--proposals"];
      const command = values["--generator"];
      let provider: SemanticProposalProvider;
      if (options.proposalProvider) provider = options.proposalProvider;
      else if (file) {
        provider = {
          identity: `file:${resolve(file)}`,
          generate: () => Deno.readTextFile(resolve(file)),
        };
      } else if (command) {
        provider = new CommandSemanticProvider({
          command: /[/\\]/.test(command) ? resolve(command) : command,
          args: generatorArgs,
        });
      } else {
        try {
          provider = configuredSemanticProvider(
            context.resolved.workspace.config?.tools.semantic,
            values["--provider"],
          );
        } catch (error) {
          throw new UsageError(
            error instanceof Error ? error.message : String(error),
          );
        }
      }
      const result = await proposeSemanticIntent(
        context.world,
        values["--text"],
        provider,
        { ...engine, renderQuestion: !file },
      );
      const beam = values["--beam"] ?? `intent-${crypto.randomUUID()}`;
      if (result.checkpoint) {
        options.signal?.throwIfAborted();
        await writeWorldBeam(context.root, beam, {
          ...result.checkpoint,
          context: context.receipt,
        });
      }
      const summary = searchSummary(result.search);
      return json({
        ...summary,
        beam: result.checkpoint ? beam : undefined,
        question: result.question ?? summary.question,
        provenance: result.provenance,
      }, summary.status === "green" ? 0 : 1);
    }
    let saved: StoredWorldBeam | undefined;
    if (values["--beam"]) {
      saved = await readWorldBeam(context.root, values["--beam"]);
      if (!saved) {
        throw new SemanticInputError(
          "BEAM_NOT_FOUND",
          "The named semantic beam does not exist.",
        );
      }
    }
    if (saved) {
      let search = await resumeWorldBeam(saved.checkpoint, engine);
      if (action === "answer") {
        current(saved.checkpoint, context);
        if (search.proposition?.fact.id !== values["--fact"]) {
          throw new SemanticInputError(
            "STALE_QUESTION",
            "The supplied fact is not the beam's current discriminating proposition.",
          );
        }
        const checkpoint = {
          ...saved.checkpoint,
          answers: [...saved.checkpoint.answers, {
            factId: values["--fact"],
            value: values["--value"] === "yes",
          }],
        };
        search = await resumeWorldBeam(checkpoint, engine);
        options.signal?.throwIfAborted();
        await writeWorldBeam(
          context.root,
          values["--beam"],
          checkpoint,
          saved.revision,
        );
      }
      if (action === "accept") {
        current(saved.checkpoint, context);
        if (
          search.status !== "selected" ||
          search.selected?.compilation.status !== "green"
        ) {
          throw new SemanticInputError(
            "GREEN_WORLD_REQUIRED",
            "Acceptance requires one selected green semantic world.",
          );
        }
        // Refresh source and canonical receipts immediately before the storage CAS.
        const refreshed = await workspaceContext(
          path,
          options.core ?? new CoreAdapter(),
        );
        current(saved.checkpoint, refreshed);
        const world = search.selected.compilation.world;
        options.signal?.throwIfAborted();
        const accepted = await writeSemanticState(context.root, {
          world,
          receipt: {
            version: 1,
            worldFingerprint: world.fingerprint,
            sourceFingerprint: refreshed.source.world.fingerprint,
            componentBindings: Object.fromEntries(
              refreshed.registry.entries.flatMap((entry) =>
                entry.authoredStructuralId
                  ? [[entry.authoredStructuralId, entry.entity]]
                  : []
              ),
            ),
          },
        }, refreshed.stored?.revision);
        return json({
          status: "green",
          accepted: values["--beam"],
          worldFingerprint: world.fingerprint,
          revision: accepted.revision,
        });
      }
      const summary = searchSummary(search);
      const stale = !saved.checkpoint.context ||
        saved.checkpoint.context.sourceFingerprint !==
          context.receipt.sourceFingerprint ||
        saved.checkpoint.context.canonicalFingerprint !==
          context.receipt.canonicalFingerprint;
      return json(
        { ...summary, beam: values["--beam"], stale },
        summary.status === "green" && !stale ? 0 : 1,
      );
    }
    const compilation = await compileSemanticWorld(context.world, engine);
    if (action === "verify") {
      if (compilation.status !== "green" || context.sourceChanged) {
        throw new SemanticInputError(
          "GREEN_WORLD_REQUIRED",
          "Implementation verification requires current green semantic contracts.",
        );
      }
      const policy = await readImplementationPolicy(context.root);
      if (!policy) {
        throw new UsageError(
          "verify requires host code bindings in .sigil/implementation.json.",
        );
      }
      const verified = await verifyImplementationWorld({
        root: context.root,
        world: context.world,
        policy,
        resolved: context.resolved,
        canonicalRevision: context.stored?.revision ?? null,
        engine,
      });
      const { compilation: implementation, commands } = verified;
      const evidence = verified.evidence!;
      const turtle = serializeSemanticWorld(evidence.world) + "\n" +
        serializeSemanticWorld(commands.world);
      const exitCode = implementation.status === "green" ? 0 : 1;
      options.signal?.throwIfAborted();
      const stage = await recordSemanticStage(context.root, implementation, {
        stage: "implementation-coverage",
        sourceFingerprint: context.source.world.fingerprint,
        evidence,
        mechanical: verified.mechanical,
        extraFiles: {
          "command-checks.json": artifactPayload({
            ...commands,
            world: undefined,
          }),
        },
      });
      const report = {
        status: implementation.status,
        worldFingerprint: context.world.fingerprint,
        codeFingerprint: verified.snapshot.fingerprint,
        checks: verified.mechanical.checks,
        requiredChecks: verified.mechanical.requiredChecks,
        diagnostics: implementation.diagnostics,
        closure: implementation.closure,
        evidence: { ...evidence, world: undefined, turtle },
        commandEvidence: {
          ...commands,
          world: undefined,
          turtle: serializeSemanticWorld(commands.world),
        },
        artifacts: {
          stages: {
            "implementation-coverage": stage,
            ...(verified.nativeArtifact
              ? { "native-evidence": verified.nativeArtifact }
              : {}),
          },
          checks: commands.artifacts,
        },
      };
      const run = await recordCompilationRun(context.root, report, {
        world: context.world.fingerprint,
        source: context.source.world.fingerprint,
        "stage.implementation-coverage": stage,
      });
      options.signal?.throwIfAborted();
      return values["--format"] === "turtle"
        ? { exitCode, stdout: turtle, stderr: "" }
        : json({
          ...report,
          artifacts: { ...report.artifacts, run },
        }, exitCode);
    }
    if (action === "status") {
      let views: unknown;
      if (compilation.status === "green") {
        try {
          const managed = await renderManagedViewSet(compilation);
          views = await inspectManagedViews(
            context.root,
            managed,
            context.stored?.revision ?? null,
          );
        } catch (error) {
          if (!(error instanceof SemanticInputError)) throw error;
        }
      }
      const viewDrift = !!views &&
        ["stale", "edited", "incomplete", "unsupported-version"].includes(
          (views as { state: string }).state,
        );
      const status = context.sourceChanged || viewDrift
        ? compilation.status === "green" ? "yellow" : compilation.status
        : compilation.status;
      return json({
        status,
        sourceChanged: context.sourceChanged,
        worldFingerprint: context.world.fingerprint,
        diagnostics: compilation.diagnostics,
        ...(views ? { views } : {}),
      }, status === "green" ? 0 : 1);
    }
    if (action === "project") {
      const projection = projectGreenSemanticWorld(compilation);
      const managed = await renderManagedViewSet(compilation);
      const worldRevision = context.stored?.revision ?? null;
      const authoredLocations = Object.fromEntries(
        managed.files.map((file) => {
          const authored = context.registry.entryForEntity(file.entity)
            ?.authored;
          if (!authored) return [file.entity, []];
          const forms = [
            { filePath: authored.filePath, declaration: authored.declaration },
            ...authored.expansions.expands,
          ];
          return [
            file.entity,
            forms.map((form) => ({
              path: canonicalWorkspacePath(form.filePath, context.root),
              componentName: form.declaration.name,
              range: form.declaration.range,
            })),
          ];
        }),
      );
      if (values["--write"] || values["--recover"]) {
        if (!worldRevision) {
          throw new SemanticInputError(
            "WORLD_REQUIRED",
            "Managed view publication requires an accepted canonical world.",
          );
        }
        if (
          values["--write"] && values["--expected-revision"] !== worldRevision
        ) {
          throw new SemanticInputError(
            "STALE_WORLD",
            "--expected-revision does not match the currently accepted world.",
          );
        }
        const published = values["--write"]
          ? await writeManagedViews(
            context.root,
            managed,
            worldRevision,
            authoredLocations,
          )
          : await recoverManagedViews(
            context.root,
            values["--transaction"],
            worldRevision,
            managed,
            authoredLocations,
          );
        return json({
          status: "current",
          transaction: published.transaction,
          receipt: published.receipt,
          inspection: await inspectManagedViews(
            context.root,
            managed,
            worldRevision,
          ),
        });
      }
      const views = await inspectManagedViews(
        context.root,
        managed,
        worldRevision,
      );
      if (values["--format"] === "sigil" || values["--format"] === "turtle") {
        return {
          exitCode: 0,
          stdout: projection[values["--format"] as "sigil" | "turtle"],
          stderr: "",
        };
      }
      return json(
        { ...projection, views },
        values["--check"] && views.state !== "current" ? 1 : 0,
      );
    }
    if (action === "slice") {
      if (context.sourceChanged) {
        throw new SemanticInputError(
          "STALE_WORLD",
          "Source contracts changed since the accepted world. Accept current intent before exporting a slice.",
        );
      }
      const component = values["--component"];
      const matches = context.registry.resolve(component);
      if (matches.length !== 1) {
        throw new UsageError(
          matches.length === 0
            ? `No semantic component matched ${JSON.stringify(component)}.`
            : `Semantic component ${JSON.stringify(component)} is ambiguous: ${
              matches.map((entry) => entry.entity).join(", ")
            }.`,
        );
      }
      const subject = matches[0].entity;
      const policy = await readImplementationPolicy(context.root);
      if (!policy) {
        throw new UsageError(
          "slice requires host verifier bindings in .sigil/implementation.json before handoff.",
        );
      }
      options.signal?.throwIfAborted();
      const handoff = await createImplementationHandoff({
        root: context.root,
        world: context.world,
        subjects: [subject],
        sourceFingerprint: context.source.world.fingerprint,
        policy,
        canonicalRevision: context.stored?.revision,
        engine,
      });
      const slice = {
        ...implementationSlice(handoff.compilation, subject),
        obligations: handoff.manifest.obligations.filter((o) =>
          o.subject === subject
        ),
      };
      if (values["--format"] === "egg" || values["--format"] === "turtle") {
        return {
          exitCode: 0,
          stderr: "",
          stdout: values["--format"] === "egg"
            ? serializeEggWorld(handoff.slice)
            : serializeSemanticWorld(handoff.slice),
        };
      }
      return values["--format"] === "text"
        ? {
          exitCode: 0,
          stdout: renderImplementationSlice(slice) +
            `\nARTIFACT\n.sigil/handoffs/${handoff.id}\n`,
          stderr: "",
        }
        : json({
          ...slice,
          handoff: handoff.manifest,
          artifacts: { handoff: handoff.id },
        });
    }
    throw new UsageError("Choose a valid semantic command.");
  } catch (error) {
    if (options.signal?.aborted) {
      return {
        exitCode: 130,
        stdout: "",
        stderr: "Semantic operation cancelled.\n",
      };
    }
    const message = error instanceof Error ? error.message : String(error);
    return {
      exitCode: error instanceof UsageError
        ? 2
        : error instanceof SemanticInputError
        ? 1
        : 3,
      stdout: "",
      stderr: `${message}\n${
        error instanceof UsageError ? "\n" + SEMANTIC_HELP : ""
      }`,
    };
  }
}
