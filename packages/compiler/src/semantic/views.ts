import { resolve } from "node:path";
import {
  artifactJson,
  atomicCompileFile,
  initializeCompileArtifacts,
  withCompileArtifactLock,
} from "./artifacts.ts";
import { digest, SemanticInputError } from "./turtle.ts";
import {
  MANAGED_VIEW_RENDERER_VERSION,
  type ManagedViewSet,
  type ViewInspection,
  type ViewReceiptAuthoredLocation,
  type ViewReceiptFile,
  type ViewReceiptV1,
} from "./view-model.ts";
import { readSemanticState } from "./store.ts";
import { parseUniqueJson } from "./proposal-protocol.ts";

const MAX_RECEIPT_BYTES = 8 * 1024 * 1024;
const MAX_FILES = 4096;
const MAX_VIEW_BYTES = 32 * 1024 * 1024;
const VIEW_HASH = /^[a-f0-9]{64}$/;

function invalid(message: string): never {
  throw new SemanticInputError("INVALID_MANAGED_VIEWS", message);
}

function safeViewPath(path: string): boolean {
  return /^\.sigil\/views\/[a-f0-9]{64}\.sigil$/.test(path);
}

function safeAuthoredPath(path: string): boolean {
  return !!path && path.length <= 4096 && !path.includes("\0") &&
    !path.includes("\\") && !path.startsWith("/") &&
    !path.startsWith("./") && !path.includes("//") &&
    !path.split("/").some((part) => !part || part === "." || part === "..");
}

function validRange(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const raw = value as Record<string, unknown>;
  if (Object.keys(raw).some((key) => !["start", "end"].includes(key))) {
    return false;
  }
  const point = (candidate: unknown): boolean => {
    if (
      !candidate || typeof candidate !== "object" || Array.isArray(candidate)
    ) return false;
    const item = candidate as Record<string, unknown>;
    return Object.keys(item).every((key) => ["line", "column"].includes(key)) &&
      Number.isInteger(item.line) && Number.isInteger(item.column) &&
      (item.line as number) >= 1 && (item.column as number) >= 1;
  };
  if (!point(raw.start) || !point(raw.end)) return false;
  const start = raw.start as { line: number; column: number };
  const end = raw.end as { line: number; column: number };
  return end.line > start.line ||
    end.line === start.line && end.column >= start.column;
}

