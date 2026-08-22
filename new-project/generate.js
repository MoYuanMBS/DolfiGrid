#!/usr/bin/env node

/*
 * 通用 Markdown → 固定排版 HTML 生成器。
 *
 * 规则来源：doc/Markdown排版生成规范.md
 * 1. 同角色内容默认按 HTML 模板中的 DOM 顺序绑定。
 * 2. [role:id] 是可选的显式覆盖。
 * 3. {{skip}} 删除当前位置对应的模板元素，不保留空间。
 * 4. {{placeholder}} 和 {{placeholder lines=N}} 只保留透明空间，不输出文字。
 */

const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const templatePath = path.join(projectRoot, '标准格式', 'susu_tactical_ui_template.html');
const originalInput = path.join(projectRoot, 'original-md-files', '体验护航.md');
const documentedInput = path.join(projectRoot, 'doc', '体验护航.md');
// 优先使用用户实际编辑的 original-md-files；没有时再使用规范目录中的样例。
const defaultInput = fs.existsSync(originalInput) ? originalInput : documentedInput;
const defaultOutput = path.join(projectRoot, 'output', '体验护航.html');

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function unquote(value) {
    const text = String(value ?? '').trim();
    if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
        return text.slice(1, -1);
    }
    return text;
}

function parseFrontmatter(lines) {
    const data = { notice: [] };
    if (lines[0]?.trim() !== '---') return { data, body: lines };
    const end = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
    if (end < 0) throw new Error('frontmatter 没有结束标记 ---');

    let activeList = null;
    for (const line of lines.slice(1, end)) {
        const pair = line.match(/^([A-Za-z0-9_.-]+):\s*(.*)$/);
        if (pair) {
            const [, key, raw] = pair;
            if (raw.trim() === '') {
                data[key] = [];
                activeList = key;
            } else {
                data[key] = unquote(raw);
                activeList = null;
            }
            continue;
        }
        const item = line.match(/^\s+-\s+(.*)$/);
        if (item && activeList) data[activeList].push(unquote(item[1]));
    }
    return { data, body: lines.slice(end + 1) };
}

