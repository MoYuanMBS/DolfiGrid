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

/** 对来自 Markdown 的文本进行 HTML 转义，防止内容破坏模板结构。 */
function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/** 读取 frontmatter 标量时去除可选的单双引号。 */
function unquote(value) {
    const text = String(value ?? '').trim();
    if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
        return text.slice(1, -1);
    }
    return text;
}

/**
 * 解析本项目约定的轻量 frontmatter：标量键值和一级字符串列表。
 * 不引入 YAML 依赖，因此嵌套对象、锚点等完整 YAML 特性不在支持范围内。
 */
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

/** 将有限的行内 Markdown 标记降级为纯文本，供固定排版 HTML 使用。 */
function stripMarkdown(text) {
    return String(text ?? '')
        .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '$1')
        .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .replace(/__([^_]+)__/g, '$1')
        .replace(/`([^`]+)`/g, '$1')
        .trim();
}

/** 解析标题开头可选的 [role:id] 显式模板覆盖标记。 */
function parseBinding(title) {
    const match = title.match(/^\[([A-Za-z][A-Za-z0-9_-]*):([A-Za-z0-9_-]+)\]\s*(.*)$/);
    if (!match) return { role: '', id: '', title: stripMarkdown(title) };
    return { role: match[1].toLowerCase(), id: match[2], title: stripMarkdown(match[3]) };
}

/** 仅接受 {{placeholder}} 与 {{placeholder lines=N}} 两种透明占位符。 */
function parsePlaceholder(text) {
    const match = String(text).trim().match(/^\{\{placeholder(?:\s+lines=(\d+))?\}\}$/);
    if (!match) return null;
    const lines = Number(match[1] || 1);
    if (!Number.isInteger(lines) || lines < 1) throw new Error('placeholder 的 lines 必须是正整数');
    return { kind: 'placeholder', lines };
}

/** 将一个列表项及其缩进续行解析为普通文本、透明占位符或行内图片项。 */
function parseItem(firstLine, continuationLines) {
    const allLines = [firstLine, ...continuationLines].map((line) => stripMarkdown(line));
    const image = allLines[0].match(/^\[image\]\s+(.+)$/i);
    if (image) return { kind: 'image', path: image[1].trim() };
    const firstPlaceholder = parsePlaceholder(allLines[0]);
    if (firstPlaceholder && allLines.length === 1) return firstPlaceholder;
    return { kind: 'item', lines: allLines };
}

/**
 * 解析正文的标题、列表、引用、跳过指令和占位符。
 * 结果保留标题出现顺序，供后续按模板 DOM 顺序绑定。
 */
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

    return { meta: data, headings };
}

/** 生成可安全嵌入 RegExp 的精确 HTML 属性匹配片段。 */
function attributePattern(name, value) {
    const escaped = String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return `\\b${name}="${escaped}"`;
}

/**
 * 在字符串模板中定位同时满足指定属性的完整 HTML 元素范围。
 * 使用同名标签深度计数，避免 card 内部嵌套 div 时提前截断。
 */
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

/** 替换精确模板元素的 innerHTML。 */
function replaceElementInner(html, attributes, content) {
    const range = findElementRange(html, attributes);
    if (!range) throw new Error(`模板中找不到元素：${JSON.stringify(attributes)}`);
    return html.slice(0, range.openEnd) + content + html.slice(range.closeStart);
}

/** 删除完整模板元素，用于空字段和 {{skip}}。 */
function removeElement(html, attributes) {
    const range = findElementRange(html, attributes);
    if (!range) throw new Error(`模板中找不到要删除的元素：${JSON.stringify(attributes)}`);
    return html.slice(0, range.openStart) + html.slice(range.closeEnd);
}

/** 按 DOM 顺序收集同一 data-md-role 的模板槽位。 */
function findSlots(html, role) {
    const regex = new RegExp(`<([a-z][a-z0-9]*)\\b(?=[^>]*${attributePattern('data-md-role', role)})(?=[^>]*\\bdata-md-id="([^"]+)")[^>]*>`, 'gi');
    return [...html.matchAll(regex)].map((match) => ({ role, id: match[2], tag: match[1] }));
}

/** 根据模板元素的 data-md-format 决定标题是否插入中文视觉间隔。 */
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

/** 渲染无文字、仅保留高度的透明占位节点。 */
function renderPlaceholder(lines) {
    return `<span class="md-placeholder" style="--placeholder-lines: ${lines};"></span>`;
}

/** 将普通多行项目或 /| 左右栏项目渲染为列表 HTML。 */
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

