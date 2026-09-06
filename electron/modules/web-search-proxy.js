"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.startWebSearchProxy = startWebSearchProxy;
/**
 * Tiffa 内置 Web 搜索代理（SearXNG 兼容接口）
 * ------------------------------------------------------------
 * 内核 web_search 工具默认链全是国外引擎（google / duckduckgo / startpage …），
 * 国内直连必挂。这里在主进程起一个本地 HTTP 服务，模拟 SearXNG 的 JSON API：
 *   GET /config          -> 返回可用引擎（供内核 resolveEngineNames 解析）
 *   GET /search?q=...     -> 按链抓取国内引擎并解析，返回 SearXNG 格式
 *
 * 引擎链：必应中国(cn.bing.com) → 360搜索(www.so.com)，前者失败/空结果自动切下一个。
 *   - 360 结果块真实 URL 在 <a data-mdurl>（href 是 so.com 跳转链），解析时优先取 data-mdurl。
 * 地址通过 SEARXNG_ENDPOINT 环境变量注入，内核 Bun 子进程自动继承，用户零配置。
 * 免费、纯国内、不连任何国外服务 —— 分发版下载即用。
 */
const node_http_1 = __importDefault(require("node:http"));
const node_https_1 = __importDefault(require("node:https"));
const node_url_1 = require("node:url");
const PORT = 18880;
const FETCH_TIMEOUT_MS = 15000;
function decodeEntities(s) {
    return s
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&#x27;/g, "'")
        .replace(/&apos;/g, "'")
        .replace(/&nbsp;/g, " ")
        .replace(/&#0183;/g, "·")
        .replace(/&ensp;/g, " ")
        .replace(/&#8201;/g, " ");
}
function stripHtml(s) {
    return s.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}
function fetchHtml(url, baseUrl) {
    return new Promise((resolve, reject) => {
        const doGet = (target, follow) => {
            node_https_1.default
                .get(target, {
                headers: {
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
                    "Accept-Language": "zh-CN,zh;q=0.9",
                    Accept: "text/html,application/xhtml+xml",
                },
            }, (res) => {
                if (follow &&
                    res.statusCode &&
                    res.statusCode >= 300 &&
                    res.statusCode < 400 &&
                    res.headers.location) {
                    const next = new node_url_1.URL(res.headers.location, baseUrl);
                    doGet(next.toString(), false);
                    return;
                }
                const chunks = [];
                res.on("data", (c) => chunks.push(c));
                res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
            })
                .on("error", reject);
        };
        doGet(url, true);
        const timer = setTimeout(() => reject(new Error("fetch timeout")), FETCH_TIMEOUT_MS);
        // 让 timer 不阻止进程退出
        if (typeof timer.unref === "function")
            timer.unref();
    });
}
function parseBing(html, max) {
    const blocks = html.match(/<li class="b_algo"[\s\S]*?<\/li>/g) || [];
    const results = [];
    for (const b of blocks) {
        const h = b.match(/<h2[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
        if (!h)
            continue;
        const url = decodeEntities(h[1]);
        const title = stripHtml(decodeEntities(h[2]));
        const cap = b.match(/<div class="b_caption">[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/);
        const snipRaw = cap
            ? cap[1]
            : (b.match(/<p[^>]*>([\s\S]*?)<\/p>/) || [])[1] || "";
        const content = stripHtml(decodeEntities(snipRaw));
        if (url && title)
            results.push({ title, url, content, engine: "bing" });
        if (results.length >= max)
            break;
    }
    return results;
}
function parseSo360(html, max) {
    const blocks = html.match(/<li class="res-list[\s\S]*?<\/li>/g) || [];
    const results = [];
    for (const b of blocks) {
        const a = b.match(/<h3[^>]*>\s*<a([^>]*)>([\s\S]*?)<\/a>/);
        if (!a)
            continue;
        const attrs = a[1];
        const href = (attrs.match(/href="([^"]+)"/) || [])[1] || "";
        // 真实 URL 在 data-mdurl；href 只是 so.com 跳转链
        const mdurl = (attrs.match(/data-mdurl="([^"]*)"/) || [])[1] || "";
        const url = decodeEntities(mdurl || href);
        if (!url || !/^https?:\/\//.test(url))
            continue;
        const title = stripHtml(decodeEntities(a[2]));
        const desc = b.match(/<p class="res-desc[^>]*>([\s\S]*?)<\/p>/);
        const content = stripHtml(decodeEntities(desc ? desc[1] : ""));
        if (url && title)
            results.push({ title, url, content, engine: "so360" });
        if (results.length >= max)
            break;
    }
    return results;
}
const ENGINES = [
    {
        name: "bing",
        buildUrl: (q) => `https://cn.bing.com/search?q=${encodeURIComponent(q)}&setlang=zh-CN&count=10&ensearch=0`,
        baseUrl: "https://cn.bing.com/search",
        parse: parseBing,
    },
    {
        name: "so360",
        buildUrl: (q) => `https://www.so.com/s?q=${encodeURIComponent(q)}&pn=1`,
        baseUrl: "https://www.so.com/s",
        parse: parseSo360,
    },
];
/** 按引擎链依次抓取，首个拿到结果的引擎胜出；全失败抛出汇总错误。 */
async function searchChain(q, max) {
    const errors = [];
    for (const eng of ENGINES) {
        try {
            const html = await fetchHtml(eng.buildUrl(q), eng.baseUrl);
            const results = eng.parse(html, max);
            if (results.length > 0)
                return results;
            errors.push(`${eng.name}: no results parsed`);
        }
        catch (e) {
            errors.push(`${eng.name}: ${String(e)}`);
        }
    }
    throw new Error(errors.join("; "));
}
function sendJson(res, status, obj) {
    const body = JSON.stringify(obj);
    res.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
    });
    res.end(body);
}
function startWebSearchProxy() {
    return new Promise((resolve, reject) => {
        const server = node_http_1.default.createServer((req, res) => {
            try {
                const u = new node_url_1.URL(req.url || "/", "http://127.0.0.1/");
                if (u.pathname === "/config") {
                    sendJson(res, 200, {
                        engines: ENGINES.map((e) => ({ name: e.name, shortcut: e.name.slice(0, 2) })),
                        version: "tiffa-builtin",
                    });
                    return;
                }
                if (u.pathname === "/search") {
                    const q = u.searchParams.get("q") || "";
                    if (!q) {
                        sendJson(res, 400, { error: "missing q" });
                        return;
                    }
                    searchChain(q, 10)
                        .then((results) => {
                        sendJson(res, 200, {
                            query: q,
                            number_of_results: results.length,
                            results,
                            answers: [],
                            suggestions: [],
                            unresponsive_engines: results.length ? [] : [["chain", "no results parsed"]],
                        });
                    })
                        .catch((err) => {
                        sendJson(res, 503, {
                            query: q,
                            results: [],
                            answers: [],
                            suggestions: [],
                            unresponsive_engines: [["chain", String(err)]],
                        });
                    });
                    return;
                }
                sendJson(res, 404, { error: "not found" });
            }
            catch (e) {
                sendJson(res, 500, { error: String(e) });
            }
        });
        let actualPort = PORT;
        server.on("error", (e) => {
            if (e.code === "EADDRINUSE" && actualPort < PORT + 20) {
                actualPort++;
                server.listen(actualPort, "127.0.0.1");
            }
            else {
                reject(e);
            }
        });
        server.listen(PORT, "127.0.0.1", () => {
            resolve(actualPort);
        });
    });
}
//# sourceMappingURL=web-search-proxy.js.map