function stripMarkdown(text) {
    return String(text ?? '')
        .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '$1')
        .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .replace(/__([^_]+)__/g, '$1')
        .replace(/`([^`]+)`/g, '$1')
        .trim();
}

function parseBinding(title) {
    const match = title.match(/^\[([A-Za-z][A-Za-z0-9_-]*):([A-Za-z0-9_-]+)\]\s*(.*)$/);
    if (!match) return { role: '', id: '', title: stripMarkdown(title) };
    return { role: match[1].toLowerCase(), id: match[2], title: stripMarkdown(match[3]) };
}

function parsePlaceholder(text) {
    const match = String(text).trim().match(/^\{\{placeholder(?:\s+lines=(\d+))?\}\}$/);
    if (!match) return null;
    const lines = Number(match[1] || 1);
    if (!Number.isInteger(lines) || lines < 1) throw new Error('placeholder 的 lines 必须是正整数');
    return { kind: 'placeholder', lines };
}

function parseItem(firstLine, continuationLines) {
    const allLines = [firstLine, ...continuationLines].map((line) => stripMarkdown(line));
    const image = allLines[0].match(/^\[image\]\s+(.+)$/i);
    if (image) return { kind: 'image', path: image[1].trim() };
    const firstPlaceholder = parsePlaceholder(allLines[0]);
    if (firstPlaceholder && allLines.length === 1) return firstPlaceholder;
    return { kind: 'item', lines: allLines };
}

function parseDocument(text) {
    const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
    const { data, body } = parseFrontmatter(lines);
    const headings = [];
    let current = null;
    let pendingSkip = false;

    for (let index = 0; index < body.length; index += 1) {
        const line = body[index];
        if (!line.trim()) continue;

        if (line.trim() === '{{skip}}') {
            pendingSkip = true;
            continue;
        }

        const placeholder = parsePlaceholder(line);
        if (placeholder) {
            if (!current) throw new Error(`第 ${index + 1} 行的 placeholder 没有所属标题`);
            current.items.push(placeholder);
            continue;
        }

        const heading = line.match(/^(#{1,6})\s+(.+?)\s*$/);
        if (heading) {
            const binding = parseBinding(heading[2]);
            current = {
                level: heading[1].length,
                role: binding.role,
                id: binding.id,
                title: binding.title,
                items: [],
                skipBefore: pendingSkip,
            };
            pendingSkip = false;
            headings.push(current);
            continue;
        }

        const list = line.match(/^(\s*)-\s+(.+?)\s*$/);
        if (list) {
            if (!current) throw new Error(`第 ${index + 1} 行列表没有所属标题`);
            const continuation = [];
            while (index + 1 < body.length) {
                const next = body[index + 1];
                if (!/^\s{2,}\S/.test(next) || /^\s{2,}-\s+/.test(next) || /^\s{2,}#/.test(next)) break;
                continuation.push(next.replace(/^\s{2}/, ''));
                index += 1;
            }
            current.items.push(parseItem(list[2], continuation));
            continue;
        }

        const quote = line.match(/^\s*>\s*(.+?)\s*$/);
        if (quote && current) {
            current.items.push({ kind: 'item', lines: [stripMarkdown(quote[1])] });
            continue;
        }

        throw new Error(`无法解析第 ${index + 1} 行：${line}`);
    }

    for (const value of data.notice || []) {
        const notice = headings.find((heading) => heading.id === 'notice' || heading.role === 'notice');
        if (notice) notice.items.push({ kind: 'item', lines: [stripMarkdown(value)] });
    }
    return { meta: data, headings };
}

function attributePattern(name, value) {
    const escaped = String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return `\\b${name}="${escaped}"`;
}

function findElementRange(html, attributes) {
    const checks = Object.entries(attributes).map(([name, value]) => attributePattern(name, value));
    const lookaheads = checks.map((check) => `(?=[^>]*${check})`).join('');
    const openPattern = new RegExp(`<([a-z][a-z0-9]*)\\b${lookaheads}[^>]*>`, 'i');
    const opening = openPattern.exec(html);
    if (!opening) return null;
    const tag = opening[1];
    const tokenPattern = new RegExp(`<\\/?${tag}\\b[^>]*>`, 'gi');
    tokenPattern.lastIndex = opening.index;
    let depth = 0;
    let token;
    while ((token = tokenPattern.exec(html))) {
        const isClosing = /^<\//.test(token[0]);
        const isSelfClosing = /\/\s*>$/.test(token[0]);
        if (!isClosing && !isSelfClosing) depth += 1;
        if (isClosing) depth -= 1;
        if (depth === 0) {
            return { openStart: opening.index, openEnd: opening.index + opening[0].length, closeStart: token.index, closeEnd: tokenPattern.lastIndex, tag };
        }
    }
    throw new Error(`模板元素 <${tag}> 没有闭合`);
}

function replaceElementInner(html, attributes, content) {
    const range = findElementRange(html, attributes);
    if (!range) throw new Error(`模板中找不到元素：${JSON.stringify(attributes)}`);
    return html.slice(0, range.openEnd) + content + html.slice(range.closeStart);
}

function removeElement(html, attributes) {
    const range = findElementRange(html, attributes);
    if (!range) throw new Error(`模板中找不到要删除的元素：${JSON.stringify(attributes)}`);
    return html.slice(0, range.openStart) + html.slice(range.closeEnd);
}

function findSlots(html, role) {
    const regex = new RegExp(`<([a-z][a-z0-9]*)\\b(?=[^>]*${attributePattern('data-md-role', role)})(?=[^>]*\\bdata-md-id="([^"]+)")[^>]*>`, 'gi');
    return [...html.matchAll(regex)].map((match) => ({ role, id: match[2], tag: match[1] }));
}

function formatTitle(value, html, scope) {
    const pattern = new RegExp(`<([a-z][a-z0-9]*)\\b(?=[^>]*${attributePattern('data-md-scope', scope)})(?=[^>]*${attributePattern('data-md-field', 'title')})[^>]*>`, 'i');
    const field = pattern.exec(html);
    if (!field) return value;
    const opening = field[0];
    if (!/data-md-format="spaced-cjk"/.test(opening)) return value;
    return [...String(value).replace(/\s+/g, '')]
        .map((char) => /[\u3400-\u9fff]/.test(char) ? `${char} ` : char)
        .join('').trim();
}

function renderPlaceholder(lines) {
    return `<span class="md-placeholder" style="--placeholder-lines: ${lines};"></span>`;
}

function renderItem(item) {
    if (item.kind === 'placeholder') return `<li class="list-item"><span class="bullet"></span><span class="item-content">${renderPlaceholder(item.lines)}</span></li>`;
    if (item.kind === 'image') return '';
    const first = item.lines[0] || '';
    const columns = first.split('/|');
    const lineHtml = (line) => `<span class="item-line">${escapeHtml(line)}</span>`;
    if (columns.length === 2) {
        const continuation = item.lines.slice(1).map(lineHtml).join('');
        return `<li class="list-item"><span class="bullet"></span><span class="item-content"><span class="price-row"><span class="price-left">${escapeHtml(columns[0].trim())}</span><span class="price-right">${escapeHtml(columns[1].trim())}</span></span>${continuation}</span></li>`;
    }
    return `<li class="list-item"><span class="bullet"></span><span class="item-content">${item.lines.map(lineHtml).join('')}</span></li>`;
}

function renderItems(items) {
    return items.filter((item) => item.kind !== 'image').map(renderItem).join('\n');
}

function imageFromItems(items) {
    return items.find((item) => item.kind === 'image')?.path || '';
}

