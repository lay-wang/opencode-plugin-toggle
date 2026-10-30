import { For, Show, createSignal, onMount } from "solid-js"
import { Plugin, Slot, usePlugin } from "@opencode/plugin/gui"
import type { SessionScreen } from "@opencode/plugin/gui"
import { Toggle } from "./rpc"

type PluginRow = {
  id: string
  label: string
  version: string | null
  description: string
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

function View(props: { screen: SessionScreen; close: () => void }) {
  const ctx = usePlugin()
  const [plugins, setPlugins] = createSignal<PluginRow[]>([])
  const [skills, setSkills] = createSignal<SkillRow[]>([])
  const [loading, setLoading] = createSignal(true)
  const [busy, setBusy] = createSignal<string | null>(null)
  const [error, setError] = createSignal<string | null>(null)

  const load = async () => {
    try {
      const next = await ctx.client.rpc(Toggle).state({})
      if (ctx.signal.aborted) return
      setPlugins(next.plugins as PluginRow[])
      setSkills(next.skills as SkillRow[])
      setError(null)
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }

  onMount(() => void load())

  const flip = async (id: string, enabled: boolean) => {
    setBusy(id)
    try {
      const result = await ctx.client.rpc(Toggle).toggle({ id, enabled })
      setError(result.ok ? null : (result.error ?? ctx.t("failed")))
      await load()
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(null)
    }
  }

  const pick = (id: string) => {
    props.screen.composer.insert(`@${id} `)
    props.screen.composer.focus()
    props.close()
  }

  const Heading = (heading: { title: string; hint?: string }) => (
    <div style={{ display: "flex", "align-items": "baseline", gap: "8px", margin: "16px 0 2px" }}>
      <span style={{ "font-size": "12px", opacity: 0.55, "text-transform": "uppercase", "letter-spacing": "0.04em" }}>{heading.title}</span>
      <Show when={heading.hint}>{(hint) => <span style={{ "font-size": "12px", opacity: 0.4 }}>{hint()}</span>}</Show>
    </div>
  )

  const Row = (row: {
    title: string
    meta: string
    detail?: string
    error?: string
    enabled?: boolean
    toggleable?: boolean
    busy?: boolean
    onFlip?: (enabled: boolean) => void
    onPick?: () => void
  }) => (
    <div
      onClick={() => row.onPick?.()}
      style={{
        display: "flex",
        "align-items": "center",
        gap: "12px",
        padding: "7px 8px",
        "margin": "0 -8px",
        "border-radius": "6px",
        "border-bottom": "1px solid color-mix(in srgb, currentColor 10%, transparent)",
        opacity: row.enabled === false ? 0.5 : 1,
        cursor: row.onPick ? "pointer" : "default",
      }}
    >
      <div style={{ flex: 1, "min-width": 0 }}>
        <div style={{ display: "flex", "align-items": "baseline", gap: "8px" }}>
          <span style={{ "font-weight": 500 }}>{row.title}</span>
          <span style={{ "font-size": "12px", opacity: 0.5 }}>{row.meta}</span>
        </div>
        <Show when={row.detail}>
          {(detail) => (
            <div style={{ "font-size": "12px", opacity: 0.6, overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap" }}>
              {detail()}
            </div>
          )}
        </Show>
        <Show when={row.error}>
          {(message) => <div style={{ "font-size": "12px", color: "var(--color-danger, #d33)" }}>{message()}</div>}
        </Show>
      </div>
      <Show when={row.toggleable}>
        <div onClick={(event) => event.stopPropagation()}>
          <ctx.ui.Switch hideLabel label={row.title} checked={row.enabled ?? true} disabled={row.busy} onChange={(next) => row.onFlip?.(next)} />
        </div>
      </Show>
      <Show when={row.onPick && !row.toggleable}>
        <span style={{ "font-size": "12px", opacity: 0.4 }}>{ctx.t("insert")}</span>
      </Show>
    </div>
  )

  return (
    <div style={{ display: "flex", "flex-direction": "column" }}>
      <Show when={error()}>
        {(message) => <div style={{ color: "var(--color-danger, #d33)", "font-size": "13px", margin: "8px 0" }}>{message()}</div>}
      </Show>
      <Show when={!loading()} fallback={<ctx.ui.Loader />}>
        <Heading title={`${ctx.t("plugins")} (${plugins().length})`} />
        <For each={plugins()}>
          {(plugin) => (
            <Row
              title={plugin.label}
              meta={plugin.version ?? ""}
              detail={plugin.description || undefined}
              error={plugin.status === "failed" ? (plugin.error ?? ctx.t("failed")) : undefined}
              enabled={plugin.enabled}
              toggleable={plugin.toggleable}
              busy={busy() === plugin.id}
              onFlip={(next) => void flip(plugin.id, next)}
            />
          )}
        </For>
        <Heading title={`${ctx.t("skills")} (${skills().length})`} hint={ctx.t("hint")} />
        <For each={skills()}>
          {(skill) => (
            <Row
              title={skill.name}
              meta={skill.source === "plugin" ? ctx.t("fromPlugin") : skill.id}
              detail={skill.description}
              onPick={() => pick(skill.id)}
              toggleable={false}
            />
          )}
        </For>
      </Show>
    </div>
  )
}

export default Plugin.define({
  i18n: {
    en: {
      title: "Plugins & Skills",
      plugins: "Plugins",
      skills: "Skills",
      failed: "Failed to load",
      fromPlugin: "provided by a plugin",
      insert: "insert",
      hint: "click one to add it to your prompt",
      done: "Done",
    },
    zh: {
      title: "插件与技能",
      plugins: "插件",
      skills: "技能",
      failed: "加载失败",
      fromPlugin: "由插件提供",
      insert: "插入",
      hint: "点击插入到输入框",
      done: "完成",
    },
  },
  setup(ctx) {
    const open = (screen: SessionScreen) =>
      ctx.dialogs.open((dialog) => (
        <ctx.ui.Dialog
          title={ctx.t("title")}
          size="x-large"
          footer={
            <ctx.ui.Button variant="contrast" onClick={dialog.close}>
              {ctx.t("done")}
            </ctx.ui.Button>
          }
        >
          <View screen={screen} close={dialog.close} />
        </ctx.ui.Dialog>
      ))

    ctx.add(Slot, {
      at: "session.header",
      order: 10,
      render: (input) => (
        <ctx.ui.Tooltip value={ctx.t("title")}>
          <ctx.ui.IconButton icon="extensions" size="small" label={ctx.t("title")} onClick={() => open(input.screen)} />
        </ctx.ui.Tooltip>
      ),
    })
  },
})