async function receipt(value: unknown): Promise<ViewReceiptV1> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    invalid("Managed view receipt must be an object.");
  }
  const raw = value as Record<string, unknown>;
  if (
    raw.version !== 1 ||
    raw.rendererVersion !== MANAGED_VIEW_RENDERER_VERSION ||
    typeof raw.worldRevision !== "string" ||
    !VIEW_HASH.test(raw.worldRevision) ||
    typeof raw.worldFingerprint !== "string" ||
    !VIEW_HASH.test(raw.worldFingerprint) ||
    !Array.isArray(raw.files) || raw.files.length > MAX_FILES ||
    Object.keys(raw).some((key) =>
      ![
        "version",
        "rendererVersion",
        "worldRevision",
        "worldFingerprint",
        "files",
      ]
        .includes(key)
    )
  ) invalid("Managed view receipt has an invalid version or identity.");
  const files: ViewReceiptFile[] = [];
  const paths = new Set<string>();
  const entities = new Set<string>();
  for (const item of raw.files as unknown[]) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      invalid("Managed view receipt contains an invalid file entry.");
    }
    const file = item as Record<string, unknown>;
    if (
      typeof file.entity !== "string" || !file.entity ||
      file.entity.length > 4096 || file.entity.includes("\0") ||
      typeof file.path !== "string" || !safeViewPath(file.path) ||
      typeof file.componentName !== "string" || !file.componentName ||
      typeof file.contentHash !== "string" ||
      !VIEW_HASH.test(file.contentHash) ||
      !Array.isArray(file.authoredLocations) ||
      file.authoredLocations.length > 4096 ||
      !Array.isArray(file.locations) ||
      file.locations.length > 4096 ||
      Object.keys(file).some((key) =>
        ![
          "entity",
          "path",
          "componentName",
          "contentHash",
          "authoredLocations",
          "locations",
        ].includes(key)
      )
    ) invalid("Managed view receipt contains an invalid file entry.");
    if (paths.has(file.path) || entities.has(file.entity)) {
      invalid("Managed view receipt contains duplicate paths or entities.");
    }
    if (file.path !== `.sigil/views/${await digest(file.entity)}.sigil`) {
      invalid(
        `Managed view receipt path does not match entity ${file.entity}.`,
      );
    }
    for (const authored of file.authoredLocations as unknown[]) {
      if (
        !authored || typeof authored !== "object" || Array.isArray(authored)
      ) {
        invalid("Managed view receipt contains an invalid authored location.");
      }
      const location = authored as Record<string, unknown>;
      if (
        typeof location.path !== "string" || !safeAuthoredPath(location.path) ||
        typeof location.componentName !== "string" || !location.componentName ||
        !validRange(location.range) ||
        Object.keys(location).some((key) =>
          !["path", "componentName", "range"].includes(key)
        )
      ) invalid("Managed view receipt contains an invalid authored location.");
    }
    for (const location of file.locations as unknown[]) {
      if (
        !location || typeof location !== "object" || Array.isArray(location)
      ) {
        invalid("Managed view receipt contains an invalid generated location.");
      }
      const itemLocation = location as Record<string, unknown>;
      if (
        !Array.isArray(itemLocation.factIds) ||
        itemLocation.factIds.length > 4096 ||
        itemLocation.factIds.some((id) =>
          typeof id !== "string" || !id || id.length > 4096
        ) ||
        !Array.isArray(itemLocation.contractIds) ||
        itemLocation.contractIds.length > 4096 ||
        itemLocation.contractIds.some((id) => typeof id !== "string" || !id) ||
        !validRange(itemLocation.range) ||
        Object.keys(itemLocation).some((key) =>
          !["factIds", "contractIds", "range"].includes(key)
        )
      ) invalid("Managed view receipt contains an invalid generated location.");
    }
    paths.add(file.path);
    entities.add(file.entity);
    files.push(file as unknown as ViewReceiptFile);
  }
  return { ...raw, files } as unknown as ViewReceiptV1;
}

async function readText(
  path: string,
  max = MAX_RECEIPT_BYTES,
): Promise<string | undefined> {
  try {
    const stat = await Deno.lstat(path);
    if (!stat.isFile || stat.isSymlink || stat.size > max) {
      invalid(`Managed view metadata is not a bounded regular file: ${path}.`);
    }
    const bytes = await Deno.readFile(path);
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      invalid(`Managed view metadata is not valid UTF-8: ${path}.`);
    }
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return undefined;
    throw error;
  }
}

function parseStrictJson(source: string, context: string): unknown {
  try {
    return parseUniqueJson(source, MAX_RECEIPT_BYTES);
  } catch {
    invalid(`${context} is not valid JSON or contains duplicate object keys.`);
  }
}

export async function viewReceiptFor(
  set: ManagedViewSet,
  worldRevision: string,
  authoredLocations: Readonly<
    Record<string, readonly ViewReceiptAuthoredLocation[]>
  > = {},
): Promise<ViewReceiptV1> {
  if (!VIEW_HASH.test(worldRevision)) {
    invalid("World revision is not a fingerprint.");
  }
  if (set.files.length > MAX_FILES) {
    invalid("Managed view file count exceeds 4096.");
  }
  let bytes = 0;
  const files: ViewReceiptFile[] = [];
  for (const file of set.files) {
    if (!safeViewPath(file.path) || !VIEW_HASH.test(file.contentHash)) {
      invalid(`Unsafe managed view path or hash: ${file.path}.`);
    }
    bytes += new TextEncoder().encode(file.content).length;
    if (
      file.path !== `.sigil/views/${await digest(file.entity)}.sigil` ||
      await digest(file.content) !== file.contentHash
    ) {
      invalid(`Managed view content hash does not match ${file.path}.`);
    }
    files.push({
      entity: file.entity,
      path: file.path,
      componentName: file.componentName,
      contentHash: file.contentHash,
      authoredLocations: authoredLocations[file.entity] ?? [],
      locations: file.locations,
    });
  }
  if (bytes > MAX_VIEW_BYTES) invalid("Managed view bytes exceed 32 MiB.");
  return {
    version: 1,
    rendererVersion: MANAGED_VIEW_RENDERER_VERSION,
    worldRevision,
    worldFingerprint: set.worldFingerprint,
    files,
  };
}

