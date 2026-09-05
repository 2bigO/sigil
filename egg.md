# Egglog for language-model authors

This is a practical, self-contained guide to writing `egglog` programs in
`.egg` files. It describes the implementation in this repository, currently
the `3.0.0` workspace. The intended reader is an LLM that must design a
well-typed, terminating, useful egglog program from a domain description.

The short version is:

> Egglog is a typed S-expression language whose runtime is both a relational
> database and an equality-saturation e-graph. Use relations for facts,
> constructors for terms that may be equal, functions for keyed derived or
> memoized values, and rules plus schedules to derive consequences.

Egglog is not ordinary functional programming. A constructor call does not
necessarily denote a unique tree node: constructor terms live in e-classes,
and `(union a b)` makes every rule match `a` and `b` interchangeably. It is
also not ordinary Datalog: the e-graph's implicit equality relation, rewrites,
merges, extraction, and rebuild semantics are first-class parts of the model.

## Repository map

The most useful source files are:

- [`src/lib.md`](src/lib.md): high-level language and Rust-API orientation.
- [`src/ast/mod.rs`](src/ast/mod.rs): the authoritative top-level command and
  AST documentation. Its `GenericCommand` documentation is the closest thing
  this checkout has to a compact language reference.
- [`src/ast/parse.rs`](src/ast/parse.rs): concrete syntax, accepted command
  names, options, literals, comments, and parser errors.
- [`src/ast/desugar.rs`](src/ast/desugar.rs): how `datatype`, `relation`,
  `rewrite`, `birewrite`, and `prove` expand into lower-level commands.
- [`src/typechecking.rs`](src/typechecking.rs): sort checking, primitive
  overload resolution, function declarations, and execution-context rules.
- [`src/lib.rs`](src/lib.rs): `EGraph`, command execution, rebuild, input/output,
  parsing, extraction, and the public Rust entry points.
- [`src/core.rs`](src/core.rs): lowering rules into relational queries and
  actions.
- [`src/scheduler.rs`](src/scheduler.rs): scheduling and rule execution.
- [`src/extract.rs`](src/extract.rs): best-term and variant extraction.
- [`src/serialize.rs`](src/serialize.rs): JSON/DOT/SVG serialization of the
  e-graph.
- [`src/cli.rs`](src/cli.rs): the standalone CLI and all command-line flags.
- [`src/prelude.rs`](src/prelude.rs): the Rust embedding API, primitive traits,
  row operations, extraction, and extension points.
- [`src/exec_state.rs`](src/exec_state.rs): the `Read`, `Write`, and `Full`
  state capabilities available to Rust callbacks.
- [`src/sort/mod.rs`](src/sort/mod.rs): the sort system and built-in sort
  registration.
- [`src/sort/i64.rs`](src/sort/i64.rs), [`src/sort/bool.rs`](src/sort/bool.rs),
  [`src/sort/string.rs`](src/sort/string.rs), and
  [`src/sort/f64.rs`](src/sort/f64.rs): primitive base sorts.
- [`src/sort/vec.rs`](src/sort/vec.rs), [`src/sort/set.rs`](src/sort/set.rs),
  [`src/sort/map.rs`](src/sort/map.rs), [`src/sort/multiset.rs`](src/sort/multiset.rs),
  [`src/sort/pair.rs`](src/sort/pair.rs), and [`src/sort/fn.rs`](src/sort/fn.rs):
  container and higher-order sorts.
- [`src/proofs/`](src/proofs/): proof instrumentation, checking, encoding, and
  proof extraction.
- [`tests/`](tests/): executable `.egg` examples and regression fixtures. Good
  starting points include [`tests/rectangle.egg`](tests/rectangle.egg),
  [`tests/cykjson.egg`](tests/cykjson.egg),
  [`tests/complex-merge-func.egg`](tests/complex-merge-func.egg), and
  [`tests/eggcc-extraction.egg`](tests/eggcc-extraction.egg).
- [`egglog-ast/src/generic_ast.rs`](egglog-ast/src/generic_ast.rs): the generic
  AST representation shared by the parser and the rest of the implementation.

Read this file first. Use the source links to confirm implementation details or
to study advanced Rust integration; the guide does not require opening them.

## The execution model

An `EGraph` contains:

1. typed declarations for sorts and tables;
2. rows in constructor/relation/function tables;
3. an implicit union-find equality relation for unionable e-classes;
4. rules lowered to relational queries plus actions;
5. schedules that repeatedly execute rules and rebuild the database.

There are three important table kinds:

| Egglog declaration | Database meaning | E-graph meaning |
| --- | --- | --- |
| `relation` | A set of fact rows | A non-unionable constructor table returning a hidden relation sort |
| `constructor` / datatype variant | A term-producing table | An e-node whose output is an equality-sort e-class |
| `function` | A keyed table with one output per input key | A functional dependency; conflicting outputs are merged or rejected according to its declaration |

For example:

```lisp
(datatype Expr
  (Lit i64)
  (Add Expr Expr))

(relation edge (String String))
(function cost (Expr) i64 :merge (min old new))
```

`(Lit 1)` and `(Add (Lit 1) (Lit 2))` are terms of sort `Expr`. `edge` stores
ordinary facts and is not a place to union arbitrary rows. `cost` is keyed by an
`Expr` e-class and has a monotone merge policy: if multiple rules propose costs
for the same key, the least cost survives.

The engine is incremental. A rule adds rows or equalities; equality causes
rebuild; rebuild canonicalizes e-class references and can make more rules
match. This is why a rule can trigger again after a union even if no source
fact was newly inserted.

The normal execution sequence is:

```text
source text
  -> S-expression parser
  -> optional command-macro expansion
  -> desugaring
  -> type checking and overload resolution
  -> global removal / rule lowering
  -> table and rule registration
  -> actions and scheduled rule execution
  -> rebuild / equality propagation
  -> checks, extraction, serialization, or output
```

