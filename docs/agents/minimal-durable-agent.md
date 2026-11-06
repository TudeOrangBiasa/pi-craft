# Minimal Durable Pi Agent

> Riset pola daya tahan sesi: apa yang bikin sesi Pi selamat dari crash/reload/resume, dan mana yang worth diadopsi pi-craft. Bahasa santai, tapi tiap klaim teknis ada sitasinya.

> Catatan pasca-trim: referensi ke `goal`, `vision`, `cache-hit`, `clear`, dan
> `web` adalah catatan historis, kodenya sudah dihapus dari repo. Pola
> durability-nya tetap berlaku sebagai referensi. Rekomendasi #3 (re-replay
> compact/tree) sudah dieksekusi untuk subagents; versi goal-nya ikut
> terhapus bersama extension-nya.

## Ringkasan

- Fondasi durability di Pi itu simpel: semua state jadi **append-only entries di file JSONL sesi**, terus di-**replay pas `session_start`**. Crash tinggal replay ulang, nggak ada state misterius di RAM yang hilang (`extensions/subagents/src/run-store.ts:4-16`, [session-format.md](https://raw.githubusercontent.com/earendil-works/pi/main/packages/coding-agent/docs/session-format.md), diakses 2026-11-06).
- Repo ini udah punya 3 varian pola yang bener: **custom-entry snapshot** (`subagents:run` di `extensions/subagents/src/run-store.ts:23,99-105`), **goal-state custom entry** (`extensions/goal/goal.ts:20,587,879`), dan **tool-result `details` snapshot** (`extensions/todo/state/replay.ts:98-120`).
- Kunci resume-nya subagent: simpen **path file sesi anak** (`sessionFile`) sebagai koordinat, terus `SessionManager.open()` file yang SAMA pas resume. Tool result yang udah settle ikut kebawa (`extensions/subagents/src/agent-runner.ts:1298-1299`, `extensions/subagents/src/agent-manager.ts:1096-1119`).
- Gap paling jelas: cuma todo yang **re-replay pas `session_compact`/`session_tree`** (`extensions/todo/index.ts:195-201`). Goal sama subagents cuma replay di `session_start` (`extensions/goal/goal.ts:877`, `extensions/subagents/src/index.ts:771`), jadi navigasi tree/compaction bisa bikin state mereka stale.
- Pola luar (Anthropic/OpenAI/LangGraph) intinya sama: snapshot + replay + referensi ringan, cuma bungkusnya beda. Yang mahal kayak checkpoint-DB per-step itu overkill buat Pi yang udah punya JSONL ([Anthropic](https://www.anthropic.com/research/multi-agent-research-system), diakses 2026-11-06; [LangGraph checkpointers](https://docs.langchain.com/oss/python/langgraph/checkpointers), diakses 2026-11-06).

## Mekanisme repo ini

| Mekanisme | File:line | Status |
|---|---|---|
| Snapshot tiap status change via `pi.appendEntry("subagents:run", ...)`, best-effort try/catch | `extensions/subagents/src/run-store.ts:23,99-105` | punya |
| Replay branch last-write-wins: run yang LAST entry-nya masih `running`/`queued` = nggak pernah settle | `extensions/subagents/src/run-store.ts:113-120` | punya |
| `restoreInterrupted()` re-register sebagai `interrupted` + persist flip biar replay berikutnya nggak restore dobel | `extensions/subagents/src/agent-manager.ts:384-409` | punya |
| Resume = buka ulang file sesi anak yang SAMA (`SessionManager.open(sessionFile)`), lazy, fail-closed kalau file hilang | `extensions/subagents/src/agent-manager.ts:1096-1119`, `extensions/subagents/src/agent-runner.ts:1274-1299` | punya |
| Child session persist by default (`rememberAgents=true`) vs `inMemory`, + `parentSession` biar nesting di `/resume` | `extensions/subagents/src/agent-runner.ts:744,1052-1062` | punya |
| `session_start`: bind writer, restore, kirim notice follow-up; `session_shutdown`: unbind + dispose | `extensions/subagents/src/index.ts:778-788`, `extensions/subagents/src/agent-manager.ts:363-370` | punya |
| Goal persist `goal-state` custom entry tiap mutasi, restore latest-wins dari `getEntries()` + re-aktifkan tools | `extensions/goal/goal.ts:20,433-440,586-590,877-885` | punya |
| Verifier gate fields (`pendingVerdict`, `lastEvidence`, `failStreak`, `lastVerdict`) ikut ke-persist biar gate selamat dari reload | `docs/adr/0011-goal-verifier-gate.md:32-34` | punya |
| Todo: state = snapshot `details` di tool result, replay `getBranch()` last-wins + sanitize + normalize | `extensions/todo/state/replay.ts:98-120`, `extensions/todo/tool/response-envelope.ts:85-87` | punya |
| Todo re-replay di `session_start` + `session_compact` + `session_tree`, per-session slot isolation | `extensions/todo/index.ts:170-201` | punya (cuma todo) |
| Goal + subagents replay CUMA di `session_start` (nggak handle compact/tree) | `extensions/goal/goal.ts:877`, `extensions/subagents/src/index.ts:771` | gap |

Catatan detail yang penting tapi gampang kelewat:

- Snapshot run itu **bounded**: `result` cuma teks jawaban pendek, yang lengkap hidup di file sesi anak, bukan di entry parent (`extensions/subagents/src/run-store.ts:76-92`).
- Koordinat resume di-capture selagi sesi hidup karena restart nge-wipe `record.session` tapi file-nya selamat di disk (`extensions/subagents/src/agent-manager.ts:761-764`).
- Snapshot terminal (`completed`/`error`/`timeout`) ditulis pas settle biar replay tahu run ini udah beres dan jangan di-restore (`extensions/subagents/src/agent-manager.ts:956-958`). Bahkan run yang masih `queued` pas restart ikut ke-persist biar balik sebagai `interrupted`, bukan menghilang (`extensions/subagents/src/agent-manager.ts:519-522`).
- Semua replay defensif: entry korup/versi lama di-skip diam-diam via shape check (`isPersistedRun`, `isGoalState`, `isTaskDetails` + `sanitizeReplayedTasks`).
- Goal pakai `getEntries()` (semua entry) sementara run-store/todo pakai `getBranch()` (cabang aktif). Docs Pi nyuruh `getBranch()` biar abandoned branch nggak kehitung ([extensions.md, State Management](https://raw.githubusercontent.com/earendil-works/pi/main/packages/coding-agent/docs/extensions.md), diakses 2026-11-06).

## Session entries API

### Tulis: `pi.appendEntry(customType, data?)`

API-nya satu baris: `pi.appendEntry("my-state", { count: 42 })` ([extensions.md, pi.appendEntry](https://raw.githubusercontent.com/earendil-works/pi/main/packages/coding-agent/docs/extensions.md), diakses 2026-11-06). Custom entries **tidak masuk konteks LLM** ([session-format.md, CustomEntry](https://raw.githubusercontent.com/earendil-works/pi/main/packages/coding-agent/docs/session-format.md), diakses 2026-11-06), jadi aman buat state internal. Semua persist best-effort try/catch: durability nggak boleh gagalkan kerja utama (`extensions/subagents/src/run-store.ts:99-105`, `extensions/goal/goal.ts:586-590`).

Bedain sama `custom_message` (via `pi.sendMessage`): itu **ikut ke LLM**, cuma buat injeksi konteks, bukan state ([session-format.md, CustomMessageEntry](https://raw.githubusercontent.com/earendil-works/pi/main/packages/coding-agent/docs/session-format.md), diakses 2026-11-06).

### Baca: `getEntries()` vs `getBranch()`

- `ctx.sessionManager.getEntries()` = semua entry; `getBranch()` = cabang aktif; `buildContextEntries()` = cabang aktif + compaction diterapkan ([extensions.md, ExtensionContext](https://raw.githubusercontent.com/earendil-works/pi/main/packages/coding-agent/docs/extensions.md), diakses 2026-11-06).
- Aturan resmi Pi: **rebuild dari `getBranch()`**, bukan semua entry. Abandoned branch itu alternate history ([extensions.md, State Management](https://raw.githubusercontent.com/earendil-works/pi/main/packages/coding-agent/docs/extensions.md), diakses 2026-11-06).
- Pola replay selalu **last-write-wins**: jalan dari belakang (goal) atau timpa per-ID lalu filter status akhir (run-store, todo).

### Alternatif resmi: state di tool-result `details`

Docs Pi nyuruh extension stateful nyimpen state di **`details` tool result** biar branching support-nya bener, terus reconstruct dengan scan `getBranch()` cari `role === "toolResult"` + `toolName` cocok ([extensions.md, State Management](https://raw.githubusercontent.com/earendil-works/pi/main/packages/coding-agent/docs/extensions.md), diakses 2026-11-06). Itu yang todo lakuin: tiap tool call sukses balikin `details` sebagai snapshot (`extensions/todo/tool/response-envelope.ts:85-87`).

Aturan gampangnya: model butuh baca jadi `details`; internal doang jadi custom entry.

### Format file + `/resume` + compaction

- Sesi = **JSONL**, satu objek per baris, struktur tree via `id`/`parentId` ([session-format.md](https://raw.githubusercontent.com/earendil-works/pi/main/packages/coding-agent/docs/session-format.md), diakses 2026-11-06).
- `--continue` buka sesi terbaru direktori ini, `--resume`/`/resume` buka picker, `/name` kasih nama biar gampang dicari ([sessions.md](https://raw.githubusercontent.com/earendil-works/pi/main/packages/coding-agent/docs/sessions.md), diakses 2026-11-06).
- `/tree` pindah dalam file yang sama, `/fork` bikin sesi baru dari user message lama, `/clone` copy cabang aktif ke sesi baru ([sessions.md](https://raw.githubusercontent.com/earendil-works/pi/main/packages/coding-agent/docs/sessions.md), diakses 2026-11-06). Model cuma nerima **cabang aktif** — ini alasan replay harus dari `getBranch()`.
- Compaction nambah entry `type: "compaction"` berisi `summary` + `firstKeptEntryId`. Entry lama tetap kesimpen, cuma nggak dikirim ke LLM ([session-format.md, CompactionEntry](https://raw.githubusercontent.com/earendil-works/pi/main/packages/coding-agent/docs/session-format.md), diakses 2026-11-06; [compaction.md](https://raw.githubusercontent.com/earendil-works/pi/main/packages/coding-agent/docs/compaction.md), diakses 2026-11-06). Extension bisa nimbrung via `session_before_compact`/`session_compact`/`session_tree` ([extensions.md, Session Events](https://raw.githubusercontent.com/earendil-works/pi/main/packages/coding-agent/docs/extensions.md), diakses 2026-11-06). Todo pakai ketiganya buat re-replay (`extensions/todo/index.ts:195-201`).

### Varian `SessionManager`: `create` / `open` / `inMemory`

- Sesi **persistent by default**; `SessionManager` pemilik entry tree + leaf aktif ([sdk.md, Session storage](https://raw.githubusercontent.com/earendil-works/pi/main/packages/coding-agent/docs/sdk.md), diakses 2026-11-06).
- `SessionManager.inMemory()` buat host yang nggak mau file sesi. Dipakai subagent kalau `persistSession` mati (`extensions/subagents/src/agent-runner.ts:1062`).
- `SessionManager.create(cwd, dir, { parentSession })` bikin file baru; `SessionManager.open(sessionFile)` buka file yang udah ada. Pola subagent: create pas spawn, open pas resume interrupted (`extensions/subagents/src/agent-runner.ts:1054-1062,1299`). Mid-flight tools TIDAK di-run ulang pas resume; yang kebawa cuma yang udah settle sebelum restart.

## Pola luar

**Anthropic, multi-agent research: filesystem artifacts + rencana di luar konteks.** Lead agent decompose query ke subagent paralel yang kerja di context window masing-masing terus balikin ringkasan padat. Dua pola relevan: (1) lead nyimpen rencana ke Memory/external store karena konteks >200k token bakal ke-truncate; (2) subagent nulis output langsung ke filesystem terus balikin referensi ringan ke koordinator, biar nggak ada "game of telephone" ([How we built our multi-agent research system](https://www.anthropic.com/research/multi-agent-research-system), diakses 2026-11-06). Prinsip recovery: jangan restart dari nol, tapi resume dari posisi terakhir error + retry deterministik + checkpoint rutin. Pelajaran termurah: **payload gede di file, yang lewat percakapan cuma pointer.**

**OpenAI Agents SDK: `Session` interface, runner yang urus prepend + persist otomatis.** Kasih objek `Session` ke `Runner.run`, runner otomatis ambil history sebelum tiap turn dan persist input+output baru setelah run ([Sessions guide](https://openai.github.io/openai-agents-js/guides/sessions/), diakses 2026-11-06). Bawaan ada `OpenAIConversationsSession` (persist via API) dan `MemorySession` (RAM doang, reset pas proses mati, eksplisit cuma buat dev lokal). Custom backend cukup implement 5 method async (`getSessionId`/`getItems`/`addItems`/`popItem`/`clearSession`). Pelajaran termurah: **pisahin interface baca-tulis history dari backend-nya**, dan sadar in-memory = hilang pas restart. Persis bedanya `SessionManager.inMemory()` vs `create()` di Pi.

**LangGraph: checkpointer, snapshot state tiap super-step, kunci `thread_id`.** Compile graph dengan checkpointer, tiap super-step state di-snapshot per thread. Ini yang ngasih memory antar interaksi, human-in-the-loop, time travel, dan fault tolerance ([Checkpointers](https://docs.langchain.com/oss/python/langgraph/checkpointers), diakses 2026-11-06). Invoke WAJIB bawa `thread_id`; resume-after-error = `invoke(None, config)`, replay = invoke dengan `checkpoint_id` lama. `MemorySaver` hilang pas restart, produksi harus `SqliteSaver`/`PostgresSaver`. Plus ada `Store` terpisah buat data lintas-thread vs checkpointer yang scope-nya per-thread. Pelajaran termurah: **snapshot per batas bermakna + ID thread stabil + bedain state-per-thread vs state-global**. Tapi DB checkpointer per-step itu overkill kalau kebutuhanmu cuma "selamat dari reload": JSONL Pi udah cukup.

## Rekomendasi minimal (urut dari termurah)

1. **Custom-entry snapshot + replay last-write-wins di `session_start`. Cost: kecil (jam-an per extension).** Tiap mutasi state panggil `pi.appendEntry(customType, snapshot)` secara best-effort (try/catch, jangan pernah gagalkan kerja utama), terus di `session_start` scan balik dan yang terakhir menang. Persis `persistRun`/`loadInterrupted` (`extensions/subagents/src/run-store.ts:99-130`) dan `persist`/`restoreFromEntries` goal (`extensions/goal/goal.ts:433-440,586-590,877-885`). Tambahin shape check defensif biar entry korup di-skip. Status: udah punya di subagents + goal. Jadikan **template default** buat semua extension stateful baru, jangan bikin varian ke-4.
2. **State yang model-perlu-lihat taruh di tool-result `details`, replay dari `getBranch()`. Cost: kecil.** Ini pola resmi Pi dan udah jalan di todo (`extensions/todo/state/replay.ts:98-120`). Status: udah punya di todo. Adopsi buat tool stateful baru, dan pertimbangkan migrasi goal ke `getBranch()` kalau mau aman di `/tree` (goal sekarang `getEntries()`).
3. **Re-replay di `session_compact` + `session_tree`, bukan cuma `session_start`. Cost: kecil-sedang (copy ~20 baris).** Todo udah bener: satu `replayAndRefresh` dipakai bareng tiga event (`extensions/todo/index.ts:156-201`). Goal dan subagents cuma `session_start`, jadi habis compact/navigasi tree state in-memory mereka bisa stale sementara branch aktif udah pindah. Status: gap. Ini adopsi termurah dengan efek paling kerasa.
4. **Resume coordinate = path file sesi + `SessionManager.open()` lazy. Cost: sedang (hari-an, cuma buat yang spawn child session).** Capture `sessionFile` selagi sesi hidup, persist di snapshot parent, restore sebagai `interrupted` yang jujur tapi resumable, dan buka file yang SAMA pas resume, jangan create baru. Batasnya: mid-flight tools nggak diulang, cuma yang udah settle yang kebawa. Status: udah punya di subagents. Nggak perlu diadopsi goal/todo (mereka single-session), tapi jadikan referensi kalau ada extension lain yang spawn sesi anak.
5. **Payload gede di file, entry cuma bawa pointer. Cost: sedang, opsional.** Run snapshot udah bounded by design: `result` pendek, yang lengkap di file sesi anak. Itu implementasi mini dari pola filesystem Anthropic. Yang kurang: konvensi eksplisit (direktori artifact + format referensi) kalau nanti ada extension yang persist output gede. Status: sebagian. Adopsi pas butuh, jangan prematur.
6. **Yang OVERKILL (jangan diadopsi):** checkpointer DB per-super-step ala LangGraph `PostgresSaver`; backend `Session` pluggable + transaksi idempoten ala OpenAI (relevan kalau history remote/shared, nggak relevan buat sesi lokal single-writer); rainbow deploy + tracing produksi ala Anthropic (buat SaaS multi-user, bukan extension lokal). Pengecualian: kalau pi-craft nanti punya state lintas-sesi (preferensi global, memori antar project), baru lirik pola `Store` lintas-thread LangGraph. Itu satu-satunya pola "mahal" yang mungkin relevan di masa depan.

## Sumber

### Primer Pi upstream (semua diakses 2026-11-06)

- Extensions doc (appendEntry, events, State Management, ExtensionContext): https://raw.githubusercontent.com/earendil-works/pi/main/packages/coding-agent/docs/extensions.md
- Session file format (JSONL, entry types, tree, CustomEntry/CompactionEntry/BranchSummaryEntry): https://raw.githubusercontent.com/earendil-works/pi/main/packages/coding-agent/docs/session-format.md
- SDK doc (SessionManager API, persistent by default, inMemory): https://raw.githubusercontent.com/earendil-works/pi/main/packages/coding-agent/docs/sdk.md
- Sessions guide (/resume, /tree, /fork, active branch): https://raw.githubusercontent.com/earendil-works/pi/main/packages/coding-agent/docs/sessions.md
- Compaction reference (trigger, CompactionEntry, branch summarization, extension hooks): https://raw.githubusercontent.com/earendil-works/pi/main/packages/coding-agent/docs/compaction.md
- Issue #6679 (ordering persist `_appendEntry`): https://github.com/earendil-works/pi/issues/6679
- Issue #320 (`--resume` vs lokasi sesi): https://github.com/earendil-works/pi/issues/320

### Primer pola luar (semua diakses 2026-11-06)

- Anthropic, How we built our multi-agent research system (orchestrator-worker, filesystem artifacts, external memory, resume-dari-error): https://www.anthropic.com/research/multi-agent-research-system
- OpenAI Agents SDK (JS), Sessions guide (Session interface, MemorySession, custom storage, transaksi): https://openai.github.io/openai-agents-js/guides/sessions/
- LangGraph, Persistence (checkpointer vs store, troubleshooting MemorySaver): https://docs.langchain.com/oss/python/langgraph/persistence
- LangGraph, Checkpointers (super-step, thread_id, resume/replay): https://docs.langchain.com/oss/python/langgraph/checkpointers

### Primer repo ini (path + baris, diverifikasi langsung)

- `extensions/subagents/src/run-store.ts:23-130` (entry type, snapshot, persist, replay)
- `extensions/subagents/src/agent-manager.ts:363-409,519-522,761-764,956-958,1096-1119` (bind writer, restore, resume-reopen)
- `extensions/subagents/src/agent-runner.ts:744,1052-1062,1298-1299` (create/inMemory/open, parentSession, resume path)
- `extensions/subagents/src/index.ts:778-788` (session_start restore + notice, shutdown unbind)
- `extensions/goal/goal.ts:20,433-440,586-590,877-885` (entry type, restore, persist, session_start)
- `extensions/todo/state/replay.ts:16-120` (shape check, sanitize, normalize, replay)
- `extensions/todo/index.ts:156-201` (replay lifecycle)
- `extensions/todo/tool/response-envelope.ts:85-87` (details snapshot)
- `docs/adr/0010-goal-mode.md:10-27` (agent_settled, appendEntry, defaultActive)
- `docs/adr/0011-goal-verifier-gate.md:19-34` (verifier gate, field persist)
