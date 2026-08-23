/*
 * HTML 视觉导出模块。
 * 由 build.js 在 --export=true 时调用：使用 Playwright 打开生成后的本地 HTML，
 * 再在 Chromium 中执行 html-to-image 的 toPng / toSvg。
 */

const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { URL } = require('node:url');
const { chromium } = require('playwright');

function dataUrlToBuffer(dataUrl) {
    const match = String(dataUrl).match(/^data:([^,]*),(.*)$/s);
    if (!match) throw new Error('html-to-image 返回了无效的数据 URL');
    const [, metadata, payload] = match;
    return metadata.includes(';base64')
        ? Buffer.from(payload, 'base64')
        : Buffer.from(decodeURIComponent(payload), 'utf8');
}

/**
 * html-to-image 在 file:// 页面中读取字体和图片容易触发浏览器安全限制。
 * 导出期间临时创建一个仅服务项目根目录的本地 HTTP 服务，使所有资源同源。
 */
function createStaticServer(rootDirectory) {
    const mimeTypes = {
        '.css': 'text/css; charset=utf-8',
        '.html': 'text/html; charset=utf-8',
        '.js': 'text/javascript; charset=utf-8',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.svg': 'image/svg+xml',
        '.woff2': 'font/woff2',
    };
    const server = http.createServer((request, response) => {
        const requestPath = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
        const filePath = path.resolve(rootDirectory, `.${requestPath}`);
        if (!filePath.startsWith(`${rootDirectory}${path.sep}`)) {
            response.writeHead(403).end();
            return;
        }
        fs.readFile(filePath, (error, data) => {
            if (error) {
                response.writeHead(error.code === 'ENOENT' ? 404 : 500).end();
                return;
            }
            response.writeHead(200, { 'Content-Type': mimeTypes[path.extname(filePath).toLowerCase()] || 'application/octet-stream' });
            response.end(data);
        });
    });
    return new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () => resolve({
            server,
            port: server.address().port,
        }));
    });
}

async function launchBrowser() {
    try {
        return await chromium.launch({ headless: true });
    } catch (chromiumError) {
        // Playwright Chromium 未下载时，尝试使用 Windows 上已安装的 Edge。
        try {
            return await chromium.launch({ channel: 'msedge', headless: true });
        } catch {
            throw new Error(`无法启动 Chromium。请执行：npx playwright install chromium\n原始错误：${chromiumError.message}`);
        }
    }
}

/**
 * 从已生成的 HTML 输出同名 PNG 与 SVG。
 * SVG 是 html-to-image 序列化 DOM 所产生的 SVG，不保证是 Illustrator 原生可编辑矢量。
 */
async function exportImageAssets({ htmlPath, rootSelector = '.canvas-container' }) {
    const projectRoot = path.resolve(__dirname, '..');
    const { server, port } = await createStaticServer(projectRoot);
    let browser;
    try {
        browser = await launchBrowser();
        const page = await browser.newPage({ viewport: { width: 4096, height: 1200 }, deviceScaleFactor: 1 });
        const htmlHref = `http://127.0.0.1:${port}/${path.relative(projectRoot, htmlPath).replace(/\\/g, '/')}`;
        await page.goto(htmlHref, { waitUntil: 'networkidle' });
        await page.evaluate(async () => document.fonts?.ready);
        await page.addScriptTag({ path: path.join(__dirname, '..', 'node_modules', 'html-to-image', 'dist', 'html-to-image.js') });

        const result = await page.evaluate(async (selector) => {
            const node = document.querySelector(selector);
            if (!node) throw new Error(`找不到导出节点：${selector}`);
            const options = {
                cacheBust: true,
                pixelRatio: 1,
                width: node.scrollWidth,
                height: node.scrollHeight,
            };
            return {
                png: await window.htmlToImage.toPng(node, options),
                svg: await window.htmlToImage.toSvg(node, options),
            };
        }, rootSelector);

        const basePath = htmlPath.replace(/\.html$/i, '');
        const pngPath = `${basePath}.png`;
        const svgPath = `${basePath}.svg`;
        fs.writeFileSync(pngPath, dataUrlToBuffer(result.png));
        fs.writeFileSync(svgPath, dataUrlToBuffer(result.svg));
        return { pngPath, svgPath };
    } finally {
        if (browser) await browser.close();
        await new Promise((resolve) => server.close(resolve));
    }
}

module.exports = { exportImageAssets };
