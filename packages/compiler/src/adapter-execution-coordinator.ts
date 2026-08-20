import type {
  AdapterCleanupRecoveryEvidence,
  AdapterFailureKind,
  AdapterObservationStatus,
  AdapterResourceLifecycleState,
  AdapterResultInputLifecycleState,
  CoordinatorFailureKind,
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
  readonly providerCleanupMs?: number;
  readonly implementationIdentity: string;
  readonly handle: AdapterExecutionHandle;
  readonly signal?: AbortSignal;
  invoke(
    signal: AbortSignal,
    resources: AdapterExecutionResources,
    terminationControl: AdapterTerminationControl,
    submitTerminalCondition: (condition: AdapterTerminalCondition<T>) => void,
  ): Promise<T | void>;
}

export type AdapterTerminalCondition<T> =
  | { readonly kind: "result"; readonly value: T }
  | { readonly kind: "failure"; readonly error: unknown };

export interface AdapterTerminationControl {
  requestPreventiveBudgetTermination(message: string): void;
}

export interface AdapterExecutionHandle {
  readonly identity: string;
  cleanup(
    winningCondition: AdapterFailureKind,
    cleanupDeadline: number,
    resources: AdapterExecutionResources,
  ): Promise<void>;
}

export interface AdapterExecutionResources {
  declareResource(identity: string): void;
  declareResultInput(identity: string): void;
  observeResource(identity: string, state: AdapterResourceLifecycleState): void;
  observeResultInput(
    identity: string,
    state: AdapterResultInputLifecycleState,
  ): void;
  reportResourceObservation(
    identity: string,
    status: Exclude<AdapterObservationStatus, "observed">,
    evidence: string,
  ): void;
  reportResultInputObservation(
    identity: string,
    status: Exclude<AdapterObservationStatus, "observed">,
    evidence: string,
  ): void;
  cleanupAttempt(description: string): void;
}

interface LifecycleObservation<State extends string> {
  latestState: State;
  observationStatus: AdapterObservationStatus;
  latestStateObservedAt: number | null;
  observationEvidence: string[];
}

