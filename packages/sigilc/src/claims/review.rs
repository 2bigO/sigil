//! The review view: the linked check's computed evidence, small enough for a
//! judge to read whole.
//!
//! The judgment context carries every unit's prose, and repeats a promise's
//! prose for each obligation it raises, so on a real design it is far larger
//! than the design itself. This view carries no prose. It names every entity,
//! unit, claim, conclusion, obligation, finding and simplification candidate
//! by a short alias local to one check, and the evidence file beside it maps
//! each alias back to its full identity, the exact source bytes it was read
//! from, and the report or context entry that carries its detail.
//!
//! Nothing here judges or computes anything new: it is a projection of what
//! the check already derived. Only exact repeats are folded together, each
//! keeping every place it came from.
use super::{
    context::{
        CONTEXT_VERSION, Context, Coverage, DUPLICATE_PROPOSITION, Obligation, SUBSUMED_CLAIM,
    },
    findings::{Class, Identity, REPORT_VERSION, Report, State, serde_name},
    identity::Body,
    link::{Linked, SourceEvidence, WORKSPACE},
    program::{self, Saturated, text},
};
use crate::{
    locations::{Location, sha256},
    structure::DesignInput,
};
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, BTreeSet},
    fmt::Write as _,
};

/// Changes when the evidence file's shape changes.
pub const REVIEW_VERSION: u32 = 1;

/// The view beside a linked report.
pub const VIEW_SUFFIX: &str = ".linked.review.md";

/// The evidence file beside a linked report.
pub const EVIDENCE_SUFFIX: &str = ".linked.review.json";

/// One file the evidence binds: its name in the claims store and the SHA-256
/// of its exact bytes.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Artifact {
    pub file: String,
    pub sha256: String,
}

impl Artifact {
    pub fn new(file: &str, bytes: &[u8]) -> Self {
        Self {
            file: file.to_owned(),
            sha256: sha256(bytes),
        }
    }
}

/// What the view is projected from: one linked check, already computed.
pub struct Inputs<'a> {
    /// The design as the check loaded it, so source identities are those of
    /// the bytes it read rather than whatever is on disk later.
    pub input: &'a DesignInput,
    pub linked: &'a Linked,
    pub world: &'a Saturated,
    pub report: &'a Report,
    pub context: &'a Context,
    /// The `--source` the report's findings were narrowed to, if any.
    pub filter: Option<&'a str>,
    pub report_artifact: Artifact,
    pub context_artifact: Artifact,
}

