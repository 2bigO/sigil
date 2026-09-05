import { DataFactory, type Quad, Writer } from "./rdf.ts";
import { RDF_TYPE, SIGIL_ONTOLOGY, XSD } from "./ontology.ts";

/** RDF term construction. All output still passes through the real parser. */
export class TurtleBuilder {
  private readonly quads: Quad[] = [];

  type(subject: string, name: string): this {
    this.quads.push(
      DataFactory.quad(
        DataFactory.namedNode(subject),
        DataFactory.namedNode(RDF_TYPE),
        DataFactory.namedNode(SIGIL_ONTOLOGY + name),
      ),
    );
    return this;
  }

  edge(subject: string, predicate: string, object: string): this {
    this.quads.push(
      DataFactory.quad(
        DataFactory.namedNode(subject),
        DataFactory.namedNode(SIGIL_ONTOLOGY + predicate),
        DataFactory.namedNode(object),
      ),
    );
    return this;
  }

  value(
    subject: string,
    predicate: string,
    value: string | boolean | number,
  ): this {
    const datatype = typeof value === "boolean"
      ? "boolean"
      : typeof value === "number"
      ? "double"
      : "string";
    this.quads.push(
      DataFactory.quad(
        DataFactory.namedNode(subject),
        DataFactory.namedNode(SIGIL_ONTOLOGY + predicate),
        DataFactory.literal(
          String(value),
          DataFactory.namedNode(XSD + datatype),
        ),
      ),
    );
    return this;
  }

  toString(): string {
    return new Writer({ format: "text/turtle" }).quadsToString(this.quads);
  }
}
