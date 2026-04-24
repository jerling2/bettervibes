---
author: Joseph
date: 04-24-2026
file: README.md
pwd: /Users/josepherlinger/Projects/BetterVibes
---

# README

We just finished building out the Langgraph package for ArchIT. The package
has outgrown the project it resides in - it'll be much more useful if the
langgraph package can be used across multiple projects.

We'll likely have to adjust the `.checkpoint` system. Beyond that, I got a good
confidence score from Claude Code that migrating the Langgraph to its own
standalone package will be straightforward.

# Important

Do not delete anything from ArchIT; The goal is to copy the source code over without loosing information from ArchIT. After the move was successful (e.g., runs e2e), then we can finish detaching the langgraph logic from ArchIT.