export async function readManagedViewReceipt(
  root: string,
): Promise<ViewReceiptV1 | undefined> {
  const source = await readText(resolve(root, ".sigil/views/current.json"));
  if (source === undefined) return undefined;
  const value = parseStrictJson(source, "Managed view receipt");
  return await receipt(value);
}

async function viewFiles(root: string): Promise<string[]> {
  const directory = resolve(root, ".sigil/views");
  try {
    const stat = await Deno.lstat(directory);
    if (!stat.isDirectory || stat.isSymlink) {
      invalid("Managed view directory is unsafe.");
    }
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return [];
    throw error;
  }
  const entries: string[] = [];
  for await (const entry of Deno.readDir(directory)) {
    if (entry.name === "current.json") continue;
    if (
      !entry.isFile || entry.isSymlink ||
      !VIEW_HASH.test(entry.name.replace(/\.sigil$/, "")) ||
      !entry.name.endsWith(".sigil")
    ) {
      invalid(`Unexpected managed view entry: ${entry.name}.`);
    }
    entries.push(`.sigil/views/${entry.name}`);
  }
  return entries.sort();
}

export async function inspectManagedViews(
  root: string,
  expected: ManagedViewSet,
  worldRevision: string | null,
): Promise<ViewInspection> {
  const pendingRoot = resolve(root, ".sigil/cache/view-transactions");
  const transactions: string[] = [];
  try {
    for await (const entry of Deno.readDir(pendingRoot)) {
      if (entry.isSymlink) {
        invalid(`Managed view transaction entry is a symlink: ${entry.name}.`);
      }
      if (!entry.isDirectory || !VIEW_HASH.test(entry.name)) continue;
      try {
        const complete = await Deno.lstat(
          resolve(pendingRoot, entry.name, "complete"),
        );
        if (complete.isSymlink || !complete.isFile) {
          invalid(
            `Managed view transaction ${entry.name} has an invalid complete marker.`,
          );
        }
        continue;
      } catch (error) {
        if (!(error instanceof Deno.errors.NotFound)) throw error;
      }
      const manifestPath = resolve(
        pendingRoot,
        entry.name,
        "manifest.json",
      );
      const manifestSource = await readText(manifestPath, MAX_RECEIPT_BYTES);
      if (manifestSource === undefined) {
        invalid(`Managed view transaction ${entry.name} has no manifest.`);
      }
      const body = await validateTransaction(
        parseStrictJson(manifestSource, "Managed view transaction"),
      );
      if (await digest(artifactJson(body)) !== entry.name) {
        invalid(`Managed view transaction ${entry.name} hash does not match.`);
      }
      transactions.push(entry.name);
    }
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
  transactions.sort();
  const differences: {
    path: string;
    kind: "missing" | "changed" | "unexpected" | "metadata";
  }[] = [];
  let recorded: ViewReceiptV1 | undefined;
  let state: ViewInspection["state"] = "not-installed";
  try {
    recorded = await readManagedViewReceipt(root);
  } catch (error) {
    if (error instanceof SemanticInputError) {
      return {
        version: 1,
        state: "unsupported-version",
        worldRevision,
        recordedWorldRevision: null,
        transactions,
        differences,
      };
    }
    throw error;
  }
  const actual = await viewFiles(root);
  if (transactions.length) state = "incomplete";
  if (!recorded && actual.length) {
    for (const path of actual) differences.push({ path, kind: "unexpected" });
    state = "incomplete";
  } else if (recorded) {
    const expectedByPath = new Map(
      expected.files.map((file) => [file.path, file]),
    );
    const recordedByPath = new Map(
      recorded.files.map((file) => [file.path, file]),
    );
    for (const file of expected.files) {
      const old = recordedByPath.get(file.path);
      if (!old) differences.push({ path: file.path, kind: "missing" });
      else if (old.contentHash !== file.contentHash) {
        differences.push({ path: file.path, kind: "metadata" });
      }
      const source = await readText(resolve(root, file.path), MAX_VIEW_BYTES);
      if (source === undefined) {
        differences.push({ path: file.path, kind: "missing" });
      } else if (await digest(source) !== old?.contentHash) {
        differences.push({ path: file.path, kind: "changed" });
      }
      expectedByPath.delete(file.path);
    }
    for (const path of actual) {
      if (!expectedByPath.has(path) && !recordedByPath.has(path)) {
        differences.push({ path, kind: "unexpected" });
      }
    }
    for (const file of recorded.files) {
      if (
        !expectedByPath.has(file.path) &&
        !expected.files.some((candidate) => candidate.path === file.path)
      ) {
        differences.push({ path: file.path, kind: "unexpected" });
      }
    }
    if (transactions.length) state = "incomplete";
    else if (differences.some((d) => d.kind === "changed")) state = "edited";
    else if (
      recorded.worldRevision !== worldRevision ||
      recorded.worldFingerprint !== expected.worldFingerprint
    ) state = "stale";
    else if (differences.length) state = "incomplete";
    else state = "current";
  }
  differences.sort((a, b) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : a.kind < b.kind ? -1 : 1
  );
  return {
    version: 1,
    state,
    worldRevision,
    recordedWorldRevision: recorded?.worldRevision ?? null,
    transactions,
    differences,
  };
}

interface ViewTransaction {
  readonly version: 1;
  readonly worldRevision: string;
  readonly before: Readonly<Record<string, string | null>>;
  readonly after: Readonly<Record<string, string | null>>;
  readonly receipt: { before: ViewReceiptV1 | null; after: ViewReceiptV1 };
  readonly payloads: Readonly<Record<string, string>>;
}

async function validateTransaction(value: unknown): Promise<ViewTransaction> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    invalid("Managed view transaction must be an object.");
  }
  const raw = value as Record<string, unknown>;
  if (
    raw.version !== 1 || typeof raw.worldRevision !== "string" ||
    !VIEW_HASH.test(raw.worldRevision) || !raw.before ||
    typeof raw.before !== "object" || Array.isArray(raw.before) ||
    !raw.after || typeof raw.after !== "object" || Array.isArray(raw.after) ||
    !raw.payloads || typeof raw.payloads !== "object" ||
    Array.isArray(raw.payloads) || !raw.receipt ||
    typeof raw.receipt !== "object" || Array.isArray(raw.receipt) ||
    Object.keys(raw).some((key) =>
      !["version", "worldRevision", "before", "after", "receipt", "payloads"]
        .includes(key)
    )
  ) invalid("Managed view transaction has an invalid schema.");
  const paths = (
    value: unknown,
    field: string,
  ): Record<string, string | null> => {
    const result: Record<string, string | null> = {};
    for (
      const [path, hash] of Object.entries(value as Record<string, unknown>)
    ) {
      if (
        !safeViewPath(path) ||
        !(hash === null || typeof hash === "string" && VIEW_HASH.test(hash))
      ) {
        invalid(
          `Managed view transaction ${field} contains an unsafe path or hash.`,
        );
      }
      result[path] = hash as string | null;
    }
    if (Object.keys(result).length > MAX_FILES) {
      invalid(`Managed view transaction ${field} exceeds its file bound.`);
    }
    return result;
  };
  const before = paths(raw.before, "before");
  const after = paths(raw.after, "after");
  const payloads: Record<string, string> = {};
  if (
    artifactJson(Object.keys(before).sort()) !==
      artifactJson(Object.keys(after).sort())
  ) {
    invalid("Managed view transaction before/after paths disagree.");
  }
  for (
    const [path, payload] of Object.entries(
      raw.payloads as Record<string, unknown>,
    )
  ) {
    if (
      !safeViewPath(path) || typeof payload !== "string" ||
      await digest(payload) !== after[path] || after[path] === null
    ) {
      invalid(`Managed view transaction payload does not match ${path}.`);
    }
    payloads[path] = payload;
  }
  for (const [path, next] of Object.entries(after)) {
    if (next !== null && !(path in payloads)) {
      invalid(`Managed view transaction is missing payload ${path}.`);
    }
    if (next === null && path in payloads) {
      invalid(`Managed view transaction contains a deletion payload ${path}.`);
    }
  }
  const receiptValue = raw.receipt as Record<string, unknown>;
  if (
    Object.keys(receiptValue).some((key) =>
      !["before", "after"].includes(key)
    ) ||
    !(receiptValue.before === null || receiptValue.before &&
        typeof receiptValue.before === "object") ||
    !receiptValue.after || typeof receiptValue.after !== "object"
  ) invalid("Managed view transaction receipts are malformed.");
  const afterReceipt = await receipt(receiptValue.after);
  const beforeReceipt = receiptValue.before === null
    ? null
    : await receipt(receiptValue.before);
  const receiptPaths = new Set(afterReceipt.files.map((file) => file.path));
  const afterFiles = new Set(
    Object.entries(after).filter(([, hash]) => hash !== null).map(([path]) =>
      path
    ),
  );
  if (
    artifactJson([...afterFiles].sort()) !==
      artifactJson([...receiptPaths].sort())
  ) {
    invalid("Managed view transaction after-state and receipt disagree.");
  }
  if (
    artifactJson(Object.keys(payloads).sort()) !==
      artifactJson([...receiptPaths].sort())
  ) {
    invalid("Managed view transaction payloads and receipt disagree.");
  }
  const encoded = artifactJson({
    version: 1,
    worldRevision: raw.worldRevision,
    before,
    after,
    receipt: { before: beforeReceipt, after: afterReceipt },
    payloads,
  });
  if (encoded.length > MAX_RECEIPT_BYTES) {
    invalid("Managed view transaction exceeds its size limit.");
  }
  return {
    version: 1,
    worldRevision: raw.worldRevision as string,
    before,
    after,
    receipt: { before: beforeReceipt, after: afterReceipt },
    payloads,
  };
}

