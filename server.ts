// น้อง potato — turns Claude Code and Codex hook events into little creatures on a web page.
// Run: bun server.ts  → open http://localhost:4747
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

const PORT = Number(process.env.NONG_POTATO_PORT ?? 4747);
const DIR = import.meta.dir;
const STATE_FILE = join(DIR, "state.json");
const PAGE_FILE = join(DIR, "index.html");
const LOG_MAX = 12;
const PRUNE_AFTER_MS = 12 * 60 * 60 * 1000;
const HELPER_LEAVE_MS = 3 * 60 * 1000;   // finished subagents wave goodbye, then go home
const HELPER_STALE_MS = 30 * 60 * 1000;  // subagents that never reported back

type Status = "idle" | "thinking" | "working" | "waiting" | "done";
type Pet = {
  id: string;
  provider?: "claude" | "codex";
  parent?: string;    // set on subagent pets: the session that spawned them
  agentType?: string;
  cwd: string;
  repo: string;
  branch: string;
  status: Status;
  verb: string;
  target: string;
  prompt: string;
  turnStart: number | null;
  lastEvent: number;
  doneAt: number | null;
  toolCount: number;
  log: { t: number; text: string }[];
};

let pets: Record<string, Pet> = {};
try {
  if (existsSync(STATE_FILE)) pets = JSON.parse(readFileSync(STATE_FILE, "utf8"));
} catch {}

// --- git info per cwd (cached) ---
const gitCache = new Map<string, { at: number; repo: string; branch: string }>();
function gitInfo(cwd: string) {
  const hit = gitCache.get(cwd);
  if (hit && Date.now() - hit.at < 15_000) return hit;
  const run = (args: string[]) => {
    try {
      const r = Bun.spawnSync(["git", "-C", cwd, ...args], { stderr: "ignore" });
      return r.exitCode === 0 ? r.stdout.toString().trim() : "";
    } catch {
      return "";
    }
  };
  const top = run(["rev-parse", "--show-toplevel"]);
  // In a worktree (e.g. .claude/worktrees/agent-…) name the pet after the main repo, not the worktree folder
  const common = top ? run(["rev-parse", "--path-format=absolute", "--git-common-dir"]) : "";
  const main = common.endsWith("/.git") ? dirname(common) : top;
  const info = {
    at: Date.now(),
    repo: basename(main || cwd) || cwd,
    branch: top ? run(["branch", "--show-current"]) || run(["rev-parse", "--short", "HEAD"]) : "",
  };
  gitCache.set(cwd, info);
  return info;
}

// --- tool call → short human description ---
const short = (s: unknown, n = 48) => {
  const str = String(s ?? "").replace(/\s+/g, " ").trim();
  return str.length > n ? str.slice(0, n - 1) + "…" : str;
};
const file = (p: unknown) => basename(String(p ?? ""));

function describe(tool: string, input: any): { verb: string; target: string } {
  input ??= {};
  switch (tool) {
    case "Read": return { verb: "อ่าน", target: file(input.file_path) };
    case "Edit":
    case "MultiEdit": return { verb: "แก้", target: file(input.file_path) };
    case "apply_patch": return { verb: "แก้", target: short(input.description || file(input.file_path) || "ไฟล์", 40) };
    case "Write": return { verb: "เขียน", target: file(input.file_path) };
    case "NotebookEdit": return { verb: "แก้", target: file(input.notebook_path) };
    case "Bash": return { verb: "รัน", target: short(input.description || input.command) };
    case "Grep": return { verb: "ค้น", target: `“${short(input.pattern, 32)}”` };
    case "Glob": return { verb: "หาไฟล์", target: short(input.pattern, 32) };
    case "WebFetch": {
      let host = "";
      try { host = new URL(input.url).host; } catch {}
      return { verb: "เปิดเว็บ", target: host };
    }
    case "WebSearch": return { verb: "เสิร์ช", target: `“${short(input.query, 32)}”` };
    case "Agent":
    case "Task": return { verb: "ส่งผู้ช่วยไป", target: short(input.description, 40) };
    case "Workflow": return { verb: "สั่งทีมผู้ช่วย", target: "" };
    case "TodoWrite": return { verb: "จดลิสต์งาน", target: "" };
    case "Skill": return { verb: "ใช้สกิล", target: short(input.skill, 32) };
    case "AskUserQuestion": return { verb: "มีคำถาม", target: "" };
    case "ExitPlanMode": return { verb: "ขอดูแผน", target: "" };
  }
  if (tool.startsWith("mcp__")) return { verb: "ใช้", target: tool.split("__").slice(-1)[0] };
  return { verb: "ใช้", target: tool };
}

