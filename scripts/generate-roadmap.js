#!/usr/bin/env node
/**
 * Generate a roadmap section in README.md from data/roadmap.json
 * - Renders between <!-- ROADMAP:START --> and <!-- ROADMAP:END -->
 * - If markers don't exist, inserts after the first '## Content' heading; otherwise appends to end
 */
import { readFileSync, writeFileSync, accessSync, constants as FS_CONSTANTS } from 'fs';
import { join } from 'path';
let jsYaml = null;
try {
  // Lazy optional dependency; only needed when using YAML
  jsYaml = await import('js-yaml');
} catch (_) {
  jsYaml = null;
}

const ROOT = process.cwd();
const DATA_JSON_PATH = join(ROOT, 'data', 'roadmap.json');
const DATA_YAML_PATH = join(ROOT, 'data', 'roadmap.yaml');
const DATA_YML_PATH = join(ROOT, 'data', 'roadmap.yml');
const README_PATH = join(ROOT, 'README.md');
const START_MARK = '<!-- ROADMAP:START -->';
const END_MARK = '<!-- ROADMAP:END -->';

function fileExists(p) {
  try {
    accessSync(p, FS_CONSTANTS.F_OK);
    return true;
  } catch {
    return false;
  }
}

function readData() {
  // Prefer YAML when available
  const yamlPath = fileExists(DATA_YAML_PATH) ? DATA_YAML_PATH : (fileExists(DATA_YML_PATH) ? DATA_YML_PATH : null);
  if (yamlPath) {
    if (!jsYaml) throw new Error('YAML file detected but js-yaml is not installed. Run: npm install js-yaml');
    const raw = readFileSync(yamlPath, 'utf8');
    // jsYaml is an ESM namespace import; default export is under .default
    const y = jsYaml.default || jsYaml;
    return y.load(raw);
  }
  // Fallback to JSON
  const raw = readFileSync(DATA_JSON_PATH, 'utf8');
  return JSON.parse(raw);
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function renderObjectives(objectives) {
  if (!objectives || !objectives.length) return '';
  const items = objectives.map((o) => `* ${escHtml(o)}`).join('\n');
  return [
    '#### Objectives',
    '_By the end of this level, the learner should learn_',
    items,
    ''
  ].join('\n');
}

function isPlainObject(val) {
  return val && typeof val === 'object' && !Array.isArray(val);
}

function renderResources(resources) {
  if (!resources || typeof resources !== 'object') return '';
  const langs = Object.keys(resources);
  if (langs.length === 0) return '';
  let out = [];
  out.push('<h5>🎞️ Resources</h5>');
  for (const lang of langs) {
    const langData = resources[lang];
    if (!langData) continue;
    out.push(`<h6>🌏 ${escHtml(lang)}</h6>`);

    // Backward-compatible: if array -> flat list
    if (Array.isArray(langData)) {
      if (langData.length === 0) continue;
      out.push('<ul>');
      for (const r of langData) {
        const title = escHtml((r && r.title) || 'Untitled');
        const url = escHtml((r && r.url) || '#');
        out.push(`  <li><a href="${url}">${title}</a></li>`);
      }
      out.push('</ul>');
      continue;
    }

    // Nested by topic: { TopicName: [{title,url}, ...], ... }
    if (isPlainObject(langData)) {
      const topicNames = Object.keys(langData);
      if (topicNames.length === 0) continue;
      out.push('<ul>');
      for (const topicName of topicNames) {
        const items = Array.isArray(langData[topicName]) ? langData[topicName] : [];
        out.push(`  <li>${escHtml(topicName)}`);
        if (items.length > 0) {
          out.push('    <ul>');
          for (const r of items) {
            const title = escHtml((r && r.title) || 'Untitled');
            const url = escHtml((r && r.url) || '#');
            out.push(`      <li><a href="${url}">${title}</a></li>`);
          }
          out.push('    </ul>');
        }
        out.push('  </li>');
      }
      out.push('</ul>');
    }
  }
  return out.join('\n');
}

function renderTopics(topics) {
  if (!topics || !topics.length) return '';
  const items = topics.map((t) => `  <li>${escHtml(t)}</li>`).join('\n');
  return [
    '<h5>🎯 Topics</h5>',
    '<ul>',
    items,
    '</ul>'
  ].join('\n');
}

function renderTask(task) {
  if (!task || !task.url) return '';
  const title = escHtml(task.title || 'Task');
  const url = escHtml(task.url);
  return [
    '<h5>📃 Task</h5>',
    `<a href="${url}">${title}</a>`
  ].join('\n');
}

function resourcesHaveNestedTopics(resources) {
  if (!resources || typeof resources !== 'object') return false;
  for (const lang of Object.keys(resources)) {
    const langData = resources[lang];
    if (isPlainObject(langData)) {
      // if any value is an array under a topic key, we consider nested
      for (const topicName of Object.keys(langData)) {
        if (Array.isArray(langData[topicName])) return true;
      }
    }
  }
  return false;
}

function renderWeekRow(week) {
  let headerText;
  if (typeof week.phase === 'string' && week.phase.trim()) {
    headerText = escHtml(week.phase.trim());
  } else if (typeof week.week === 'number' && !Number.isNaN(week.week)) {
    headerText = `Week ${Number(week.week)}`;
  } else {
    headerText = 'Phase';
  }
  const header = `<th>${headerText}</th>`;
  const parts = [];
  const nestedTopics = resourcesHaveNestedTopics(week.resources);
  if (!nestedTopics) {
    const topics = renderTopics(week.topics);
    if (topics) parts.push(topics);
  }
  let resourcesBlock = '';
  if (week.resources) {
    const title = typeof week.resourcesTitle === 'string' && week.resourcesTitle.trim()
      ? week.resourcesTitle.trim()
      : '🎞️ Resources';
    // Temporarily swap heading in output by post-processing the default render
    const rendered = renderResources(week.resources);
    resourcesBlock = rendered.replace('<h5>🎞️ Resources</h5>', `<h5>${escHtml(title)}</h5>`);
  }
  const resources = resourcesBlock;
  if (resources) parts.push(resources);
  const task = renderTask(week.task);
  if (task) parts.push(task);
  const td = `<td>\n${parts.join('\n')}\n</td>`;
  return [
    '        <tr>',
    `            ${header}`,
    `            ${td}`,
    '        </tr>'
  ].join('\n');
}

function renderLevel(level) {
  const title = escHtml(level.title || `Level ${level.id}`);
  const header = `\n### ${title}`;
  const objectives = renderObjectives(level.objectives);
  let weeks = Array.isArray(level.weeks) ? [...level.weeks] : [];
  const numbered = weeks.filter((w) => typeof w.week === 'number').sort((a, b) => Number(a.week) - Number(b.week));
  const nonNumbered = weeks.filter((w) => typeof w.week !== 'number');
  weeks = [...numbered, ...nonNumbered];
  const rows = weeks.map(renderWeekRow).join('\n');
  const table = [
    '<table>',
    '    <thead>',
    '        <tr>',
    '            <th>Phase</th>',
    '            <th>Content</th>',
    '        </tr>',
    '    </thead>',
    '    <tbody>',
    rows,
    '    </tbody>',
    '</table>'
  ].join('\n');
  return [header, '', objectives, '#### Plan', table, ''].filter(Boolean).join('\n');
}

function renderAll(data) {
  const introNote = [
    '<!-- This section is auto-generated. Do not edit directly. Edit data/roadmap.yaml (preferred) or data/roadmap.json instead. -->',
    '',
  ].join('\n');
  const levels = (data.levels || [])
    .sort((a, b) => Number(a.id) - Number(b.id))
    .map(renderLevel)
    .join('\n');
  return [introNote, levels].join('\n');
}

function insertOrReplace(readme, content) {
  const block = `${START_MARK}\n${content}\n${END_MARK}`;
  const startIdx = readme.indexOf(START_MARK);
  const endIdx = readme.indexOf(END_MARK);
  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    return readme.slice(0, startIdx) + block + readme.slice(endIdx + END_MARK.length);
  }
  // Try to insert after '## Content' heading
  const contentHeadingRegex = /(^##\s+Content\s*$)/m;
  const match = readme.match(contentHeadingRegex);
  if (match) {
    const idx = match.index + match[0].length;
    return readme.slice(0, idx) + '\n\n' + block + readme.slice(idx);
  }
  // Fallback: append at end
  return readme.trimEnd() + '\n\n' + block + '\n';
}

function main() {
  const data = readData();
  const readme = readFileSync(README_PATH, 'utf8');
  const content = renderAll(data);
  const next = insertOrReplace(readme, content);
  if (next !== readme) {
    writeFileSync(README_PATH, next, 'utf8');
    console.log('README.md updated with generated roadmap.');
  } else {
    console.log('README.md unchanged.');
  }
}

try {
main();
} catch (err) {
console.error('Failed to generate roadmap:', err);
process.exit(1);
}
