# Claude handoff

## Project

`/Users/cankilic/Documents/GitHub/flareway`

## Give Claude this file

`CLAUDE_GAME_BUILD_PROMPT.md`

From Claude Code, use the full file as the task prompt. One safe one-shot invocation is:

```bash
cd /Users/cankilic/Documents/GitHub/flareway
claude -p "$(<CLAUDE_GAME_BUILD_PROMPT.md)" \
  --model claude-opus-5-5 \
  --effort high \
  --dangerously-skip-permissions \
  --output-format json
```

If you prefer the interactive Claude Code app, open this folder and paste the entire content of `CLAUDE_GAME_BUILD_PROMPT.md`.

## What is already finished

- Original FT-172 Blender source and runtime GLB
- Fictional Runway 09/27 airfield GLB
- Eight asset QA renders
- Deterministic Blender generator
- Asset license and source ledgers
- Automated GLB contract inspector
- Exact animation/contact/camera node contract

Claude should build the game around these assets. It should not regenerate or replace them unless a verified integration defect requires a generator-first fix.

## What Claude must not do

- No push, GitHub repo creation, Vercel deployment, DNS or subdomain work
- No TheGridBase portfolio edits
- No Cessna/Skyhawk/Textron branding
- No human models

Friday will perform GitHub, `flareway.thegridbase.com`, production verification and the two-game TheGridBase portfolio update after local acceptance.
