const root = "integrations/skills/sigil";
const required = [
  "SKILL.md",
  "VERSION",
  "compatibility.json",
  "agents/openai.yaml",
  "references/sigil-format.md",
  "references/standards-review.md",
  "references/implementation-design.md",
  "references/design-conversation.md",
  "references/greenfield-design.md",
  "references/brownfield-adoption.md",
  "references/glossary-workflow.md",
  "references/workspace-bootstrap.md",
  "references/authoring-conventions.md",
  "evals/design-conversation-fixture.md",
  "evals/workspace-bootstrap-fixture.md",
  "evals/brownfield-fixture.md",
  "evals/greenfield-fixture.md",
  "evals/implementation-coverage-fixture.md",
  "evals/concept-identifier-fixture.md",
  "evals/decision-rationale-fixture.md",
  "evals/glossary-fixture.md",
  "evals/expected.json",
];

for (const path of required) await requireFile(`${root}/${path}`);

const skill = await Deno.readTextFile(`${root}/SKILL.md`);
const workspaceBootstrap = await Deno.readTextFile(
  `${root}/references/workspace-bootstrap.md`,
);
const authoringConventions = await Deno.readTextFile(
  `${root}/references/authoring-conventions.md`,
);
requireText(skill, "name: sigil", "SKILL.md name");
requireText(skill, "description:", "SKILL.md description");
requireText(
  skill,
  "This file is the workflow dispatcher.",
  "compact workflow dispatcher",
);
requireText(
  skill,
  "references/workspace-bootstrap.md",
  "workspace bootstrap routing",
);
requireText(skill, "sigil check", "structural preflight");
requireText(skill, "references/greenfield-design.md", "greenfield routing");
requireText(skill, "references/brownfield-adoption.md", "brownfield routing");
requireText(
  skill,
  "references/implementation-design.md",
  "implementation design routing",
);
requireText(
  skill,
  "references/design-conversation.md",
  "design conversation routing",
);
requireText(
  skill,
  "references/glossary-workflow.md",
  "glossary workflow routing",
);
requireText(skill, "sigil glossary", "glossary deterministic inspection");
requireText(
  skill,
  "references/authoring-conventions.md",
  "authoring convention routing",
);
requireText(
  workspaceBootstrap,
  "Unconfigured with Sigil",
  "existing-Sigil configuration state",
);
requireText(
  workspaceBootstrap,
  "Missing config is not itself a compatibility failure.",
  "missing config compatibility guard",
);
requireText(
  workspaceBootstrap,
  "Workflow classification never decides whether missing config may be\ninitialized.",
  "bootstrap before workflow classification",
);
requireText(
  workspaceBootstrap,
  "inventory existing `.sigil` paths read-only",
  "read-only unconfigured Sigil inventory",
);
requireText(
  workspaceBootstrap,
  "it must not overwrite existing\nconfig or semantically rewrite existing `.sigil` sources",
  "non-overwriting initialization",
);
requireText(
  workspaceBootstrap,
  "Do not classify this state automatically as Brownfield.",
  "unconfigured Sigil workflow neutrality",
);
requireText(
  authoringConventions,
  "Separate distinct prose-level ideas with blank lines",
  "semantic blank-line style",
);
requireText(skill, "one primary decision per turn", "sequential clarification");
requireText(
  skill,
  "Verify that every material implementation concern has established coverage",
  "clear Sigil coverage guard",
);
requireText(skill, "Stop at the Sigil review gate", "semantic review gate");
requireText(
  skill,
  "Require explicit user approval of the written Sigil",
  "implementation approval boundary",
);
requireText(
  authoringConventions,
  "`SIGIL_MISSING_CONCEPT_IDENTIFIER` as an authoring gap",
  "missing concept identifier workflow",
);
requireText(
  authoringConventions,
  "inspect the remainder of the same section",
  "complete local concept reuse discovery",
);
requireText(
  authoringConventions,
  "use `sigil graph` to inspect direct importers",
  "direct consumer concept evidence",
);
requireText(
  authoringConventions,
  "traverse transitive importers only when a concept is re-exposed",
  "bounded transitive concept discovery",
);
requireText(
  authoringConventions,
  "delegate concept grouping and identifier\n" +
    "generation to one dedicated subagent only after completing reuse discovery",
  "concept identifier subagent delegation",
);
requireText(
  authoringConventions,
  "return a proposal only and not edit files.",
  "proposal-only concept identifier subagent",
);
requireText(
  authoringConventions,
  "case-insensitive namespace uniqueness, public and\n" +
    "private visibility, collective coherence, and transitive import ambiguity",
  "primary-agent concept proposal validation",
);
requireText(
  authoringConventions,
  "Subagent completion is not user approval and grants no edit authority to the\nprimary agent.",
  "delegated proposal authority boundary",
);
requireText(
  authoringConventions,
  "repair always require explicit user approval of the presented proposal before\nany repository mutation",
  "concept identifier pre-edit approval gate",
);
requireText(
  skill,
  "Every delegated semantic proposal is advisory",
  "global delegated proposal gate",
);
requireText(
  authoringConventions,
  "Keep anchoring outside concept-identifier work.",
  "concept identifier anchoring exclusion",
);
requireText(
  authoringConventions,
  "record `Decision`, `Context`, and `Scope`",
  "decision rationale required labels",
);
requireText(
  authoringConventions,
  "attempting to enumerate every current dependent",
  "decision scope boundary",
);
requireText(
  authoringConventions,
  "Reuse an accessible concept identifier when decisions concern the same",
  "decision contextual concept reuse",
);
requireText(
  authoringConventions,
  "reuse never makes a\n" +
    "decision transitively binding",
  "decision transitive authority guard",
);
requireText(
  authoringConventions,
  "but not its private\n" +
    "decision rationale",
  "provider private decision boundary",
);

