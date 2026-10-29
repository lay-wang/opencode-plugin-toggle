import { Plugin } from "@opencode/plugin"
import { Toggle } from "./rpc.js"
import fs from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"

const SELF = "plugin-toggle"

const configDir = join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "opencode")

type Row = {
  id: string
  label: string
  version: string | null
  enabled: boolean
  status: "active" | "failed" | "off"
  error: string | null
  toggleable: boolean
}

type SkillRow = {
  id: string
  name: string
  description: string
  source: "file" | "plugin" | "builtin"
}

/* ---------- JSONC ---------- */

// Comments and strings are skipped so the scanner never trips on a URL or a quote in a comment.
function stripJsonc(src: string): string {
  let out = ""
  for (let i = 0; i < src.length; ) {
    const c = src[i]
    if (c === '"') {
      let j = i + 1
      while (j < src.length) {
        if (src[j] === "\\") j += 2
        else if (src[j] === '"') {
          j++
          break
        } else j++
      }
      out += src.slice(i, j)
      i = j
      continue
    }
    if (c === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n") i++
      continue
    }
    if (c === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2)
      i = end < 0 ? src.length : end + 2
      continue
    }
    out += c
    i++
  }
  return out
}

function pluginsOf(src: string): unknown[] {
  try {
    const config = JSON.parse(stripJsonc(src))
    return Array.isArray(config?.plugins) ? config.plugins : []
  } catch {
    return []
  }
}

/** Bounds of the `plugins` array literal, `[` through `]`. */
function arraySpan(src: string, key = "plugins"): { open: number; close: number } | null {
  const keyAt = new RegExp(`"${key}"\\s*:`).exec(src)
  if (!keyAt) return null
  const open = src.indexOf("[", keyAt.index + keyAt[0].length)
  if (open < 0) return null
  let depth = 0
  for (let i = open; i < src.length; ) {
    const c = src[i]
    if (c === '"') {
      let j = i + 1
      while (j < src.length) {
        if (src[j] === "\\") j += 2
        else if (src[j] === '"') {
          j++
          break
        } else j++
      }
      i = j
      continue
    }
    if (c === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n") i++
      continue
    }
    if (c === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2)
      i = end < 0 ? src.length : end + 2
      continue
    }
    if (c === "[") depth++
    else if (c === "]" && --depth === 0) return { open, close: i }
    i++
  }
  return null
}

const lineIndent = (src: string, at: number) => src.slice(src.lastIndexOf("\n", at - 1) + 1, at).match(/^[ \t]*/)?.[0] ?? ""

function addEntry(src: string, entry: string): string {
  const span = arraySpan(src)
  if (!span) throw new Error("配置文件里找不到 plugins 数组")
  const literal = JSON.stringify(entry)
  const body = src.slice(span.open + 1, span.close)
  const head = src.slice(0, span.close).replace(/\s+$/, "")
  if (!body.includes("\n")) return head + (head.endsWith("[") || head.endsWith(",") ? "" : ", ") + literal + src.slice(span.close)
  // A "-id" entry only disables a plugin that loads before it, so new entries go last.
  const entryIndent = /^\n([ \t]*)\S/.exec(body)?.[1] ?? `${lineIndent(src, span.close)}  `
  const comma = head.endsWith("[") || head.endsWith(",") ? "" : ","
  return head + comma + `\n${entryIndent}${literal}\n${lineIndent(src, span.close)}` + src.slice(span.close)
}

function removeEntry(src: string, entry: string): string {
  const span = arraySpan(src)
  if (!span) throw new Error("配置文件里找不到 plugins 数组")
  const literal = JSON.stringify(entry)
  const at = src.indexOf(literal, span.open)
  if (at < 0 || at > span.close) return src
  const end = at + literal.length
  const lineStart = src.lastIndexOf("\n", at - 1) + 1
  const lineEnd = src.indexOf("\n", end)
  const head = src.slice(lineStart, at).trim()
  const tail = (lineEnd < 0 ? src.slice(end) : src.slice(end, lineEnd)).trim()
  // A line holding nothing but the entry goes as a whole, which keeps the file's shape.
  if (head === "" && (tail === "" || tail === ",") && lineStart > 0 && lineEnd > 0)
    // Dropping the last element would leave the previous line's comma dangling before `]`.
    return (src.slice(0, lineStart) + src.slice(lineEnd + 1)).replace(/([ \t]*),([ \t]*\n[ \t]*\])/, "$1$2")
  const comma = src.slice(span.open, at).match(/,\s*$/)
  if (comma) return src.slice(0, span.open + comma.index!) + src.slice(end)
  const after = src.slice(end).match(/^\s*,\s*/)
  return after ? src.slice(0, at) + src.slice(end + after[0].length) : src.slice(0, at) + src.slice(end)
}

const stable = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`
  if (value && typeof value === "object")
    return `{${Object.keys(value as object)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable((value as Record<string, unknown>)[k])}`)
      .join(",")}}`
  return JSON.stringify(value) ?? "null"
}