// @sigil implements packages/compiler/src/adapter-execution-coordinator.sigil::SigilAgentAdapterExecutionCoordinator::AgentAdapterExecutionCoordinator interface,logic,cases
export async function coordinateAdapterExecution<T>(
  operation: AdapterExecutionOperation<T>,
): Promise<T> {
  const remaining = operation.elapsedTimeMs -
    (performance.now() - operation.elapsedOrigin);
  const timeout = new AbortController();
  const preventiveBudget = new AbortController();
  const timer = setTimeout(
    () =>
      timeout.abort(
        new AdapterFailure(
          "elapsed-time",
          "Evaluation elapsed-time budget expired.",
        ),
      ),
    Math.max(0, remaining),
  );
  const signal = AbortSignal.any([
    ...(operation.signal ? [operation.signal] : []),
    timeout.signal,
    preventiveBudget.signal,
  ]);
  const terminationControl: AdapterTerminationControl = {
    requestPreventiveBudgetTermination(message) {
      if (!preventiveBudget.signal.aborted) {
        preventiveBudget.abort(
          new AdapterFailure("preventive-budget", message),
        );
      }
    },
  };
  const arbiter = new AdapterTerminalArbiter<T>();
  let invocationStarted = false;
  const submitCancellation = () =>
    invocationStarted && arbiter.submitFailure(
      new AdapterFailure("cancelled", "Evaluation was cancelled."),
    );
  const submitElapsedTime = () =>
    arbiter.submitFailure(
      new AdapterFailure(
        "elapsed-time",
        "Evaluation elapsed-time budget expired.",
      ),
    );
  operation.signal?.addEventListener("abort", submitCancellation, {
    once: true,
  });
  timeout.signal.addEventListener("abort", submitElapsedTime, { once: true });
  preventiveBudget.signal.addEventListener("abort", () => {
    arbiter.submitFailure(preventiveBudget.signal.reason);
  }, { once: true });
  const resources = new Map<
    string,
    LifecycleObservation<AdapterResourceLifecycleState>
  >();
  const resultInputs = new Map<
    string,
    LifecycleObservation<AdapterResultInputLifecycleState>
  >();
  let resultInputSettlementNotifier: (() => void) | undefined;
  const cleanupAttempts: string[] = [];
  const observationFailures: string[] = [];
  const resourceHooks: AdapterExecutionResources = {
    declareResource(identity) {
      if (resources.has(identity)) {
        throw new AdapterFailure(
          "execution",
          `Adapter resource ${identity} was registered more than once.`,
        );
      }
      resources.set(identity, absentObservation());
    },
    declareResultInput(identity) {
      if (resultInputs.has(identity)) {
        throw new AdapterFailure(
          "execution",
          `Adapter result input ${identity} was registered more than once.`,
        );
      }
      resultInputs.set(identity, absentObservation());
    },
    observeResource(identity, state) {
      observeLifecycle(
        resources,
        identity,
        state,
        resourceStateRank,
        "resource",
      );
    },
    observeResultInput(identity, state) {
      observeLifecycle(
        resultInputs,
        identity,
        state,
        resultInputStateRank,
        "result input",
      );
      if (
        [...resultInputs.values()].every(({ latestState }) =>
          latestState === "closed" || latestState === "cancelled"
        )
      ) {
        resultInputSettlementNotifier?.();
        resultInputSettlementNotifier = undefined;
      }
    },
    reportResourceObservation(identity, status, evidence) {
      reportObservation(
        resources,
        identity,
        status,
        evidence,
        "resource",
        (state) => state === "terminal" || state === "released",
      );
    },
    reportResultInputObservation(identity, status, evidence) {
      reportObservation(
        resultInputs,
        identity,
        status,
        evidence,
        "result input",
        (state) => state === "closed" || state === "cancelled",
      );
    },
    cleanupAttempt(description) {
      cleanupAttempts.push(description);
    },
  };
  let cleanupAttempted = false;
  try {
    if (operation.signal?.aborted) {
      throw new AdapterFailure(
        "cancelled",
        "Evaluation was cancelled before invocation.",
      );
    }
    if (remaining <= 0) {
      throw new AdapterFailure(
        "elapsed-time",
        "Evaluation elapsed-time budget expired before invocation.",
      );
    }
    if (
      !beginInvocation(operation.signal, timeout.signal, () => {
        invocationStarted = true;
      })
    ) {
      throw new AdapterFailure(
        operation.signal?.aborted ? "cancelled" : "elapsed-time",
        operation.signal?.aborted
          ? "Evaluation was cancelled before invocation."
          : "Evaluation elapsed-time budget expired before invocation.",
      );
    }
    let submittedByAdapter = false;
    const submitTerminalCondition = (
      condition: AdapterTerminalCondition<T>,
    ) => {
      submittedByAdapter = true;
      if (condition.kind === "failure") {
        arbiter.submitFailure(condition.error);
        return;
      }
      void waitForResultInputs(resultInputs, (notifier) => {
        resultInputSettlementNotifier = notifier;
      }).then(() => arbiter.submitResult(condition.value));
    };
    void operation.invoke(
      signal,
      resourceHooks,
      terminationControl,
      submitTerminalCondition,
    ).then(
      async (result) => {
        if (submittedByAdapter) return;
        await waitForResultInputs(resultInputs, (notifier) => {
          resultInputSettlementNotifier = notifier;
        });
        arbiter.submitResult(result as T);
      },
      (error) => {
        if (!submittedByAdapter) arbiter.submitFailure(error);
      },
    );
    const settled = await arbiter.waitForWinner();
    if (settled instanceof Error) throw settled;
    assertReleasedResources(
      operation.implementationIdentity,
      resources,
      resultInputs,
      cleanupAttempts,
      observationFailures,
      "execution",
    );
    return settled;
  } catch (error) {
    const initiatingKind = error instanceof AdapterFailure
      ? error.kind
      : "execution";
    if (initiatingKind !== "cleanup" && !cleanupAttempted) {
      cleanupAttempted = true;
      const cleanupDeadline = performance.now() +
        (operation.providerCleanupMs ?? 0);
      await cleanupAndVerify(
        operation.handle,
        initiatingKind,
        cleanupDeadline,
        operation.implementationIdentity,
        resourceHooks,
        resources,
        resultInputs,
        cleanupAttempts,
        observationFailures,
        error,
      );
    }
    assertReleasedResources(
      operation.implementationIdentity,
      resources,
      resultInputs,
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
    operation.signal?.removeEventListener("abort", submitCancellation);
    timeout.signal.removeEventListener("abort", submitElapsedTime);
  }
}

function waitForResultInputs(
  resultInputs: ReadonlyMap<
    string,
    LifecycleObservation<AdapterResultInputLifecycleState>
  >,
  subscribe: (notifier: () => void) => void,
): Promise<void> {
  if (
    [...resultInputs.values()].every(({ latestState }) =>
      latestState === "closed" || latestState === "cancelled"
    )
  ) {
    return Promise.resolve();
  }
  return new Promise((resolve) => subscribe(resolve));
}

function beginInvocation(
  cancellationSignal: AbortSignal | undefined,
  elapsedSignal: AbortSignal,
  markStarted: () => void,
): boolean {
  if (cancellationSignal?.aborted || elapsedSignal.aborted) return false;
  markStarted();
  return true;
}

async function cleanupAndVerify(
  handle: AdapterExecutionHandle,
  initiatingKind: AdapterFailureKind,
  cleanupDeadline: number,
  implementationIdentity: string,
  resourceHooks: AdapterExecutionResources,
  resources: ReadonlyMap<
    string,
    LifecycleObservation<AdapterResourceLifecycleState>
  >,
  resultInputs: ReadonlyMap<
    string,
    LifecycleObservation<AdapterResultInputLifecycleState>
  >,
  cleanupAttempts: readonly string[],
  observationFailures: string[],
  cause: unknown,
): Promise<void> {
  let cleanupDeadlineOutcome: "completed" | "expired" | "unverifiable" =
    "completed";
  try {
    await beforeDeadline(
      handle.cleanup(initiatingKind, cleanupDeadline, resourceHooks),
      cleanupDeadline,
    );
  } catch (error) {
    cleanupDeadlineOutcome = error instanceof AdapterFailure &&
        error.kind === "cleanup" &&
        error.message === "Adapter cleanup exceeded its deadline."
      ? "expired"
      : "unverifiable";
    observationFailures.push(
      error instanceof Error ? error.message : String(error),
    );
  }
  assertReleasedResources(
    implementationIdentity,
    resources,
    resultInputs,
    cleanupAttempts,
    observationFailures,
    initiatingKind,
    cause,
    cleanupDeadlineOutcome,
    cleanupDeadline,
  );
}

async function beforeDeadline(
  promise: Promise<void>,
  deadline: number,
): Promise<void> {
  const remaining = Math.max(0, deadline - performance.now());
  const timeout = Symbol("cleanup-deadline");
  const result = await Promise.race([
    promise.then(() => undefined),
    new Promise<typeof timeout>((resolve) =>
      setTimeout(() => resolve(timeout), remaining)
    ),
  ]);
  if (result === timeout) {
    throw new AdapterFailure(
      "cleanup",
      "Adapter cleanup exceeded its deadline.",
    );
  }
}

class AdapterTerminalArbiter<T> {
  readonly #conditions: Array<{
    readonly sequence: number;
    readonly kind: CoordinatorFailureKind | "result";
    readonly value: T | unknown;
  }> = [];
  #settled = false;
  #resultSubmitted = false;
  #drainScheduled = false;
  #nextSequence = 0;
  #resolve?: (value: T | Error) => void;
  readonly #winner = new Promise<T | Error>((resolve) => {
    this.#resolve = resolve;
  });

  submitResult(value: T): void {
    if (this.#resultSubmitted) {
      this.submitFailure(
        new AdapterFailure(
          "final-result-protocol",
          "Adapter invocation submitted more than one result.",
        ),
      );
      return;
    }
    this.#resultSubmitted = true;
    this.#submit({
      sequence: this.#nextSequence++,
      kind: "result",
      value,
    });
  }

  submitFailure(error: unknown): void {
    const failure = error instanceof AdapterFailure
      ? error
      : new AdapterFailure(
        "execution",
        error instanceof Error ? error.message : String(error),
        undefined,
        { cause: error },
      );
    const kind: CoordinatorFailureKind = failure.kind === "binding-mismatch" ||
        failure.kind === "capability-mismatch" || failure.kind === "cleanup"
      ? "execution"
      : failure.kind;
    const normalized = kind === failure.kind
      ? failure
      : new AdapterFailure(kind, failure.message, failure.recovery, {
        cause: failure,
      });
    this.#submit({
      sequence: this.#nextSequence++,
      kind,
      value: normalized,
    });
  }

  waitForWinner(): Promise<T | Error> {
    return this.#winner;
  }

  #submit(condition: {
    readonly sequence: number;
    readonly kind: CoordinatorFailureKind | "result";
    readonly value: T | unknown;
  }): void {
    if (this.#settled) return;
    this.#conditions.push(condition);
    if (this.#drainScheduled) return;
    this.#drainScheduled = true;
    queueMicrotask(() => this.#drain());
  }

  #drain(): void {
    if (this.#settled) return;
    const batch = this.#conditions.splice(0);
    this.#drainScheduled = false;
    const precedence: Record<CoordinatorFailureKind | "result", number> = {
      cancelled: 0,
      "elapsed-time": 1,
      "preventive-budget": 2,
      "incomplete-evidence": 3,
      "operational-limit": 4,
      process: 5,
      execution: 6,
      "final-result-protocol": 7,
      cleanup: Number.POSITIVE_INFINITY,
      result: 8,
    };
    const winner =
      batch.sort((left, right) =>
        precedence[left.kind] - precedence[right.kind] ||
        left.sequence - right.sequence
      )[0];
    this.#settled = true;
    if (!winner) {
      this.#resolve?.(
        new AdapterFailure(
          "execution",
          "Adapter invocation produced no outcome.",
        ),
      );
      return;
    }
    this.#resolve?.(winner.value as T | Error);
  }
}

function assertReleasedResources(
  implementationIdentity: string,
  resources: ReadonlyMap<
    string,
    LifecycleObservation<AdapterResourceLifecycleState>
  >,
  resultInputs: ReadonlyMap<
    string,
    LifecycleObservation<AdapterResultInputLifecycleState>
  >,
  cleanupAttempts: readonly string[],
  observationFailures: readonly string[],
  initiatingKind: AdapterFailureKind,
  cause?: unknown,
  cleanupDeadlineOutcome: "completed" | "expired" | "unverifiable" =
    "unverifiable",
  verificationDeadline?: number,
): void {
  if (
    [...resources.values()].every((observation) =>
      isVerifiedByDeadline(
        observation,
        (state) => state === "terminal" || state === "released",
        verificationDeadline,
      )
    ) &&
    [...resultInputs.values()].every((observation) =>
      isVerifiedByDeadline(
        observation,
        (state) => state === "closed" || state === "cancelled",
        verificationDeadline,
      )
    )
  ) return;
  throw new AdapterFailure(
    "cleanup",
    "Adapter-owned resource cleanup could not be verified.",
    {
      implementationIdentity,
      resources: [...resources].map(([identity, observation]) => ({
        identity,
        ...observation,
      })),
      resultInputs: [...resultInputs].map(([identity, observation]) => ({
        identity,
        ...observation,
      })),
      initiatingTerminalKind: initiatingKind,
      observationFailures,
      cleanupAttempts,
      cleanupDeadlineOutcome,
      operatorRecoveryAction:
        "Inspect and remove the listed adapter-owned resources before retrying.",
    },
    { cause },
  );
}

function absentObservation<State extends string>(): LifecycleObservation<
  State
> {
  return {
    latestState: "absent" as State,
    observationStatus: "incomplete",
    latestStateObservedAt: null,
    observationEvidence: [],
  };
}

function observeLifecycle<State extends string>(
  declarations: Map<string, LifecycleObservation<State>>,
  identity: string,
  state: State,
  rank: (state: State) => number,
  kind: string,
): void {
  const observation = declarations.get(identity);
  if (!observation) {
    throw new AdapterFailure(
      "execution",
      `Adapter ${kind} ${identity} was observed without declaration.`,
    );
  }
  if (rank(state) < rank(observation.latestState)) {
    throw new AdapterFailure(
      "execution",
      `Adapter ${kind} ${identity} lifecycle state regressed.`,
    );
  }
  observation.latestState = state;
  observation.observationStatus = "observed";
  observation.latestStateObservedAt = performance.now();
}

function reportObservation<State extends string>(
  declarations: Map<string, LifecycleObservation<State>>,
  identity: string,
  status: Exclude<AdapterObservationStatus, "observed">,
  evidence: string,
  kind: string,
  isFinalState: (state: State) => boolean,
): void {
  const observation = declarations.get(identity);
  if (!observation) {
    throw new AdapterFailure(
      "execution",
      `Adapter ${kind} ${identity} was reported without declaration.`,
    );
  }
  if (!isFinalState(observation.latestState)) {
    observation.observationStatus = status;
  }
  observation.observationEvidence.push(evidence);
}

function isVerifiedByDeadline<State extends string>(
  observation: LifecycleObservation<State>,
  isTerminalState: (state: State) => boolean,
  verificationDeadline: number | undefined,
): boolean {
  return isTerminalState(observation.latestState) &&
    observation.latestStateObservedAt !== null &&
    (verificationDeadline === undefined ||
      observation.latestStateObservedAt <= verificationDeadline);
}

function resourceStateRank(state: AdapterResourceLifecycleState): number {
  return ({ absent: 0, active: 1, terminal: 2, released: 3 })[state];
}

function resultInputStateRank(state: AdapterResultInputLifecycleState): number {
  return ({ absent: 0, open: 1, closed: 2, cancelled: 2 })[state];
}