const version = (await Deno.readTextFile(`${root}/VERSION`)).trim();
if (version !== "0.6.0") {
  throw new Error(`Expected skill VERSION 0.6.0, got ${version}`);
}

const compatibility = JSON.parse(
  await Deno.readTextFile(`${root}/compatibility.json`),
);
for (
  const [key, expected] of Object.entries({
    cliVersion: "^0.6.0",
    coreVersion: "^0.6.0",
    sigilVersion: "0.5.0",
  })
) {
  if (compatibility[key] !== expected) {
    throw new Error(`Expected ${key} ${expected}, got ${compatibility[key]}`);
  }
}
if ("skillVersion" in compatibility) {
  throw new Error("compatibility.json must not duplicate the VERSION owner.");
}

const expected = JSON.parse(
  await Deno.readTextFile(`${root}/evals/expected.json`),
);
const workspaceBootstrapFixture = await Deno.readTextFile(
  `${root}/evals/workspace-bootstrap-fixture.md`,
);
const requiredWorkspaceBootstrapBehaviors = [
  "resolve-selected-repository-root",
  "exclude-ungoverning-parent-workspace",
  "discover-compatible-cli-first",
  "classify-unconfigured-existing-sigil",
  "inventory-existing-sigil-read-only",
  "initialize-before-workflow-selection",
  "preserve-existing-sigil-sources",
  "validate-initialized-workspace",
  "preserve-post-init-diagnostics",
  "select-semantic-workflow-after-bootstrap",
  "report-bootstrap-handoff",
  "preserve-invalid-existing-config",
  "stop-on-bootstrap-failure",
];
if (!Array.isArray(expected.workspaceBootstrapRequiredBehaviors)) {
  throw new Error(
    "Workspace bootstrap fixture must declare required behaviors.",
  );
}
for (const behavior of requiredWorkspaceBootstrapBehaviors) {
  if (!expected.workspaceBootstrapRequiredBehaviors.includes(behavior)) {
    throw new Error(
      `Workspace bootstrap fixture is missing behavior ${behavior}.`,
    );
  }
}
requireText(
  workspaceBootstrapFixture,
  "unconfigured with existing Sigil rather than\n   Brownfield",
  "fixture neutral unconfigured classification",
);
requireText(
  workspaceBootstrapFixture,
  "Inventory existing `.sigil` paths read-only",
  "fixture read-only existing Sigil inventory",
);
requireText(
  workspaceBootstrapFixture,
  "without overwriting or\n   rewriting existing Sigil sources",
  "fixture non-overwriting initialization",
);
requireText(
  workspaceBootstrapFixture,
  "Only after bootstrap",
  "fixture bootstrap-before-workflow ordering",
);
requireText(
  workspaceBootstrapFixture,
  "invalid `.sigil/config.json` already exists, preserve it",
  "fixture invalid config preservation",
);

