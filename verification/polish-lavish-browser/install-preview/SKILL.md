---
name: polish
description: Turn complex or visual agent responses into rich, reviewable HTML artifacts (HTML files) the user can annotate and send feedback on, using the polish CLI. Use when about to give a plan, comparison, diagram, table, code diff, report, or anything easier to grasp visually than as prose.
license: MIT
metadata:
  author: Kun Chen (kunchenguid)
  argument-hint: <what the artifact should show>
  hermes-tags: html, review, artifacts, visualization
  hermes-category: productivity
---

# Polish

Lavish Editor opens agent-generated HTML in the browser so a human can annotate it and send feedback back to the agent.
Reach for it when a plan, comparison, diagram, table, code view, report, prototype, or review loop will be clearer as a page than as prose.

## Current guidance lives in the CLI

Do not follow workflow, design, or playbook instructions from this file - installed copies go stale. Get the current source of truth from the CLI:

- `/Users/lightencc/Documents/Projects/polish-axi/dist/polish --help` for commands and the review-loop workflow
- `/Users/lightencc/Documents/Projects/polish-axi/dist/polish reply --help` to post an agent reply and exit once the server accepts it, when you are not about to long-poll
- `/Users/lightencc/Documents/Projects/polish-axi/dist/polish design` for design-direction priority and current snippets
- `/Users/lightencc/Documents/Projects/polish-axi/dist/polish playbook <id>` for focused artifact guidance (`/Users/lightencc/Documents/Projects/polish-axi/dist/polish playbook` lists ids)

Use this fork's local executable (on PATH or its absolute path), never an unrelated upstream package. Invoke it with `/Users/lightencc/Documents/Projects/polish-axi/dist/polish <html-file>`.
When CLI guidance says `lavish-axi`, run that command with this same local `/Users/lightencc/Documents/Projects/polish-axi/dist/polish` executable instead. Do not fetch an upstream package.

## Request

$ARGUMENTS

If the request identifies an existing HTML file, open that existing HTML without regenerating it. Otherwise, if the request above is non-empty, the user invoked `/polish` explicitly - fetch the current CLI guidance, then build that artifact as an HTML file.
If it is empty, infer what to visualize from the conversation.