`(datatype ...)` and `(rewrite ...)` are source conveniences. The implementation
lowers them before execution. `EGraph::resolve_program` exposes that lowered
program without running ordinary commands; `EGraph::parse_and_run_program`
parses and runs it. See the corresponding methods in [`src/lib.rs`](src/lib.rs).

## File syntax

### S-expressions and comments

Every top-level form is a parenthesized S-expression. Whitespace is
insignificant. A semicolon starts a comment that runs to the end of the line.
Strings use double quotes and support only these escapes: `\n`, `\t`, `\\`, and
`\"`.

```lisp
; A comment.
(relation knows (String String))
(knows "alice" "bob")
```

Atoms are not quoted unless they are string data. Names such as `Person`,
`knows`, `x`, and `$root` are atoms. A string such as `"https://example.org/p"`
is a `String` literal. The parser recognizes:

- signed 64-bit integer literals, such as `0`, `-7`, and `42`;
- finite floating-point literals, such as `3.14`;
- `NaN`, `inf`, and `-inf` as floating-point literals;
- `true` and `false` as booleans;
- quoted strings;
- `()` as the unit value in contexts that expect it.

Do not put RDF IRIs or lexical literals into bare atoms. Use `String` values,
for example `"http://schema.org/name"`, so the type checker and input loader
see the intended sort.

### Names, variables, and globals

Egglog distinguishes global bindings from rule-local variables:

- A global name conventionally starts with `$`, for example `$root` or `$alice`.
- A rule variable does not start with `$`, for example `x`, `predicate`, or
  `value`.
- With `--strict-mode`, violating this convention is an error. Without it,
  egglog emits a warning.

Use globals for named roots or constants that are intentionally shared across
commands. Use locals for rule matching. A top-level `let` is a global action:

```lisp
(datatype Person (PersonId String))
(let $alice (PersonId "https://example.org/alice"))
```

Inside a rule, `let` binds a local action variable and is useful for naming a
derived expression before using it in later actions:

```lisp
(rule ((raw-triple s p o))
      ((let normalized (normalize-iri s))
       (entity normalized)))
```

The rule-local binding must be grounded by the body or by a preceding action;
do not treat `let` as arbitrary imperative sequencing.

## Sorts and declarations

### Base sorts

The standard binary contains these base sorts:

| Sort | Values | Typical primitives |
| --- | --- | --- |
| `i64` | signed 64-bit integers | `+ - * / %`, bitwise operators, comparisons, `min`, `max`, conversions |
| `f64` | 64-bit floats | arithmetic, `pow`, `exp`, `log`, `sqrt`, comparisons, conversions |
| `bool` | booleans | `not`, `and`, `or`, `xor`, `=>`, `guard` |
| `String` | strings | variadic `+` concatenation and `replace` |
| `Unit` | one unit value | commonly the output of a fact/guard primitive |

`BigInt` (`Z`) and `BigRat` (`Q`) are also registered by the core and provide
arbitrary-size integer/rational operations; see
[`src/sort/bigint.rs`](src/sort/bigint.rs) and
[`src/sort/bigrat.rs`](src/sort/bigrat.rs).

Important numeric details:

- Integer arithmetic is checked. Overflow, division by zero, invalid remainder,
  and invalid shifts make the primitive undefined rather than producing a bad
  value.
- Floating division, remainder, logarithm, and square root are partial where
  the implementation cannot produce a valid result.
- `<`, `>`, `<=`, and `>=` are usually partial predicates: in a rule body they
  match only when true. They produce `Unit` when successful and no result when
  false.
- `bool-=`, `bool-<`, `bool->`, `bool-<=`, and `bool->=` are total boolean
  functions. Use them when a boolean expression is required rather than a
  query guard.
- `guard` turns a boolean into a partial unit-valued predicate:
  `(guard (bool-= x 0))` matches only when the boolean is true.

The same symbol can be overloaded by input sort. For example `+` adds
integers, floats, strings, big integers, or rationals when the surrounding
types determine which overload is valid.

### Datatypes and constructors

`datatype` declares an equality-sort and its constructors:

```lisp
(datatype Term
  (Number i64)
  (Name String)
  (Call String (Vec Term)))
```

This is equivalent in spirit to:

```lisp
(sort Term)
(constructor Number (i64) Term)
(constructor Name (String) Term)
(constructor Call (String (Vec Term)) Term)
```

Datatype terms are unionable. If two `Term` values are unioned, every rule
matches them as equal, and equality propagates through constructors and
containers whose contents are equality sorts.

A constructor can specify extraction behavior:

```lisp
(constructor Cheap (Term) Term :cost 1)
(constructor Expensive (Term) Term :cost 50)
(constructor InternalEvidence (String) Term :unextractable)
```

`:cost` changes the default extraction cost. `:unextractable` keeps a
constructor available to reasoning but prevents it from being selected as an
extracted representative. Use this for proof or bookkeeping nodes that should
not appear in output.

Use `sort` directly for forward declarations or parameterized container sorts:

```lisp
(sort TermVec (Vec Term))
(sort StringSet (Set String))
(sort IriToLabel (Map String String))
(sort PairOfTerms (Pair Term Term))
(sort TermBag (MultiSet Term))
```

### Relations

Use `relation` for facts where the row itself should not be equality-saturated:

```lisp
(relation parent (String String))
(parent "alice" "bob")
```

Relations are conceptually sets of tuples. Internally they are represented as
constructors over a fresh non-unionable sort, which is why a relation fact is
added by evaluating `(parent ...)` but relation rows must not be unioned as if
they were ordinary terms.

For RDF-style data, relations are normally the right raw representation. Use
constructors or functions for semantic objects and derived values built from
those facts.

### Functions and merge policies

`function` declares a table with a functional dependency from all input columns
to one output. Every function must explicitly say how collisions behave:

```lisp
(function label (String) String :no-merge)
(function best-score (String) i64 :merge (max old new))
(function canonical (String) Entity :merge old)
```

`:no-merge` means a second distinct output for an existing key is an error.
`:merge expression` resolves the old and new outputs. In the merge expression,
`old` and `new` denote the two competing values. The expression should define a
monotone, order-independent join/lattice operation whenever possible:

```lisp
(function evidence-count (String) i64 :merge (max old new))
(function all-labels (String) (Set String) :merge (set-union old new))
```

Do not use a non-commutative or order-sensitive merge for facts whose arrival
order is not controlled. Egglog may encounter merges in different orders, and
the implementation explicitly documents such merges as requiring a lattice-like
behavior for defined results. See the merge examples in
[`tests/complex-merge-func.egg`](tests/complex-merge-func.egg) and
[`tests/merge-saturates.egg`](tests/merge-saturates.egg).

Functions can return equality-sort values. Such outputs can then participate in
`union`, equality matching, and extraction. Functions without a term-producing
equality output are still useful as analyses, indexes, and memoized maps.

## Expressions, facts, and actions

### Expressions

The expression grammar is intentionally small:

```text
expression := literal
            | variable-or-global
            | (function-or-constructor expression*)
```

Examples:

```lisp
42
"https://example.org/Alice"
x
$root
(+ x 1)
(PersonId "https://example.org/alice")
(set-insert (set-empty) "admin")
```

Egglog resolves a call from the declarations and primitive overloads. There is
no implicit coercion between `String`, `i64`, `f64`, booleans, and user sorts.
Make conversions explicit with operations such as `to-string`, `to-i64`, and
`to-f64`.

### Facts

A rule body is a list of facts. A fact is either a table/predicate expression or
an equality constraint:

```lisp
(rule
  ((parent x y)
   (parent y z)
   (= y (canonical-person y)))
  ((ancestor x z)))
```

Facts are matched modulo e-graph equality. Equality facts are especially useful
for binding the result of a function or constructor:

```lisp
(rule
  ((raw-triple s "http://schema.org/name" label)
   (= person (person-id s)))
  ((has-name person label)))
```

A failed partial primitive makes the body match fail. This is the normal way to
write guards:

```lisp
(rule ((range x) (< x 100))
      ((range (+ x 1))))
```

Every variable in the action head must be grounded by the body or by a local
action binding. Avoid rules with unbounded variables: the type checker rejects
unsafe/ungrounded rules, and a rule that invents unconstrained values would not
have a finite relational interpretation.

### Actions

The action list can contain:

```lisp
(let local expression)              ; bind a local action value
(set (function key...) value)       ; write a function row
(union expression expression)       ; merge two equality-sort e-classes
(delete (table key...))             ; remove a table entry
(subsume (table key...))            ; hide from future matching/extraction
(panic "message")                   ; deliberately fail the command
expression                           ; add/evaluate a constructor or relation fact
```

Examples:

```lisp
(rule ((raw-score x score))
      ((set (best-score x) score)))

(rule ((same-as x y))
      ((union x y)))

(rule ((obsolete x))
      ((delete (raw-score x))))

(rule ((bad x))
      ((panic "bad input")))
```

Use `set` for a `function`; use a constructor/relation expression to insert a
constructor/relation row; use `union` for equality-sort values. In particular,
do not use `set` to update a datatype constructor.

`delete` physically removes a table entry and can invalidate later assumptions.
`subsume` keeps enough information for checking but hides the row from future
rewrites and extraction. Both are specialized tools, not routine ways to model
knowledge.

### Rules, rewrites, and birewrites

The general rule form is:

```lisp
(rule (<facts>) (<actions>)
      :ruleset <ruleset-name>
      :name "stable-debug-name"
      :naive)
```

All options are optional. A rule without `:ruleset` belongs to the default
ruleset. A rule without `:name` receives a generated name derived from its
syntax.

`rewrite` is shorthand for a rule that unions the left and right expressions:

```lisp
(rewrite (Add x 0) x)
(rewrite (Add x y) (Add y x) :when ((is-commutative x)))
(rewrite (Normalize x) x :subsume)
```

The `:when` value is a list of additional facts. `:subsume` also hides the
matched left-hand-side table entry. Use it only when you know no later rule
needs to match that form.

`birewrite` creates both directions:

```lisp
(birewrite (Add x y) (Add y x))
```

Use `birewrite` only for a genuine equivalence. It is dangerous for an
orientation that should be one-way, and it can substantially increase the
e-graph.

The default rule mode is seminaive. The alternatives are:

- default seminaive: delta evaluation and restrictive primitive contexts;
- `:naive`: re-match the whole database each iteration and permit database
  reads in RHS-capable primitive contexts;
- `:unsafe-seminaive`: retain delta evaluation while permitting live database
  reads. This is explicitly unsafe because a read can observe mid-iteration
  state and will not necessarily be re-evaluated after that state changes.

Prefer default seminaive rules. Use `:naive` when a rule's semantics genuinely
requires a live read, and use `:unsafe-seminaive` only with a clear correctness
argument.

`:no-decomp` disables query tree decomposition for a rule. It can help diagnose
or benchmark planner behavior, but should not be a default performance guess.

## Rulesets and schedules

Rules are declared independently of when they run. Define named rulesets to
control phases:

```lisp
(ruleset normalize)
(ruleset infer)
(ruleset report)

(rule ((raw-triple s p o))
      ((normalized-triple s p o))
      :ruleset normalize)

(rule ((normalized-triple s p o))
      ((inferred s p o))
      :ruleset infer)
```

Run a ruleset for a bounded number of iterations:

```lisp
(run normalize 5)
(run infer 20 :until (inferred "a" "p" "b"))
```

The first form can omit the ruleset to run the default ruleset:

```lisp
(run 10)
```

Use explicit schedules for staged fixed-point execution:

```lisp
(run-schedule
  (saturate (run normalize))
  (repeat 10 (run infer))
  (run report 1))
```

Schedule forms are:

- `(run <ruleset>? <iterations> :until (<facts>*))`;
- `(saturate <schedule>...)`, which repeats until no further change;
- `(repeat <count> <schedule>...)`;
- `(seq <schedule>...)`;
- `(run-schedule <schedule>...)`, the top-level sequence wrapper.

The simplest reliable pattern for a monotone closure is:

```lisp
(run-schedule (saturate (run infer)))
```

For large workloads, stage rulesets so that normalization, joins, transitive
closure, and reporting do not all fire together. This makes both correctness
and performance easier to reason about.

## Equality saturation and extraction

An equality-sort constructor creates an e-node in an e-class. Rules can add
alternative representations and rewrites can union them. The e-graph retains
the alternatives until extraction.

```lisp
(datatype Arith
  (Num i64)
  (Add Arith Arith)
  (Mul Arith Arith))

(rewrite (Add x (Num 0)) x)
(rewrite (Mul x (Num 1)) x)
(birewrite (Add x y) (Add y x))

(let $root (Mul (Add (Num 0) (Num 4)) (Num 1)))
(run 10)
(extract $root)
```

`(extract expr)` selects the lowest-cost representative under the default
tree-additive cost model. `(extract expr n)` requests `n` variants. Constructors
default to cost `1`; `:cost` overrides it. Extraction is not a proof of a
semantic theorem by itself: it chooses among terms that the program has made
equal.

Use `:unextractable` for internal terms and higher costs for undesirable but
valid representations. If extraction returns no term, inspect whether the
root was deleted/subsumed or whether all available constructors are
unextractable.

## Built-in containers and higher-order values

Parameterized sorts are declared with `sort` and a presort name. The compiler
registers operations for each instantiation.

### `Vec`

```lisp
(sort TermVec (Vec Term))
(let $xs (vec-of (Num 1) (Num 2)))
(let $ys (vec-push $xs (Num 3)))
(check (= (vec-length $ys) 3))
```

Operations include `vec-of`, `vec-empty`, `vec-push`, `vec-pop`, `vec-append`,
`vec-get`, `vec-set`, `vec-remove`, `vec-length`, `vec-contains`, and
`vec-not-contains`. `vec-range` is provided for `i64` elements. Indexing and
removal are partial when the index is invalid.

### `Set`

```lisp
(sort Labels (Set String))
(let $labels (set-insert (set-empty) "admin"))
(let $labels2 (set-insert $labels "staff"))
(check (set-contains $labels2 "staff"))
```

Operations include `set-empty`, `set-of`, `set-insert`, `set-remove`,
`set-union`, `set-diff`, `set-intersect`, `set-get`, `set-length`,
`set-contains`, and `set-not-contains`.

### `Map`

```lisp
(sort LabelsByPerson (Map String (Set String)))
(let $m (map-insert (map-empty) "alice" (set-of "admin")))
(check (map-contains $m "alice"))
(check (= (map-get $m "alice") (set-of "admin")))
```

Operations include `map-empty`, `map-of`, `map-insert`, `map-get`,
`map-remove`, `map-length`, `map-contains`, and `map-not-contains`. Map terms
are canonicalized by key; duplicate keys use last-write-wins behavior in the
runtime container.

### `MultiSet`, `Pair`, and `UnstableFn`

`MultiSet` provides bag semantics, including `multiset-single`, insertion,
removal, subtraction, sum, intersection, counts, and picking elements.
`Pair A B` provides `pair`, `pair-first`, and `pair-second`.

`UnstableFn` represents a function value. Its declaration requires a full
signature, for example:

```lisp
(sort StringToI64 (UnstableFn (String) i64))
```

Function values are created with `unstable-fn` and applied with `unstable-app`.
The name is intentional: function values are an advanced feature with stricter
typing and proof limitations than ordinary first-order calls. See
[`src/sort/fn.rs`](src/sort/fn.rs) before using them in a design.

Container equality matters. If a container contains an equality-sort, rebuild
can replace contained values with their canonical e-class representatives. This
is powerful for sets/maps/vectors of terms, but it also means a container can
change when an inner term is unioned. Model identity-sensitive external data as
`String`, `i64`, or a non-unionable relation key when that behavior is not
desired.

## Assertions, diagnostics, and debugging

`check` succeeds when all supplied facts match at least once:

```lisp
(check (ancestor "alice" "carol"))
(check (= (best-score "alice") 10))
(check (< 2 3) (<= 3 4))
```

`fail` asserts that a command fails:

```lisp
(fail (check (= 1 2)))
(fail (set (no-merge "key") 2))
```

Expected failure is useful in executable regression `.egg` tests. Failure does
not mean transactional rollback: effects completed before the failing command
remain. A rule-action error may trigger recovery/rebuild, but code must not rely
on an all-or-nothing transaction.

`print-function` prints extracted rows. It can print a bounded number of rows,
write to a file, or use CSV mode:

```lisp
(print-function best-score)
(print-function best-score 20 :mode csv :file "scores.csv")
(print-size best-score)
(print-stats)
(print-stats :file "run-report.json")
```

`output` extracts one or more expressions and appends them to a file:

```lisp
(output "answers.txt" $root (best-score "alice"))
```

`output` is extraction-oriented, not a raw serialization of a table.

`push` and `pop` save and restore e-graph levels:

```lisp
(push)
(temporary-fact "x")
(run 10)
(check (temporary-fact "x"))
(pop)
(fail (check (temporary-fact "x")))
```

Use these for speculative branches or test cases. They are not a replacement
for explicit data provenance in a long-running program.

## CLI and compiler tooling

Build or install the binary as described in [`README.md`](README.md):

```bash
cargo run --release -- tests/rectangle.egg
cargo install --path=.
egglog tests/rectangle.egg
```

With no input file, the binary starts the REPL:

```bash
cargo run --release
```

Useful CLI options from [`src/cli.rs`](src/cli.rs):

```text
-F, --fact-directory <DIR>       Prefix paths used by input/output commands
--naive                           Disable seminaive optimization globally
--no-decomp                       Disable query tree decomposition globally
--mode <normal|desugar|interactive|no-messages>
--to-json                         Write e-graph JSON beside the input
--to-dot                          Write Graphviz DOT beside the input
--to-svg                          Write Graphviz SVG beside the input
--serialize-split-primitive-outputs
--max-functions <N>
--max-calls-per-function <N>
--serialize-n-inline-leaves <N>
-j, --threads <N>                1 by default; 0 means inferred maximum
--report-level <LEVEL>
--save-report <PATH>              Save aggregate runtime statistics as JSON
--strict-mode                     Enforce `$` global naming conventions
--term-encoding                   Enable term encoding
--proofs                          Enable proof generation
--proof-testing                   Turn checks into proof-oriented checks
```

