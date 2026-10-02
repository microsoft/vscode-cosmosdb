# Changelog

## 1.1.0 (Unreleased)

### Added

- Export `DiagnosticSeverity` as a runtime value from the root entry point, matching `/services`.
- JavaScript source maps with embedded TypeScript and declaration maps, without separate TypeScript source files.
- Documentation of ESM/Node/browser support, editor dependencies, self-contained examples, and API limitations.

### Fixed

- Report `QUERY_TOO_COMPLEX` without an AST when parsing exceeds 512 active grammar rules or 256 AST node
  levels, instead of allowing excessive nesting to exhaust the stack.
- Restore parser depth after failures so subsequent queries remain usable.
- Align source coordinates with UTF-16 code units, exclusive range ends, and zero-width EOF diagnostics.
- Correct hover ranges and carriage-return handling in formatting and multi-query documents.
- Isolate function metadata and signature-help results so caller mutations cannot affect other requests or services.
- Correct documented exports, completion kinds, dependencies, and editor integration examples.

### Compatibility notes

- `FUNCTION_SIGNATURES` is now deeply frozen and readonly. `getFunctionMeta()` and signature-help results
  are independent mutable snapshots; editing them does not customize the built-in function registry.
- Parser recovery may return a partial AST but does not guarantee one. Complexity rejections return no AST.
  Unexpected exceptions still propagate; the structural limits do not impose a query-length or time limit.
- The schema-analyzer dependency is now `~1.1.0`, including its property-safety and declaration-dependency fixes.
- Optional CodeMirror peers use `>=6.0.0 <7.0.0`; Monaco uses `>=0.30.0 <1.0.0`. Future major versions
  require an explicit support decision. These ranges are not a claim that every historical version was tested.
- Node.js remains `>=22`; exports remain ESM-only. Declaration-to-source navigation requires separately
  available source files because declaration maps do not embed source text.