/** 过滤图片项后批量渲染列表内容；图片交给独立媒体槽位处理。 */
function renderItems(items) {
    return items.filter((item) => item.kind !== 'image').map(renderItem).join('\n');
}

/** 兼容正文内 [image] 写法；常规图片优先使用 frontmatter images 顺序列表。 */
function imageFromItems(items) {
    return items.find((item) => item.kind === 'image')?.path || '';
}

/** 按 scope + field 写入模板字段；空字段可按模板规则直接移除。 */
function bindField(html, scope, field, value, options = {}) {
    if (!value && options.removeWhenEmpty) return removeElement(html, { 'data-md-scope': scope, 'data-md-field': field });
    return replaceElementInner(html, { 'data-md-scope': scope, 'data-md-field': field }, options.raw ? value : escapeHtml(value));
}

/** 先尊重显式 ID，未指定 ID 时才取当前角色的下一个可用槽位。 */
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

// 模板的 data-bind 名称直接对应 frontmatter 键名，例如 data-bind="label.notice_tag"。
// 这样新增模板标签时无需在 JS 再添加硬编码映射表。
function applyMetadataBindings(html, meta) {
    const bindings = [...html.matchAll(/<([a-z][a-z0-9]*)\b(?=[^>]*\bdata-bind="([^"]+)")[^>]*>/gi)]
        .map((match) => match[2]);
    for (const binding of [...new Set(bindings)]) {
        if (!Object.prototype.hasOwnProperty.call(meta, binding)) continue;
        const value = meta[binding];
        if (Array.isArray(value)) continue;
        const range = findElementRange(html, { 'data-bind': binding });
        if (!range) continue;
        const opening = html.slice(range.openStart, range.openEnd);
        const removeWhenEmpty = /data-md-empty="remove"/.test(opening);
        html = value === '' && removeWhenEmpty
            ? html.slice(0, range.openStart) + html.slice(range.closeEnd)
            : html.slice(0, range.openEnd) + escapeHtml(value) + html.slice(range.closeStart);
    }
    return html;
}

/** 将模板中唯一的 data-theme-stylesheet 链接替换为 build.js 选定的主题。 */
function setThemeStylesheet(html, themeHref) {
    if (!themeHref) return html;
    return html.replace(/(<link\b[^>]*\bdata-theme-stylesheet\b[^>]*\bhref=")[^"]*(")/i, `$1${themeHref}$2`);
}

/** 解析“宽:高”最小比例；仅接受正数，避免把任意 CSS 注入模板。 */
function parseAspectRatio(value) {
    const match = String(value).trim().match(/^(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)$/);
    if (!match || Number(match[1]) <= 0 || Number(match[2]) <= 0) {
        throw new Error('min_aspect_ratio 必须是正数比例，例如 9:16');
    }
    return { width: Number(match[1]), height: Number(match[2]) };
}

/** 仅允许安全的 CSS 尺寸值写入模板变量，避免 frontmatter 注入任意样式。 */
function applyLayoutConfig(html, meta) {
    const layoutWidth = String(meta.layout_width || '1280px').trim();
    const layoutWidthMatch = layoutWidth.match(/^(\d+(?:\.\d+)?)px$/);
    if (!layoutWidthMatch || Number(layoutWidthMatch[1]) <= 0) {
        throw new Error('layout_width 必须是正数 px 尺寸，例如 1280px');
    }
    // 手动 canvas_min_height 有最高优先级；否则按最小比例计算，内容可继续自然增高。
    const computedMeta = { ...meta, layout_width: layoutWidth };
    if (!Object.prototype.hasOwnProperty.call(meta, 'canvas_min_height') && meta.min_aspect_ratio !== undefined) {
        const ratio = parseAspectRatio(meta.min_aspect_ratio);
        computedMeta.canvas_min_height = `${Math.ceil(Number(layoutWidthMatch[1]) * ratio.height / ratio.width)}px`;
    }
    const variables = {
        decor_block_height: '--decor-block-height',
        canvas_min_height: '--canvas-min-height',
        layout_width: '--canvas-layout-width',
    };
    for (const [metaKey, cssVariable] of Object.entries(variables)) {
        if (!Object.prototype.hasOwnProperty.call(computedMeta, metaKey)) continue;
        const value = String(computedMeta[metaKey]).trim();
        if (!/^\d+(?:\.\d+)?(?:px|vh|vw|rem|em|%)$/.test(value)) {
            throw new Error(`${metaKey} 必须是非负 CSS 尺寸，例如 100px 或 20vh`);
        }
        const variablePattern = new RegExp(`(${cssVariable.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:\\s*)[^;]+;`);
        html = html.replace(variablePattern, `$1${value};`);
    }
    return html;
}

/** 主标题也允许使用透明占位符，供后续手工加入艺术字。 */
function renderTitleValue(title) {
    const placeholder = parsePlaceholder(title);
    return placeholder ? { value: renderPlaceholder(placeholder.lines), raw: true } : { value: title, raw: false };
}

/** 写入等比图片，并给媒体容器添加 has-image 以切换自动高度样式。 */
function insertMedia(html, scope, image) {
    if (!image) return html;
    if (!fs.existsSync(image.sourcePath)) throw new Error(`图片文件不存在：${image.sourcePath}`);
    html = replaceElementInner(html, { 'data-md-scope': scope, 'data-md-field': 'media' }, `<img class="media-image" src="${escapeHtml(image.href)}" alt="">`);
    const mediaRange = findElementRange(html, { 'data-md-scope': scope, 'data-md-field': 'media' });
    return html.slice(0, mediaRange.openStart) + html.slice(mediaRange.openStart).replace(/^([^>]*class="[^"]*)"/, '$1 has-image"');
}

/**
 * 将解析后的 Markdown 内容绑定到一份模板副本。
 * options 由 build.js 提供已校验的模板、主题和图片资源，生成器不猜测目录。
 */
function renderDocument(document, options = {}) {
    const activeTemplatePath = options.templatePath || templatePath;
    let html = fs.readFileSync(activeTemplatePath, 'utf8');
    html = setThemeStylesheet(html, options.themeHref);
    html = applyLayoutConfig(html, document.meta);
    const roles = ['section', 'card'];
    const slots = Object.fromEntries(roles.map((role) => [role, findSlots(html, role)]));
    const used = new Set();
    const orderedImages = [...(options.images || [])];

    html = applyMetadataBindings(html, document.meta);
    const documentHeading = document.headings.find((heading) => heading.role === 'document' || (!heading.role && heading.level === 1));
    if (documentHeading) {
        const rendered = renderTitleValue(documentHeading.title);
        html = bindField(html, 'header', 'title', rendered.value, { raw: rendered.raw, removeWhenEmpty: !rendered.raw });
    } else {
        html = bindField(html, 'header', 'title', '', { removeWhenEmpty: true });
    }

    for (const heading of document.headings) {
        const role = heading.role || (heading.level <= 2 ? 'section' : 'card');
        if (role === 'document') continue;
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
        const inlineImage = imageFromItems(heading.items);
        const inlineSource = inlineImage
            ? { sourcePath: path.resolve(options.imagesRoot || path.dirname(activeTemplatePath), inlineImage), href: inlineImage.replace(/\\/g, '/') }
            : null;
        const nextImage = target.role === 'card' && !inlineSource ? orderedImages.shift() : null;
        html = insertMedia(html, target.id, inlineSource || nextImage);
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

    if (orderedImages.length > 0) throw new Error(`图片数量超过已绑定的卡片媒体槽位：剩余 ${orderedImages.length} 张`);

    if (!html.includes('*以上内容最终解释权归溯流电竞所有')) throw new Error('固定最终解释权区域缺失');
    if (/\[[^\]]*(占位|placeholder)[^\]]*\]/i.test(html) || /标题占位符|SUBTITLE PLACEHOLDER/.test(html)) throw new Error('生成结果残留可见占位文本');
    return html;
}

/**
 * 对外可调用的生成入口。
 * build.js 调用此函数；直接执行 generate.js 时仍保留兼容的命令行模式。
 */
function generate(options = {}) {
    const inputPath = path.resolve(options.inputPath || defaultInput);
    const outputPath = path.resolve(options.outputPath || defaultOutput);
    if (!fs.existsSync(inputPath)) throw new Error(`Markdown 文件不存在：${inputPath}`);
    const document = parseDocument(fs.readFileSync(inputPath, 'utf8'));
    const html = renderDocument(document, options);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, html, 'utf8');
    return outputPath;
}

// 直接执行时使用默认 Markdown；被 build.js require 时只导出函数，不自动生成文件。
if (require.main === module) {
    const outputPath = generate({
        inputPath: process.argv[2] || defaultInput,
        outputPath: process.argv[3] || defaultOutput,
    });
    console.log(`已生成：${outputPath}`);
}

module.exports = { generate, parseFrontmatter };