const fixture = await Deno.readTextFile(
  `${root}/evals/brownfield-fixture.md`,
);
const requiredBrownfieldBehaviors = [
  "detect-missing-config",
  "initialize-config-first",
  "validate-initialized-config",
  "classify-repository-evidence",
  "scan-application-evidence",
  "converse-when-application-vague",
  "continue-boundary-follow-up-questions",
  "elicit-application-goal-and-interface",
  "confirm-synthesized-boundary-contract-separately",
  "inspect-root-and-declared-member-boundaries",
  "propose-confirmed-boundary-summaries",
  "classify-boundary-expand-evidence",
  "propose-minimal-boundary-expands",
  "preserve-only-binding-boundary-constraints",
  "exclude-incidental-and-task-specific-boundary-details",
  "propose-before-edit",
  "review-boundaries-before-task-focus",
  "focus-requested-task-after-boundary-approval",
  "collaborate-on-missing-sigil-before-implementation",
  "validate-written-sigil",
  "stop-at-semantic-review-gate",
  "implement-only-after-approval",
];
if (!Array.isArray(expected.requiredBehaviors)) {
  throw new Error(
    "Brownfield fixture must declare required behaviors.",
  );
}
for (const behavior of requiredBrownfieldBehaviors) {
  if (!expected.requiredBehaviors.includes(behavior)) {
    throw new Error(`Brownfield fixture is missing behavior ${behavior}.`);
  }
}
requireText(
  fixture,
  "run `sigil init` before detailed project",
  "fixture initialization-first rule",
);
requireText(
  fixture,
  "use the shared design conversation",
  "fixture conversational discovery",
);
requireText(
  fixture,
  "Resolve one primary decision per turn",
  "fixture follow-up conversation",
);
requireText(
  fixture,
  "then request separate confirmation",
  "fixture separate confirmation",
);
requireText(
  fixture,
  "Only after configured-boundary summary approval, focus on the requested",
  "fixture boundary-before-task ordering",
);
requireText(
  fixture,
  "collaborate with the user to define and approve that coverage",
  "brownfield missing coverage collaboration",
);

const greenfieldFixture = await Deno.readTextFile(
  `${root}/evals/greenfield-fixture.md`,
);
const requiredGreenfieldBehaviors = [
  "start-with-design-conversation",
  "ask-multiple-manageable-rounds",
  "build-questions-on-answers",
  "surface-weak-assumptions",
  "present-choices-and-tradeoffs",
  "provide-reasoned-recommendation",
  "allow-user-to-reject-all-choices",
  "continue-until-contract-is-clear",
  "synthesize-conversation-into-exact-sigil",
  "confirm-before-writing-sigil",
  "collaborate-on-missing-sigil-before-implementation",
  "stop-at-semantic-review-gate",
  "implement-only-after-approval",
];
if (!Array.isArray(expected.greenfieldRequiredBehaviors)) {
  throw new Error("Greenfield fixture must declare required behaviors.");
}
for (const behavior of requiredGreenfieldBehaviors) {
  if (!expected.greenfieldRequiredBehaviors.includes(behavior)) {
    throw new Error(`Greenfield fixture is missing behavior ${behavior}.`);
  }
}
requireText(
  greenfieldFixture,
  "asking one primary decision per turn",
  "greenfield iterative conversation",
);
requireText(
  greenfieldFixture,
  "consequences and tradeoffs, plus a reasoned recommendation",
  "greenfield choices and recommendation",
);
requireText(
  greenfieldFixture,
  "combine, reject, revise, or replace",
  "greenfield user-directed choices",
);
requireText(
  greenfieldFixture,
  "exact proposed Sigil",
  "greenfield exact proposal",
);
requireText(
  greenfieldFixture,
  "collaborate with the user on\n    the affected Sigil before adding implementation",
  "greenfield missing coverage collaboration",
);

