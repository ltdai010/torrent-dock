# TorrentDock Agent Rules

## GitHub Account And Push Safety

This project belongs to the GitHub account and repository:

```text
ltdai010/torrent-dock
```

Before pushing, creating PRs, or running GitHub CLI commands for this repo:

1. Confirm the current repository remote points to `https://github.com/ltdai010/torrent-dock.git`.
2. Confirm GitHub CLI is using the `ltdai010` account:

   ```powershell
   gh auth status
   ```

3. If another account is active, switch before pushing:

   ```powershell
   gh auth switch --hostname github.com --user ltdai010
   ```

4. Keep this repo's local Git author set to:

   ```text
   ltdai010 <47277582+ltdai010@users.noreply.github.com>
   ```

   Verify or reset it with:

   ```powershell
   git config --local user.name ltdai010
   git config --local user.email 47277582+ltdai010@users.noreply.github.com
   ```

Do not push TorrentDock work while `hieunguyenthio` or another GitHub account is active. Other projects may intentionally use different GitHub accounts, so do not change global Git identity or global account assumptions when working here.

## PR Workflow

- Use feature branches with the `codex/` prefix unless the user requests another branch name.
- Do not push directly to `main`.
- Open PRs against `main`.
- Stage only files related to the requested TorrentDock change.
- Do not commit generated folders such as `node_modules/`, `dist/`, or `src-tauri/target/`.

## Verification

For frontend or scaffold changes, run:

```powershell
npm run build
npm audit
```

For Rust/Tauri backend changes, run `cargo check` from `src-tauri` when Cargo is available on PATH.