async function hashState(root: string, path: string): Promise<string | null> {
  const source = await readText(resolve(root, path), MAX_VIEW_BYTES);
  return source === undefined ? null : await digest(source);
}

export interface ManagedViewPublicationOptions {
  /** Re-read caller-owned source/world identity while both locks are held. */
  readonly validateCurrent?: () => Promise<void>;
  readonly lock?: import("./artifacts.ts").CompileArtifactLockOptions;
}

/** Install a rendered set through a recoverable world-then-views transaction. */
export async function writeManagedViews(
  root: string,
  set: ManagedViewSet,
  expectedRevision: string,
  authoredLocations: Readonly<
    Record<string, readonly ViewReceiptAuthoredLocation[]>
  > = {},
  options: ManagedViewPublicationOptions = {},
): Promise<{ readonly transaction: string; readonly receipt: ViewReceiptV1 }> {
  if (!VIEW_HASH.test(expectedRevision)) {
    invalid("Expected world revision is invalid.");
  }
  await initializeCompileArtifacts(root);
  await Deno.mkdir(resolve(root, ".sigil/views"), { recursive: true });
  await Deno.mkdir(resolve(root, ".sigil/cache/view-transactions"), {
    recursive: true,
  });
  for (
    const directory of [
      resolve(root, ".sigil/views"),
      resolve(root, ".sigil/cache/view-transactions"),
    ]
  ) {
    const stat = await Deno.lstat(directory);
    if (!stat.isDirectory || stat.isSymlink) {
      invalid("Managed view storage directory is unsafe.");
    }
  }
  return withCompileArtifactLock(
    root,
    "world",
    () =>
      withCompileArtifactLock(root, "views", async () => {
        const currentState = await readSemanticState(root);
        if (currentState && currentState.revision !== expectedRevision) {
          invalid("Accepted world changed before managed view publication.");
        }
        await options.validateCurrent?.();
        const pending = await inspectManagedViews(root, set, expectedRevision);
        if (
          pending.transactions.length ||
          ["edited", "incomplete", "unsupported-version"].includes(
            pending.state,
          )
        ) {
          invalid("An unresolved or edited managed view generation exists.");
        }
        const previous = await readManagedViewReceipt(root);
        const actual = await viewFiles(root);
        if (!previous && actual.length) {
          invalid("Existing managed view files are not owned.");
        }
        if (previous) {
          for (const file of previous.files) {
            const current = await hashState(root, file.path);
            if (current !== file.contentHash) {
              invalid(`Managed view was edited: ${file.path}.`);
            }
          }
        }
        const next = await viewReceiptFor(
          set,
          expectedRevision,
          authoredLocations,
        );
        const before: Record<string, string | null> = {};
        const after: Record<string, string | null> = {};
        const payloads: Record<string, string> = {};
        for (const file of previous?.files ?? []) {
          before[file.path] = file.contentHash;
        }
        for (const file of set.files) {
          before[file.path] ??= await hashState(root, file.path);
          after[file.path] = file.contentHash;
          payloads[file.path] = file.content;
        }
        for (const path of Object.keys(before)) after[path] ??= null;
        const transactionBody: ViewTransaction = {
          version: 1,
          worldRevision: expectedRevision,
          before,
          after,
          receipt: { before: previous ?? null, after: next },
          payloads,
        };
        const transaction = await digest(artifactJson(transactionBody));
        const txRoot = resolve(
          root,
          ".sigil/cache/view-transactions",
          transaction,
        );
        try {
          const complete = await Deno.lstat(resolve(txRoot, "complete"));
          if (complete.isFile && !complete.isSymlink) {
            return { transaction, receipt: next };
          }
        } catch (error) {
          if (!(error instanceof Deno.errors.NotFound)) throw error;
        }
        await Deno.mkdir(txRoot, { recursive: true });
        const manifest = artifactJson(transactionBody);
        try {
          const existing = await readText(
            resolve(txRoot, "manifest.json"),
            MAX_RECEIPT_BYTES,
          );
          if (existing !== undefined && existing !== manifest) {
            invalid(
              "Managed view transaction directory has a conflicting manifest.",
            );
          }
          if (existing === undefined) {
            await atomicCompileFile(
              root,
              resolve(txRoot, "manifest.json"),
              manifest,
            );
          }
        } catch (error) {
          if (!(error instanceof Deno.errors.NotFound)) throw error;
        }
        for (const [path, text] of Object.entries(payloads)) {
          await atomicCompileFile(
            root,
            resolve(txRoot, path.slice(".sigil/views/".length)),
            text,
          );
        }
        for (const path of Object.keys(after).sort()) {
          const current = await hashState(root, path);
          if (current !== before[path]) {
            invalid(
              `Managed view changed during publication: ${path}.`,
            );
          }
          if (after[path] === null) {
            if (current !== null) await Deno.remove(resolve(root, path));
          } else {
            await atomicCompileFile(root, resolve(root, path), payloads[path]);
          }
        }
        await options.validateCurrent?.();
        const finalState = await readSemanticState(root);
        if (finalState && finalState.revision !== expectedRevision) {
          invalid("Accepted world changed during managed view publication.");
        }
        await atomicCompileFile(
          root,
          resolve(root, ".sigil/views/current.json"),
          artifactJson(next),
        );
        await atomicCompileFile(
          root,
          resolve(txRoot, "complete"),
          "complete\n",
        );
        return { transaction, receipt: next };
      }, options.lock),
    options.lock,
  );
}

