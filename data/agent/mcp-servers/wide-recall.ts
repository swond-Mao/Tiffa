/**
 * wide-recall — 跨项目记忆扩圈检索(MCP stdio 服务 + CLI 双入口)
 *
 * 背景:内核 Mnemopi 在 per-project-tagged 下 recall 只搜 [本项目 bank, 全局库],
 * 其他项目的 bank 永远不可达。本工具枚举全部 bank(全局 + banks/*),
 * 逐库调用内核 pi-mnemopi 的 Mnemopi.search(),与原生 recall 同款嵌入/打分。
 *
 * 运行:
 *   bun wide-recall.ts                          → MCP stdio 服务(newline-delimited JSON-RPC)
 *   bun wide-recall.ts --query 词 --json        → CLI 直测
 *
 * 关键约束:
 * - 路径从 PI_CODING_AGENT_DIR 环境变量解析(与内核一致),禁止硬编码盘符
 * - 打开 bank 必须传 reconcile:false —— 否则构造函数在嵌入模型不匹配时会
 *   wipe-and-rebuild 该库向量(内核源码明确:只读消费者必须关闭)
 * - 嵌入模型有进程级单例缓存(pi-mnemopi embeddings.ts),多库只加载一次
 */
import * as fs from "node:fs"
import * as path from "node:path"

interface BankRef {
	bank: string
	dbPath: string
	label: string
}

interface RecallItem {
	readonly content?: unknown
	readonly score?: unknown
	readonly timestamp?: unknown
	readonly source?: unknown
	readonly id?: unknown
}

interface MnemopiInstance {
	search(query: string, topK?: number): Promise<RecallItem[]>
}

type MnemopiCtor = new (options: Record<string, unknown>) => MnemopiInstance

interface WideHit {
	content: string
	score: number
	timestamp: string
	source: string
	id: string
	bank: string
	project: string
}

// ── 路径解析:PI_CODING_AGENT_DIR 与内核同源(start-tiffa.bat 设置),
//    兜底用 PORTABLE_ROOT 拼,都没有则报错退出 ──
function resolveAgentDir(): string {
	const fromEnv = process.env.PI_CODING_AGENT_DIR
	if (fromEnv && fromEnv.trim()) return path.resolve(fromEnv.trim())
	const root = process.env.PORTABLE_ROOT
	if (root && root.trim()) return path.join(root.trim(), "data", "agent")
	console.error("[wide-recall] 需要 PI_CODING_AGENT_DIR 或 PORTABLE_ROOT 环境变量")
	process.exit(1)
}

const AGENT_DIR = resolveAgentDir()
const ROOT = path.resolve(AGENT_DIR, "..", "..")
const MNEMOPI_DIR = path.join(AGENT_DIR, "memories", "mnemopi")
const GLOBAL_DB = path.join(MNEMOPI_DIR, "mnemopi.db")
const BANKS_DIR = path.join(MNEMOPI_DIR, "banks")
const LOG_FILE = path.join(ROOT, "data", "log", "wide-recall.log")

// fastembed 的模型缓存按 local_cache 相对 cwd 解析,必须切到便携根目录
try {
	process.chdir(ROOT)
} catch {}
process.env.HOME = process.env.HOME || path.join(ROOT, "home")

