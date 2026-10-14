/**
 * Test helpers shared by the benchmark's tests. This file is not a test.
 *
 * `writeFakeHost` writes an executable that stands in for a coding-agent CLI.
 * It behaves like the sigil-compute-design orchestrator: it runs the pinned
 * `sigilc` from PATH inside its pass directory, reads every unread source
 * with `(reading ...)` rows (or the planted contradiction), ingests them,
 * writes the readings back into the copied root, checks, and hands back a state.
 */

const interpreterCache = new Map<string, string>();

/** Find the first candidate on PATH that actually runs, caching the result. */
async function resolveInterpreter(
  candidates: readonly string[],
): Promise<string> {
  const key = candidates.join(",");
  const cached = interpreterCache.get(key);
  if (cached) return cached;
  for (const candidate of candidates) {
    try {
      const probe = await new Deno.Command(candidate, {
        args: ["--version"],
        stdout: "null",
        stderr: "null",
      }).output();
      if (probe.success) {
        interpreterCache.set(key, candidate);
        return candidate;
      }
    } catch {
      // Not on PATH; try the next candidate.
    }
  }
  throw new Error(
    `No usable interpreter found among: ${candidates.join(", ")}`,
  );
}

/**
 * A tiny standalone program, compiled once per test process (see
 * `windowsStub` below) and then copied to a fresh path for every fake host.
 * `Deno.execPath()` for a compiled binary reports that copy's own on-disk
 * path -- not the path it was compiled at -- so each copy independently
 * finds its own sibling `.interpreter` file and script (itself, minus the
 * trailing `.exe`) and re-execs `interpreter script ...originalArgs`,
 * forwarding stdio and the exit code.
 *
 * This exists because the natural approach -- a `.cmd` launcher invoking
 * the interpreter via `%*` -- does not work here: Windows routes any
 * `.bat`/`.cmd` spawn through `cmd.exe`, and Rust's standard library (which
 * `Deno.Command` is built on) refuses to forward argument lists like the
 * real agent CLIs', which routinely fail its batch-argument safety check,
 * with "batch file arguments are invalid" -- confirmed live in CI, not
 * merely suspected. A compiled binary is a real Win32 executable, so both
 * this hop (orchestrator -> stub) and the next (stub -> interpreter) use
 * Rust's ordinary, unrestricted argument passing instead.
 */
const WINDOWS_STUB_SOURCE = `
const self = Deno.execPath();
const base = self.slice(0, -".exe".length);
const interpreter = (await Deno.readTextFile(base + ".interpreter")).trim();
const child = new Deno.Command(interpreter, {
  args: [base, ...Deno.args],
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
}).spawn();
const status = await child.status;
Deno.exit(status.code);
`;

let windowsStub: Promise<string> | undefined;
let windowsStubCleanupArmed = false;

/** Compile `WINDOWS_STUB_SOURCE` once per test process; later calls reuse it. */
function compileWindowsStub(): Promise<string> {
  return windowsStub ??= (async () => {
    const dir = await Deno.makeTempDir({ prefix: "slotted-fake-host-stub-" });
    if (!windowsStubCleanupArmed) {
      windowsStubCleanupArmed = true;
      // The compiled stub is a shared, process-lifetime cache (the whole
      // point of memoizing it), so it's cleaned up once here, at process
      // exit, rather than by any individual fake host's own test cleanup.
      globalThis.addEventListener("unload", () => {
        try {
          Deno.removeSync(dir, { recursive: true });
        } catch {
          // Best-effort; nothing else can act once the process is unloading.
        }
      });
    }
    const sourcePath = `${dir}/stub.ts`;
    const outputPath = `${dir}/stub.exe`;
    await Deno.writeTextFile(sourcePath, WINDOWS_STUB_SOURCE);
    const compiled = await new Deno.Command(Deno.execPath(), {
      args: [
        "compile",
        "--allow-run",
        "--allow-read",
        "--output",
        outputPath,
        sourcePath,
      ],
      stdout: "piped",
      stderr: "piped",
    }).output();
    if (!compiled.success) {
      const reason = new TextDecoder().decode(compiled.stderr);
      await Deno.remove(dir, { recursive: true }).catch(() => {});
      throw new Error(
        `failed to compile the Windows fake-host stub: ${reason}`,
      );
    }
    return outputPath;
  })();
}