const designConversationFixture = await Deno.readTextFile(
  `${root}/evals/design-conversation-fixture.md`,
);
const requiredDesignConversationBehaviors = [
  "track-conversation-phase",
  "maintain-decision-ledger",
  "prioritize-foundational-decisions",
  "ask-one-primary-decision-per-turn",
  "acknowledge-answer-effects",
  "explain-question-dependencies",
  "offer-choices-and-recommendation",
  "preserve-user-authority",
  "handle-user-uncertainty",
  "defer-only-non-blocking-decisions",
  "resolve-conflicts-before-advancing",
  "reduce-scope-when-overwhelmed",
  "provide-decision-checkpoints",
  "avoid-reasking-confirmed-decisions",
  "synthesize-only-without-blockers",
  "preserve-deferrals-in-synthesis",
];
if (!Array.isArray(expected.designConversationRequiredBehaviors)) {
  throw new Error(
    "Design conversation fixture must declare required behaviors.",
  );
}
for (const behavior of requiredDesignConversationBehaviors) {
  if (!expected.designConversationRequiredBehaviors.includes(behavior)) {
    throw new Error(
      `Design conversation fixture is missing behavior ${behavior}.`,
    );
  }
}
requireText(
  designConversationFixture,
  "one primary decision per turn",
  "design conversation sequential turn",
);
requireText(
  designConversationFixture,
  "Acknowledge each answer and state its effect",
  "design conversation answer acknowledgement",
);
requireText(
  designConversationFixture,
  "confirmed decisions, assumptions,\n    deferrals, blockers, and the next decision",
  "design conversation checkpoint",
);
requireText(
  designConversationFixture,
  "reduce the turn to the single most\n    foundational decision",
  "design conversation overwhelm handling",
);
requireText(
  designConversationFixture,
  "Synthesize exact proposed Sigil only after no unresolved decision",
  "design conversation blocker exit condition",
);

const implementationFixture = await Deno.readTextFile(
  `${root}/evals/implementation-coverage-fixture.md`,
);
const requiredImplementationBehaviors = [
  "reject-high-level-only-coverage",
  "inspect-implementation-boundary",
  "treat-goal-and-interface-public-to-dependents",
  "model-programming-abstraction-as-component",
  "model-ui-surface-as-component",
  "use-expand-for-owned-implementation-detail",
  "omit-trivial-mechanics",
  "report-implementation-coverage-map",
  "propose-exact-implementation-sigil",
  "support-combined-or-dependent-review",
  "stop-at-semantic-review-gate",
  "implement-only-after-implementation-approval",
];
if (!Array.isArray(expected.implementationRequiredBehaviors)) {
  throw new Error("Implementation fixture must declare required behaviors.");
}
for (const behavior of requiredImplementationBehaviors) {
  if (!expected.implementationRequiredBehaviors.includes(behavior)) {
    throw new Error(`Implementation fixture is missing behavior ${behavior}.`);
  }
}
requireText(
  implementationFixture,
  "approved high-level service contract as sufficient",
  "implementation high-level coverage rejection",
);
requireText(
  implementationFixture,
  "queue programming abstraction as a component",
  "implementation abstraction component",
);
requireText(
  implementationFixture,
  "delivery-status surface as a UI component",
  "implementation UI component",
);
requireText(
  implementationFixture,
  "component/expand/omit decision",
  "implementation coverage map",
);

const conceptIdentifierFixture = await Deno.readTextFile(
  `${root}/evals/concept-identifier-fixture.md`,
);
const requiredConceptIdentifierBehaviors = [
  "inspect-complete-local-collective",
  "inspect-local-and-imported-concepts",
  "inspect-direct-consumers",
  "bound-transitive-traversal",
  "treat-consumers-as-evidence",
  "classify-reuse-before-creation",
  "provide-evidence-bundle",
  "require-evidence-backed-proposal",
  "validate-in-primary-agent",
  "present-exact-proposal",
  "enter-awaiting-approval",
  "deny-primary-edit-authority",
  "require-explicit-pre-edit-approval",
  "exclude-anchor-workflow",
];
if (!Array.isArray(expected.conceptIdentifierRequiredBehaviors)) {
  throw new Error(
    "Concept identifier fixture must declare required behaviors.",
  );
}
for (const behavior of requiredConceptIdentifierBehaviors) {
  if (!expected.conceptIdentifierRequiredBehaviors.includes(behavior)) {
    throw new Error(
      `Concept identifier fixture is missing behavior ${behavior}.`,
    );
  }
}
requireText(
  conceptIdentifierFixture,
  "remainder of the same section, every other component section",
  "concept fixture complete local discovery",
);
requireText(
  conceptIdentifierFixture,
  "Inspect direct importers",
  "concept fixture direct consumer discovery",
);
requireText(
  conceptIdentifierFixture,
  "only because the concept is re-exposed",
  "concept fixture bounded transitive discovery",
);
requireText(
  conceptIdentifierFixture,
  "leave every repository file unchanged",
  "concept fixture awaiting approval",
);
requireText(
  conceptIdentifierFixture,
  "advisory output rather than user approval",
  "concept fixture delegated authority boundary",
);