export async function recoverManagedViews(
  root: string,
  transaction: string,
  expectedRevision: string,
  expected: ManagedViewSet,
  authoredLocations: Readonly<
    Record<string, readonly ViewReceiptAuthoredLocation[]>
  > = {},
  options: ManagedViewPublicationOptions = {},
): Promise<{ readonly transaction: string; readonly receipt: ViewReceiptV1 }> {
  if (!VIEW_HASH.test(transaction)) invalid("Transaction identity is invalid.");
  const txRoot = resolve(root, ".sigil/cache/view-transactions", transaction);
  const source = await readText(resolve(txRoot, "manifest.json"));
  if (!source) invalid("Managed view transaction is missing.");
  const body = await validateTransaction(
    parseStrictJson(source, "Managed view transaction"),
  );
  if (await digest(artifactJson(body)) !== transaction) {
    invalid("Managed view transaction hash does not match its directory.");
  }
  try {
    const complete = await Deno.lstat(resolve(txRoot, "complete"));
    if (complete.isSymlink || !complete.isFile) {
      invalid("Managed view transaction has an invalid complete marker.");
    }
    invalid("Managed view transaction is already complete.");
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
  if (body.worldRevision !== expectedRevision) {
    invalid("Managed view transaction targets a different world revision.");
  }
  const next = await viewReceiptFor(
    expected,
    expectedRevision,
    authoredLocations,
  );
  if (artifactJson(body.receipt.after) !== artifactJson(next)) {
    invalid("Managed view transaction is stale.");
  }
  const expectedPaths = new Set(expected.files.map((file) => file.path));
  for (const [path, hash] of Object.entries(body.after)) {
    if (hash !== null && !expectedPaths.has(path)) {
      invalid(
        "Managed view transaction contains an unexpected generated file.",
      );
    }
  }
  for (const file of expected.files) {
    if (body.after[file.path] !== file.contentHash) {
      invalid("Managed view transaction omits an expected generated file.");
    }
  }
  const state = await readSemanticState(root);
  if (state?.revision !== expectedRevision) {
    invalid("Accepted world advanced since this transaction was prepared.");
  }
  for (const [path, after] of Object.entries(body.after)) {
    if (!safeViewPath(path)) {
      invalid("Managed view transaction contains an unsafe path.");
    }
    const current = await hashState(root, path);
    if (current !== body.before[path] && current !== after) {
      invalid(
        `Managed view changed after the transaction was prepared: ${path}.`,
      );
    }
    if (after !== null) {
      const payload = body.payloads[path];
      if (typeof payload !== "string" || await digest(payload) !== after) {
        invalid(`Managed view transaction payload does not match ${path}.`);
      }
    }
  }
  await initializeCompileArtifacts(root);
  await Deno.mkdir(resolve(root, ".sigil/views"), { recursive: true });
  const viewDirectory = await Deno.lstat(resolve(root, ".sigil/views"));
  if (!viewDirectory.isDirectory || viewDirectory.isSymlink) {
    invalid("Managed view storage directory is unsafe.");
  }
  return withCompileArtifactLock(
    root,
    "world",
    () =>
      withCompileArtifactLock(root, "views", async () => {
        const currentState = await readSemanticState(root);
        if (currentState && currentState.revision !== expectedRevision) {
          invalid("Accepted world advanced during managed view recovery.");
        }
        await options.validateCurrent?.();
        for (const path of Object.keys(body.after).sort()) {
          const current = await hashState(root, path);
          if (current === body.after[path]) continue;
          if (body.after[path] === null) {
            if (current !== null) await Deno.remove(resolve(root, path));
          } else {
            await atomicCompileFile(
              root,
              resolve(root, path),
              body.payloads[path],
            );
          }
        }
        await options.validateCurrent?.();
        const finalState = await readSemanticState(root);
        if (finalState && finalState.revision !== expectedRevision) {
          invalid("Accepted world advanced during managed view recovery.");
        }
        await atomicCompileFile(
          root,
          resolve(root, ".sigil/views/current.json"),
          artifactJson(next),
        );
        await atomicCompileFile(
          root,
          resolve(txRoot, "complete"),
          "complete\n",
        );
        return { transaction, receipt: next };
      }, options.lock),
    options.lock,
  );
}
