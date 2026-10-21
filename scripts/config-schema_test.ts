import { deepStrictEqual as equal } from "node:assert/strict";
import { Ajv2020 } from "ajv-2020";

/**
 * The workspace config is defined twice: the strict parser in the Rust core and
 * the published JSON Schema in docs/spec/sigil-config.schema.json. The Rust
 * tests replay every fixture against the parser (`parserValid`); this checks
 * the schema against the same fixtures. A structural fixture must be accepted
 * or refused by both alike. A parser-only fixture states the schema's own
 * outcome (`schemaValid`), where the schema cannot express the parser's rule.
 * A malformed-source fixture is not JSON, so only the parser sees it.
 */
interface Fixture {
  name: string;
  category: "structural-parity" | "parser-only-semantic" | "malformed-source";
  source: string;
  parserValid: boolean;
  schemaValid?: boolean;
}

const root = new URL("..", import.meta.url);
const fixtures = JSON.parse(
  await Deno.readTextFile(
    new URL("packages/core/tests/fixtures/config-parity.json", root),
  ),
) as Fixture[];
const schema = JSON.parse(
  await Deno.readTextFile(new URL("docs/spec/sigil-config.schema.json", root)),
);
const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);

Deno.test("every config fixture gets the schema outcome it records", () => {
  const checked: string[] = [];
  for (const fixture of fixtures) {
    if (fixture.category === "malformed-source") continue;
    const expected = fixture.category === "structural-parity"
      ? fixture.parserValid
      : fixture.schemaValid;
    equal(
      typeof expected,
      "boolean",
      `${fixture.name} states no schema outcome`,
    );
    equal(
      validate(JSON.parse(fixture.source)),
      expected,
      `${fixture.name}: ${JSON.stringify(validate.errors)}`,
    );
    checked.push(fixture.name);
  }
  equal(checked.length, 57);
});

Deno.test("a schema-only difference is recorded as one, never as agreement", () => {
  const differing = fixtures.filter((fixture) =>
    fixture.category === "parser-only-semantic"
  );
  equal(differing.length, 5);
  for (const fixture of differing) {
    equal(fixture.parserValid, false, fixture.name);
    equal(fixture.schemaValid, true, fixture.name);
  }
});
