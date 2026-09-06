# @qoherent/sigil-compiler-adapter-pi

Pi transport for Sigil semantic proposal generation.

PiSemanticProvider implements SemanticProposalProvider and invokes the installed
pi executable in one-shot mode. Its only semantic output is a bounded version-1
JSON envelope containing Turtle additions and retractions. The compiler
validates, ranks, and accepts candidates and performs all verification
independently.

```sh
sigil config set-provider pi . --kind pi --model openai/gpt-5
sigil config set-provider-default pi .
```

Pi must be installed and authenticated on the host. The provider uses no project
write tools and does not stage target dependencies. Direct compiler callers may
instantiate PiSemanticProvider and pass it to proposeSemanticIntent.

PiAdapter remains an AgentAdapter compatibility export for legacy evaluator
callers. It is retained for API compatibility only; ordinary compile, managed
view publication, receipt import, and retained verification never invoke it.

Run deno task test:compiler-adapter-pi for this package's tests.
