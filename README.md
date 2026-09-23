like [tap-dot](https://github.com/scottcorgan/tap-dot), but with more information about failures, and where to find them.

based on [am-tap-dot](http://github.com/amokrushin/am-tap-dot) by [amokrushin](https://github.com/amokrushin). (Thanks!)

![image](https://user-images.githubusercontent.com/399657/39227440-9716c02a-4826-11e8-872e-4c1ad674446e.png)

---

![image](https://user-images.githubusercontent.com/399657/39227411-7038874a-4826-11e8-8907-de7fbf68ec05.png)

```bash
# local
npm i tap-dancer --save-dev

# global
npm i tap-dancer -g
```

### Requirements

Node.js 20 or 22+. TAP parsing uses `tap-parser` and supports TAP 13/14.

### Command-line

```bash
tape test/index.js | tap-dancer
```

Or in `package.json`:

```json
{
  "scripts": {
    "test": "node ./test/tap-test.js | tap-dancer"
  }
}
```

The CLI exits 1 for failed assertions, bailouts, malformed or incomplete TAP,
and empty input. An explicit zero-test plan (`1..0`, optionally with `# SKIP`)
is valid. Normal console output is preserved alongside valid TAP.

Passed, failed, skipped, and TODO test points are counted separately. TODO
failures do not fail the run. For nested TAP, the displayed counts describe the
top-level test points; the parser also validates their child tests.
Nested failures include their subtest path and assertion diagnostics. TODO/SKIP
directives suppress assertion failures throughout the marked subtest, but
malformed TAP and bailouts still fail the run at every nesting level.
Reports show details for the first 10 failures, followed by the number of
additional failures omitted. The final counts always include all test points.

### API

The default export is a Transform stream. Importing it does not read stdin,
print anything, or change the host process's exit status.
The package uses ES modules. Use `import TapDance from 'tap-dancer'`; CommonJS
callers can use `const { default: TapDance } = await import('tap-dancer')`
inside an async function.

```js
import test from 'tape'
import TapDance from 'tap-dancer'
import { pipeline } from 'node:stream'

const reporter = new TapDance({ noreport: false })
reporter.on('complete', results => {
  if (!results.ok) process.exitCode = 1
})

pipeline(test.createStream(), reporter, process.stdout, err => {
  if (err) {
    console.error(err)
    process.exitCode = 1
  }
})
```

`complete` provides the parser's final result, with `ok` also reflecting the
reporter's protocol checks, plus `counts` (`passed`, `failed`, `skipped`, `todo`)
and an `errors` array of protocol failure messages. The same object is available
as `reporter.results` after completion. Assertion failures are test results;
stream/parser errors emit `error` and are handled by `pipeline`.

### Options

- `-nofail` / `--nofail`: return exit code 0 even for failed or invalid TAP.
  Failures remain visible. Input/output errors still exit 1.
- `-noreport` / `--noreport`: omit individual assertion failure details. The
  summary, protocol errors, and failure exit status remain.
- `--color`: enable colored output (unless `NO_COLOR` is set).

### Development

Use pnpm 11.5.0 for development (pinned in `packageManager`):

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm run lint
```

The regular suite uses Node's built-in test runner and covers the CLI, TAP
fixtures, stream API, exit status, and output flushing. It does not install Tape.

Real Tape compatibility tests live in the standalone `integration/tape` project,
with a separate installation and lockfile. To run them:

```bash
pnpm --dir integration/tape install --frozen-lockfile
pnpm run test:integration
```

These tests cover asynchronous assertions, skips, failure diagnostics, rejected
promises, and the diagnostic limit. Tape's deprecated Glob/Inflight dependencies
remain confined to that optional installation. CI runs it in a separate job.

Both projects disable install scripts and require dependencies to be at least
24 hours old, rejecting release-age exceptions and missing publication dates.
CI uses frozen lockfiles. To intentionally update dependencies, use
`pnpm install --no-frozen-lockfile` in the relevant project, review the lockfile
diff, and run its tests. If a version is too new, wait for the age requirement
instead of adding an exception.

The pnpm release-age policy applies to development installs using pnpm; it is
not enforced on downstream users installing the published package with npm.
The repository's `.npmrc` also disables install scripts for npm users.

MIT
