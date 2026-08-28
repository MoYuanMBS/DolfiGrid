/*
 * HTML 视觉导出模块。
 * 由 build.js 在 --export=true 时调用：使用 Playwright 对固定画布元素截图，
 * 只输出高分辨率 PNG 母版及其整数倍率派生图，不再输出 SVG。
 */

const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { URL } = require('node:url');
const { chromium } = require('playwright');
const sharp = require('sharp');

/**
 * 导出期间临时创建一个仅服务项目根目录的本地 HTTP 服务，确保字体、CSS 和图片同源加载。
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
 * 从已生成的 HTML 输出 @Nx PNG 母版，并从母版做整数倍率缩小派生。
 * Playwright 的 deviceScaleFactor 会让浏览器重新栅格化 CSS 和文字，禁止使用 CSS transform 缩放。
 */
async function exportImageAssets({ htmlPath, rootSelector = '.canvas', layoutWidth = 1280, canvasHeight, exportScale = 4, deriveScales = [], specVersion = 'legacy-v1' }) {
    const projectRoot = path.resolve(__dirname, '..');
    const { server, port } = await createStaticServer(projectRoot);
    let browser;
    try {
        browser = await launchBrowser();
        const htmlHref = `http://127.0.0.1:${port}/${path.relative(projectRoot, htmlPath).replace(/\\/g, '/')}`;
        const basePath = htmlPath.replace(/\.html$/i, '');
        const masterPath = `${basePath}@${exportScale}x.png`;
        const context = await browser.newContext({
            viewport: { width: Math.ceil(layoutWidth) + 120, height: 900 },
            deviceScaleFactor: exportScale,
        });
        const page = await context.newPage();
        try {
            await page.goto(htmlHref, { waitUntil: 'networkidle' });
            await page.evaluate(async () => document.fonts?.ready);
            const canvas = page.locator(rootSelector);
            if (await canvas.count() !== 1) throw new Error(`导出节点必须唯一：${rootSelector}`);
            if (specVersion === 'fixed-canvas-v2') {
                const result = await canvas.evaluate((node, expected) => {
                    const rect = node.getBoundingClientRect();
                    const frame = (element) => {
                        const style = getComputedStyle(element);
                        const borders = ['Top', 'Right', 'Bottom', 'Left'].some((side) => parseFloat(style[`border${side}Width`]) > 0);
                        return borders || (style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0);
                    };
                    const logo = node.querySelector('[data-brand-logo]');
                    const logoHasFrame = logo && (() => {
                        for (let element = logo; element && element !== node; element = element.parentElement) if (frame(element)) return true;
                        return false;
                    })();
                    const mediaHasFrame = [...node.querySelectorAll('[data-md-field="media"]')].some((slot) => frame(slot) || Boolean(slot.querySelector('img')) && frame(slot.querySelector('img')));
                    return {
                        width: rect.width,
                        height: rect.height,
                        overflow: node.scrollWidth > node.clientWidth || node.scrollHeight > node.clientHeight,
                        logoHasFrame,
                        mediaHasFrame,
                    };
                }, { width: layoutWidth, height: canvasHeight });
                if (Math.abs(result.width - layoutWidth) > 0.01 || Math.abs(result.height - canvasHeight) > 0.01) {
                    throw new Error(`fixed-canvas-v2 画布尺寸不符：实际 ${result.width}×${result.height}px，应为 ${layoutWidth}×${canvasHeight}px`);
                }
                if (result.overflow) throw new Error('fixed-canvas-v2 内容溢出画布');
                if (result.logoHasFrame) throw new Error('fixed-canvas-v2 Logo 或其容器存在边框/描边');
                if (result.mediaHasFrame) throw new Error('fixed-canvas-v2 业务图片或媒体槽位存在边框/描边');
            }
            await canvas.screenshot({ path: masterPath });
        } finally {
            await context.close();
        }

        const derivedPaths = [];
        for (const scale of [...new Set(deriveScales)]) {
            const derivedPath = `${basePath}@${scale}x.png`;
            await sharp(masterPath)
                .resize({ width: Math.round(layoutWidth * scale), withoutEnlargement: true })
                .png()
                .toFile(derivedPath);
            derivedPaths.push(derivedPath);
        }
        return { masterPath, derivedPaths };
    } finally {
        if (browser) await browser.close();
        await new Promise((resolve) => server.close(resolve));
    }
}

module.exports = { exportImageAssets };