`--mode desugar` is one of the best debugging tools: it parses, expands macros,
type-checks, and prints the lowered egglog program instead of running ordinary
commands. It still processes `push` and `pop` because those affect resolution
context. `--mode no-messages` is useful for benchmarks. `RUST_LOG=INFO` shows
more runtime progress; the CLI defaults to warnings.

Serialization is bounded by `--max-functions` and
`--max-calls-per-function`; a large e-graph may therefore have an intentionally
incomplete visualization. JSON/DOT/SVG output describes the e-graph, while
`print-function`, `output`, and extraction describe semantic program results.

`-j 0` enables inferred parallelism. Parallelism changes execution scheduling,
not the intended monotone result of a well-designed program. Do not depend on
the order in which merge conflicts are observed.

### Compiler pipeline and embedding API

The standalone binary is both a language interpreter and a compiler-like
front-end. The core pipeline is parser -> macro expansion -> desugar -> type
check -> lower -> execute. The Rust API exposes the same engine:

```rust
use egglog::EGraph;

let mut egraph = EGraph::default();
egraph.parse_and_run_program(
    Some("example.egg".to_owned()),
    r#"
      (datatype Math (Num i64) (Add Math Math))
      (rewrite (Add x (Num 0)) x)
      (let $root (Add (Num 0) (Num 4)))
      (run 10)
    "#,
)?;
```

Important API surfaces are documented in [`src/lib.md`](src/lib.md) and
[`src/prelude.rs`](src/prelude.rs):

- `parse_program`: parse only;
- `resolve_program`: parse, expand, desugar, and type-check without normal
  command execution;
- `parse_and_run_program`: parse and execute source text;
- `run_program`: execute an already-built AST;
- `eval_expr`: resolve an expression to `(sort, Value)`;
- `query`: run a one-shot pattern query and obtain variable bindings;
- `update`: perform Rust-side reads/writes in a capability-scoped closure;
- `extract_value`, `extract_best`, and `extract_variants`: extract terms;
- `add_pure_primitive`, `add_read_primitive`, `add_write_primitive`, and
  `add_full_primitive`: add native functions with explicit capabilities;
- `rust_rule` and `rust_rule_full`: use Rust closures as rule RHS logic;
- `add_command` and command macros: add host-specific commands/syntax;
- `serialize`: export a bounded graph representation.

The Rust state capabilities are deliberate:

- `PureState` can compute without reading or writing the live database;
- `ReadState` can read;
- `WriteState` can write but is restricted from live reads;
- `FullState` can both read and write.

Default egglog rules are designed to be seminaive-safe. If domain integration
needs a parser, network client, database, or a custom RDF value representation,
put that in Rust or an external preprocessing step and feed typed rows into the
e-graph. Do not pretend that a side effect is an ordinary pure primitive.

## Turtle facts: modeling RDF for egglog

### The critical boundary: egglog does not parse Turtle

The core `input` command reads tab-separated rows, despite some historical
documentation calling the feature “CSV input”. The implementation in
[`src/lib.rs`](src/lib.rs) splits each input line on `\t`, trims fields, and
supports `i64`, `f64`, and `String` columns (plus `Unit` where applicable).
It does not parse Turtle prefixes, `@base`, blank-node syntax, RDF collections,
language tags, datatype escapes, or Turtle punctuation.

Therefore use this architecture:

```text
Turtle parser / RDF loader outside egglog
  -> canonical, lossless tab-separated fact files
  -> (input ...) into raw String relations
  -> egglog rules normalize, type, join, infer, validate, and summarize
  -> print-function / output / extraction / Rust API
```

The external parser should preserve enough information to make the translation
reversible or auditable. Do not silently turn an RDF literal into a plain string
if datatype or language affects domain meaning.

### A lossless row contract

For a first implementation, represent every RDF term with a canonical string
and keep the term kind explicit. One practical row contract is:

```text
subject<TAB>predicate<TAB>object<TAB>object_kind<TAB>object_datatype<TAB>object_language
```

Use canonical N-Triples-like lexical forms, not the original Turtle spelling:

```text
<https://example.org/alice>␉<https://schema.org/name>␉"Alice"␉literal␉<http://www.w3.org/2001/XMLSchema#string>␉
<https://example.org/alice>␉<https://schema.org/age>␉"42"^<http://www.w3.org/2001/XMLSchema#integer>␉literal␉<http://www.w3.org/2001/XMLSchema#integer>␉
<https://example.org/alice>␉<https://schema.org/knows>␉<https://example.org/bob>␉iri␉␉
_:b0␉<https://schema.org/name>␉"anonymous"␉literal␉<http://www.w3.org/2001/XMLSchema#string>␉
```

Here `␉` means one literal tab. The final marker on rows without a language
tag is the delimiter before the empty language column; the actual fact file
must contain real tabs, not the visible marker.

The exact serializer is your application contract. The important properties
are:

1. one physical RDF triple per row;
2. tabs and newlines inside lexical values are escaped or encoded before writing;
3. IRIs, blank nodes, and literals cannot collide;
4. datatype and language information survive ingestion;
5. the generated file is deterministic so runs and tests are reproducible.

If you control the preprocessor, use separate files for separate types of fact
instead of a six-column polymorphic row. For example:

```text
iri_triple.tsv:      subject<TAB>predicate<TAB>object
literal_triple.tsv:  subject<TAB>predicate<TAB>lexical<TAB>datatype<TAB>language
type_triple.tsv:     subject<TAB>class
same_as.tsv:         subject<TAB>object
```

This lets egglog type-check more of the data model and avoids using a string
kind tag as a substitute for a real predicate. The single raw-triple relation
is more convenient when the input vocabulary is open-ended.