/**
 * Write `body` (a script whose first line is its shebang) to `path` as an
 * executable a test can hand to `agentExecutables`/`executable:`. POSIX makes
 * the file itself executable via the shebang. Windows has no shebang
 * interpretation at the process-launch level -- `CreateProcess` on a script
 * file fails outright (`%1 is not a valid Win32 application`) -- so there the
 * script is written as plain data and a copy of the compiled stub above is
 * returned instead, pointed at one of `windowsInterpreters` via a sibling
 * `.interpreter` file.
 */
async function writeExecutableScript(
  path: string,
  body: string,
  windowsInterpreters: readonly string[],
): Promise<string> {
  await Deno.writeTextFile(path, body);
  if (Deno.build.os !== "windows") {
    await Deno.chmod(path, 0o755);
    return path;
  }
  const interpreter = await resolveInterpreter(windowsInterpreters);
  await Deno.writeTextFile(`${path}.interpreter`, interpreter);
  const stub = await compileWindowsStub();
  const launcherPath = `${path}.exe`;
  await Deno.copyFile(stub, launcherPath);
  return launcherPath;
}

/**
 * Write a POSIX `/bin/sh` fake host. `body` is the script after the shebang
 * line, which this prepends. On Windows the script runs under Git for
 * Windows' bundled `bash`/`sh` (present on PATH on GitHub-hosted Windows
 * runners), which understands the same POSIX syntax.
 */
export async function writeShellFakeHost(
  path: string,
  body: string,
): Promise<string> {
  return await writeExecutableScript(path, `#!/bin/sh\n${body}`, [
    "bash",
    "sh",
  ]);
}

export interface FakeHostOptions {
  /** Which host's output shape to imitate. */
  readonly host?: "claude" | "codex";
  /** Read Booking's two range-change Facets as a contradiction. */
  readonly planted?: boolean;
  /** A source the fake never reads, so it stays unread. */
  readonly skipSource?: string;
  /** The state to hand back instead of the check's real one. */
  readonly handback?: string;
  /** Omit the `Hand-back state:` line entirely. */
  readonly noHandback?: boolean;
  /** Models and efforts the fake's children report. Codex only for efforts. */
  readonly childModel?: string;
  readonly childEffort?: string;
  /** Exit non-zero after writing the readings. */
  readonly exitCode?: number;
  /** A file the fake writes into, outside its pass directory. */
  readonly tamperPath?: string;
  /** Sleep this long before doing anything, to exercise timeouts. */
  readonly sleepSeconds?: number;
  /** Read only this many sources, so the rest stay unread. */
  readonly stopAfterSources?: number;
  /** Sleep this long after the readings are stored and before handing back. */
  readonly sleepAfterSeconds?: number;
}

