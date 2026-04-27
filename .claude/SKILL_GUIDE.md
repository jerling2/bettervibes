---
author: Joseph Erlinger
reference: https://github.com/affaan-m/everything-claude-code
---
# your-claude-skill

In one or two sentences, describe what your Claude skill does.

> **Example:**
>
> \# API Design Patterns
>
> Conventions and best practices for designing consistent, developer-friendly REST APIs.

---

## Core Components

🔴 _Tailor the following list to what your Claude skill actually needs. The list was created by examining commonalities between 94 unique community skills found in ‘_[_ECC_](https://github.com/affaan-m/everything-claude-code "‌")_’._

### YAML Frontmatter (Required)

The frontmatter guides Claude’s decision-making, and it is **always loaded** into the context window. Please include a `name` and a `description`. Other fields, such as _origin_, _compatibility_, and _license_, aren’t important outside of niche use cases. Claude tends to under-trigger skills, so please be “pushy” in the description.

> **Example:**

```yaml
---
name: blueprint
description: >-
  Turn a one-line objective into a step-by-step
  construction plan for multi-session, multi-agent
  engineering project. Each step has a
  self-contained context brief so a fresh agent
  can execute it cold. Includes adversarial review
  gate, dependency graph, parallel step detection,
  anti-pattern catalog, and plan mutation protocol.
  TRIGGER when: user requests a plan, blueprint, or
  roadmap for a complex multi-PR task, or describes
  work that needs multiple sessions. DO NOT TRIGGER
  when: task is completable in a single PR or fewer
  than 3 tool calls, or user says "just do it".
origin: community
---
```

### When to Activate

This section tells Claude when to activate and when not to activate. In practice, this section is written as a list of triggers.

> **Example:**
>
> \# When to Activate
>
> - Designing new API endpoints
> - Reviewing existing API contracts
> - Adding pagination, filtering, or sorting
> - Implementing error handling for APIs
> - Planning API versioning strategy
>
> `**Do not use** for when the user says "do not use."`

### Workflows

Describe a sequence of steps for Claude to follow.

> **Example:**
>
> \# Voice Capture Workflow
>
> If the user wants a specific voice, collect one or more of:
>
> - published articles
> - newsletters
> - X / LinkedIn posts
> - docs or memos
> - a short style guide
>
> Then extract:
>
> - sentence length and rhythm
> - whether the voice is formal, conversational, or sharp
> - favored rhetorical devices such as parentheses, lists, fragments or questions
> - tolerance for humor, opinion, and contrarian framing
>
> If no voice references are given, default to a direct, operator-style voice: concrete, practical, and low on hype.

### Role and Context

Give Claude a persona to help it connect on an emotional level. Include this section if Claude embodies the role of a mentor, peer, or judge.

> **Example:**
>
> \# Role and Context
>
> You are a senior transportation manager with 15+ years managing carrier portfolios ranging from 40 to 200+ active carriers across truckload, LTL, intermodal, and brokerage. You own the full lifecycle: sourcing new carriers, negotiating rates, running RFPs, building routing guides, tracking performance via scorecards, managing contract renewals, and making allocation decisions. Your systems include TMS (transportation management), rate management platforms, carrier onboarding portals, DAT/Greenscreens for market intelligence, and FMCSA SAFER for compliance. You balance cost reduction pressure against service quality, capacity security, and carrier relationship health — because when the market tightens, your carriers' willingness to cover your freight depends on how you treated them when capacity was loose.

### How It Works / What’s Included / Key Features

Include this section to explain the “why” behind a non-obvious mechanism that Claude needs to understand. Unlike the “Workflow” section, this section does not teach Claude how to use the skill. Be mindful that Claude might understand your skill from context alone without needing a “How it Works” section; including this section is a judgment call on your part.

> **Example:**
>
> \# Key Features
>
> - **Cold-start execution** - every step includes a self-contained context brief. No prior context needed.
> - **Adversarial review gate** - every plan is reviewed by a strongest-model sub-agent against a checklist covering completeness, dependency correctness, and anti-pattern detection.
> - **Branch/PR/CI workflow** - built into every step. Degrades gracefully to direct mode when git/gh is absent.
> - **Parallel step detection** - dependency graph identifies steps with no shared files or output dependencies.
> - **Plan mutation protocol** - steps can be split, inserted, skipped, reordered, or abandoned with formal protocols and an audit trail.
> - **Zero runtime risk** - pure markdown skill. The entire repository contains only `.md` files - no hooks, no shell scripts, no executable code, no `package.json`, no build step. Nothing runs on install or invocation beyond Claude Code’s native markdown skill loader.

### Installation/Requirements

This section is a must-have for skills that depend on third-party packages.

> **Example:**

```markdown
# Installation

```bash
npm install @third-party-package
```

### Patterns/Examples

Include examples of “green flags” or patterns for Claude to follow best practices.

> **Example:**

```
# Patterns

## RESTful API Structure
```typescript
// ✅ Resource-based URLs
GET    /api/markets        # List resources
GET    /api/markets/:id    # Get single resource
POST   /api/markets        # Create resource
PUT    /api/markets/:id    # Replace resource
PATCH  /api/markets/:id    # Update resource
DELETE /api/markets/:id    # Delete resource

// ✅ Query parameters for filtering,
// sorting, pagination
GET /api/markets?status=active&sort=volume&limit=20&offset=0
```

### Anti-Patterns

If you catch Claude repeatedly making bad decisions, then include a list of “Red Flags” or Anti-Patterns.

```
## Red Flags

Watch for these architectural anti-patterns:
- **Big Ball of Mud**: No clear structure
- **Golden Hammer**: Using the same solution for
everything
- **Premature Optimization**: Optimizing too early
- **Not Invented Here**: Rejecting existing solutions
- **Analysis Paralysis**: Over-planning,
under-building
- **Magic**: Unclear, undocumented behavior
- **Tight Coupling**: COmponents too dependent
- **God Object**: One class/component does everything
```

### Structure

Install guardrails on where Claude is allowed to generate files by including a file-tree diagram section.

```
# Project Structure

project/
├── app/                  # Android entry point, DI wiring, Application class
├── core/                 # Shared utilities, base classes, error types
├── domain/               # UseCases, domain models, repository interfaces (pure Kotlin)
├── data/                 # Repository implementations, DataSources, DB, network
├── presentation/         # Screens, ViewModels, UI models, navigation
├── design-system/        # Reusable Compose components, theme, typography
└── feature/              # Feature modules (optional, for larger projects)
    ├── auth/
    ├── settings/
    └── profile/
```

### Related Skills

This section acts as a signpost by telling Claude where it could go next to learn more information. Consider adding this section if Claude needs to navigate multiple relevant skills without getting lost.

> **Example:**
>
> \# Related Skills
>
> - `content-engine` - Generate platform-native content
> - `x-api` - X/Twitter API integration

### Quality Gate (Checklist)

If your skill deploys something into production, a quality gate can decrease the chance of error. Write a quality gate by using a checklist of items required for the deliverable.

> **Example:**

```
### Security
- [ ] Dependencies scanned for CVEs
- [ ] CORS configured for allowed origins only
- [ ] Rate limiting enabled on public endpoints
- [ ] Authentication and authorization verified
- [ ] Security headers set (CSP, HSTS, X-Frame-Options)
```