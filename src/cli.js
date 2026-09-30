#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { compareReports, createReport, evaluateBudgets, markdownSummary } from './index.js';

const args = process.argv.slice(2); const value = (flag) => { const i = args.indexOf(flag); return i < 0 ? undefined : args[i + 1]; };
const loadText = (flag) => value(flag) ? readFileSync(value(flag), 'utf8') : undefined;
const build = (file) => createReport(readFileSync(file, 'utf8'), { nmText: loadText('--nm'), mapText: loadText('--map') });
try {
  const command = args[0] ?? 'analyze';
  if (command === 'analyze') {
    const report = build(args[1]); const config = value('--budget') ? JSON.parse(readFileSync(value('--budget'), 'utf8')) : null; const budget = config ? evaluateBudgets(report, config) : null;
    const output = value('--output'); const result = { report, budget }; const text = args.includes('--markdown') ? markdownSummary(report, budget) : JSON.stringify(result, null, 2) + '\n';
    if (output) writeFileSync(output, text); else process.stdout.write(text); if (budget && !budget.pass) process.exitCode = 2;
  } else if (command === 'compare') {
    const baseline = createReport(readFileSync(args[1], 'utf8')); const current = createReport(readFileSync(args[2], 'utf8'));
    const result = compareReports(baseline, current, { maxFlashGrowthBytes: Number(value('--max-flash-growth') ?? Infinity), maxRamGrowthBytes: Number(value('--max-ram-growth') ?? Infinity), maxGrowthPercent: value('--max-percent') == null ? undefined : Number(value('--max-percent')) });
    console.log(JSON.stringify(result, null, 2)); if (!result.pass) process.exitCode = 2;
  } else throw new Error(`Unknown command: ${command}`);
} catch (error) { console.error(error.message); process.exitCode = 1; }
