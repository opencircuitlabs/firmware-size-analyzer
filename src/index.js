const toNumber = (value) => Number.parseInt(value, /^0x/i.test(value) ? 16 : 10);
const normalizeSection = (name) => name.replace(/^\./, '');

export function parseSize(text) {
  if (typeof text !== 'string' || !text.trim()) throw new Error('size output is empty');
  const lines = text.trim().split(/\r?\n/); const sections = []; let file = null;
  const berkeleyHeader = lines.findIndex((line) => /^\s*text\s+data\s+bss\s+dec\s+hex\s+filename\s*$/i.test(line));
  if (berkeleyHeader >= 0) {
    const row = lines.slice(berkeleyHeader + 1).find((line) => line.trim());
    const match = row?.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+([0-9a-f]+)\s+(.+)$/i);
    if (!match) throw new Error('Malformed Berkeley size row');
    file = match[6].trim();
    sections.push({ name: 'text', size: toNumber(match[1]), kind: 'flash' }, { name: 'data', size: toNumber(match[2]), kind: 'ram+flash' }, { name: 'bss', size: toNumber(match[3]), kind: 'ram' });
    return summarize({ format: 'berkeley', file, sections, symbols: [] });
  }
  const fileHeader = lines.find((line) => /^.+:\s+file format/i.test(line)); if (fileHeader) file = fileHeader.split(':')[0].trim();
  for (const line of lines) {
    const match = line.trim().match(/^(\.[A-Za-z0-9_.$-]+)\s+(\d+)\s+(?:0x)?[0-9a-f]+\s*$/i);
    if (match) sections.push({ name: normalizeSection(match[1]), size: toNumber(match[2]), kind: classifySection(match[1]) });
  }
  if (!sections.length) throw new Error('Unrecognized GNU size output');
  return summarize({ format: 'sysv', file, sections, symbols: [] });
}

export function classifySection(name) {
  name = normalizeSection(name);
  if (/^(text|rodata|init|fini|vectors|isr_vector|ARM\.exidx)/.test(name)) return 'flash';
  if (/^(data|sdata|tdata)/.test(name)) return 'ram+flash';
  if (/^(bss|sbss|tbss|noinit|heap|stack)/.test(name)) return 'ram';
  if (/^(debug|comment|symtab|strtab|shstrtab)/.test(name)) return 'debug';
  return 'other';
}

export function parseNm(text) {
  const symbols = [];
  for (const line of text.split(/\r?\n/)) {
    const match = line.trim().match(/^(?:([0-9a-f]+)\s+)?([0-9a-f]+)\s+([A-Za-z?])\s+(.+)$/i);
    if (!match) continue;
    const size = Number.parseInt(match[2], 16); const type = match[3]; const name = match[4].trim();
    symbols.push({ name, size, type, kind: classifySymbol(type), object: inferObject(name) });
  }
  return symbols.sort((a, b) => b.size - a.size || a.name.localeCompare(b.name));
}

export function classifySymbol(type) {
  const lower = type.toLowerCase();
  if (['t', 'w'].includes(lower)) return 'code';
  if (['r'].includes(lower)) return 'rodata';
  if (['d', 'g', 's'].includes(lower)) return 'data';
  if (['b', 'c'].includes(lower)) return 'bss';
  return 'other';
}

function inferObject(name) {
  const match = name.match(/^(?:.+\/)?([^/():]+\.(?:o|a))(?::|\()/); return match?.[1] ?? null;
}

export function parseMap(text) {
  const regions = []; const symbols = []; let inMemory = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^Memory Configuration/.test(line.trim())) { inMemory = true; continue; }
    if (inMemory) {
      if (/^Linker script and memory map/.test(line.trim())) { inMemory = false; continue; }
      const region = line.trim().match(/^(\S+)\s+0x([0-9a-f]+)\s+0x([0-9a-f]+)\s+([xrwa!]+)/i);
      if (region && region[1] !== 'Name') regions.push({ name: region[1], origin: Number.parseInt(region[2], 16), length: Number.parseInt(region[3], 16), attributes: region[4] });
      continue;
    }
    const contribution = line.match(/^\s*(\.[A-Za-z0-9_.$-]+)\s+0x([0-9a-f]+)\s+0x([0-9a-f]+)\s+(.+?)\s*$/i);
    const symbol = line.match(/^\s*0x([0-9a-f]+)\s+0x([0-9a-f]+)\s+(.+?)\s*$/i);
    if (contribution && Number.parseInt(contribution[3], 16) > 0) symbols.push({ address: Number.parseInt(contribution[2], 16), size: Number.parseInt(contribution[3], 16), name: contribution[1], object: contribution[4] });
    else if (symbol && Number.parseInt(symbol[2], 16) > 0) symbols.push({ address: Number.parseInt(symbol[1], 16), size: Number.parseInt(symbol[2], 16), name: symbol[3].trim(), object: null });
  }
  return { regions, symbols: symbols.sort((a, b) => b.size - a.size) };
}