const decisionRationaleFixture = await Deno.readTextFile(
  `${root}/evals/decision-rationale-fixture.md`,
);
const requiredDecisionRationaleBehaviors = [
  "keep-binding-outcome-in-constraints",
  "use-optional-decisions-for-material-rationale",
  "use-named-decision-concept",
  "record-decision-context-scope",
  "bound-scope-with-exclusions",
  "record-applicable-rationale",
  "reuse-accessible-public-concept",
  "prevent-transitive-decision-authority",
  "inspect-provider-private-rationale-explicitly",
  "exclude-session-transcripts-and-hidden-reasoning",
  "exclude-initial-responsibility-and-handoff-metadata",
];
if (!Array.isArray(expected.decisionRationaleRequiredBehaviors)) {
  throw new Error(
    "Decision rationale fixture must declare required behaviors.",
  );
}
for (const behavior of requiredDecisionRationaleBehaviors) {
  if (!expected.decisionRationaleRequiredBehaviors.includes(behavior)) {
    throw new Error(
      `Decision rationale fixture is missing behavior ${behavior}.`,
    );
  }
}
requireText(
  decisionRationaleFixture,
  "Keep the binding PostgreSQL outcome in `constraints`.",
  "decision fixture binding constraint",
);
requireText(
  decisionRationaleFixture,
  "Record `Decision`, `Context`, and `Scope`.",
  "decision fixture required labels",
);
requireText(
  decisionRationaleFixture,
  "without\n   enumerating every current dependent",
  "decision fixture scope boundary",
);
requireText(
  decisionRationaleFixture,
  "do not make either decision\n   transitively binding",
  "decision fixture transitive authority guard",
);
requireText(
  decisionRationaleFixture,
  "provider's private decision rationale matters",
  "decision fixture provider inspection",
);
requireText(
  decisionRationaleFixture,
  "raw session transcripts",
  "decision fixture transcript exclusion",
);

const glossaryFixture = await Deno.readTextFile(
  `${root}/evals/glossary-fixture.md`,
);
const requiredGlossaryBehaviors = [
  "inspect-deterministic-glossary",
  "preserve-reviewed-authority",
  "separate-glossary-and-concept-identity",
  "extract-sigil-prose-only",
  "exclude-nonprose-regions",
  "collect-candidate-evidence",
  "avoid-ordinary-language-noise",
  "surface-conflicting-meaning",
  "repair-normative-contract-conflict",
  "select-nonoverlapping-scope",
  "explain-context-override",
  "present-exact-json-proposal",
  "require-explicit-pre-edit-approval",
  "validate-approved-glossary",
  "stop-at-glossary-review-gate",
  "inspect-after-every-sigil-mutation",
  "inspect-when-glossary-absent",
  "separate-deterministic-inspection-from-model-extraction",
  "forbid-zero-diagnostic-no-change-inference",
  "extract-regardless-of-diagnostic-count",
  "record-evidence-based-no-candidate-result",
  "block-material-terminology-ambiguity",
  "allow-ordinary-unambiguous-vocabulary",
  "return-to-sigil-review-gate",
  "include-scoped-glossary-in-coding-context",
  "supplement-request-matched-accepted-term",
  "exclude-unrelated-glossary-context",
  "defer-markdown-extraction",
];
if (!Array.isArray(expected.glossaryRequiredBehaviors)) {
  throw new Error("Glossary fixture must declare required behaviors.");
}
for (const behavior of requiredGlossaryBehaviors) {
  if (!expected.glossaryRequiredBehaviors.includes(behavior)) {
    throw new Error(`Glossary fixture is missing behavior ${behavior}.`);
  }
}
requireText(
  glossaryFixture,
  "run deterministic glossary\n   inspection",
  "glossary fixture deterministic inspection",
);
requireText(
  glossaryFixture,
  "contract\ncontradicts one glossary definition",
  "glossary fixture normative conflict",
);
requireText(
  glossaryFixture,
  "Leave GlossaryFile unchanged",
  "glossary fixture approval boundary",
);
requireText(
  glossaryFixture,
  "Markdown extraction as deferred",
  "glossary fixture Markdown deferral",
);
requireText(
  glossaryFixture,
  "After every approved Sigil write or semantic edit",
  "glossary fixture mandatory post-write inspection",
);
requireText(
  glossaryFixture,
  "including when GlossaryFile is\n   absent",
  "glossary fixture absent authority inspection",
);
requireText(
  glossaryFixture,
  "separate mandatory stages",
  "glossary fixture stage separation",
);
requireText(
  glossaryFixture,
  "Never infer that no glossary changes are needed from zero CLI diagnostics",
  "glossary fixture zero-diagnostic guard",
);
requireText(
  glossaryFixture,
  "regardless of\n   diagnostic count or GlossaryFile presence",
  "glossary fixture mandatory model extraction",
);
requireText(
  glossaryFixture,
  "instead of citing the diagnostic count",
  "glossary fixture evidence-based no-candidate result",
);
requireText(
  glossaryFixture,
  "materially\n    change behavior, ownership, state, APIs, or implementation",
  "glossary fixture material ambiguity blocker",
);
requireText(
  glossaryFixture,
  "include its scoped `glossaryContext`",
  "glossary fixture coding context handoff",
);
requireText(
  glossaryFixture,
  "without injecting unrelated workspace vocabulary",
  "glossary fixture scoped request supplement",
);

