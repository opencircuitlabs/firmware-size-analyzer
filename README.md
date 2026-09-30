# Firmware Size Analyzer

A dependency-free firmware footprint analyzer for GNU `size`, `nm`, and linker-map output. It turns build artifacts into normalized section and symbol data, enforces flash/RAM budgets, explains regressions, and generates Markdown or JSON suitable for CI and dashboards.

## Quick start

Capture tool output during your embedded build:

```bash
arm-none-eabi-size -A build/app.elf > size.txt
arm-none-eabi-nm --print-size --size-sort build/app.elf > nm.txt
```

Then analyze or gate it:

```bash
npm install
npm test
node src/cli.js analyze size.txt --nm nm.txt --map build/app.map
node src/cli.js analyze size.txt --nm nm.txt --budget examples/budget.json --markdown --output size-report.md
node src/cli.js compare baseline-size.txt current-size.txt --max-flash-growth 256 --max-ram-growth 64
```

Budget and regression failures exit with status `2`; parse or usage errors exit with `1`.

## Memory accounting

- Flash includes executable/read-only sections plus the load image for initialized data.
- RAM includes initialized data, BSS, no-init, heap, and stack sections.
- Debug sections are reported separately and do not count against runtime flash/RAM.
- Unknown sections remain visible as `other`; they are never silently discarded.

This mirrors the embedded reality that `.data` consumes both nonvolatile image space and runtime RAM.

## Budgets

```json
{
  "flashBytes": 131072,
  "ramBytes": 32768,
  "totalBytes": 160000,
  "sections": { "bss": 16384 },
  "symbols": { "^audio_": 8192, "buffer": 4096 }
}
```

Section budgets use normalized names with or without a leading dot. Symbol budget keys are JavaScript regular expressions and sum all matching symbol sizes. Every check reports used, limit, remaining, percentage, and pass/fail.

## API

```js
import {
  createReport, evaluateBudgets, compareReports, hierarchy
} from '@opencircuitlabs/firmware-size-analyzer';

const report = createReport(sizeText, { nmText, mapText });
const gate = evaluateBudgets(report, limits);
const change = compareReports(baseline, report, {
  maxFlashGrowthBytes: 256,
  maxRamGrowthBytes: 64,
  maxGrowthPercent: 2
});
const treemap = hierarchy(report, 'kind');
```

The comparison includes byte/percentage deltas and the symbols responsible for growth or shrinkage. `hierarchy` returns renderer-neutral nested data grouped by memory kind or object file.

## Supported inputs

- GNU `size` Berkeley summary format;
- GNU `size -A` / SysV section format;
- GNU `nm --print-size` symbol listings;
- GNU ld memory configuration and map contributions.

Tool output formats can differ across vendor forks; keep a real fixture when adding support for one.

## License

MIT