/** Writes only when the edit parses back to exactly the intended array, and keeps the previous file as a backup. */
async function patchConfig(edit: (src: string) => string, expect: (before: unknown[]) => unknown[]): Promise<void> {
  const path = await configPath()
  if (!path) throw new Error("找不到 opencode 配置文件")
  const before = await fs.readFile(path, "utf8")
  const after = edit(before)
  if (after === before) return
  const sorted = (entries: unknown[]) => entries.map(stable).sort()
  if (JSON.stringify(sorted(pluginsOf(after))) !== JSON.stringify(sorted(expect(pluginsOf(before)))))
    throw new Error("改写后的配置校验失败，已放弃写入")
  await fs.writeFile(`${path}.toggle-backup`, before)
  await fs.writeFile(path, after)
}

async function configPath(): Promise<string | null> {
  for (const name of ["opencode.jsonc", "opencode.json"]) {
    const path = join(configDir, name)
    try {
      await fs.access(path)
      return path
    } catch {}
  }
  return null
}

/* ---------- state ---------- */

const bareSpec = (spec: string) => spec.replace(/@[^@/]*$/, "")
const guessId = (spec: string) => bareSpec(spec).split("/").pop() ?? spec

export default Plugin.define({
  id: SELF,
  async setup(ctx) {
    type Runtime = { id: string; source: Record<string, unknown>; state: { status: string; error?: string } }

    const list = async (): Promise<Runtime[]> => {
      const listed = await ctx.plugin.list()
      return (Array.isArray(listed) ? listed : ((listed as { data?: unknown[] })?.data ?? [])) as Runtime[]
    }

    const state = async (): Promise<{ plugins: Row[]; skills: SkillRow[] }> => {
      const path = await configPath()
      const src = path ? await fs.readFile(path, "utf8") : ""
      const raw = pluginsOf(src)
        .map((entry) =>
          typeof entry === "string"
            ? entry
            : typeof (entry as { package?: unknown })?.package === "string"
              ? (entry as { package: string }).package
              : "",
        )
        .filter(Boolean) as string[]

      const bySpec = new Map((await list()).map((plugin) => [bareSpec(String(plugin.source.target ?? plugin.source.path ?? plugin.id)), plugin]))

      const disabled = new Map<string, string>()
      for (const spec of raw) if (spec.startsWith("-")) disabled.set(spec.slice(1), spec)

      const plugins: Row[] = []
      for (const spec of raw) {
        if (spec.startsWith("-")) continue
        const match = bySpec.get(bareSpec(spec))
        // A disabled plugin has no runtime entry, so its "-id" line is the only link to it.
        const id = match?.id ?? [...disabled.keys()].find((d) => bareSpec(spec) === d || bareSpec(spec).endsWith(d)) ?? guessId(spec)
        if (id === SELF) continue
        const off = disabled.get(id)
        plugins.push({
          id,
          label: match?.id ?? id,
          version: (match?.source.version as string | undefined) ?? null,
          enabled: !off,
          status: off ? "off" : match?.state.status === "active" ? "active" : "failed",
          error: match?.state.error ?? null,
          toggleable: Boolean(match) || Boolean(off),
        })
        if (off) disabled.delete(id)
      }
      for (const [id] of disabled) plugins.push({ id, label: id, version: null, enabled: false, status: "off", error: null, toggleable: true })

      const res = await ctx.skill.list()
      const skills = ((Array.isArray(res) ? res : ((res as { data?: unknown[] })?.data ?? [])) as Array<{
        id: string
        name: string
        description?: string
        path: string
      }>)
        .filter((skill) => skill.description)
        .map((skill) => ({
          id: skill.id,
          name: skill.name,
          description: skill.description ?? "",
          source: (skill.path.startsWith("/builtin") ? "builtin" : skill.path.includes("/node_modules/") ? "plugin" : "file") as SkillRow["source"],
        }))

      return { plugins, skills }
    }

    // The config write returns before the server reloads plugins, so read the list again until it agrees.
    const settle = async (id: string, enabled: boolean) => {
      const deadline = Date.now() + 6000
      while (Date.now() < deadline) {
        if ((await list()).some((plugin) => plugin.id === id) === enabled) return
        await new Promise((resolve) => setTimeout(resolve, 200))
      }
    }

    const toggle = async (input: { id: string; enabled: boolean }) => {
      try {
        const entry = `-${input.id}`
        if (input.enabled) await patchConfig((src) => removeEntry(src, entry), (before) => before.filter((e) => e !== entry))
        else await patchConfig((src) => (pluginsOf(src).includes(entry) ? src : addEntry(src, entry)), (before) => [...before, entry])
        await settle(input.id, input.enabled)
        return { ok: true, error: null }
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
    }

    await ctx.rpc.register(Toggle, { state, toggle })
  },
})
