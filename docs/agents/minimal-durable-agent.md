# Minimal Durable Pi Agent

Pola daya tahan sesi yang dipakai repo ini. Aturan main: semua state jadi
append-only entries di file JSONL sesi, terus di-replay pas `session_start`.
Crash tinggal replay ulang, tidak ada state misterius di RAM yang hilang.

## Pola 1: custom-entry snapshot (subagents)

Tiap perubahan status panggil `pi.appendEntry("subagents:run", snapshot)`
secara best-effort (try/catch, tidak pernah gagalkan kerja utama).
Di `session_start`, `session_compact`, dan `session_tree`, scan branch
dengan last-write-wins: run yang entry terakhirnya masih `running`/`queued`
berarti tidak pernah settle, restore sebagai `interrupted`.
Restore idempotent: id yang dikenal di-skip, flip ke `interrupted`
di-persist biar replay berikutnya tidak restore dobel.
(`extensions/subagents/src/run-store.ts`, `extensions/subagents/src/agent-manager.ts`)

Resume = buka ulang file sesi anak yang SAMA via `SessionManager.open()`,
lazy, fail-closed kalau file hilang. Mid-flight tools tidak diulang, hanya
yang sudah settle yang kebawa. (`extensions/subagents/src/agent-runner.ts`)

## Pola 2: tool-result details snapshot (todo)

State yang model perlu lihat taruh di `details` tool result.
Replay dari `getBranch()` (cabang aktif, bukan semua entry) dengan
last-write-wins + sanitize + normalize.
Replay di `session_start`, `session_compact`, dan `session_tree`.
(`extensions/todo/state/replay.ts`, `extensions/todo/index.ts`)

## Aturan pilih pola

Model butuh baca jadi `details` (pola 2). Internal saja jadi custom entry
(pola 1). Replay selalu dari `getBranch()`, bukan `getEntries()`.
Persist selalu best-effort: durability tidak boleh gagalkan kerja utama.