### Minimal raw-triple ingestion

Suppose the external Turtle parser emits `facts/triples.tsv` with exactly three
canonical string columns. The egglog side can begin as:

```lisp
(relation raw-triple (String String String))
(input raw-triple "triples.tsv")

(relation type-of (String String))
(relation same-as (String String))
(relation label (String String))
(relation knows (String String))

(rule ((raw-triple s "<http://www.w3.org/1999/02/22-rdf-syntax-ns#type>" c))
      ((type-of s c)))

(rule ((raw-triple s "<http://www.w3.org/2002/07/owl#sameAs>" o))
      ((same-as s o)))

(rule ((raw-triple s "<http://xmlns.com/foaf/0.1/name>" name))
      ((label s name)))

(rule ((raw-triple s "<http://xmlns.com/foaf/0.1/knows>" o))
      ((knows s o)))

(run-schedule (saturate (run)))

(check (type-of "<https://example.org/alice>"
               "<https://example.org/Person>"))
```

This preserves the open RDF graph and uses rules as vocabulary projections.
When the vocabulary is stable, prefer typed relations with meaningful names;
when it is open, retain `raw-triple` as the source of truth and derive indexes.

Do not write a separate rule for every data row. Turtle rows belong in the TSV
input; `.egg` should describe the schema and the general transformations.

### A full RDF domain model

For richer reasoning, separate identity, lexical data, typing, and derived
knowledge. The following is a complete pattern; it is intentionally explicit
about RDF's distinction between resources and literals.

```lisp
; ---------- Raw ingestion ----------
(relation raw-iri-triple (String String String))
(relation raw-literal-triple (String String String String String))
(relation typed-age (String i64))

(input raw-iri-triple "iri-triples.tsv")
(input raw-literal-triple "literal-triples.tsv")
(input typed-age "typed-age.tsv")

; ---------- Canonical domain facts ----------
(relation rdf-type (String String))
(relation rdf-edge (String String String))
(relation rdf-literal (String String String String String))
(relation equivalent-resource (String String))

(rule ((raw-iri-triple s p o))
      ((rdf-edge s p o)))

(rule ((raw-literal-triple s p lexical datatype language))
      ((rdf-literal s p lexical datatype language)))

(rule ((raw-iri-triple s "<http://www.w3.org/1999/02/22-rdf-syntax-ns#type>" c))
      ((rdf-type s c)))

(rule ((raw-iri-triple x "<http://www.w3.org/2002/07/owl#sameAs>" y))
      ((equivalent-resource x y)
       (equivalent-resource y x)))

; ---------- Equality-safe canonical resources ----------
(datatype Resource
  (Iri String)
  (Blank String))

(sort Literal)
(constructor LiteralLexical (String String String) Literal)
(sort LiteralSet (Set Literal))
(datatype Entity
  (EntityId Resource))

; This function is a keyed canonicalization table. Its rows are populated by
; the rules below with an explicit `set` action.
(function resource (Resource) Entity :merge old)

; Turn source identity strings into equality-sort terms. Prefix the encoding
; in the preprocessor or keep Iri/Blank in separate input relations so the
; two namespaces cannot collide.
(relation iri-resource (String))
(relation blank-resource (String))
(input iri-resource "iri-resources.tsv")
(input blank-resource "blank-resources.tsv")

(rule ((iri-resource x))
      ((set (resource (Iri x)) (EntityId (Iri x)))))

(rule ((blank-resource x))
      ((set (resource (Blank x)) (EntityId (Blank x)))))

; ---------- Typed views ----------
(relation person (Entity))
(relation organization (Entity))
(relation name (Entity String))
(relation age (Entity i64))
(relation member-of (Entity Entity))

(rule ((rdf-type s "<https://schema.org/Person>" )
       (= e (resource (Iri s))))
      ((person e)))

(rule ((rdf-type s "<https://schema.org/Organization>")
       (= e (resource (Iri s))))
      ((organization e)))

(rule ((rdf-literal s "<https://schema.org/name>" lexical datatype language)
       (= e (resource (Iri s)))
       (= datatype "<http://www.w3.org/2001/XMLSchema#string>"))
      ((name e lexical)))

; String-to-i64 conversion is not a built-in general parser. The robust choice
; is to have preprocessing emit a typed age relation. This placeholder rule
; illustrates the intended boundary rather than claiming a nonexistent parse
; primitive.
(rule ((typed-age s age)
       (= e (resource (Iri s))))
      ((age e age)))

(rule ((rdf-edge s "<https://schema.org/memberOf>" o)
       (= es (resource (Iri s)))
       (= eo (resource (Iri o))))
      ((member-of es eo)))

; ---------- Inference ----------
(relation ancestor (Entity Entity))
(rule ((member-of x y)) ((ancestor x y)))
(rule ((ancestor x y) (member-of y z)) ((ancestor x z)))

(relation organization-member (Entity Entity))
(rule ((person p) (ancestor p org) (organization org))
      ((organization-member p org)))
```

There is intentionally no rule here that treats a missing name as a negative
fact. Egglog has no implicit negation-as-failure. If the domain needs a
missing-name diagnostic, use one of these designs:

1. have the preprocessor emit a complete typed relation and use a positive
   `check` for required rows;
2. derive a finite candidate set and use a partial/total function designed to
   represent absence;
3. implement a Rust read primitive or a host-side validation pass;
4. encode explicit closed-world facts, such as `known-person-without-name`,
   rather than assuming that missing data means false.

This is an important RDF rule: the absence of a triple is normally not a
negative fact. Egglog rules are positive and monotone by default; do not invent
closed-world negation from a failed lookup.

The example still needs an input policy for resource kind: either ingest
canonical resource-kind rows and create `(Iri x)` or `(Blank x)`
  based on that kind, or keep IRI and blank-node identifiers in separate raw
  relations. A single untyped `String` cannot tell egglog which `Resource`
  constructor to use. The declarations for `resource` and `typed-age` are
  included above so the example's rule references are well-formed.

