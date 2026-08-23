#!/usr/bin/env node

/*
 * 固定排版构建入口。
 * 用法：node .\new-project\build.js 体验护航.md
 *
 * Markdown 必须位于 original-md-files\；模板、主题和图片均由 frontmatter 决定。
 */

const fs = require('node:fs');
const path = require('node:path');
const { generate, parseFrontmatter } = require('./generate.js');
const { exportImageAssets } = require('./export-images.js');

// 项目路径只在这里集中定义；Markdown 中不允许传入任意磁盘路径。
const projectRoot = path.resolve(__dirname, '..');
const sourceDirectory = path.join(projectRoot, 'original-md-files');
const templateDirectory = path.join(projectRoot, '标准格式');
const themeDirectory = path.join(projectRoot, 'css', 'themes');
const imageDirectory = path.join(projectRoot, 'assets', 'insert-png');
const outputDirectory = path.join(projectRoot, 'output');

/** 统一构建错误前缀，方便用户从终端日志中定位配置问题。 */
function fail(message) {
    throw new Error(`构建失败：${message}`);
}

/**
 * 只接受目录内文件名，阻止 ../ 或绝对路径越过项目约定目录。
 * requiredExtension 传入时同时校验文件扩展名。
 */
function assertSimpleFileName(fileName, requiredExtension) {
    if (!fileName || path.basename(fileName) !== fileName) fail(`只允许文件名，不允许路径：${fileName}`);
    if (requiredExtension && path.extname(fileName).toLowerCase() !== requiredExtension) fail(`文件必须是 ${requiredExtension}：${fileName}`);
}

/** 将磁盘绝对路径转换为输出 HTML 可使用的相对 URL。 */
function relativeHref(fromDirectory, targetPath) {
    return path.relative(fromDirectory, targetPath).replace(/\\/g, '/');
}

/** 解析只允许使用 px 的画布宽度；排版尺寸不能随导出环境而产生歧义。 */
function parsePixelWidth(value, fieldName, fallback) {
    const resolvedValue = value === undefined || value === '' ? fallback : String(value).trim();
    const match = resolvedValue.match(/^(\d+(?:\.\d+)?)px$/);
    if (!match || Number(match[1]) <= 0) fail(`${fieldName} 必须是正数 px 尺寸，例如 4096px`);
    return Number(match[1]);
}

/** 解析正数数值配置。 */
function parsePositiveNumber(value, fieldName) {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) fail(`${fieldName} 必须是正数`);
    return number;
}

/**
 * 逻辑宽度与导出倍率彻底解耦：模板按固定 CSS 像素排版，PNG 按整数倍率截图。
 * 1280px × 4 产出 5120px 母版，避免非整数缩放造成文字发虚。
 */
function resolveExportConfig(meta) {
    const layoutWidth = parsePixelWidth(meta.layout_width, 'layout_width', '1280px');
    const exportScale = parsePositiveNumber(meta.export_scale ?? 4, 'export_scale');
    if (!Number.isInteger(exportScale)) fail('export_scale 必须是正整数，例如 4');
    const outputWidth = layoutWidth * exportScale;
    if (outputWidth <= 4096 || outputWidth > 32768) {
        fail('layout_width × export_scale 必须大于 4096 且不超过 32768 像素');
    }
    const entries = meta.export_derive === undefined ? [] : Array.isArray(meta.export_derive) ? meta.export_derive : [meta.export_derive];
    const deriveScales = entries.map((value) => {
        const scale = parsePositiveNumber(value, 'export_derive');
        if (!Number.isInteger(scale) || scale >= exportScale) fail('export_derive 中的倍率必须是小于 export_scale 的正整数');
        return scale;
    });
    return { layoutWidth, exportScale, deriveScales };
}

// 命令行仅接收一个 Markdown 文件名，例如：node build.js 体验护航.md。
const inputName = process.argv[2];
const exportArgument = process.argv.slice(3).find((argument) => argument.startsWith('--export='));
const exportEnabled = exportArgument ? exportArgument === '--export=true' : false;
if (exportArgument && !['--export=true', '--export=false'].includes(exportArgument)) {
    fail('export 参数只能是 --export=true 或 --export=false');
}
if (!inputName) fail('请提供 original-md-files 中的 Markdown 文件名，例如：体验护航.md');
assertSimpleFileName(inputName, '.md');

const inputPath = path.join(sourceDirectory, inputName);
if (!fs.existsSync(inputPath)) fail(`找不到 Markdown 文件：${inputName}`);

// build.js 只读取 frontmatter 配置；正文解析和 HTML 填充全部交给 generate.js。
const sourceText = fs.readFileSync(inputPath, 'utf8');
const { data: meta } = parseFrontmatter(sourceText.replace(/^\uFEFF/, '').split(/\r?\n/));
const templateName = String(meta.template || '').trim();
const themeName = String(meta.theme || '').trim();
if (!/^[A-Za-z0-9_-]+$/.test(templateName)) fail('frontmatter 必须提供合法的 template 名称');
if (!/^[A-Za-z0-9_-]+$/.test(themeName)) fail('frontmatter 必须提供合法的 theme 名称');

const templatePath = path.join(templateDirectory, `${templateName}.html`);
const themePath = path.join(themeDirectory, `${themeName}.css`);
if (!fs.existsSync(templatePath)) fail(`模板不存在：${templateName}.html`);
if (!fs.existsSync(themePath)) fail(`主题不存在：${themeName}.css`);
const exportConfig = resolveExportConfig(meta);

const outputPath = path.join(outputDirectory, `${path.basename(inputName, '.md')}.html`);
// images 按列表顺序交给 generate.js，并绑定到未跳过的媒体槽位。
const images = Array.isArray(meta.images) ? meta.images.map((entry) => {
    const imageName = String(entry).trim();
    assertSimpleFileName(imageName);
    const sourcePath = path.join(imageDirectory, imageName);
    if (!fs.existsSync(sourcePath)) fail(`图片不存在：assets/insert-png/${imageName}`);
    return {
        sourcePath,
        href: relativeHref(path.dirname(outputPath), sourcePath),
    };
}) : [];

// 将已经验证过的路径和资源交给通用生成器，避免生成器自行猜测模板或主题。
const generatedPath = generate({
    inputPath,
    outputPath,
    templatePath,
    themeHref: relativeHref(path.dirname(outputPath), themePath),
    images,
    imagesRoot: imageDirectory,
});

if (!exportEnabled) {
    console.log(`已生成：${generatedPath}`);
} else {
    exportImageAssets({ htmlPath: generatedPath, ...exportConfig })
        .then(({ masterPath, derivedPaths }) => {
            console.log(`已生成：${generatedPath}`);
            console.log(`已导出 PNG 母版：${masterPath}`);
            for (const derivedPath of derivedPaths) console.log(`已导出 PNG 派生图：${derivedPath}`);
        })
        .catch((error) => {
            console.error(`导出失败：${error.message}`);
            process.exitCode = 1;
        });
}
