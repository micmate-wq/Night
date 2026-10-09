---
name: handoff
description: Generates a comprehensive system context prompt and session summary to seamlessly resume development in a new chat. Trigger whenever the user asks for a handoff, session handover, context summary, or to continue in a new chat.
requires_confirmation: false
auto_approve: true
---

# Session Handoff & New Chat Context Generator

## Goal
Generate a complete, self-contained, high-fidelity system context prompt that the user can copy and paste directly into a new chat session to continue working with zero loss of context, architectural understanding, or approved design constraints.

## When to Use
- User asks to "handoff", "handover", "continue in new chat", "export context", or "create summary for next chat".
- Context window or token usage is getting high and the conversation needs to be split into a fresh session.
- Ending a major feature phase and wanting a clean checkpoint to resume from.

## Instructions

When invoked, inspect the workspace and recent work, then output a structured response containing:
1. A brief 1-sentence confirmation.
2. A single, copyable markdown block formatted as follows:

````markdown
# Session Continuation Context: <Project Name>

## 1. Project & Environment Overview
- **Project Name & Version:** <e.g., Aether 5.1 Codex-AGY>
- **Workspace Path:** `<absolute path to workspace>`
- **Core Technology Stack:** <e.g., HTML5, Vanilla JavaScript (ES6+), Web Audio API, Canvas 2D, Tauri (Rust), CSS3>
- **Development Server:** <e.g., http://localhost:3456/desktop/index.html>
- **Key Files & Entry Points:**
  - `<file_path_1>`: <short description of role>
  - `<file_path_2>`: <short description of role>

## 2. Key Architectural Decisions & Approved Work
- **Completed Features & Recent Changes:**
  - <Itemized list of recently implemented features with specific file locations>
- **Locked Design Decisions (DO NOT REVERT OR ALTER):**
  - <Specific CSS, aesthetic, or functional behaviors explicitly approved by the user>
  - <e.g., Outer borders removed, button borders set to graphite grey #8e8e88, record button stays circular, etc.>
- **Known Patterns & Architecture:**
  - <Component hierarchy, state management, render loop integration, audio routing>

## 3. Active State & Current Progress
- **Current Status:** <What was just completed in the previous turn>
- **Immediate Next Steps:** <The exact next logical task or open user request>
- **Known Gotchas / Cautions:** <Any quirks, timing issues, or constraints to keep in mind>

## 4. Operating Rules for the New Session
1. **Strict Incrementality:** Implement ONLY what is explicitly requested. Do not anticipate future needs or add unprompted styling/polish.
2. **Minimal Viable Code:** Default to the simplest native implementation.
3. **Plan Before Execution:** For tasks touching multiple files or adding new components, state a 3-bullet-point execution plan and stop with "Should I proceed with this step?".
4. **Preserve Approved Work:** Keep locked UI elements, layouts, and logic in place without altering them when working on adjacent code.
````

3. Advise the user that they can copy the prompt and paste it into their new chat window to immediately begin.
