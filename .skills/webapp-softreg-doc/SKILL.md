---
name: webapp-softreg-doc
description: Generate high-quality Chinese software copyright materials, user manuals, and feature documents from a web app or website. Use when reviewing a live web page and producing deliverables such as a fact summary, a Chinese user manual, a software copyright attachment, or a Word-formatted final document. Especially use when the task requires multi-pass page review, extracting only verified UI functionality, imitating the structure and tone of a reference manual without copying its content, enforcing strict simplified-Chinese output, generating Markdown plus DOCX, adding covers and tables of contents, backing up Word versions, rendering DOCX pages for layout verification, or producing a mature formal draft even when the user did not provide a sample manual.
---

# Webapp Softreg Doc

## Overview

Use this skill for “web page or web app to Chinese software documentation” tasks.
The output target is a formal, review-ready document rather than a thin feature list.
Always review facts first, then write.
If the user provides a reference manual, treat that manual as the primary style target for structure, chapter density, paragraph thickness, and formal tone.
If no reference manual is provided, use the built-in default formal style as the minimum baseline, and still produce a mature, submission-grade draft.

## Mandatory workflow

### 1. Review the target app before writing

Always complete three passes before drafting:

1. Whole-site pass
- identify all routes, tabs, menu items, drawers, and dialog entry points
- record page names, module boundaries, and major visible regions

2. Detail pass
- inspect cards, chart titles, table columns, filters, selectors, buttons, status tags, dialogs, visible field groups, and feedback text

3. Interaction pass
- verify route switching, tab switching, dimension switching, time-range switching, search and filter behavior, modal open or close behavior, action buttons, and result feedback

Never draft the formal manual before these three passes are done.

### 2. Freeze facts in a fact-only Markdown file

Before writing the formal manual, create a fact summary such as:

- `webapp-review-notes.md`
- `platform-function-summary.md`

This fact summary must contain only verified content:

- platform positioning as seen from the UI
- all visible pages or business regions
- main functions per page
- visible charts, cards, tables, filters, dialogs, and feedback
- verified interactions and page-to-page relationships

Do not infer hidden architecture, deployment, protocols, database design, permissions, or algorithms.

### 3. Choose the writing-style source correctly

If the user provides a reference manual:

- learn its chapter structure
- learn its formal tone
- learn its paragraph density
- learn how it combines functional description with business scenarios
- compare your draft against it before finalizing

Do not copy the reference manual’s product assumptions, industry positioning, backend details, protocol names, or technical architecture.

If the user does not provide a reference manual:

- read `references/default-formal-style.md`
- use it as the minimum submission-grade style baseline
- do not stop to ask the user for a sample unless they explicitly want to imitate one

### 4. Draft the formal manual in Markdown first

Prefer a formal structure equivalent to:

- 一、引言
- 二、系统综述
- 三、系统使用前提
- 四、功能模块说明
- 五、典型业务使用路径
- 六、说明范围与边界

Within those sections, prefer second-level and third-level subheadings such as:

- 1.1 编写目的
- 1.2 软件概述
- 1.3 读者对象
- 1.4 术语与缩写解释
- 2.1 设计目标
- 2.2 主要功能特点
- 2.3 功能架构简介

If the app is small or visually concentrated in a few routes, split content by business regions instead of pretending there are many pages.
Even in that case, the final text must still read like a formal manual, not like notes.

### 5. Apply the default professional expansion rule

Unless the user explicitly asks for a brief version, default to a medium-to-long formal draft.

For every major module or page, explain at least:

- what the module is for
- what appears on the page
- what the user can do there
- why it matters in the business flow
- how it connects to upstream and downstream pages or actions

For dashboards and overview pages, explicitly cover:

- summary cards and what they help users observe
- chart areas and their analysis dimensions
- switching behavior such as time range or dimension changes
- alerts, rankings, statuses, or notification regions

For list or table pages, explicitly cover:

- query and filtering area
- table composition and key columns
- row-level actions and detail entry
- how the list supports management, review, tracking, or follow-up work

For forms, dialogs, and drawers, explicitly cover:

- entry point
- visible field groups
- visible validation or required-input hints
- result feedback and return path

