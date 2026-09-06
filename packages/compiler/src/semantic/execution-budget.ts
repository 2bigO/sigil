import { AdapterFailure } from "../adapter-execution-coordinator.ts";

export interface ExecutionBudget {
  readonly signal: AbortSignal;
  remainingMs(): number;
}

export interface ExecutionBudgetHandle extends ExecutionBudget {
  dispose(): void;
}

/** One owned timer and parent cancellation subscription for an operation. */
// @sigil implements packages/compiler/src/compiler.sigil::SigilOneShotCompilation::CompilationInvocation logic
export function createExecutionBudget(
  options: { readonly timeoutMs?: number; readonly signal?: AbortSignal },
): ExecutionBudgetHandle {
  const timeoutMs = options.timeoutMs ?? 120_000;
  if (
    !Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 ||
    timeoutMs > 2_147_483_647
  ) {
    throw new Error("Invalid verification elapsed-time budget.");
  }
  options.signal?.throwIfAborted();
  const controller = new AbortController();
  const deadline = performance.now() + timeoutMs;
  const expired = () =>
    controller.abort(
      new DOMException(
        "Verification elapsed-time budget exhausted.",
        "TimeoutError",
      ),
    );
  const cancel = () => controller.abort(options.signal!.reason);
  options.signal?.addEventListener("abort", cancel, { once: true });
  const timer = setTimeout(expired, timeoutMs);
  return {
    signal: controller.signal,
    remainingMs() {
      if (performance.now() >= deadline && !controller.signal.aborted) {
        expired();
      }
      controller.signal.throwIfAborted();
      return Math.max(1, Math.floor(deadline - performance.now()));
    },
    dispose() {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", cancel);
    },
  };
}

/** Await subprocess cleanup before returning a timeout or cancellation. */
export async function withExecutionBudget<T>(
  options: { readonly timeoutMs?: number; readonly signal?: AbortSignal },
  operation: (budget: ExecutionBudget) => Promise<T>,
): Promise<T> {
  const budget = createExecutionBudget(options);
  try {
    const result = await operation(budget);
    budget.remainingMs();
    return result;
  } catch (error) {
    // An unverified cleanup remains actionable even after timeout/cancellation.
    if (!(error instanceof AdapterFailure && error.kind === "cleanup")) {
      budget.signal.throwIfAborted();
    }
    throw error;
  } finally {
    budget.dispose();
  }
}
