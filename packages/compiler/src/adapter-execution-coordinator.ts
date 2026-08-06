import type {
  AdapterCleanupRecoveryEvidence,
  AdapterFailureKind,
} from "./types.ts";

export class AdapterFailure extends Error {
  constructor(
    readonly kind: AdapterFailureKind,
    message: string,
    readonly recovery?: AdapterCleanupRecoveryEvidence,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "AdapterFailure";
  }
}

export interface AdapterExecutionOperation<T> {
  readonly elapsedOrigin: number;
  readonly elapsedTimeMs: number;
  readonly implementationIdentity: string;
  readonly signal?: AbortSignal;
  invoke(
    signal: AbortSignal,
    resources: AdapterExecutionResources,
  ): Promise<T>;
}

export interface AdapterExecutionResources {
  register(identity: string): void;
  released(identity: string): void;
  cleanupAttempt(description: string): void;
  observationFailure(description: string): void;
}

// @sigil implements packages/compiler/src/adapter-execution-coordinator.sigil::SigilAgentAdapterExecutionCoordinator::AgentAdapterExecutionCoordinator interface,logic,constraints,cases
export async function coordinateAdapterExecution<T>(
  operation: AdapterExecutionOperation<T>,
): Promise<T> {
  if (operation.signal?.aborted) {
    throw new AdapterFailure(
      "cancelled",
      "Evaluation was cancelled before invocation.",
    );
  }
  const remaining = operation.elapsedTimeMs -
    (performance.now() - operation.elapsedOrigin);
  if (remaining <= 0) {
    throw new AdapterFailure(
      "elapsed-time",
      "Evaluation elapsed-time budget expired before invocation.",
    );
  }

  const timeout = new AbortController();
  const timer = setTimeout(
    () =>
      timeout.abort(
        new AdapterFailure(
          "elapsed-time",
          "Evaluation elapsed-time budget expired.",
        ),
      ),
    remaining,
  );
  const signal = operation.signal
    ? AbortSignal.any([operation.signal, timeout.signal])
    : timeout.signal;
  const resources = new Map<string, "active" | "released">();
  const cleanupAttempts: string[] = [];
  const observationFailures: string[] = [];
  const resourceHooks: AdapterExecutionResources = {
    register(identity) {
      if (resources.has(identity)) {
        throw new AdapterFailure(
          "execution",
          `Adapter resource ${identity} was registered more than once.`,
        );
      }
      resources.set(identity, "active");
    },
    released(identity) {
      if (!resources.has(identity)) {
        throw new AdapterFailure(
          "execution",
          `Adapter resource ${identity} was released without registration.`,
        );
      }
      resources.set(identity, "released");
    },
    cleanupAttempt(description) {
      cleanupAttempts.push(description);
    },
    observationFailure(description) {
      observationFailures.push(description);
    },
  };
  try {
    const result = await operation.invoke(signal, resourceHooks);
    assertReleasedResources(
      operation.implementationIdentity,
      resources,
      cleanupAttempts,
      observationFailures,
      "execution",
    );
    return result;
  } catch (error) {
    const initiatingKind = error instanceof AdapterFailure
      ? error.kind
      : "execution";
    assertReleasedResources(
      operation.implementationIdentity,
      resources,
      cleanupAttempts,
      observationFailures,
      initiatingKind,
      error,
    );
    if (error instanceof AdapterFailure) throw error;
    if (operation.signal?.aborted) {
      throw new AdapterFailure(
        "cancelled",
        "Evaluation was cancelled.",
        undefined,
        {
          cause: error,
        },
      );
    }
    if (timeout.signal.aborted) {
      throw new AdapterFailure(
        "elapsed-time",
        "Evaluation elapsed-time budget expired.",
        undefined,
        { cause: error },
      );
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function assertReleasedResources(
  implementationIdentity: string,
  resources: ReadonlyMap<string, "active" | "released">,
  cleanupAttempts: readonly string[],
  observationFailures: readonly string[],
  initiatingKind: AdapterFailureKind,
  cause?: unknown,
): void {
  if (![...resources.values()].some((state) => state === "active")) return;
  throw new AdapterFailure(
    "cleanup",
    "Adapter-owned resource cleanup could not be verified.",
    {
      implementationIdentity,
      resources: [...resources].map(([identity, latestState]) => ({
        identity,
        latestState,
      })),
      resultInputs: [],
      initiatingTerminalKind: initiatingKind,
      observationFailures,
      cleanupAttempts,
      cleanupDeadlineOutcome: "unverifiable",
      operatorRecoveryAction:
        "Inspect and remove the listed adapter-owned resources before retrying.",
    },
    { cause },
  );
}