If a draft feels thin after initial writing, expand with verified page composition, user path explanation, module linkage, and business value.
Do not expand with invented backend details.

## Failure-prevention rules

These rules are mandatory because they directly address common quality failures:

1. Do not treat the built-in default style as a short outline.
   It is the minimum formal baseline, not a lightweight fallback.

2. If a reference manual exists, compare your current draft against it before final output.
   Check chapter depth, paragraph length, and the number of business-scenario explanations.

3. Never allow Markdown markers to leak into the final DOCX or PDF.
   Headings, emphasis, and tables must be rendered into Word styles, not left as raw `##`, `###`, `**`, or pipe-table text.

4. Do not stop after “content is generated”.
   The work is not complete until the final Word and PDF are opened, inspected, and confirmed to match the user’s requirements.

5. Every completed task must include a final self-review.
   Confirm content accuracy, formatting accuracy, simplified-Chinese quality, and whether the result fully matches the user’s request.

## Simplified Chinese and encoding rules

These rules are mandatory:

- use strict simplified Chinese everywhere in deliverables
- do not output traditional Chinese
- do not output Japanese kana or Japanese-style text fragments
- do not leave garbled text, replacement characters, or placeholder question marks
- keep intermediate Markdown files in UTF-8

If a page scrape returns garbled text, repair the text using verified context before writing.
Never copy mojibake directly into the deliverable.

## Word deliverable rules

When the user wants a final deliverable, generate DOCX only after the Markdown content is stable.

Required steps:

1. back up the previous DOCX before major changes
2. create a clean DOCX with no Markdown markers
3. add a cover page
4. add a subtitle when appropriate
5. add a table of contents
6. apply formal heading styles
7. format glossary tables cleanly
8. render the document for visual inspection

Use `scripts/build_softreg_docx.py` when you need deterministic DOCX output from Markdown.
Use `scripts/update_toc_and_export.py` if local Word automation is available and you need field updates or a PDF export.

Recommended formatting:

- Heading 1: SimHei, 16pt, bold
- Heading 2: SimHei, 14pt, bold
- Heading 3: SimHei, 12pt, bold
- Body: SimSun, 12pt, line spacing around 1.4 to 1.5

## Rendering and validation

Validation is required, not optional.

Preferred validation flow:

1. Markdown content review
2. DOCX generation
3. DOCX or PDF export
4. PDF-to-image rendering
5. visual inspection
6. final self-review against user requirements

Inspect at least:

- cover page
- TOC page
- one early body page
- one middle body page
- one late body page
- final page

Check for:

- title overlap
- missing or thin sections
- raw Markdown markers in body text
- broken tables
- garbled Chinese
- sparse module explanations
- obvious mismatch with the user’s stated format or content expectations

## Final self-review

Before delivering, complete this final review explicitly:

1. Content review
- is every described function verified from the target page or project
- are all major pages or business regions covered
- is the text thick enough to read like a formal manual

2. Format review
- did all headings render correctly
- did any Markdown markers remain in DOCX or PDF
- are tables, paragraphs, page numbers, and cover elements normal

3. Requirement review
- did the result fully match the user’s latest request
- if the user asked for a more formal, longer, or sample-aligned version, was that actually done

If any answer is “no”, revise before delivering.

## When to read references

Read `references/sop.md` for the full end-to-end process.
Read `references/default-formal-style.md` when the user did not provide a sample manual or when the draft feels too thin.
Read `references/checklist.md` when validating whether a deliverable is ready to ship.
Read `references/request-template.md` for reusable prompt patterns.

## Scripts

### `scripts/build_softreg_docx.py`

Use when:

- the final deliverable must be a Word document
- the Markdown structure is stable
- you want consistent formatting and no Markdown leakage

Run pattern:

```bash
python scripts/build_softreg_docx.py --input <manual.md> --output <manual.docx> --title "<doc title>" --subtitle "软件说明书" --doc-type "文档版本：V1.0"
```

### `scripts/update_toc_and_export.py`

Use when:

- a DOCX already exists
- local Microsoft Word is available
- you need field updates or a real Word-exported PDF

Run pattern:

```bash
python scripts/update_toc_and_export.py --input <manual.docx> --pdf <manual.pdf>
```