A clean production version is:

```lisp
(datatype Resource
  (Iri String)
  (Blank String))
(datatype Entity
  (EntityId Resource))

(function resource (Resource) Entity :merge old)
(relation iri-resource (String))
(relation blank-resource (String))

(rule ((iri-resource x))
      ((set (resource (Iri x)) (EntityId (Iri x)))))
(rule ((blank-resource x))
      ((set (resource (Blank x)) (EntityId (Blank x)))))
```

If the input rows are raw `String` columns, derive `iri-resource` and
`blank-resource` in the external Turtle loader. Egglog is then responsible for
all domain-level joins and inference, not lexical parsing.

### Preserving literals correctly

Do not model every RDF object as an `Entity`. A useful split is:

```lisp
(datatype RdfLiteral
  (Lexical String String String)) ; lexical, datatype IRI, language tag

(relation literal-value (Entity String String String String))
; subject, predicate, lexical, datatype, language
```

Use a typed relation for values needed in arithmetic:

```lisp
(relation integer-value (Entity String i64))
(relation decimal-value (Entity String f64))
(relation boolean-value (Entity String bool))
```

The Turtle/RDF parser should validate lexical forms and emit these typed rows.
Then egglog can use actual numeric primitives:

```lisp
(relation score (Entity i64))
(rule ((integer-value item "<https://example.org/score>" value))
      ((score item value)))

(function best-score (Entity) i64 :merge (max old new))
(rule ((score item value))
      ((set (best-score item) value)))
```

The `max` merge is appropriate only if the domain says that higher score is
the desired join. If score observations are conflicting evidence rather than
alternatives, preserve all observations in a relation and derive a separate
aggregate; do not overwrite data with an arbitrary merge.

Language-tagged strings should retain the language in a separate column or
constructor. Otherwise `"chat"@fr` and `"chat"@en` collapse incorrectly.
Blank-node identifiers need document-scoped identity. Never use a bare blank
node label globally unless the loader has already scoped it to its source graph.

### RDF identity and `owl:sameAs`

There are two sound choices for equivalence:

1. Keep RDF resource IDs as strings and derive an explicit symmetric/transitive
   `equivalent-resource` relation. This preserves provenance and avoids
   globally rewriting every fact.
2. Convert resources to an equality-sort such as `Resource` and union them when
   `sameAs` is trusted. This lets every subsequent rule match through the
   equality relation and is usually the most powerful egglog design.

The second choice is concise:

```lisp
(datatype Resource
  (Iri String)
  (Blank String))

(relation trusted-same-as (Resource Resource))

(rule ((trusted-same-as x y))
      ((union x y)))
```

It is also semantically strong: every constructor and container containing these
resources can rebuild through the union. Use it only when equivalence is
authorized by the domain. For untrusted or provenance-sensitive `sameAs`, keep
the relation and derive a canonical representative with an externally supplied
mapping or a monotone policy.

### RDF joins and transitive closure

Egglog's relational rule engine is especially good at joins:

```lisp
(relation broader (Resource Resource))
(relation narrower (Resource Resource))

(rule ((broader parent child))
      ((narrower child parent)))

(rule ((narrower x y) (narrower y z))
      ((narrower x z)))

(run-schedule (saturate (run)))
```

For large graphs, do not put every expensive inference rule in the default
ruleset. Partition them:

```lisp
(ruleset normalize)
(ruleset closure)
(ruleset application)

(rule ((raw-edge s p o)) ((edge s p o)) :ruleset normalize)
(rule ((edge x broader y) (edge y broader z))
      ((edge x broader z))
      :ruleset closure)
(rule ((edge x type c) (edge c subclass-of target))
      ((eligible x))
      :ruleset application)

(run-schedule
  (saturate (run normalize))
  (saturate (run closure))
  (run application 10))
```

The exact syntax for a predicate with a fixed IRI is to put the string literal
in the fact, as in `(edge x "...predicate..." y)`. This gives the query planner
a join key and avoids creating a separate variable for a predicate that is
known at compile time.

### A tested small Turtle-style example

Here is a compact `.egg` program that can run if `facts.tsv` contains three
tab-separated canonical strings per line:

```lisp
(datatype Resource
  (Iri String)
  (Blank String))

(relation triple (String String String))
(input triple "facts.tsv")

(relation iri-resource (String))
(rule ((triple s "<urn:egglog:kind>" "iri"))
      ((iri-resource s)))

(relation edge (Resource String Resource))
(rule ((triple s p o)
       (iri-resource s)
       (iri-resource o))
      ((edge (Iri s) p (Iri o))))

(relation type-of (Resource Resource))
(rule ((edge s "<http://www.w3.org/1999/02/22-rdf-syntax-ns#type>" c))
      ((type-of s c)))

(relation subclass-of (Resource Resource))
(rule ((edge x "<http://www.w3.org/2000/01/rdf-schema#subClassOf>" y))
      ((subclass-of x y)))

(relation inferred-type (Resource Resource))
(rule ((type-of x c) (subclass-of c parent))
      ((inferred-type x parent)))

(run-schedule (saturate (run)))
(print-function edge)
(check (inferred-type
  (Iri "https://example.org/alice")
  (Iri "https://example.org/Agent")))
```

In this example, the `urn:egglog:kind` marker is an intentionally simple input
contract. A real loader should provide separate `iri-resource.tsv` and
`blank-resource.tsv` files or a four-column raw table with an explicit kind,
then derive the corresponding `Resource` constructor. The key lesson is that
Turtle syntax is handled before egglog, while RDF identity, joins, subclass
closure, trusted equality, and domain inference are handled inside egglog.

### What to do when Turtle data is large

For large RDF datasets:

1. Parse Turtle with a real RDF parser outside egglog.
2. Canonicalize IRIs and literals once, deterministically.
3. Partition rows by schema and predicate family when possible.
4. Use `input` for primitive columns and relations for raw facts.
5. Use rulesets to stage normalization, identity policy, closure, and reports.
6. Run with `--no-messages` for measurements and `-j 0` only after correctness
   is established.
