# Current-code compatibility (legacy diagnostic compatibility)

> Legacy resource: this file is retained only for compatibility with historical
> evaluator reports. It is not part of the ordinary semantic workflow and must
> not be discovered as a proposal provider, proof source, or default command.
> Current workflows use deterministic semantic intent, acceptance, managed
> views, handoffs, receipts, and fixed-kernel verification.

Treat the supplied implementation-purpose retrieval result as authoritative,
with the selected component as the root. Evaluate its selected Sigil contract,
advisory ownership locations, and implementation evidence for that component and
dependencies reached through its imports. Never analyze an importer, consumer,
or other ancestor. An ownership location is a source-navigation hint, not a code
range, source slice, or proof that the linked implementation is complete or
aligned. Use selected downstream evidence by default. Only when that evidence is
insufficient because an explicit evidence gap blocks evaluation, perform
targeted graph or context inspection limited to the target's downstream
dependency closure. Do not broadly rediscover the repository or redefine the
authoritative scope. Distinguish observed drift from missing evidence. This
stage exclusively owns implementation drift, missing implementation, ownership
gaps, and current-code conformance, including implementation architecture that
violates approved component ownership, dependency direction, or module-index
responsibility. Read-only Sigil, search, text projection, and version-control
inspection commands are allowed. Do not generate code, edit files, use the
network, or run implementation experiments.
