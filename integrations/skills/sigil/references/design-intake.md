<!-- @sigil implements integrations/skills/sigil/design-intake.sigil::SigilDesignIntake::DesignIntake interface,logic,constraints,cases -->

# Sigil Design Intake

Run this procedure after workspace bootstrap and before semantic authoring or
implementation for every requested change. It classifies the request; it does
not approve a mutation or replace DesignConversation.

## 1. Inspect The Boundary

Use available workspace, Sigil, implementation, test, and request evidence to
identify the affected boundary. Do not infer absent boundary evidence.

## 2. Inventory Decisions

Record only choices that could affect purpose, ownership, public behavior,
lifecycle, failure handling, permissions, persistence, compatibility,
architecture, verification, or future consistency.

## 3. Classify The Route

- `mechanical`: inspection establishes that the request introduces no material
  decision. Record the evidence for the bypass.
- `conversation-required`: one or more material decisions are unresolved. Enter
  `references/design-conversation.md` before authoring.
- `context-insufficient`: the boundary, evidence, or decision cannot be classified
  reliably. State the missing context and do not author speculative Sigil or
  implementation.

A user asking for an outcome, implementation, validation, or compilation does
not bypass this procedure. Read-only explanation, diagnosis, and status work do
not create a mutation route.
