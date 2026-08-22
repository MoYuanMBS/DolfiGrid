#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const templatePath = path.join(projectRoot, '标准格式', 'susu_tactical_ui_template.html');
const defaultInput = path.join(projectRoot, 'doc', '体验护航.md');
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
    const result = { notice: [] };
    if (lines[0]?.trim() !== '---') return { data: result, body: lines };
    const end = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
    if (end < 0) return { data: result, body: lines };

    let activeList = null;
    for (const line of lines.slice(1, end)) {
        const keyValue = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
        if (keyValue) {
            const [, key, raw] = keyValue;
            if (raw.trim() === '') {
                result[key] = [];
                activeList = key;
            } else {
                result[key] = unquote(raw);
                activeList = null;
            }
            continue;
        }
        const listItem = line.match(/^\s*-\s+(.*)$/);
        if (listItem && activeList) result[activeList].push(unquote(listItem[1]));
    }
    return { data: result, body: lines.slice(end + 1) };
}

function stripMarkdown(text) {
    return String(text ?? '')
        .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .replace(/__([^_]+)__/g, '$1')
        .replace(/`([^`]+)`/g, '$1')
        .trim();
}

function parseDocument(text) {
    const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
    const { data, body } = parseFrontmatter(lines);
    const sections = [];
    let current = null;
    for (const line of body) {
        const heading = line.match(/^##\s+([^\s]+)\s+(.+?)\s*$/);
        if (heading) {
            current = { code: heading[1], title: stripMarkdown(heading[2]), items: [] };
            sections.push(current);
            continue;
        }
        const item = line.match(/^\s*-\s+(.+?)\s*$/);
        if (item && current) current.items.push(stripMarkdown(item[1]));
        const quote = line.match(/^\s*>\s*(.+?)\s*$/);
        if (quote && current) current.note = stripMarkdown(quote[1]);
    }
    return { meta: data, sections };
}

function sectionByCode(document, code) {
    return document.sections.find((section) => section.code.toUpperCase() === code) || { title: '', items: [] };
}

function spacedChineseTitle(value) {
    const text = String(value ?? '').trim().replace(/\s+/g, '');
    if (!text) return '';
    return [...text].map((char) => /[\u3400-\u9fff]/.test(char) ? `${char} ` : char).join('').trim();
}

function setInnerByBind(html, bind, value) {
    const escaped = escapeHtml(value);
    const pattern = new RegExp(`(<([a-z0-9]+)[^>]*data-bind="${bind.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*>)[\\s\\S]*?(</\\2>)`, 'i');
    return html.replace(pattern, (_whole, opening, _tag, closing) => `${opening}${escaped}${closing}`);
}

function removeEmptyBindElement(html, bind) {
    const escapedBind = bind.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`<([a-z0-9]+)([^>]*data-bind="${escapedBind}"[^>]*)>[\\s\\S]*?</\\1>`, 'i');
    return html.replace(pattern, '');
}

function replaceList(html, bind, items) {
    const escapedBind = bind.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`(<ul[^>]*data-bind-list="${escapedBind}"[^>]*>)[\\s\\S]*?(</ul>)`, 'i');
    const body = items.map((item) => `<li class="list-item"><span class="bullet"></span><span class="item-content">${escapeHtml(item)}</span></li>`).join('\n');
    return html.replace(pattern, (_whole, opening, closing) => `${opening}\n${body}\n${closing}`);
}

function applyExistingMedia(html, templateDirectory) {
    const pattern = /<div class="card-media-placeholder"([^>]*data-media-file="([^"]+)"[^>]*)>[\s\S]*?<\/div>/gi;
    return html.replace(pattern, (whole, attributes, fileName) => {
        const sourcePath = path.resolve(templateDirectory, fileName);
        if (!fs.existsSync(sourcePath)) return whole;
        const src = fileName.replace(/\\/g, '/');
        return `<div class="card-media-placeholder has-image"${attributes}><img class="media-image" src="${escapeHtml(src)}" alt=""></div>`;
    });
}

function render(document) {
    let html = fs.readFileSync(templatePath, 'utf8');
    const d1 = sectionByCode(document, 'D1');
    const d2 = sectionByCode(document, 'D2');
    const d3 = sectionByCode(document, 'D3');

    html = setInnerByBind(html, 'header.title', document.meta.title || '');
    html = setInnerByBind(html, 'header.subtitle', document.meta.subtitle || '');
    if (!document.meta.title) html = removeEmptyBindElement(html, 'header.title');
    if (!document.meta.subtitle) html = removeEmptyBindElement(html, 'header.subtitle');

    html = setInnerByBind(html, 'sections.exp.title_cn', spacedChineseTitle(d1.title.replace(/套餐/g, '')));
    html = setInnerByBind(html, 'escort.guarantee.title', spacedChineseTitle(d2.title.replace(/^护航/, '')));
    html = setInnerByBind(html, 'escort.match.title', spacedChineseTitle(d3.title.replace(/带出物资/g, '')));
    html = setInnerByBind(html, 'copyright.text', document.meta.copyright || '');
    if (!document.meta.copyright) html = removeEmptyBindElement(html, 'copyright.text');

    html = replaceList(html, 'exp.card1.items', d1.items.slice(0, 1));
    html = replaceList(html, 'exp.card2.items', d1.items.slice(1, 2));
    html = replaceList(html, 'escort.guarantee.items', d2.items);
    html = replaceList(html, 'escort.match.items', d3.items);
    html = replaceList(html, 'notice.items', document.meta.notice || []);
    return applyExistingMedia(html, path.dirname(templatePath));
}

const inputPath = path.resolve(projectRoot, process.argv[2] || defaultInput);
const outputPath = path.resolve(projectRoot, process.argv[3] || defaultOutput);
if (!fs.existsSync(inputPath)) throw new Error(`Markdown 文件不存在：${inputPath}`);
const document = parseDocument(fs.readFileSync(inputPath, 'utf8'));
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, render(document), 'utf8');
console.log(`已生成：${outputPath}`);
