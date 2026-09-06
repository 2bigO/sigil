import {
  CommandSemanticProvider,
  type SemanticProposalProvider,
  semanticToolsFrom,
} from "@qoherent/sigil-compiler";
import { ClaudeSemanticProvider } from "@qoherent/sigil-compiler-adapter-claude";
import { CodexSemanticProvider } from "@qoherent/sigil-compiler-adapter-codex";
import { OpenCodeSemanticProvider } from "@qoherent/sigil-compiler-adapter-opencode";
import { PiSemanticProvider } from "@qoherent/sigil-compiler-adapter-pi";

export function configuredSemanticProvider(
  tools: unknown,
  requested?: string,
): SemanticProposalProvider {
  const config = semanticToolsFrom(tools);
  const name = requested ?? config.defaultProvider;
  if (!name) {
    throw new Error(
      "No semantic provider is configured. Select --provider <name>, --generator <executable>, or --proposals <file>.",
    );
  }
  const selected = config.providers[name];
  if (!selected) {
    throw new Error(
      `Semantic provider ${JSON.stringify(name)} is not configured.`,
    );
  }
  const timeoutMs = config.proposalTimeoutMs;
  if (selected.kind === "command") {
    return new CommandSemanticProvider({
      command: selected.command!,
      args: selected.args,
      timeoutMs,
      identity: `semantic:${name}`,
    });
  }
  const options = { timeoutMs };
  if (selected.kind === "codex") {
    return new CodexSemanticProvider(selected.model, options);
  }
  if (selected.kind === "claude") {
    return new ClaudeSemanticProvider(selected.model, options);
  }
  if (selected.kind === "pi") {
    return new PiSemanticProvider(selected.model, options);
  }
  return new OpenCodeSemanticProvider(selected.model, options);
}
