<p align="center">
  <img src="public/brand/pianpian-reading.webp" alt="Pianpian, your paper-reading companion" width="160">
</p>

<h1 align="center">Pianpian · 篇篇</h1>

<p align="center">
  Understand English papers, find related literature, and prepare Chinese reading notes beside the original PDF.
</p>

<p align="center">
  <a href="README.md">简体中文</a> · <strong>English</strong> · <a href="README.ja.md">日本語</a>
</p>

<p align="center">
  <a href="#screenshots">Screenshots</a> · <a href="#getting-started">Getting started</a> · <a href="#data-and-services">Data and services</a> · <a href="CONTRIBUTING.md">Contributing</a>
</p>

Pianpian is a desktop paper reader for Chinese-speaking readers of English research. The **original PDF is the reading surface**: layout, figures, and equations stay intact, with reading assistance alongside each paragraph. Originals, reading progress, vocabulary, and analysis caches are persisted locally.

Current version: `0.4.2` · Primary distribution target: `Windows x64` · Built with `Electron / React / TypeScript`

> These language options translate the repository documentation. The application interface and reading assistance currently focus on Chinese.

## Recent updates

- **Find and import papers in chat:** The research assistant searches arXiv and Crossref. After confirmation, an arXiv result downloads the official PDF to the local library and starts MinerU parsing.
- **Meet Pianpian:** The product and reading companion share one name, with a folded-paper character generated using gpt-image-2. Ask Pianpian from the library, chat beside a paper, or request vocabulary for the current paragraph.
- **More room for reading:** Conversation history, new chat, and reading workflows share a compact toolbar with floating pickers. Create and select a paper group inline in the metadata editor.
- **Smoother long-paper startup:** PDF pages load on demand. Research sessions start when first opened, and Pi runs in a worker thread.
- **Clearer tool progress:** A compact timeline shows status, task summaries, and search results. Details expand on demand, and library writes require confirmation.
- **Clickable source references:** References in answers navigate to the corresponding PDF page and reading block.
- **Vocabulary for the selected paragraph:** Double-click to generate translation, explanation, summary with contextual role, and AI-selected vocabulary in parallel. The vocabulary panel stays empty until generation; saved terms keep source sentences.

## Screenshots

### The paper and its explanation, side by side

Double-click a paragraph to start translation, explanation, summary with contextual role, and vocabulary in parallel. For a highlighted sentence, only the selected original text is processed.

![Original PDF, aligned paragraph selection, and the Chinese research assistant](docs/assets/reader.png)

<table>
  <tr>
    <td width="50%">
      <img src="docs/assets/library.png" alt="Paper library with search, favorites, groups, and preparation status" width="100%">
      <p><strong>Organize your papers</strong><br>Search, favorites, groups, metadata editing, and preparation progress in one library.</p>
    </td>
    <td width="50%">
      <img src="docs/assets/wordbook.png" alt="Personal wordbook with meanings, source sentences, and paper links" width="100%">
      <p><strong>Build academic vocabulary</strong><br>Save terms explicitly, keep their source sentences, and track what you have learned.</p>
    </td>
  </tr>
</table>

<sub>The reader, library, and wordbook images above illustrate features before the rebrand. The conversation images below show Pianpian on October 16, 2026. All use synthetic papers and simulated responses, with no user papers or credentials. A fresh installation starts with an empty library. See <a href="docs/assets/README.md">asset provenance</a>.</sub>

## Features

| Reading task | Current capability |
| --- | --- |
| Keep the original layout | Continuous scrolling, pages, zoom, and outline navigation; aligned paragraph, figure, and equation regions, including paragraphs spanning pages. Long papers keep their full scroll layout while PDF pages near the viewport load on demand. |
| Understand a paragraph or sentence | Chinese translation, explanation, summary, and contextual role; original-text selection, streaming results, and local caching. |
| Interpret figures and equations | Double-click a figure to start interpretation with its image and context; answers stream directly as Markdown, with math rendering in translations. |
| Learn academic language | Double-click a paragraph to generate AI-selected vocabulary, or generate it manually. No initial term cards appear before generation. Only terms grounded in that paragraph are displayed; the wordbook keeps meanings, source sentences, and links. |
| Research around a paper | Pi-powered conversations across multiple turns; read the current paper, click answer references to navigate to source blocks, search the local library and Crossref, expand compact tool rows, and confirm adding paper metadata to the library. |
| Prepare reading notes | Generate Chinese Markdown drafts, preview them, and choose an export location; three bundled workflows cover close reading, literature search and screening, and literature comparison with notes. |
| Manage a personal library | Import, search, favorites, groups, metadata editing, deletion, and saved reading positions. |
| Adjust the reading environment | Switch between light and dark interfaces in the library sidebar or reader toolbar; keep the preference after restart while original PDF pages, figures, and equation images retain their appearance. |

### Chat with Pianpian

