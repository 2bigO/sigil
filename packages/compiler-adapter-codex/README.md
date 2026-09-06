# @qoherent/sigil-compiler-adapter-codex

Codex transport for Sigil semantic proposal generation.

This package implements CodexSemanticProvider, a SemanticProposalProvider that
invokes the installed codex executable and returns one bounded version-1 proposal
envelope. The envelope contains only Turtle additions and retractions. Candidate
validation, ranking, acceptance, and verification remain in the compiler.

```ts
import { CodexSemanticProvider } from "@qoherent/sigil-compiler-adapter-codex";

const provider = new CodexSemanticProvider("configured-model");
const result = await provider.generate({
  purpose: "interpret-intent",
  prompt: "compiler-generated prompt",
});
```

Configure the bundled provider through the semantic namespace:

```sh
sigil config set-provider codex . --kind codex --model configured-model
sigil config set-provider-default codex .
```

The CLI registers this provider when the host executable is available. Direct
compiler callers can instantiate it and pass it to proposeSemanticIntent. The
host must provide codex; Sigil does not download it or use it for ordinary
compile or semantic verify.

CodexAdapter remains an AgentAdapter compatibility export for callers of the
legacy evaluator API. It is not selected by the semantic provider namespace and
cannot supply an ordinary compiler or verification verdict.

Run deno task test:compiler-adapter-codex for this package's tests.
