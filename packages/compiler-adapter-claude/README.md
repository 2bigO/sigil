# @qoherent/sigil-compiler-adapter-claude

Claude transport for Sigil semantic proposal generation.

ClaudeSemanticProvider implements the compiler's SemanticProposalProvider
interface. It invokes the installed claude executable with a bounded one-shot
request and returns strict version-1 JSON proposal text. The proposal contains
Turtle additions and retractions only; the compiler's fixed egglog kernel decides
semantic status.

```ts
import { ClaudeSemanticProvider } from "@qoherent/sigil-compiler-adapter-claude";

const provider = new ClaudeSemanticProvider("claude-model");
```

Configure it in the target workspace:

```sh
sigil config set-provider claude . --kind claude --model claude-model
sigil config set-provider-default claude .
```

The selected host executable must already be installed and authenticated. Sigil
does not download providers, grant them write access to the project, or invoke
them during ordinary compile or retained semantic verify.

ClaudeAdapter remains an AgentAdapter compatibility export for legacy API
callers. Legacy evaluator findings are never treated as semantic assertions,
host observations, or proof.

Run deno task test:compiler-adapter-claude for this package's tests.
