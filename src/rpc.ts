import { Rpc } from "@opencode/plugin/rpc"

const nullable = (type: "string" | "number") => ({ anyOf: [{ type }, { type: "null" }] })

const PluginRow = {
  type: "object",
  properties: {
    id: { type: "string" },
    label: { type: "string" },
    version: nullable("string"),
    enabled: { type: "boolean" },
    status: { type: "string", enum: ["active", "failed", "off"] },
    error: nullable("string"),
    toggleable: { type: "boolean" },
  },
  required: ["id", "label", "version", "enabled", "status", "error", "toggleable"],
  additionalProperties: false,
} as const

const SkillRow = {
  type: "object",
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    description: { type: "string" },
    source: { type: "string", enum: ["file", "plugin", "builtin"] },
  },
  required: ["id", "name", "description", "source"],
  additionalProperties: false,
} as const

export const Toggle = Rpc.define({
  id: "plugin-toggle",
  methods: {
    state: {
      input: { type: "object", properties: {}, additionalProperties: false },
      output: {
        type: "object",
        properties: { plugins: { type: "array", items: PluginRow }, skills: { type: "array", items: SkillRow } },
        required: ["plugins", "skills"],
        additionalProperties: false,
      },
    },
    toggle: {
      input: {
        type: "object",
        properties: { id: { type: "string" }, enabled: { type: "boolean" } },
        required: ["id", "enabled"],
        additionalProperties: false,
      },
      output: {
        type: "object",
        properties: { ok: { type: "boolean" }, error: nullable("string") },
        required: ["ok", "error"],
        additionalProperties: false,
      },
    },
  },
  events: {},
})