function log(msg: string): void {
	try {
		fs.appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${msg}\n`, "utf8")
	} catch {
		// 日志失败不影响检索
	}
}

const DEFAULT_EMBEDDING_MODEL = "BAAI/bge-small-zh-v1.5"

function readEmbeddingModel(): string {
	try {
		const yml = fs.readFileSync(path.join(AGENT_DIR, "config.yml"), "utf8")
		const m = yml.match(/embeddingModel:\s*["']?([^"'\n]+?)["']?\s*$/m)
		return m ? m[1].trim() : DEFAULT_EMBEDDING_MODEL
	} catch {
		return DEFAULT_EMBEDDING_MODEL
	}
}

function listBanks(): BankRef[] {
	const out: BankRef[] = [{ bank: "default", dbPath: GLOBAL_DB, label: "全局库" }]
	try {
		for (const name of fs.readdirSync(BANKS_DIR)) {
			const dbPath = path.join(BANKS_DIR, name, "mnemopi.db")
			if (fs.existsSync(dbPath)) out.push({ bank: name, dbPath, label: name })
		}
	} catch {
		// banks 目录缺失时只搜全局库
	}
	return out
}

// 动态 import 说明:pi-mnemopi 包位于便携根目录下的 npm-global,
// 绝对路径只有运行时才知道(盘符不固定),静态导入无法表达。
let cachedCtor: MnemopiCtor | null = null
async function loadMnemopiCtor(): Promise<MnemopiCtor> {
	if (cachedCtor) return cachedCtor
	const entry = path.join(ROOT, "npm-global", "node_modules", "@oh-my-pi", "pi-mnemopi", "src", "index.ts")
	const mod: unknown = await import(entry)
	let ctor: unknown
	if (mod && typeof mod === "object" && "Mnemopi" in mod) {
		ctor = (mod as Record<string, unknown>).Mnemopi
	}
	if (typeof ctor !== "function") {
		throw new Error(`pi-mnemopi 导入失败: ${entry}`)
	}
	cachedCtor = ctor as MnemopiCtor
	return cachedCtor
}

const instanceCache = new Map<string, Promise<MnemopiInstance>>()

async function getInstance(ref: BankRef): Promise<MnemopiInstance> {
	const hit = instanceCache.get(ref.bank)
	if (hit) return hit
	const creating = (async () => {
		const Ctor = await loadMnemopiCtor()
		return new Ctor({
			dbPath: ref.dbPath,
			bank: ref.bank,
			sessionId: ref.bank,
			authorId: "wide-recall",
			authorType: "agent",
			channelId: ref.bank,
			noEmbeddings: false,
			embeddingModel: readEmbeddingModel(),
			llm: false,
			reconcile: false, // 只读!防止打开时触发向量 wipe-and-rebuild
			debug: false,
		})
	})()
	instanceCache.set(ref.bank, creating)
	return creating
}

function toHit(r: RecallItem, ref: BankRef): WideHit {
	return {
		content: typeof r.content === "string" ? r.content.slice(0, 500) : "",
		score: typeof r.score === "number" ? r.score : 0,
		timestamp: typeof r.timestamp === "string" ? r.timestamp : "",
		source: typeof r.source === "string" ? r.source : "",
		id: typeof r.id === "string" ? r.id : "",
		bank: ref.bank,
		project: ref.label,
	}
}

export async function wideRecall(query: string, topKPerBank = 8, limit = 12): Promise<WideHit[]> {
	const q = query.trim()
	if (!q) return []
	const banks = listBanks()
	const t0 = Date.now()
	const jobs = banks.map(async (ref): Promise<WideHit[]> => {
		try {
			const inst = await getInstance(ref)
			const rows = await inst.search(q, topKPerBank)
			return Array.isArray(rows) ? rows.map((r) => toHit(r, ref)) : []
		} catch (e) {
			log(`bank ${ref.bank} search failed: ${e instanceof Error ? e.message : String(e)}`)
			return []
		}
	})
	const settled = await Promise.allSettled(jobs)
	const merged = settled.flatMap((s) => (s.status === "fulfilled" ? s.value : []))
	merged.sort((a, b) => b.score - a.score)
	log(`query="${q}" banks=${banks.length} hits=${merged.length} in ${Date.now() - t0}ms`)
	return merged.slice(0, limit)
}

// ── CLI 入口:bun wide-recall.ts --query X [--top-k N] [--limit N] ──
function argValue(flag: string): string | undefined {
	const i = process.argv.indexOf(flag)
	return i >= 0 ? process.argv[i + 1] : undefined
}

// ── MCP stdio(newline-delimited JSON-RPC 2.0)──
const SERVER_INFO = { name: "memory-wide", version: "1.0.0" }

const TOOLS_DECL = [
	{
		name: "wide_recall",
		description:
			"跨项目语义记忆检索。当原生 recall 结果为空或目标记忆可能属于其他项目时使用。" +
			"搜索全部项目记忆库 + 全局库,与 recall 同款语义打分,结果带来源项目标注。",
		inputSchema: {
			type: "object",
			properties: {
				query: { type: "string", description: "自然语言检索词" },
				top_k: { type: "integer", description: "每个库取前 N 条,默认 8" },
				limit: { type: "integer", description: "合并后最多返回 N 条,默认 12" },
			},
			required: ["query"],
		},
	},
]

interface RpcMessage {
	id?: unknown
	method?: unknown
	params?: Record<string, unknown>
}

function parseRpc(line: string): RpcMessage | null {
	try {
		const v: unknown = JSON.parse(line)
		if (v && typeof v === "object" && "method" in v) return v as RpcMessage
		return null
	} catch {
		return null
	}
}

async function handleRpc(msg: RpcMessage): Promise<unknown | null> {
	const method = typeof msg.method === "string" ? msg.method : ""
	switch (method) {
		case "initialize":
			return {
				jsonrpc: "2.0",
				id: msg.id,
				result: {
					protocolVersion:
						msg.params && typeof msg.params.protocolVersion === "string"
							? msg.params.protocolVersion
							: "2024-11-05",
					capabilities: { tools: {} },
					serverInfo: SERVER_INFO,
				},
			}
		case "ping":
			return { jsonrpc: "2.0", id: msg.id, result: {} }
		case "tools/list":
			return { jsonrpc: "2.0", id: msg.id, result: { tools: TOOLS_DECL } }
		case "tools/call": {
			const args = (msg.params?.arguments ?? {}) as Record<string, unknown>
			try {
				const results = await wideRecall(
					typeof args.query === "string" ? args.query : "",
					typeof args.top_k === "number" ? args.top_k : 8,
					typeof args.limit === "number" ? args.limit : 12,
				)
				const text =
					results.length === 0
						? "wide_recall 无命中。"
						: results
								.map((r) => `- [${r.project}] (${r.score.toFixed(3)}) ${r.content}`)
								.join("\n\n")
				return { jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text }] } }
			} catch (e) {
				const reason = e instanceof Error ? e.message : String(e)
				log(`tools/call failed: ${reason}`)
				return {
					jsonrpc: "2.0",
					id: msg.id,
					result: { content: [{ type: "text", text: `wide_recall 失败: ${reason}` }], isError: true },
				}
			}
		}
		default:
			if (method.startsWith("notifications/")) return null
			if (msg.id === undefined) return null
			return { jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: `method not found: ${method}` } }
	}
}

async function runServer(): Promise<void> {
	log("MCP server starting")
	let pending = ""
	for await (const chunk of process.stdin) {
		pending += chunk.toString("utf8")
		let idx = pending.indexOf("\n")
		while (idx >= 0) {
			const line = pending.slice(0, idx).trim()
			pending = pending.slice(idx + 1)
			idx = pending.indexOf("\n")
			if (!line) continue
			const msg = parseRpc(line)
			if (!msg) {
				log("bad json line ignored")
				continue
			}
			try {
				const resp = await handleRpc(msg)
				if (resp !== null) process.stdout.write(JSON.stringify(resp) + "\n")
			} catch (e) {
				const reason = e instanceof Error ? e.message : String(e)
				log(`handler error: ${reason}`)
				if (msg.id !== undefined) {
					process.stdout.write(
						JSON.stringify({ jsonrpc: "2.0", id: msg.id, error: { code: -32603, message: reason } }) + "\n",
					)
				}
			}
		}
	}
	log("stdin closed, exiting")
	process.exit(0)
}

const queryArg = argValue("--query")
if (queryArg !== undefined) {
	const topK = Number(argValue("--top-k")) || 8
	const limit = Number(argValue("--limit")) || 12
	const results = await wideRecall(queryArg, topK, limit)
	console.log(JSON.stringify({ results }, null, 2))
	process.exit(0)
}

runServer().catch((e: unknown) => {
	log(`fatal: ${e instanceof Error ? e.message : String(e)}`)
	process.exit(1)
})
