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

### API

The default export is a Transform stream. Importing it does not read stdin,
print anything, or change the host process's exit status.

```js
const test = require('tape')
const TapDance = require('tap-dancer')
const { pipeline } = require('node:stream')

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

Run `npm install`, then `npm test`. The suite exercises the real CLI with TAP
fixtures and tests the stream API, exit status, and output flushing.

MIT
