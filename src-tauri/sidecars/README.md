# Computer Use Sidecar

Atlas bundles a pinned `open-computer-use` helper for macOS Computer Use.

Expected development path:

```text
src-tauri/sidecars/open-computer-use
```

The binary is not fetched at runtime and Atlas must not call upstream installer commands that write user-global agent config.

Until the binary is present, only metadata is bundled as a Tauri resource.

To update the helper:

1. Pick a release or commit from `https://github.com/iFurySt/open-codex-computer-use`.
2. Build or download the macOS `open-computer-use` binary.
3. Put it at `src-tauri/sidecars/open-computer-use`.
4. Ensure it is executable: `chmod 755 src-tauri/sidecars/open-computer-use`.
5. Update `open-computer-use.version.json`.
6. Run Settings diagnostics and the TextEdit manual smoke test.
