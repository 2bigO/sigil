// Import the synchronous N3 modules so parsing needs no environment/stream access.
import ParserModule from "n3/lib/N3Parser.js";
import WriterModule from "n3/lib/N3Writer.js";
import FactoryModule from "n3/lib/N3DataFactory.js";
import type * as N3 from "n3-types";

export const Parser: typeof N3.Parser = ParserModule.default;
export const Writer: typeof N3.Writer = WriterModule.default;
export const DataFactory: typeof N3.DataFactory = FactoryModule.default;
export type { Quad, Term } from "n3-types";
