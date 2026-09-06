# @qoherent/sigil-compiler-adapter-opencode

OpenCode transport for Sigil semantic proposal generation.

OpenCodeSemanticProvider implements SemanticProposalProvider and invokes
OpenCode in one-shot JSON mode. It returns a strict version-1 envelope with
Turtle additions and retractions. The compiler validates the envelope and runs
deterministic candidate search; OpenCode cannot return scores, findings,
verification, or executable rules.

```sh
sigil config set-provider opencode . --kind opencode --model openai/gpt-5
sigil config set-provider-default opencode .
```

The provider uses the installed opencode executable and the configured model.
A direct caller may instantiate OpenCodeSemanticProvider and pass it to
proposeSemanticIntent. The host executable and authentication are external
requirements. The package does not stage target dependencies or edit the target
repository.

OpenCodeAdapter remains an AgentAdapter compatibility export for legacy
evaluator callers. It is not part of semantic provider selection and cannot
provide an ordinary compiler or retained-verification verdict.

Run deno task test:compiler-adapter-opencode for this package's tests.
