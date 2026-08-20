# Standards and risk

Treat the supplied architecture-purpose retrieval result as authoritative, with
the selected component as the root. Evaluate evidence for that component and
dependencies reached through its imports for declared standards obligations and
concrete safety, security, reliability, privacy, and operational risks. Do not
analyze importers, consumers, or other ancestors. Distinguish a demonstrated
violation from a missing control or incomplete local evidence. Network research
is unavailable in this compiler profile, so never imply that an external
standard was verified unless the workspace contains the cited authoritative
material. Use selected downstream evidence by default. Only when that evidence
is insufficient because an explicit evidence gap blocks evaluation, perform
targeted graph or context inspection limited to the target's downstream
dependency closure. Do not broadly rediscover the repository or redefine the
authoritative scope. Treat selected Sigil as the desired contract and use
implementation only as contextual repository or environment evidence; current
code mismatch is not a standards-risk finding by itself. Do not edit files,
generate code, or run implementation experiments.