Choose **问问篇篇** (Ask Pianpian) in the library, or select **聊聊** (Chat) beside the current paper. Ask follow-up questions, search for related papers, confirm additions to the library, and generate reading notes. Bundled research skills are read on demand. Tool status, results, page citations, and answers appear in one timeline. Scrolling up during a streamed answer preserves your reading position; returning to the bottom or sending a new question resumes following the output.

Click a source reference in an answer to load its PDF page and locate the paragraph. References use stable reading-block IDs returned by a reading tool, rather than guessing from page numbers. Opening a PDF does not start a hidden research session; Pi initialization runs in a worker thread when the research tab is first visited.

![Pianpian workspace and three bundled reading workflows](docs/screenshots/pianpian-workspace.png)

![Compact tool progress and clickable references beside the original PDF](docs/screenshots/pianpian-reader-light.png)

![Pianpian in dark mode with tool progress and source navigation](docs/screenshots/research-reader-dark.png)

<sub>The reference preview uses a synthetic paper and simulated streaming responses in an isolated desktop profile. It illustrates the interface and contains no user papers, credentials, or live-service output. See <a href="docs/assets/README.md">asset provenance</a>.</sub>

A three-turn workflow can start with:

1. “Summarize this paper's method and main findings, with source references.”
2. “Find two related papers and list their titles, years, and DOIs.”
3. “Use the paper and search results to draft Chinese reading notes.”

Literature search currently uses **Crossref's public scholarly metadata**, with coverage determined by that source. Adding a candidate saves metadata; reading its full text still requires importing its PDF and completing MinerU parsing. Documents export as Markdown. Library-wide and paper-specific conversations are stored locally and can be restored, searched, renamed, or deleted. Model context length is limited for long papers.

## Reading workflow

![Import, prepare with MinerU, read the original, and request AI assistance](docs/assets/workflow.svg)

1. **Save the original.** Import a PDF and keep it in the desktop user-data directory.
2. **Prepare the paper.** If MinerU is configured, the PDF is uploaded automatically for parsing. Otherwise it is saved locally until configuration is complete. The library shows upload, queue, parsing, and download stages.
3. **Open the original.** Reading unlocks only after parsed results, assets, and every reading region's coordinates are ready. Failed preparation can be retried from the library.
4. **Request assistance.** Model analysis starts on user action. Import, parsing completion, and restart recovery do not trigger AI analysis. Model failures do not prevent reading an already prepared paper.

The reader first creates lightweight placeholders for the whole paper, then loads the first page and pages near the current viewport. At most three page loads run at once, with the navigation target taking priority. Scrolling or navigating to another page loads it on demand, keeping requests bounded when opening a long paper or rapidly changing pages.

## Getting started

### Run from source

Install Git, **Node.js 24.x**, and npm. Access to this repository is required.

```powershell
git clone https://github.com/yuanshane76-lang/pianpian.git
cd pianpian
npm ci
npm run desktop:dev
```

Open **服务配置** (Service settings) and configure the two independent services: **Paper parsing** uses your own **MinerU Token**; **Model service** lets you choose **DeepSeek's official service** or **Alibaba Cloud Bailian**, then enter that provider's API key and model. Research conversations use the same model configuration. See the [service setup guide (Chinese)](docs/服务密钥配置.md).

For a web preview, use `npm run dev` and visit `http://127.0.0.1:4173/`. The preview also persists imported PDFs in browser storage; the desktop app stores originals as files in its user-data directory. System credential storage and real service requests require the desktop application.

### Build the Windows installer and ZIP

```powershell
npm run make:win
```

This runs the quality checks and builds a Windows x64 installer and ZIP:

```text
out/installer/Pianpian-Setup-0.4.2-x64.exe
out/installer/Pianpian-0.4.2-x64.zip
```

The installer supports in-app updates. Extract the **entire ZIP directory** and launch `Pianpian.exe` for a portable setup; Node.js is not needed on the recipient's machine. Windows may show a security prompt because the installer has no commercial code-signing certificate. Users configure their own service credentials.

## Data and services

Local-first means originals and reading data are persisted on your machine. Parsing and AI analysis use external services, require a network connection, and may consume quota or incur charges.

| Data or operation | Storage and transmission |
| --- | --- |
| Original PDFs, parsed results, and figure assets | Stored in Electron's user-data directory. With MinerU configured, imported PDFs are automatically sent to MinerU for parsing. |
| Library index, reading position, wordbook, and analysis cache | Stored locally. Caches are identified by content signatures and service configuration. |
| Translation, explanation, vocabulary, figure interpretation, and Q&A | On user action, the necessary passages, context, images, or paper text are sent to the selected model provider. |
| Agent literature searches and note drafts | Search queries are sent to Crossref; the current paper and local paper metadata are supplied to the model as required by the research task. Library additions require confirmation, and drafts are saved after the user chooses a location. |
| Service credentials | Supplied by each user and encrypted in the Electron main process using system secure storage. Saved keys are not returned to the interface in plaintext. |
| Repository and distribution | No bundled default papers, user libraries, parsed caches, or demo credentials. |

Deleting a paper removes its original, parsed assets, and analysis caches. Explicitly collected wordbook terms keep their source sentences; unavailable sources no longer offer navigation.

