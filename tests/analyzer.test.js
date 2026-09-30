import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { classifySection, compareReports, createReport, evaluateBudgets, hierarchy, markdownSummary, parseMap, parseNm, parseSize } from '../src/index.js';
const fixture = (name) => readFileSync(new URL(`fixtures/${name}`, import.meta.url), 'utf8');

test('parses Berkeley size and counts initialized data in flash and RAM', () => {
  const report = parseSize(fixture('size-berkeley.txt'));
  assert.equal(report.summary.flashBytes, 4224); assert.equal(report.summary.ramBytes, 1152); assert.equal(report.file, 'build/sensor.elf');
});
test('parses SysV sections and excludes debug bytes from runtime totals', () => {
  const report = parseSize(fixture('size-sysv.txt'));
  assert.equal(report.summary.flashBytes, 4736); assert.equal(report.summary.ramBytes, 1152); assert.equal(report.summary.debugBytes, 2048);
});
test('classifies common embedded sections', () => {
  assert.equal(classifySection('.isr_vector'), 'flash'); assert.equal(classifySection('.noinit'), 'ram'); assert.equal(classifySection('.debug_line'), 'debug');
});
test('nm parser ranks symbols and classifies storage', () => {
  const symbols = parseNm(fixture('nm.txt')); assert.equal(symbols[0].name, 'sample_buffer'); assert.equal(symbols[0].kind, 'bss'); assert.equal(symbols.at(-1).kind, 'rodata');
});
test('linker map parser extracts memory regions and contributions', () => {
  const map = parseMap(fixture('linker.map')); assert.equal(map.regions.length, 2); assert.equal(map.regions[0].length, 262144); assert.equal(map.symbols.length, 2);
});
test('combined report includes symbols and linker map', () => {
  const report = createReport(fixture('size-sysv.txt'), { nmText: fixture('nm.txt'), mapText: fixture('linker.map') });
  assert.equal(report.symbols.length, 5); assert.equal(report.linkerMap.regions[1].name, 'RAM'); assert.equal(report.summary.symbolBytes, 992);
});
test('budgets support memory, sections, and regex symbol groups', () => {
  const report = createReport(fixture('size-sysv.txt'), { nmText: fixture('nm.txt') });
  const result = evaluateBudgets(report, { flashBytes: 5000, ramBytes: 1100, sections: { bss: 1100 }, symbols: { '^sample_': 600 } });
  assert.equal(result.pass, false); assert.equal(result.checks.filter((x) => !x.pass).length, 1);
});
test('comparison reports growth and enforces byte gates', () => {
  const baseline = parseSize(fixture('size-berkeley.txt')); const current = structuredClone(baseline); current.summary.flashBytes += 100; current.summary.ramBytes += 20; current.summary.totalSectionBytes += 120;
  const result = compareReports(baseline, current, { maxFlashGrowthBytes: 50, maxRamGrowthBytes: 25 }); assert.equal(result.pass, false); assert.equal(result.metrics.flash.delta, 100);
});
test('hierarchy creates treemap-ready section groups', () => {
  const tree = hierarchy(parseSize(fixture('size-sysv.txt'))); assert.equal(tree.name, 'firmware'); assert.ok(tree.children.some((x) => x.name === 'flash'));
});
test('Markdown summary includes budget status', () => {
  const report = parseSize(fixture('size-berkeley.txt')); const budget = evaluateBudgets(report, { flashBytes: 4000 }); const md = markdownSummary(report, budget);
  assert.match(md, /Firmware size report/); assert.match(md, /\| flash \| 4224 \| 4000 \| -224 \| FAIL \|/);
});
test('malformed input fails clearly', () => assert.throws(() => parseSize('not a size report'), /Unrecognized/));