/// The view and the evidence that resolves it.
pub struct Bundle {
    pub view: String,
    pub evidence: Evidence,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Evidence {
    pub version: u32,
    pub scope: Scope,
    pub computation: Computation,
    pub artifacts: Artifacts,
    pub inputs: LoadedInputs,
    pub entities: Vec<EntityEntry>,
    pub units: Vec<UnitEntry>,
    pub claims: Vec<ClaimEntry>,
    pub conclusions: Vec<ConclusionEntry>,
    pub obligations: Vec<ObligationEntry>,
    pub findings: Vec<FindingEntry>,
    pub simplifications: Vec<SimplificationEntry>,
    pub unread: Vec<UnreadEntry>,
    /// A pointer into the report for each import that did not resolve.
    pub unresolved_imports: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Scope {
    /// What was computed: always the whole workspace.
    pub computation: String,
    /// The source the report's findings were narrowed to. Units, claims and
    /// coverage are the workspace's either way.
    pub report_filter: Option<String>,
    pub state: State,
    pub findings: usize,
    pub coverage: CoverageTotals,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CoverageTotals {
    pub units: usize,
    pub interpreted: usize,
    pub read_without_commitment: usize,
    pub uninterpreted: usize,
    pub unread: usize,
    pub refused: usize,
    pub unresolved_imports: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Computation {
    pub tool: String,
    pub language_version: String,
    pub reader_version: String,
    pub report_version: u32,
    pub context_version: u32,
    pub workspace_digest: String,
    pub identity: Identity,
    pub sources: Vec<SourceEvidence>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Artifacts {
    pub view: Artifact,
    pub report: Artifact,
    pub context: Artifact,
}

/// Every file the check loaded, by the bytes it loaded.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LoadedInputs {
    pub sources: Vec<LoadedSource>,
    /// Workspace configuration, including files that were absent.
    pub context: Vec<LoadedContext>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LoadedSource {
    pub path: String,
    pub sha256: String,
    pub bytes: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LoadedContext {
    pub path: String,
    pub present: bool,
    pub sha256: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EntityEntry {
    pub alias: String,
    pub id: String,
    pub kind: String,
    pub label: String,
    /// The owning entity's alias.
    pub owner: Option<String>,
    pub source: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UnitEntry {
    pub alias: String,
    pub facet: String,
    pub source: String,
    /// The owning component's alias.
    pub component: String,
    pub section: String,
    pub coverage: UnitCoverage,
    /// The unit's prose as exact UTF-8 bytes of the source the check loaded.
    pub location: Option<Location>,
    /// A JSON pointer into the judgment context.
    pub context: String,
}

/// How far the check got with one unit, with what is unread or refused taking
/// precedence over the context's own account.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum UnitCoverage {
    Interpreted,
    ReadWithoutCommitment,
    Uninterpreted,
    /// No valid stored reading.
    Unread,
    /// A stored reading that admission refused.
    Refused,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ClaimEntry {
    pub alias: String,
    pub id: String,
    pub unit: String,
    pub context: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConclusionEntry {
    pub alias: String,
    pub subject: String,
    pub relation: String,
    pub object: String,
    pub derivations: Vec<Derivation>,
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Derivation {
    pub law: String,
    pub witness: String,
    /// Pointers into the judgment context, where a unit carries it.
    pub context: Vec<String>,
    /// Aliases of the claims and conclusions the law combined, so a conclusion
    /// whose witness is a component or graph still leads to its support.
    pub premises: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ObligationEntry {
    pub alias: String,
    pub claim: String,
    pub filled: bool,
    pub context: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FindingEntry {
    pub alias: String,
    /// A JSON pointer into the report.
    pub report: String,
    pub claims: Vec<String>,
    pub units: Vec<String>,
    pub obligations: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SimplificationEntry {
    pub alias: String,
    pub kind: String,
    pub claims: Vec<String>,
    /// Every context candidate the entry folds together.
    pub context: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UnreadEntry {
    pub report: String,
    pub units: Vec<String>,
}

/// Bundle-local names, assigned from sorted canonical identities.
struct Names {
    entities: BTreeMap<String, String>,
    units: BTreeMap<String, String>,
    claims: BTreeMap<String, String>,
    /// Step claim id to its ordinal, so a step reads as one wherever it is named.
    steps: BTreeMap<String, u32>,
}

impl Names {
    /// How the view writes an identity: its alias, or the value quoted when it
    /// names nothing this bundle aliases.
    fn of(&self, id: &str) -> String {
        if let Some(alias) = self.entities.get(id).or_else(|| self.units.get(id)) {
            return alias.clone();
        }
        match (self.claims.get(id), self.steps.get(id)) {
            (Some(alias), Some(ordinal)) => format!("{alias}:step{ordinal}"),
            (Some(alias), None) => alias.clone(),
            _ => format!("{id:?}"),
        }
    }

    fn claim(&self, id: &str) -> String {
        self.claims
            .get(id)
            .cloned()
            .unwrap_or_else(|| format!("{id:?}"))
    }
}

/// The claims and conclusions one derivation combined, read back from the law
/// that produced it in `claims.egg`.
fn premises(
    stated_by: &BTreeMap<(String, String, String), Vec<String>>,
    (subject, _, object): (&String, &String, &String),
    law: &str,
    witness: &str,
    own: &str,
) -> Vec<String> {
    let fact = |s: &str, p: &str, o: &str| (s.to_owned(), p.to_owned(), o.to_owned());
    let facts: Vec<(String, String, String)> = match law {
        "dependency-direct" => vec![fact(subject, "dependsOn", object)],
        "dependency-transitive" => vec![
            fact(subject, "reachable", witness),
            fact(witness, "dependsOn", object),
        ],
        "delegated-capability" => vec![
            fact(subject, "delegates", witness),
            fact(witness, "provides", object),
        ],
        "flow-end-direct" => vec![fact(subject, "to", object)],
        // The next step reaches an end by any of its own derivations.
        "flow-end-transitive" => std::iter::once(fact(subject, "to", object))
            .chain(
                stated_by
                    .keys()
                    .filter(|(s, p, _)| s == object && p == "flow-end")
                    .cloned(),
            )
            .collect(),
        _ => Vec::new(),
    };
    let mut found: Vec<String> = facts
        .iter()
        .filter_map(|f| stated_by.get(f))
        .flatten()
        .filter(|alias| alias.as_str() != own)
        .cloned()
        .collect();
    found.sort_by(|a, b| (&a[..1], number(a)).cmp(&(&b[..1], number(b))));
    found.dedup();
    found
}

fn aliases<'a>(
    prefix: &str,
    ids: impl IntoIterator<Item = &'a String>,
) -> BTreeMap<String, String> {
    let sorted: BTreeSet<&String> = ids.into_iter().collect();
    sorted
        .into_iter()
        .enumerate()
        .map(|(n, id)| (id.clone(), format!("{prefix}{}", n + 1)))
        .collect()
}

struct EntityRow {
    kind: String,
    label: String,
    owner: Option<String>,
    source: String,
}

/// Project one linked check into its view and evidence.
// @sigil implements packages/sigilc/claims.sigil::SigilComputedClaims::JudgmentContext interface
pub fn build(inputs: &Inputs) -> Bundle {
    let Inputs {
        input,
        linked,
        world,
        report,
        context,
        filter,
        ..
    } = inputs;

    // Declared entities, then the flow graphs the program minted. A step is
    // not listed here: its identity is its declaring claim's.
    let mut entity_rows: BTreeMap<String, EntityRow> = BTreeMap::new();
    for entity in &linked.request.entities {
        entity_rows.entry(entity.id.clone()).or_insert(EntityRow {
            kind: entity.kind.clone(),
            label: entity.label.clone(),
            owner: entity.owner.clone(),
            source: entity.source.clone(),
        });
    }
    for row in world.table("entity") {
        if text(row, 1) == "Graph" {
            entity_rows.entry(text(row, 0)).or_insert(EntityRow {
                kind: text(row, 1),
                label: text(row, 2),
                owner: Some(text(row, 3)).filter(|o| !o.is_empty()),
                source: text(row, 4),
            });
        }
    }

    let mut claim_at: BTreeMap<String, (usize, usize)> = BTreeMap::new();
    let mut steps = BTreeMap::new();
    for (u, unit) in context.units.iter().enumerate() {
        for (a, asserted) in unit.asserted.iter().enumerate() {
            claim_at.insert(asserted.claim.clone(), (u, a));
            if let Body::Step { ordinal } = asserted.body {
                steps.insert(asserted.claim.clone(), ordinal);
            }
        }
    }
    let names = Names {
        entities: aliases("E", entity_rows.keys()),
        units: aliases("U", context.units.iter().map(|u| &u.facet)),
        claims: aliases("C", claim_at.keys()),
        steps,
    };
    let unit_alias = |facet: &str| names.units.get(facet).cloned().unwrap_or_default();
    let facet_of_claim = |claim: &str| claim_at.get(claim).map(|(u, _)| &context.units[*u].facet);
    let at = |claim: &str| match facet_of_claim(claim) {
        Some(facet) => format!("{}@{}", names.claim(claim), unit_alias(facet)),
        None => names.claim(claim),
    };

    // Coverage, with what is unread or refused taking precedence over the
    // context's own account of a unit nothing was linked for.
    let unread_of: BTreeMap<&str, bool> = report
        .unread
        .iter()
        .flatten()
        .flat_map(|u| {
            u.facets
                .iter()
                .map(move |f| (f.as_str(), u.refusal.is_some()))
        })
        .collect();
    let coverage = |facet: &str, coverage: Coverage| match unread_of.get(facet) {
        Some(true) => UnitCoverage::Refused,
        Some(false) => UnitCoverage::Unread,
        None => match coverage {
            Coverage::Interpreted => UnitCoverage::Interpreted,
            Coverage::ReadWithoutCommitment => UnitCoverage::ReadWithoutCommitment,
            Coverage::Uninterpreted => UnitCoverage::Uninterpreted,
        },
    };
    let unresolved = report.unresolved_imports.as_deref().unwrap_or_default();
    let mut totals = CoverageTotals {
        units: context.units.len(),
        interpreted: 0,
        read_without_commitment: 0,
        uninterpreted: 0,
        unread: 0,
        refused: 0,
        unresolved_imports: unresolved.len(),
    };
    for unit in &context.units {
        match coverage(&unit.facet, unit.coverage) {
            UnitCoverage::Interpreted => totals.interpreted += 1,
            UnitCoverage::ReadWithoutCommitment => totals.read_without_commitment += 1,
            UnitCoverage::Uninterpreted => totals.uninterpreted += 1,
            UnitCoverage::Unread => totals.unread += 1,
            UnitCoverage::Refused => totals.refused += 1,
        }
    }

    let entities: Vec<EntityEntry> = entity_rows
        .iter()
        .map(|(id, row)| EntityEntry {
            alias: names.entities[id].clone(),
            id: id.clone(),
            kind: row.kind.clone(),
            label: row.label.clone(),
            owner: row.owner.as_deref().map(|o| names.of(o)),
            source: row.source.clone(),
        })
        .collect();

    // Each source is hashed once, however many units it holds.
    let digests: BTreeMap<&str, String> = input
        .sources
        .iter()
        .map(|s| (s.path.as_str(), sha256(s.text.as_bytes())))
        .collect();
    let input_unit: BTreeMap<&str, &crate::structure::Unit> =
        input.units.iter().map(|u| (u.id.as_str(), u)).collect();
    let mut units: Vec<UnitEntry> = context
        .units
        .iter()
        .enumerate()
        .map(|(u, unit)| {
            let located = input_unit.get(unit.facet.as_str());
            UnitEntry {
                alias: unit_alias(&unit.facet),
                facet: unit.facet.clone(),
                source: located.map(|i| i.source.clone()).unwrap_or_default(),
                component: names.of(&unit.component),
                section: unit.section.clone(),
                coverage: coverage(&unit.facet, unit.coverage),
                location: located.and_then(|i| {
                    let digest = digests.get(i.source.as_str())?;
                    Some(Location::with_digest(
                        "design",
                        &i.source,
                        digest.clone(),
                        i.prose_range.clone(),
                    ))
                }),
                context: format!("/units/{u}"),
            }
        })
        .collect();
    units.sort_by(|a, b| number(&a.alias).cmp(&number(&b.alias)));

    // Claim aliases follow `claim_at`'s order, so these come out in alias order.
    let claims: Vec<ClaimEntry> = claim_at
        .iter()
        .map(|(id, (u, a))| ClaimEntry {
            alias: names.claim(id),
            id: id.clone(),
            unit: unit_alias(&context.units[*u].facet),
            context: format!("/units/{u}/asserted/{a}"),
        })
        .collect();

    // Conclusions the laws inferred. One a claim states directly is that claim
    // again, so it is not repeated.
    let mut derived_at: BTreeMap<(String, String, String, String, String), Vec<String>> =
        BTreeMap::new();
    for (u, unit) in context.units.iter().enumerate() {
        for (d, derived) in unit.derived.iter().enumerate() {
            derived_at
                .entry((
                    derived.subject.clone(),
                    derived.relation.clone(),
                    derived.object.clone(),
                    derived.law.clone(),
                    derived.witness.clone(),
                ))
                .or_default()
                .push(format!("/units/{u}/derived/{d}"));
        }
    }
    type Fact = (String, String, String);
    let mut inferred: BTreeMap<Fact, BTreeSet<(String, String, Vec<String>)>> = BTreeMap::new();
    // The aliases that state each fact: the claims asserting it, then the
    // conclusion inferring it.
    let mut stated_by: BTreeMap<Fact, Vec<String>> = BTreeMap::new();
    for row in world.table("because") {
        let law = text(row, 3);
        let witness = text(row, 4);
        let fact = (text(row, 0), text(row, 1), text(row, 2));
        if law == "asserted" {
            if let Some(alias) = names.claims.get(&witness) {
                stated_by.entry(fact).or_default().push(alias.clone());
            }
            continue;
        }
        let full = (fact.0, fact.1, fact.2, law, witness);
        let pointers = derived_at.get(&full).cloned().unwrap_or_default();
        let (subject, relation, object, law, witness) = full;
        inferred
            .entry((subject, relation, object))
            .or_default()
            .insert((law, witness, pointers));
    }
    for (n, fact) in inferred.keys().enumerate() {
        stated_by
            .entry(fact.clone())
            .or_default()
            .push(format!("D{}", n + 1));
    }
    let conclusions: Vec<ConclusionEntry> = inferred
        .iter()
        .enumerate()
        .map(|(n, ((subject, relation, object), derivations))| {
            let alias = format!("D{}", n + 1);
            let derivations = derivations
                .iter()
                .map(|(law, witness, context)| Derivation {
                    premises: premises(
                        &stated_by,
                        (subject, relation, object),
                        law,
                        witness,
                        &alias,
                    ),
                    law: law.clone(),
                    witness: witness.clone(),
                    context: context.clone(),
                })
                .collect();
            ConclusionEntry {
                alias,
                subject: subject.clone(),
                relation: relation.clone(),
                object: object.clone(),
                derivations,
            }
        })
        .collect();

    let mut raised: Vec<(&Obligation, (usize, usize))> = context
        .units
        .iter()
        .enumerate()
        .flat_map(|(u, unit)| {
            unit.obligations
                .iter()
                .enumerate()
                .map(move |(o, obligation)| (obligation, (u, o)))
        })
        .collect();
    raised.sort_by(|(a, x), (b, y)| {
        (
            &a.promise.claim,
            &a.subject,
            &a.relation,
            &a.object,
            a.filled,
            x,
        )
            .cmp(&(
                &b.promise.claim,
                &b.subject,
                &b.relation,
                &b.object,
                b.filled,
                y,
            ))
    });
    let obligations: Vec<ObligationEntry> = raised
        .iter()
        .enumerate()
        .map(|(n, (obligation, (u, o)))| ObligationEntry {
            alias: format!("O{}", n + 1),
            claim: names.claim(&obligation.promise.claim),
            filled: obligation.filled,
            context: format!("/units/{u}/obligations/{o}"),
        })
        .collect();

    let findings: Vec<FindingEntry> = report
        .findings
        .iter()
        .enumerate()
        .map(|(n, finding)| {
            // Unit aliases follow facet order, so a set of facets is already
            // in alias order.
            let mut facets: BTreeSet<&str> = finding
                .claims
                .iter()
                .filter_map(|c| facet_of_claim(c).map(String::as_str))
                .collect();
            if names.units.contains_key(&finding.object) {
                facets.insert(&finding.object);
            }
            let obligations = if finding.class == Class::UnmetObligation {
                raised
                    .iter()
                    .zip(&obligations)
                    .filter(|((obligation, _), _)| {
                        !obligation.filled
                            && finding.claims.contains(&obligation.promise.claim)
                            && obligation.subject == finding.subject
                            && obligation.object == finding.object
                    })
                    .map(|(_, entry)| entry.alias.clone())
                    .collect()
            } else {
                Vec::new()
            };
            let units = facets.into_iter().map(&unit_alias).collect();
            FindingEntry {
                alias: format!("F{}", n + 1),
                report: format!("/findings/{n}"),
                claims: finding.claims.iter().map(|c| names.claim(c)).collect(),
                units,
                obligations,
            }
        })
        .collect();

    let (simplifications, grouped): (Vec<SimplificationEntry>, Vec<Vec<String>>) =
        simplifications(context, &names).into_iter().unzip();

    let unread: Vec<UnreadEntry> = report
        .unread
        .iter()
        .flatten()
        .enumerate()
        .map(|(n, u)| UnreadEntry {
            report: format!("/unread/{n}"),
            units: u.facets.iter().map(|f| unit_alias(f)).collect(),
        })
        .collect();

    let scope = Scope {
        computation: WORKSPACE.to_owned(),
        report_filter: filter.map(str::to_owned),
        state: report.state,
        findings: report.findings.len(),
        coverage: totals,
    };
    let evidence_file = super::findings::file_name(&report.source, EVIDENCE_SUFFIX);

    let mut evidence = Evidence {
        version: REVIEW_VERSION,
        scope,
        computation: Computation {
            tool: format!("sigilc {}", env!("CARGO_PKG_VERSION")),
            language_version: input.language_version.clone(),
            reader_version: input.reader_version.clone(),
            report_version: REPORT_VERSION,
            context_version: CONTEXT_VERSION,
            workspace_digest: linked.workspace_digest.clone(),
            identity: report.identity.clone(),
            sources: linked.sources.clone(),
        },
        artifacts: Artifacts {
            view: Artifact::new("", b""),
            report: inputs.report_artifact.clone(),
            context: inputs.context_artifact.clone(),
        },
        inputs: LoadedInputs {
            sources: input
                .sources
                .iter()
                .map(|s| LoadedSource {
                    path: s.path.clone(),
                    sha256: sha256(s.text.as_bytes()),
                    bytes: s.text.len(),
                })
                .collect(),
            context: input
                .context
                .iter()
                .map(|c| LoadedContext {
                    path: c.path.clone(),
                    present: c.text.is_some(),
                    sha256: c.text.as_deref().map(|t| sha256(t.as_bytes())),
                })
                .collect(),
        },
        entities,
        units,
        claims,
        conclusions,
        obligations,
        findings,
        simplifications,
        unread,
        unresolved_imports: (0..unresolved.len())
            .map(|n| format!("/unresolvedImports/{n}"))
            .collect(),
    };

    let view = render(&View {
        inputs,
        names: &names,
        evidence: &evidence,
        evidence_file: &evidence_file,
        at: &at,
        obligations: raised.iter().map(|(o, _)| *o).collect(),
        grouped: &grouped,
    });
    evidence.artifacts.view = Artifact::new(
        &super::findings::file_name(&report.source, VIEW_SUFFIX),
        view.as_bytes(),
    );
    Bundle { view, evidence }
}

/// The numeric part of an alias, so `C10` sorts after `C9`.
fn number(alias: &str) -> usize {
    alias
        .trim_start_matches(|c: char| c.is_ascii_alphabetic())
        .parse()
        .unwrap_or_default()
}

/// Candidates, with every pair of duplicate propositions that share a claim
/// folded into one group. Each group keeps every candidate it folds.
fn simplifications(context: &Context, names: &Names) -> Vec<(SimplificationEntry, Vec<String>)> {
    // Union-find over the claims of duplicate-proposition pairs.
    let mut parent: BTreeMap<String, String> = BTreeMap::new();
    fn find(parent: &mut BTreeMap<String, String>, id: &str) -> String {
        let up = parent
            .entry(id.to_owned())
            .or_insert_with(|| id.to_owned())
            .clone();
        if up == id {
            return up;
        }
        let root = find(parent, &up);
        parent.insert(id.to_owned(), root.clone());
        root
    }
    for candidate in &context.simplification {
        if candidate.kind == DUPLICATE_PROPOSITION
            && let [first, rest @ ..] = candidate.claims.as_slice()
        {
            for other in rest {
                let (a, b) = (find(&mut parent, first), find(&mut parent, other));
                // The smaller root wins, so a group's root never depends on
                // the order the pairs arrive in.
                match a.cmp(&b) {
                    std::cmp::Ordering::Less => parent.insert(b, a),
                    std::cmp::Ordering::Greater => parent.insert(a, b),
                    std::cmp::Ordering::Equal => None,
                };
            }
        }
    }

    let mut groups: BTreeMap<(String, BTreeSet<String>), BTreeSet<usize>> = BTreeMap::new();
    let mut members: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
    let ids: Vec<String> = parent.keys().cloned().collect();
    for id in ids {
        let root = find(&mut parent, &id);
        members.entry(root).or_default().insert(id);
    }
    for (n, candidate) in context.simplification.iter().enumerate() {
        let claims: BTreeSet<String> = if candidate.kind == DUPLICATE_PROPOSITION {
            candidate
                .claims
                .first()
                .map(|c| members[&find(&mut parent, c)].clone())
                .unwrap_or_default()
        } else {
            candidate.claims.iter().cloned().collect()
        };
        groups
            .entry((candidate.kind.clone(), claims))
            .or_default()
            .insert(n);
    }
    groups
        .into_iter()
        .enumerate()
        .map(|(n, ((kind, claims), candidates))| {
            let mut ids: Vec<String> = claims.into_iter().collect();
            ids.sort_by_key(|id| number(&names.claim(id)));
            let entry = SimplificationEntry {
                alias: format!("S{}", n + 1),
                kind,
                claims: ids.iter().map(|c| names.claim(c)).collect(),
                context: candidates
                    .into_iter()
                    .map(|i| format!("/simplification/{i}"))
                    .collect(),
            };
            (entry, ids)
        })
        .collect()
}

struct View<'a> {
    inputs: &'a Inputs<'a>,
    names: &'a Names,
    evidence: &'a Evidence,
    evidence_file: &'a str,
    at: &'a dyn Fn(&str) -> String,
    /// The context's obligations, in alias order.
    obligations: Vec<&'a Obligation>,
    /// Each simplification entry's claim ids, in its alias order.
    grouped: &'a [Vec<String>],
}

fn render(view: &View) -> String {
    let View {
        inputs,
        names,
        evidence,
        evidence_file,
        at,
        obligations,
        grouped,
    } = view;
    let (report, context) = (inputs.report, inputs.context);
    let scope = &evidence.scope;
    let totals = &scope.coverage;
    let mut out = String::new();
    let mut line = |text: String| {
        out.push_str(&text);
        out.push('\n');
    };

    line("# Sigil review view".into());
    line(String::new());
    line(format!(
        "Computation: whole workspace ({} sources); report filter: {}.",
        evidence.inputs.sources.len(),
        match &scope.report_filter {
            Some(source) => format!("{source} (findings below are those it authored part of)"),
            None => "none".into(),
        }
    ));
    line(format!(
        "State: {}. Findings: {}. Units: {} (interpreted {}, read-without-commitment {}, uninterpreted {}, unread {}, refused {}). Unresolved imports: {}.",
        serde_name(&scope.state),
        scope.findings,
        totals.units,
        totals.interpreted,
        totals.read_without_commitment,
        totals.uninterpreted,
        totals.unread,
        totals.refused,
        totals.unresolved_imports,
    ));
    line(format!(
        "Evidence: {evidence_file} (report {}, context {}).",
        inputs.report_artifact.file, inputs.context_artifact.file
    ));
    line(String::new());
    line(
        "Aliases are local to this check. A claim is required and expected to hold unless marked. \
         A step is named by its claim alias. A conclusion a claim states directly is not repeated. \
         No prose is shown: retrieve a unit's prose through the evidence file."
            .into(),
    );

    line(String::new());
    line("## Vocabulary".into());
    for entity in &evidence.entities {
        let mut text = format!(
            "{} {} {:?}",
            entity.alias,
            entity.kind.to_lowercase(),
            entity.label
        );
        if let Some(owner) = &entity.owner {
            let _ = write!(text, " of {owner}");
        } else if !entity.source.is_empty() {
            let _ = write!(text, " in {}", entity.source);
        }
        line(text);
    }

    // Units in source order, each with its claims beneath it.
    line(String::new());
    line("## Units and claims".into());
    let position: BTreeMap<&str, (&str, usize)> = inputs
        .input
        .units
        .iter()
        .map(|u| (u.id.as_str(), (u.source.as_str(), u.prose_range.start)))
        .collect();
    let mut ordered: Vec<usize> = (0..context.units.len()).collect();
    ordered.sort_by_key(|&u| {
        position
            .get(context.units[u].facet.as_str())
            .copied()
            .unwrap_or_default()
    });
    let entry_of: BTreeMap<&str, &UnitEntry> = evidence
        .units
        .iter()
        .map(|u| (u.facet.as_str(), u))
        .collect();
    let mut source = "";
    for u in ordered {
        let unit = &context.units[u];
        let entry = entry_of[unit.facet.as_str()];
        if entry.source != source {
            source = &entry.source;
            line(format!("### {source}"));
        }
        let mut text = format!(
            "{} {} {} · {}",
            entry.alias,
            entry.component,
            entry.section,
            serde_name(&entry.coverage)
        );
        if !program::commits(&entry.section) {
            text.push_str(" · non-committing");
        }
        line(text);
        // A flow reads in step order: each step, then what it does and what
        // guards it. Every other claim comes first.
        let mut asserted: Vec<_> = unit.asserted.iter().collect();
        asserted.sort_by_cached_key(|a| {
            let place = match &a.body {
                Body::Step { ordinal } => (*ordinal, 0),
                Body::Claim { subject, .. } => names.steps.get(subject).map_or((0, 0), |o| (*o, 1)),
                Body::Guard { step, .. } => (*step, 2),
                _ => (0, 0),
            };
            (place, number(&names.claim(&a.claim)))
        });
        for asserted in asserted {
            let mut text = format!(
                "  {} {}",
                names.claim(&asserted.claim),
                body(&asserted.body, names)
            );
            if !asserted.satisfies_unit {
                text.push_str(" [defective]");
            }
            line(text);
        }
    }

    if !evidence.conclusions.is_empty() {
        line(String::new());
        line("## Conclusions".into());
        for conclusion in &evidence.conclusions {
            let laws: BTreeSet<&str> = conclusion
                .derivations
                .iter()
                .map(|d| d.law.as_str())
                .collect();
            let mut premises: Vec<&str> = Vec::new();
            for derivation in &conclusion.derivations {
                for premise in &derivation.premises {
                    if !premises.contains(&premise.as_str()) {
                        premises.push(premise);
                    }
                }
            }
            let mut text = format!(
                "{} {} {} {} ({})",
                conclusion.alias,
                names.of(&conclusion.subject),
                conclusion.relation,
                names.of(&conclusion.object),
                laws.into_iter().collect::<Vec<_>>().join(", ")
            );
            if !premises.is_empty() {
                text.push_str(" · from ");
                text.push_str(&premises.join(" "));
            }
            line(text);
        }
    }

    if !evidence.obligations.is_empty() {
        line(String::new());
        line("## Obligations".into());
        for (entry, obligation) in evidence.obligations.iter().zip(obligations) {
            line(format!(
                "{} {}: {} {} {} · {}",
                entry.alias,
                at(&obligation.promise.claim),
                names.of(&obligation.subject),
                obligation.relation,
                names.of(&obligation.object),
                if entry.filled { "filled" } else { "unmet" }
            ));
        }
    }

    line(String::new());
    line("## Findings".into());
    if report.findings.is_empty() {
        line("None.".into());
    }
    // A detail sentence shared by many findings is written once, as a note.
    let mut notes: Vec<&str> = Vec::new();
    for (entry, finding) in evidence.findings.iter().zip(&report.findings) {
        let class = serde_name(&finding.class);
        let mut text = format!(
            "{} {class} {}: {} → {}",
            entry.alias,
            finding.law,
            names.of(&finding.subject),
            if finding.object.is_empty() {
                "—".to_owned()
            } else {
                names.of(&finding.object)
            }
        );
        if finding.claims.is_empty() {
            let _ = write!(
                text,
                " · {} {}",
                names.of(&finding.component),
                finding.section
            );
        } else {
            let _ = write!(
                text,
                " · {}",
                finding
                    .claims
                    .iter()
                    .map(|c| at(c))
                    .collect::<Vec<_>>()
                    .join(", ")
            );
        }
        if !entry.obligations.is_empty() {
            let _ = write!(text, " · {}", entry.obligations.join(", "));
        }
        // A gap's detail restates its name, and an unmet obligation's restates
        // the obligation named beside it.
        let restated = finding.class == Class::Gap || finding.class == Class::UnmetObligation;
        if !restated && !finding.detail.is_empty() {
            let index = notes
                .iter()
                .position(|n| *n == finding.detail)
                .unwrap_or_else(|| {
                    notes.push(&finding.detail);
                    notes.len() - 1
                });
            let _ = write!(text, " · note {}", index + 1);
        }
        line(text);
    }
    if !notes.is_empty() {
        line(String::new());
        line("Notes:".into());
        for (n, note) in notes.iter().enumerate() {
            line(format!("note {}: {note}", n + 1));
        }
    }

    if !evidence.simplifications.is_empty() {
        line(String::new());
        line("## Simplification candidates".into());
        for (entry, ids) in evidence.simplifications.iter().zip(grouped.iter()) {
            let claims: Vec<String> = ids.iter().map(|id| at(id)).collect();
            let mut text = format!("{} {}: {}", entry.alias, entry.kind, claims.join(", "));
            if entry.kind == SUBSUMED_CLAIM {
                text.push_str(" (already derived by another route)");
            }
            line(text);
        }
    }

    line(String::new());
    line("## Coverage".into());
    let unread = report.unread.as_deref().unwrap_or_default();
    if unread.is_empty() {
        line("Unread: none.".into());
    }
    for (entry, unit) in evidence.unread.iter().zip(unread) {
        line(format!(
            "{} {} {} in {}: {}",
            if unit.refusal.is_some() {
                "Refused"
            } else {
                "Unread"
            },
            entry.units.join(", "),
            unit.section,
            unit.source,
            unit.refusal.as_deref().unwrap_or("no stored reading"),
        ));
    }
    let unresolved = report.unresolved_imports.as_deref().unwrap_or_default();
    if unresolved.is_empty() {
        line("Unresolved imports: none.".into());
    }
    for import in unresolved {
        line(format!(
            "Unresolved import in {}: {} from {} ({})",
            import.source, import.provider, import.path, import.status
        ));
    }
    line(format!(
        "Non-committing roles: {}.",
        context.non_committing_roles.join(", ")
    ));
    out
}

/// One claim body, every column kept.
fn body(body: &Body, names: &Names) -> String {
    match body {
        Body::Claim {
            subject,
            relation,
            object,
            modality,
            expected,
        } => {
            let mut text = format!("{} {relation} {}", names.of(subject), names.of(object));
            let mut marks = Vec::new();
            if modality != "required" {
                marks.push(modality.clone());
            }
            if expected != "true" {
                marks.push(format!("expected {expected}"));
            }
            if !marks.is_empty() {
                let _ = write!(text, " ({})", marks.join(", "));
            }
            text
        }
        Body::Property {
            subject,
            property,
            value,
        } => format!("property {} {property} = {value}", names.of(subject)),
        Body::Measure {
            subject,
            property,
            number,
        } => format!("measure {} {property} = {number}", names.of(subject)),
        Body::Reading { outcome } => format!("reading {outcome}"),
        Body::Step { ordinal } => format!("step {ordinal}"),
        Body::Guard {
            step,
            operand,
            value,
        } => format!("guard step {step}: {operand} = {}", names.of(value)),
        Body::Undeclared { name, declared } => match declared {
            Some(entity) => format!(
                "undeclared {name:?} (declared as {}, not referenced here)",
                names.of(entity)
            ),
            None => format!("undeclared {name:?}"),
        },
    }
}