// --- event → state ---
function apply(ev: any) {
  const session = String(ev.session_id ?? "");
  const name = String(ev.hook_event_name ?? "");
  if (!session || !name) return false;
  const now = Date.now();
  const provider = ev.provider === "codex" ? "codex" : "claude";
  const sessionKey = provider === "codex" ? `codex:${session}` : session;
  // Subagents share their session's id; agent_id tells them apart, so each gets its own pet
  const agentId = ev.agent_id ? String(ev.agent_id) : "";
  const id = agentId ? `${sessionKey}/${agentId}` : sessionKey;

  if (name === "SessionEnd") {
    for (const [k, p] of Object.entries(pets)) if (k === sessionKey || p.parent === sessionKey) delete pets[k];
    return true;
  }

  const cwd = String(ev.cwd ?? pets[id]?.cwd ?? "");
  const { repo, branch } = gitInfo(cwd);
  const pet: Pet = (pets[id] ??= {
    id, provider, cwd, repo, branch, status: "idle", verb: "", target: "", prompt: "",
    turnStart: null, lastEvent: now, doneAt: null, toolCount: 0, log: [],
  });
  Object.assign(pet, { provider, cwd, repo, branch, lastEvent: now });
  if (agentId) Object.assign(pet, { parent: sessionKey, agentType: String(ev.agent_type ?? "") });
  const log = (text: string) => {
    pet.log.unshift({ t: now, text });
    pet.log.length = Math.min(pet.log.length, LOG_MAX);
  };

  switch (name) {
    case "SessionStart":
      if (pet.status !== "working") pet.status = "idle";
      break;
    case "UserPromptSubmit":
      Object.assign(pet, {
        status: "thinking", verb: "", target: "", turnStart: now, doneAt: null, toolCount: 0,
        prompt: short(ev.prompt, 140),
      });
      log(`ได้งานใหม่: ${short(ev.prompt, 60)}`);
      break;
    case "PreToolUse": {
      const d = describe(String(ev.tool_name ?? ""), ev.tool_input);
      const asks = ev.tool_name === "AskUserQuestion" || ev.tool_name === "ExitPlanMode";
      Object.assign(pet, d, { status: asks ? "waiting" : "working", doneAt: null });
      pet.turnStart ??= now;
      pet.toolCount++;
      log(`${d.verb} ${d.target}`.trim());
      break;
    }
    case "PermissionRequest": {
      const d = describe(String(ev.tool_name ?? ""), ev.tool_input);
      Object.assign(pet, {
        status: "waiting", ...d, verb: "รออนุญาต",
        target: [d.verb, d.target].filter(Boolean).join(" "), doneAt: null,
      });
      pet.turnStart ??= now;
      log(`รออนุญาต: ${d.verb} ${d.target}`.trim());
      break;
    }
    case "PostToolUse":
      if (pet.status === "waiting") pet.status = "working";
      break;
    case "PreCompact":
      Object.assign(pet, { status: "working", verb: "จัดความจำ", target: "" });
      log("จัดความจำ");
      break;
    case "Notification": {
      const msg = String(ev.message ?? "");
      // "Claude is waiting for your input" after a finished turn is not a permission prompt
      const idleNudge = ev.notification_type === "idle_prompt" || /waiting for your input/i.test(msg);
      if (idleNudge && (pet.status === "done" || pet.status === "idle")) break;
      Object.assign(pet, { status: "waiting", verb: "รอเธออยู่", target: short(msg, 60) });
      log(`รอ: ${short(msg, 60)}`);
      break;
    }
    case "Stop":
      Object.assign(pet, { status: "done", doneAt: now, verb: "", target: "" });
      log("เสร็จแล้ว");
      break;
    case "Interrupt":
      Object.assign(pet, { status: "idle", verb: "", target: "", turnStart: null });
      log("หยุดชั่วคราว");
      break;
    case "SubagentStart":
      Object.assign(pet, { status: "thinking", verb: "ผู้ช่วยกำลังเริ่ม", target: String(ev.agent_type ?? "") });
      log(`ผู้ช่วยเริ่มทำงาน${ev.agent_type ? `: ${short(ev.agent_type, 40)}` : ""}`);
      break;
    case "SubagentStop":
      if (agentId) {
        Object.assign(pet, { status: "done", doneAt: now, verb: "", target: "" });
        log("เสร็จแล้ว");
      } else log("ผู้ช่วยกลับมาแล้ว");
      break;
    default:
      return false;
  }
  return true;
}

