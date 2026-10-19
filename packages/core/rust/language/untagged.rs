//! The advisory untagged-Facet warning. A port of `untaggedFacetDiagnostics`
//! in `packages/core/src/resolver.ts`.
//!
//! Operational Facets should name a Tag in their own prose, so interpretation
//! can ground claims in something narrower than a component. Resolution does
//! not report it; callers such as `sigil check` ask for it.
use super::{
    diagnostics::{Location, diagnostic, order_diagnostics},
    resolve::{AccessStatus, FacetPos, ResolvedWorkspace},
};
use crate::types::{Diagnostic, Severity};
use std::collections::HashSet;

/// Warn on each Facet whose prose neither references a resolved Tag nor
/// defines one. Goal and Decisions are exempt, and a group heading is not part
/// of the Facet's prose. A source whose recovery is incomplete is skipped, as
/// the check is absence-based. An ambiguous reference names no Tag, so it does
/// not count. The result is in canonical diagnostic order.
pub fn untagged_facet_diagnostics(resolved: &ResolvedWorkspace) -> Vec<Diagnostic> {
    let mut diagnostics = Vec::new();
    for component in &resolved.components {
        if !resolved.documents[component.file].complete {
            continue;
        }
        let tagged: HashSet<FacetPos> = component
            .references
            .iter()
            .filter(|r| r.status == AccessStatus::Resolved)
            .map(|r| r.facet)
            .collect();
        let file_path = &resolved.paths[component.file];
        for (si, section) in resolved.declaration(component).sections.iter().enumerate() {
            if section.name == "goal" || section.name == "decisions" {
                continue;
            }
            for (ui, facet) in section.units.iter().enumerate() {
                let pos = FacetPos {
                    section: si,
                    unit: ui,
                };
                if tagged.contains(&pos) || facet.definitions.iter().any(|d| d.valid) {
                    continue;
                }
                let mut warning = diagnostic(
                    "SIGIL_UNTAGGED_FACET",
                    "Facet has no Tag reference or inline Tag definition in its prose.",
                    Location::at(file_path, Some(facet.prose_range.range())),
                );
                warning.severity = Severity::Warning;
                diagnostics.push(warning);
            }
        }
    }
    order_diagnostics(diagnostics)
}
