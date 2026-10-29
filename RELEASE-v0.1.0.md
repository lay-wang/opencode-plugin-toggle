## v0.1.0 — first release

A switchboard for the OpenCode desktop session header.

### What you get

- A **puzzle icon** at the right end of the session header. Click it for a popover listing everything installed.
- **Plugin switches.** Turning one off appends `"-<plugin-id>"` to the global `plugins` array; turning it back on removes that line. No restart — the server reloads in about a second.
- Disabled plugins stay in the list, greyed out, so re-enabling does not require remembering the package name.
- A plugin that failed to load keeps its row and shows the error, instead of silently vanishing the way the built-in list does.
- **Skills** are listed too. Clicking one inserts `@skill-id` into the prompt and focuses the composer.

### Install

```sh
opencode plugin add opencode-plugin-toggle
```

### Known limits

- Global configuration only — the desktop app has no per-project plugin toggle.
- Plugin-contributed skills cannot be switched off individually; turn off the whole plugin.
- Inserting `@skill-id` is a mention. The agent still has to load the skill; it is not an automatic invocation.