function prune() {
  const now = Date.now();
  let gone = false;
  for (const [id, p] of Object.entries(pets)) {
    const old = p.parent
      ? (p.status === "done" && now - (p.doneAt ?? p.lastEvent) > HELPER_LEAVE_MS) || now - p.lastEvent > HELPER_STALE_MS
      : now - p.lastEvent > PRUNE_AFTER_MS;
    if (old) { delete pets[id]; gone = true; }
  }
  return gone;
}

// --- persist + broadcast ---
const clients = new Set<ReadableStreamDefaultController>();
const enc = new TextEncoder();
let saveTimer: Timer | null = null;
function changed() {
  const payload = enc.encode(`data: ${JSON.stringify(Object.values(pets))}\n\n`);
  for (const c of clients) {
    try { c.enqueue(payload); } catch { clients.delete(c); }
  }
  saveTimer ??= setTimeout(() => {
    saveTimer = null;
    try { writeFileSync(STATE_FILE, JSON.stringify(pets)); } catch {}
  }, 1000);
}
setInterval(() => {
  for (const c of clients) {
    try { c.enqueue(enc.encode(": ping\n\n")); } catch { clients.delete(c); }
  }
}, 20_000);
setInterval(() => { if (prune()) changed(); }, 30_000);

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: PORT,
  async fetch(req, srv) {
    const url = new URL(req.url);

    if (req.method === "POST" && url.pathname === "/event") {
      // Hooks post via curl, which sends no Origin. An Origin means a browser page is trying to spoof events.
      if (req.headers.get("origin")) return new Response("forbidden", { status: 403 });
      try {
        if (apply(await req.json())) changed();
      } catch {}
      return new Response("ok");
    }

    if (req.method === "GET" && url.pathname === "/stream") {
      srv.timeout(req, 0);
      let ctrl!: ReadableStreamDefaultController;
      return new Response(
        new ReadableStream({
          start(c) {
            ctrl = c;
            clients.add(c);
            c.enqueue(enc.encode(`retry: 2000\ndata: ${JSON.stringify(Object.values(pets))}\n\n`));
          },
          cancel() { clients.delete(ctrl); },
        }),
        { headers: { "content-type": "text/event-stream", "cache-control": "no-cache" } },
      );
    }

    if (req.method === "POST" && url.pathname === "/dismiss") {
      if (req.headers.get("origin") !== `http://localhost:${PORT}` && req.headers.get("origin") !== `http://127.0.0.1:${PORT}`)
        return new Response("forbidden", { status: 403 });
      const id = url.searchParams.get("id") ?? "";
      if (pets[id]) { delete pets[id]; changed(); }
      return new Response("ok");
    }

    if (req.method === "GET" && url.pathname === "/") {
      return new Response(Bun.file(PAGE_FILE), { headers: { "content-type": "text/html; charset=utf-8" } });
    }

    return new Response("not found", { status: 404 });
  },
});

prune();
// pets saved before worktree-aware naming may carry a worktree folder as their repo
for (const p of Object.values(pets)) {
  const { repo, branch } = gitInfo(p.cwd);
  Object.assign(p, { repo, branch });
}
console.log(`🥔 น้อง potato is up at http://localhost:${server.port}`);