export function summarize(report) {
  const sections = report.sections.map((s) => ({ ...s, kind: s.kind ?? classifySection(s.name) }));
  const sum = (kinds) => sections.filter((s) => kinds.includes(s.kind)).reduce((total, s) => total + s.size, 0);
  return { schemaVersion: 1, ...report, sections, summary: { flashBytes: sum(['flash', 'ram+flash']), ramBytes: sum(['ram', 'ram+flash']), debugBytes: sum(['debug']), otherBytes: sum(['other']), totalSectionBytes: sections.reduce((total, s) => total + s.size, 0), symbolBytes: (report.symbols ?? []).reduce((total, s) => total + s.size, 0) } };
}

export function createReport(sizeText, options = {}) {
  const report = parseSize(sizeText);
  report.symbols = options.nmText ? parseNm(options.nmText) : [];
  if (options.mapText) report.linkerMap = parseMap(options.mapText);
  return summarize(report);
}

export function evaluateBudgets(report, config) {
  const checks = []; const add = (scope, used, limit) => { if (limit == null) return; checks.push({ scope, used, limit, remaining: limit - used, percent: limit === 0 ? (used ? Infinity : 0) : used / limit * 100, pass: used <= limit }); };
  add('flash', report.summary.flashBytes, config.flashBytes); add('ram', report.summary.ramBytes, config.ramBytes); add('total', report.summary.totalSectionBytes, config.totalBytes);
  for (const [name, limit] of Object.entries(config.sections ?? {})) add(`section:${name}`, report.sections.find((s) => normalizeSection(s.name) === normalizeSection(name))?.size ?? 0, limit);
  for (const [pattern, limit] of Object.entries(config.symbols ?? {})) { const regex = new RegExp(pattern); add(`symbols:${pattern}`, report.symbols.filter((s) => regex.test(s.name)).reduce((n, s) => n + s.size, 0), limit); }
  return { pass: checks.every((c) => c.pass), checks };
}

export function compareReports(baseline, current, options = {}) {
  const metric = (name) => ({ before: baseline.summary[name], after: current.summary[name], delta: current.summary[name] - baseline.summary[name], percent: baseline.summary[name] ? (current.summary[name] - baseline.summary[name]) / baseline.summary[name] * 100 : null });
  const metrics = { flash: metric('flashBytes'), ram: metric('ramBytes'), total: metric('totalSectionBytes') };
  const oldSymbols = new Map((baseline.symbols ?? []).map((s) => [s.name, s]));
  const symbolDeltas = (current.symbols ?? []).map((s) => ({ name: s.name, before: oldSymbols.get(s.name)?.size ?? 0, after: s.size, delta: s.size - (oldSymbols.get(s.name)?.size ?? 0) })).filter((s) => s.delta !== 0).sort((a, b) => b.delta - a.delta);
  for (const old of baseline.symbols ?? []) if (!(current.symbols ?? []).some((s) => s.name === old.name)) symbolDeltas.push({ name: old.name, before: old.size, after: 0, delta: -old.size });
  const failures = [];
  if (metrics.flash.delta > (options.maxFlashGrowthBytes ?? Infinity)) failures.push(`flash grew by ${metrics.flash.delta} bytes`);
  if (metrics.ram.delta > (options.maxRamGrowthBytes ?? Infinity)) failures.push(`RAM grew by ${metrics.ram.delta} bytes`);
  if (options.maxGrowthPercent != null && [metrics.flash, metrics.ram].some((m) => m.percent != null && m.percent > options.maxGrowthPercent)) failures.push(`growth exceeded ${options.maxGrowthPercent}%`);
  return { pass: failures.length === 0, failures, metrics, symbolDeltas };
}

export function hierarchy(report, groupBy = 'kind') {
  const groups = new Map();
  const items = groupBy === 'object' ? report.symbols : report.sections;
  for (const item of items) { const key = groupBy === 'object' ? item.object ?? '(unknown)' : item.kind; const group = groups.get(key) ?? []; group.push({ name: item.name, value: item.size }); groups.set(key, group); }
  return { name: report.file ?? 'firmware', children: [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([name, children]) => ({ name, value: children.reduce((n, x) => n + x.value, 0), children: children.sort((a, b) => b.value - a.value) })) };
}

export function markdownSummary(report, budget = null) {
  const lines = ['# Firmware size report', '', `Artifact: \`${report.file ?? 'unknown'}\``, '', '| Memory | Bytes |', '| --- | ---: |', `| Flash | ${report.summary.flashBytes} |`, `| RAM | ${report.summary.ramBytes} |`, `| Debug | ${report.summary.debugBytes} |`, '', '## Sections', '', '| Section | Kind | Bytes |', '| --- | --- | ---: |', ...report.sections.map((s) => `| ${s.name} | ${s.kind} | ${s.size} |`)];
  if (budget) lines.push('', '## Budgets', '', '| Scope | Used | Limit | Remaining | Status |', '| --- | ---: | ---: | ---: | --- |', ...budget.checks.map((c) => `| ${c.scope} | ${c.used} | ${c.limit} | ${c.remaining} | ${c.pass ? 'PASS' : 'FAIL'} |`));
  return lines.join('\n') + '\n';
}