## Development and validation

```powershell
npm run check
```

This checks common credential formats and the current branch history, runs automated tests, checks TypeScript, and builds the frontend. GitHub's [Quality checks (Windows)](https://github.com/yuanshane76-lang/pianpian/actions/workflows/quality.yml) uses the same command without real model or MinerU calls.

For long-canvas changes, also verify that opening a long paper renders only pages near the viewport, page navigation loads the destination on demand, and coordinate hit testing, outline navigation, and zoom anchors keep working.

### Validation record

On October 16, 2026, the Pianpian brand and conversation interface passed local Windows validation:

| Scope | Result |
| --- | --- |
| Automated checks | `npm run check`: 61 test files, 488 tests, credential checks, TypeScript, and production build passed. |
| Light and dark desktop flows | Real Electron and Pi SDK with synthetic papers and local SSE fixtures: multi-turn tools, approvals, cancellation, note export, streaming scroll, source navigation, persistent history, keyboard popovers, and group editing. |
| Windows ZIP | Built, extracted, and launched `Pianpian.exe`; checked bundled Pi and three workflows, brand assets, mandatory model/MinerU setup, partial save, and retained theme preference. |
| External services | This desktop and ZIP regression used no live model or MinerU calls. Brand artwork was generated separately with gpt-image-2. |

The existing local data directory is preserved across the rename. A signed installer and automatic updates were not validated. The historical live-service and performance record below was not repeated for this change.

On October 14, 2026, feature commit `f838be9` was validated locally on Windows:

| Scope | Result |
| --- | --- |
| Automated checks | `npm run check` passed: 56 test files, 428 tests, credential checks, TypeScript, and a production build. |
| Synthetic desktop regression | Real Pi SDK with local simulated SSE verified skills, confirmations, cancellation, document export, streaming scroll behavior, and source navigation; no external services. |
| Real long papers | DEER (45 pages) and FINDEEPRESEARCH (25 pages) passed cold startup, tail-page navigation, zoom, and on-demand canvas checks in temporary user profiles. |
| Live model and search | DeepSeek paragraph streams, three Pi conversation turns, source navigation, Crossref search, Markdown drafts, and light/dark compact-window checks passed. |

The two papers' first-page times in the live-service run were 543ms and 553ms. Each open read the original PDF once; no main-process heartbeat interval exceeded 100ms, and no native window “unresponsive” event was recorded. These are local samples; results depend on papers, hardware, and the runtime environment.

The additional re-upload → MinerU reparse → first-read acceptance was not completed on October 14 or repeated on October 16, so prepared-paper results do not establish that flow as passed. Real papers, service settings, and raw acceptance screenshots stay in ignored local directories.

### Reproduce desktop acceptance

With parsed local copies of DEER (45 pages) and FINDEEPRESEARCH (25 pages), the following script copies papers into temporary user profiles, records responsiveness and screenshots, and preserves the main library:

```powershell
npm run test:reader-performance:e2e
# Explicitly use configured live services for paragraph streams and three conversation turns
node scripts/reader-performance-e2e.cjs --live-ai
# Extra reparse acceptance entry point, not yet passed; consumes MinerU quota
node scripts/reader-performance-e2e.cjs --live-ai --reparse
```

Reports and screenshots are written to ignored `out/reader-performance-acceptance/` or `out/reader-live-acceptance/` directories. `npm run test:research-agent:e2e` and `npm run test:paragraph-vocabulary:e2e` use synthetic data without external service calls.

| Directory | Responsibility |
| --- | --- |
| `src/domain/` | Reading blocks, coordinate hit testing, content signatures, caches, and vocabulary rules |
| `src/services/` | PDF.js, storage access, and service adapters |
| `src/features/`, `src/app/` | Chinese UI, interactions, and status presentation |
| `electron/` | Secure IPC, credentials, document storage, MinerU tasks, and model requests |
| `tests/`, `scripts/` | Automated tests, validation, and build tools |

Use task branches and pull requests. Review staged changes before committing. Desktop interactions, packaging, and live paid-service checks are reported separately; simulated output does not establish live-service success.

## Documentation and support

The detailed contributor and architecture documents are currently in Chinese:

- [Contributing](CONTRIBUTING.md): environment, workflow, commands, and validation scope.
- [Service configuration](docs/服务密钥配置.md): MinerU, DeepSeek, and Bailian.
- [Architecture](docs/架构说明.md): preparation gates, persistence, coordinates, and caches.
- [Research assistant PRD](docs/PRD-研究助手.md) and [technical decisions](docs/技术选型-研究助手.md): Pi conversations, literature search, controlled tools, and note drafts.
- [Collaboration rules](AGENTS.md): product boundaries, file ownership, and security.
- [Private GitHub collaboration](docs/GitHub私有协作配置.md): permissions and branch conventions.
- [Report an issue](https://github.com/yuanshane76-lang/pianpian/issues): include reproduction steps, version, and expected behavior; exclude credentials and papers you are not authorized to share.
