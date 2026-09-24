### 0.4.3 [Sep 2026]
- **[change]** nicer failure output

### 0.4.2 [Sep 2026]
- **[change]** unlink devDependencies

### 0.4.1 [Sep 2026]
- **[change]** dont print non-zero output
- **[fix]** linting
 
### 0.4.0 [Sep 2026]

- **[breaking]** Converted to ES modules; use the default import for the stream API.
- **[breaking]** Requires Node.js 20 or 22+.
- **[fix]** Invalid/incomplete TAP and bailouts now fail.
- **[fix]** TODO/SKIP counts and nested subtests behave correctly; protocol errors still fail inside TODO/SKIP subtests.
- **[fix]** Output flushes before exit.
- **[fix]** The stream API works without process side effects.
- **[fix]** Missing diagnostics no longer print undefined.
- **[fix]** Nested failure diagnostics include their subtest paths.
- **[fix]** Reports retain diagnostics for the first 10 failures and summarize additional failures.
- **[fix]** Both CLI entry points support forced color and symlinked execution.
- **[change]** Replaced Colorette with small local color functions.
- **[test]** Added 56 tests, including real Tape integration tests for asynchronous assertions, skips, diagnostics, rejected promises, and the diagnostic limit.
- **[release]** Restricted published files to source, package metadata, documentation, and the license.