const brownfield = await Deno.readTextFile(
  `${root}/references/brownfield-adoption.md`,
);
requireText(
  brownfield,
  "Complete `references/workspace-bootstrap.md` before gathering detailed project",
  "brownfield bootstrap-first rule",
);
requireText(
  brownfield,
  "Brownfield classification does not authorize initialization",
  "brownfield initialization independence",
);
requireText(
  brownfield,
  "Build Each Boundary Picture Through Conversation",
  "brownfield conversational discovery",
);
requireText(
  brownfield,
  "one primary decision at a time",
  "brownfield follow-up conversation",
);
requireText(
  brownfield,
  "Ask the user to confirm or correct each synthesized boundary",
  "brownfield separate confirmation",
);
requireText(
  brownfield,
  "Do not move to task modeling until the user approves the\nwritten configured-boundary summaries.",
  "brownfield boundary-before-task ordering",
);

const greenfield = await Deno.readTextFile(
  `${root}/references/greenfield-design.md`,
);
requireText(
  greenfield,
  "one-primary-decision turns",
  "greenfield iterative design",
);
requireText(
  greenfield,
  "shared design conversation",
  "greenfield recommendation",
);
requireText(
  greenfield,
  "Greenfield choices should explain",
  "greenfield rejectable choices",
);
requireText(
  greenfield,
  "Show the exact components, expands, and imports that would be written.",
  "greenfield exact proposal",
);

const implementationDesign = await Deno.readTextFile(
  `${root}/references/implementation-design.md`,
);
requireText(
  implementationDesign,
  "A component's goal and interface are public relative to its dependents.",
  "dependent-relative public contract",
);
requireText(
  implementationDesign,
  "Select Component, Expand, Or Omit",
  "implementation selection rule",
);
requireText(
  implementationDesign,
  "Build The Implementation Coverage Map",
  "implementation coverage map procedure",
);
requireText(
  implementationDesign,
  "Review UI Component Coverage",
  "UI component coverage procedure",
);

const glossaryWorkflow = await Deno.readTextFile(
  `${root}/references/glossary-workflow.md`,
);
requireText(
  glossaryWorkflow,
  "The glossary is reviewed authority.",
  "glossary reviewed authority",
);
requireText(
  glossaryWorkflow,
  "sigil glossary . --format json --pretty",
  "glossary inspection command",
);
requireText(
  glossaryWorkflow,
  "Completing `sigil glossary` completes only deterministic inspection.",
  "glossary deterministic-stage boundary",
);
requireText(
  glossaryWorkflow,
  "Zero\n" +
    "diagnostics establish only that the deterministic glossary projection is valid.",
  "glossary zero-diagnostic limitation",
);
requireText(
  glossaryWorkflow,
  "Candidate extraction is a mandatory model-assisted stage",
  "glossary mandatory model extraction",
);
requireText(
  glossaryWorkflow,
  "A diagnostic count is not evidence for\n  this conclusion.",
  "glossary evidence-based no-candidate result",
);
requireText(
  glossaryWorkflow,
  "Leave repository\nfiles unchanged while awaiting approval.",
  "glossary exact proposal gate",
);
requireText(
  glossaryWorkflow,
  "Markdown and other document adapters are deferred",
  "glossary Markdown deferral",
);

console.log(
  "Sigil skill 0.6.0 dispatcher, workspace bootstrap, compatibility, authoring, glossary, review gates, workflow references, implementation coverage, and fixture rubrics are valid.",
);

async function requireFile(path: string): Promise<void> {
  const stat = await Deno.stat(path);
  if (!stat.isFile) throw new Error(`Expected file ${path}`);
}

function requireText(source: string, value: string, label: string): void {
  if (!source.includes(value)) throw new Error(`Missing ${label}: ${value}`);
}