const SCRIPT = String.raw`#!/usr/bin/env python3
import json, os, shutil, subprocess, sys, time

OPTIONS = json.loads(__OPTIONS__)

if sys.argv[1:2] == ['--version']:
    print('fake-host 1.0')
    sys.exit(0)

argv = sys.argv[1:]
with open(os.path.join(os.getcwd(), 'run', 'argv.json'), 'w') as f:
    json.dump({'argv': argv, 'cwd': os.getcwd(), 'codexHome': os.environ.get('CODEX_HOME'),
               'sigilc': shutil.which('sigilc')}, f)

if OPTIONS.get('sleepSeconds'):
    time.sleep(OPTIONS['sleepSeconds'])

def claims(*args):
    return subprocess.run(['sigilc', *args], capture_output=True, text=True)

store_entries = os.listdir('store')
with open('run/start-state.json', 'w') as f:
    json.dump({
        'storeEntries': store_entries,
        'rootConfig': os.path.exists('root/.sigil/config.json'),
        'rootClaims': os.path.exists('root/.sigil/claims'),
        'skills': sorted(os.listdir('skills')),
        'computeSkill': os.path.exists('skills/sigil-compute-design/SKILL.md'),
    }, f)

first = claims('check', '--root', 'root', '--store', 'store')
report = json.load(open(json.loads(first.stdout)['report']))
sources = sorted({unit['source'] for unit in report['unread']})
planted = OPTIONS.get('planted', False)
read_count = 0
for source in sources:
    if source == OPTIONS.get('skipSource'):
        continue
    if OPTIONS.get('stopAfterSources') is not None and read_count >= OPTIONS['stopAfterSources']:
        break
    read_count += 1
    prep = 'run/prep-' + source
    prepared = claims('prepare', '--source', source, '--out', prep, '--root', 'root', '--store', 'store')
    if prepared.returncode != 0:
        sys.stderr.write(prepared.stderr)
        sys.exit(3)
    request = json.load(open(prep + '/request.json'))
    rows = []
    for row in request['rows']:
        if row.get('context'):
            continue
        facet = json.dumps(row['facet'])
        if planted and row['section'] == 'interface' and 'Booking provides a renter a *range change*' in row['prose']:
            rows.append('(claim ' + facet + ' "Booking" "provides" "range change" "required" "true")')
        elif planted and row['section'] == 'constraints' and 'Booking must not provide a range change' in row['prose']:
            rows.append('(claim ' + facet + ' "Booking" "provides" "range change" "required" "false")')
        else:
            rows.append('(reading ' + facet + ' "no-commitment")')
    answer = 'run/' + source + '.rows'
    with open(answer, 'w') as f:
        f.write('\n'.join(rows) + '\n')
    ingested = claims('ingest', '--binding', prep + '/binding.json', '--claims', answer, '--root', 'root', '--store', 'store')
    if ingested.returncode not in (0, 1):
        sys.stderr.write(ingested.stderr)
        sys.exit(3)

# The skill's write-back: readings land in the copied root, never the fixture.
os.makedirs('root/.sigil/claims/interpretations', exist_ok=True)
for name in os.listdir('store/claims/interpretations'):
    shutil.copy(os.path.join('store/claims/interpretations', name),
                os.path.join('root/.sigil/claims/interpretations', name))

if OPTIONS.get('tamperPath'):
    with open(OPTIONS['tamperPath'], 'w') as f:
        f.write('tampered')

if OPTIONS.get('sleepAfterSeconds'):
    time.sleep(OPTIONS['sleepAfterSeconds'])

final = claims('check', '--root', 'root', '--store', 'store')
state = json.loads(final.stdout)['state']
handback = OPTIONS.get('handback') or state

lines = []
text = 'Final check: ' + state + '.'
if not OPTIONS.get('noHandback'):
    text += '\nHand-back state: ' + handback
child_model = OPTIONS.get('childModel', 'served-fake-model')
if OPTIONS.get('host') == 'codex':
    home = os.environ['CODEX_HOME']
    sessions = os.path.join(home, 'sessions', '2026', '10', '08')
    os.makedirs(sessions, exist_ok=True)
    def rollout(name, child, model, effort, calls):
        with open(os.path.join(sessions, 'rollout-' + name + '.jsonl'), 'w') as f:
            meta = {'type': 'session_meta', 'payload': {'source': {'subagent': {}} if child else 'exec'}}
            f.write(json.dumps(meta) + '\n')
            f.write(json.dumps({'type': 'turn_context', 'payload': {'model': model, 'effort': effort}}) + '\n')
            for call in calls:
                f.write(json.dumps({'type': 'response_item', 'payload': {'type': 'function_call', 'name': call[0], 'arguments': json.dumps(call[1])}}) + '\n')
    rollout('parent', False, 'served-fake-model', OPTIONS.get('parentEffort', 'medium'),
            [('spawn_agent', {'fork_turns': 'none'})])
    if 'childEffort' in OPTIONS or child_model:
        rollout('child', True, child_model, OPTIONS.get('childEffort', 'medium'), [])
    for i, arg in enumerate(argv):
        if arg == '--output-last-message':
            with open(argv[i + 1], 'w') as f:
                f.write(text)
else:
    print(json.dumps({'type': 'system', 'subtype': 'init', 'agents': ['interpreter']}))
    print(json.dumps({'type': 'assistant', 'message': {'model': 'served-fake-model'}}))
    print(json.dumps({'type': 'assistant', 'parent_tool_use_id': 'toolu_1', 'message': {'model': child_model}}))
    print(json.dumps({'type': 'result', 'result': text}))
sys.exit(OPTIONS.get('exitCode', 0))
`;

/** Write an executable fake host to `path`. */
export async function writeFakeHost(
  path: string,
  options: FakeHostOptions = {},
): Promise<string> {
  return await writeExecutableScript(
    path,
    SCRIPT.replace("__OPTIONS__", JSON.stringify(JSON.stringify(options))),
    ["python3", "python"],
  );
}
