import {
  resolveSemanticRuntime,
  runtimeDoctor,
} from "@qoherent/sigil-compiler";

const runtimeDirectory = Deno.env.get("SIGIL_TEST_RUNTIME");
if (!runtimeDirectory) throw new Error("SIGIL_TEST_RUNTIME is required.");

let missingRuntimeRejected = false;
try {
  await resolveSemanticRuntime();
} catch (error) {
  missingRuntimeRejected = /SIGIL_RUNTIME_DIR|native runtime/i.test(
    String(error),
  );
}
if (!missingRuntimeRejected) {
  throw new Error("A published consumer accepted a missing native runtime.");
}

const runtime = await resolveSemanticRuntime({ runtimeDirectory });
if (runtime.mode !== "explicit") {
  throw new Error(`Expected explicit runtime mode, got ${runtime.mode}.`);
}
const doctor = await runtimeDoctor({ runtimeDirectory });
if (!doctor.ok || doctor.mode !== "explicit") {
  throw new Error(
    `Explicit published runtime failed: ${JSON.stringify(doctor)}`,
  );
}

console.log(JSON.stringify({
  explicit: true,
  missingRuntimeRejected: true,
  doctor: true,
}));