7. Use `print-size`, `print-stats`, and `--save-report` to identify exploding
   rules or tables.
8. Serialize bounded graphs with `--to-json`/`--to-dot` for debugging rather
   than trying to visualize the entire closure.

If the data model requires parsing arbitrary RDF terms inside the e-graph,
write a Rust primitive or a host-side ingestion layer. A primitive that parses a
string should be pure and deterministic if it is used in a default rule; a
primitive that reads external state belongs in a read/full context and should
not be used to claim seminaive-safe behavior.

## Common mistakes an LLM should avoid

### Treating a relation as a datatype

Wrong:

```lisp
(relation Person (String))
(union (Person "alice") (Person "bob"))
```

Relations are non-unionable facts. If two values should be equal, declare an
equality-sort datatype such as `Resource` and union its values, or derive an
explicit equivalence relation.

### Using `set` on a constructor

Wrong:

```lisp
(set (Person "alice") ...)
```

Use a constructor expression to add a term, a relation expression to add a
fact, and `set` only for a declared `function` table.

### Assuming rules run when declared

Declaring a rule only registers it. Run it with `(run ...)` or a schedule. A
top-level constructor/relation expression, `set`, `union`, or `let` executes
immediately, but rules wait.

### Using strings as if they were typed resources

`"42"`, `42`, `(Iri "42")`, and `(Num 42)` are different values/sorts. RDF
lexical forms need explicit datatype handling before arithmetic or equality-sort
reasoning.

### Forgetting function merge behavior

Every `function` needs `:merge` or `:no-merge`. If multiple rules can write the
same key, choose a monotone merge that reflects domain semantics. Do not use
`old` merely as a convenient overwrite policy when arrival order is arbitrary.

### Inventing negation from absence

A missing row is not automatically false. Use positive, explicitly modeled
negative facts, finite closed-world input, a host-side query, or a purpose-built
Rust primitive.

### Leaving variables ungrounded

Rules are relational. Every head variable must be determined by body facts or
local bindings. Generate constants in the source program or use a finite
relation of candidates; do not write unconstrained variables in a head.

### Overusing birewrites and unrestricted saturation

Every equivalence increases opportunities for matching. Orient one-way
normalizations with `rewrite`; reserve `birewrite` for real equivalences. Stage
rulesets and use bounded `run` during development before switching to
`saturate`.

### Relying on side effects or execution order

Well-designed merge functions and rules should be insensitive to rule firing
order. Do not depend on a particular order of conflicting writes, parallel
execution, or non-monotone custom primitives.

### Confusing `input`, `print-function`, and `output`

- `input` loads tab-separated primitive rows into a declared table;
- `print-function` prints table rows, with extraction applied to e-class values;
- `output` extracts specified expressions and appends them to a file;
- `--to-json`, `--to-dot`, and `--to-svg` serialize the graph, not domain result
  tables.

### Ignoring proof and extraction constraints

Proof mode may reject or transform advanced extensions, especially user-defined
commands and primitives without validators. Container operations have proof
validators for some operations but not all. If proofs matter, design the
program around supported primitives and test with `--proofs` early.

## A disciplined authoring workflow

When asked to write an `.egg` program, an LLM should follow this sequence:

1. Identify entities that need equality reasoning. Make them equality-sort
   datatypes, not relations.
2. Identify immutable/open-world facts. Make them relations.
3. Identify keyed derived values or aggregations. Make them functions and
   choose merge semantics before writing rules.
4. Identify primitive columns and choose `String`, `i64`, `f64`, `bool`, or a
   user datatype explicitly.
5. Declare all sorts, constructors, relations, functions, and container sorts
   before use.
6. Write raw facts or `input` declarations separately from semantic rules.
7. Write positive, grounded rules. Name rulesets by phase.
8. Add rewrites only where the equivalence is justified. Prefer one-way
   orientation for canonicalization.
9. Add a bounded run and executable `check` assertions.
10. Run with `--strict-mode` and `--mode desugar` while developing.
11. Inspect `print-size`, `print-stats`, and extracted outputs.
12. Only then choose `saturate`, proofs, parallelism, or large input data.

A good `.egg` file should make the following visible to a reviewer:

- what is raw input versus derived knowledge;
- which values can be unioned;
- which facts are open-world and which are closed-world assumptions;
- which function merges are domain joins;
- which rules form a fixed point;
- what output/extraction represents the answer;
- which checks demonstrate the intended semantics.

## Further repository reading

For concrete programs, read:

- [`tests/calc.egg`](tests/calc.egg) for algebraic datatypes, globals, rewrites,
  bounded runs, `:until`, and push/pop.
- [`tests/rectangle.egg`](tests/rectangle.egg) for rulesets, range generation,
  multi-way joins, saturation, and statistics.
- [`tests/cykjson.egg`](tests/cykjson.egg) for TSV input into relations and
  functions, derived parsing, and a dynamic-programming workload.
- [`tests/complex-merge-func.egg`](tests/complex-merge-func.egg) for custom
  function merges and why merge order should not matter.
- [`tests/eggcc-extraction.egg`](tests/eggcc-extraction.egg) for datatypes,
  vectors, analysis relations, function-valued summaries, and extraction costs.
- [`tests/container-proofs.egg`](tests/container-proofs.egg) and
  [`tests/proofs/`](tests/proofs/) for proof-related constraints.
- [`tests/fail-typecheck/`](tests/fail-typecheck/) for examples of invalid
  declarations and ungrounded rules.
- [`egglog-bridge/examples/math.egg`](egglog-bridge/examples/math.egg) for a
  small standalone arithmetic example.

For implementation and embedding details, read [`src/lib.md`](src/lib.md),
[`src/prelude.rs`](src/prelude.rs), and [`src/exec_state.rs`](src/exec_state.rs).
For exact syntax, trust [`src/ast/parse.rs`](src/ast/parse.rs) and the command
documentation in [`src/ast/mod.rs`](src/ast/mod.rs) over third-party examples.