function bindField(html, scope, field, value, options = {}) {
    if (!value && options.removeWhenEmpty) return removeElement(html, { 'data-md-scope': scope, 'data-md-field': field });
    return replaceElementInner(html, { 'data-md-scope': scope, 'data-md-field': field }, options.raw ? value : escapeHtml(value));
}

function targetForHeading(heading, slots, used) {
    if (heading.id) {
        const exact = slots.find((slot) => slot.id === heading.id);
        if (!exact) throw new Error(`Markdown ID 未在模板中找到：${heading.id}`);
        return exact;
    }
    const candidate = slots.find((slot) => !used.has(slot.id));
    if (!candidate) throw new Error(`模板中没有可供顺序绑定的 ${heading.role || '当前角色'} 元素`);
    return candidate;
}

function applyLabels(html, meta) {
    const targets = {
        'label.header_tag': ['header', 'label'],
        'label.experience_en': ['experience', 'label'],
        'label.experience_status': ['experience', 'status'],
        'label.experience_badge_1': ['exp-1', 'badge'],
        'label.experience_badge_2': ['exp-2', 'badge'],
        'label.escort_en': ['escort', 'label'],
        'label.escort_status': ['escort', 'status'],
        'label.guarantee_badge': ['escort-guarantee', 'badge'],
        'label.match_badge': ['escort-match', 'badge'],
        'label.notice_en': ['notice', 'label'],
        'label.notice_status': ['notice', 'status'],
        'label.notice_tag': ['notice', 'tag'],
    };
    for (const [key, value] of Object.entries(meta)) {
        if (!key.startsWith('label.') || !String(value).trim()) continue;
        const target = targets[key];
        if (target) html = bindField(html, target[0], target[1], value);
    }
    return html;
}

function renderDocument(document) {
    let html = fs.readFileSync(templatePath, 'utf8');
    const roles = ['section', 'card'];
    const slots = Object.fromEntries(roles.map((role) => [role, findSlots(html, role)]));
    const used = new Set();

    if (document.meta.title) html = bindField(html, 'header', 'title', document.meta.title);
    else html = bindField(html, 'header', 'title', '', { removeWhenEmpty: true });
    if (document.meta.subtitle) html = bindField(html, 'header', 'subtitle', document.meta.subtitle);
    else html = bindField(html, 'header', 'subtitle', '', { removeWhenEmpty: true });
    html = applyLabels(html, document.meta);

    for (const heading of document.headings) {
        const role = heading.role || (heading.level <= 2 ? 'section' : 'card');
        if (!slots[role]) continue;
        const target = targetForHeading(heading, slots[role], used);
        if (heading.skipBefore) {
            html = removeElement(html, { 'data-md-role': target.role, 'data-md-id': target.id });
            used.add(target.id);
            continue;
        }
        used.add(target.id);
        const title = formatTitle(heading.title, html, target.id);
        html = bindField(html, target.id, 'title', title, { removeWhenEmpty: true });
        const image = imageFromItems(heading.items);
        if (image) {
            const imagePath = path.resolve(path.dirname(templatePath), image);
            if (!fs.existsSync(imagePath)) throw new Error(`图片文件不存在：${image}`);
            html = replaceElementInner(html, { 'data-md-scope': target.id, 'data-md-field': 'media' }, `<img class="media-image" src="${escapeHtml(image.replace(/\\/g, '/'))}" alt="">`);
            const mediaRange = findElementRange(html, { 'data-md-scope': target.id, 'data-md-field': 'media' });
            html = html.slice(0, mediaRange.openStart) + html.slice(mediaRange.openStart).replace(/^([^>]*class="[^"]*)"/, '$1 has-image"');
        }
        const field = 'items';
        // 不依赖 HTML 属性书写顺序，避免 data-md-field 与 data-md-scope 调换后失效。
        const hasList = Boolean(findElementRange(html, {
            'data-md-scope': target.id,
            'data-md-field': field,
        }));
        if (hasList) html = bindField(html, target.id, field, renderItems(heading.items), { raw: true });
    }

    for (const role of roles) {
        for (const slot of slots[role].slice().reverse()) {
            if (!used.has(slot.id)) html = removeElement(html, { 'data-md-role': role, 'data-md-id': slot.id });
        }
    }

    if (!html.includes('*以上内容最终解释权归溯流电竞所有')) throw new Error('固定最终解释权区域缺失');
    if (/\[[^\]]*(占位|placeholder)[^\]]*\]/i.test(html) || /标题占位符|SUBTITLE PLACEHOLDER/.test(html)) throw new Error('生成结果残留可见占位文本');
    return html;
}

const inputPath = path.resolve(projectRoot, process.argv[2] || defaultInput);
const outputPath = path.resolve(projectRoot, process.argv[3] || defaultOutput);
if (!fs.existsSync(inputPath)) throw new Error(`Markdown 文件不存在：${inputPath}`);
const document = parseDocument(fs.readFileSync(inputPath, 'utf8'));
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, renderDocument(document), 'utf8');
console.log(`已生成：${outputPath}`);
