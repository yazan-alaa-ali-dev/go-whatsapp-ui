# Ticket Structure Guide — How a Well-Shaped Ticket Should Look

> **Purpose:** This document is the standard/rule for writing tickets (work items / user stories).
> Hand it to any external contributor so they learn the expected shape of a good ticket
> _before_ they start writing. A ticket that does not follow this structure should be sent back.
>
> Based on the **"Internal Board MS2"** Notion board pattern.

---

## 1. Ticket Properties (metadata — fill ALL of these)

Every ticket must have these fields set. They live in the database/board, not in the body.

| Property                      | Type         | Required  | Description                                                                                  |
| ----------------------------- | ------------ | --------- | -------------------------------------------------------------------------------------------- |
| **Name / Title**              | Text         | ✅        | Short, action-oriented title (e.g. `Create ticket`, `Edit ticket`). Verb + object.           |
| **ID**                        | Auto number  | ✅ (auto) | Unique identifier, generated automatically.                                                  |
| **Status**                    | Status       | ✅        | Workflow state — see allowed values below.                                                   |
| **Backbone**                  | Select       | ✅        | The feature area / module the ticket belongs to (e.g. `Ticket System`, `Assets Management`). |
| **Actor**                     | Multi-select | ✅        | Who performs the action: `System Admin`, `Account Admin`, `Normal User`, `System`.           |
| **Assignee**                  | Person       | ✅        | Who is responsible for delivering it.                                                        |
| **Time Estimate (h)**         | Number       | ✅        | Estimated effort in hours.                                                                   |
| **Sprints**                   | Relation     | ⬜        | Sprint the ticket is planned for.                                                            |
| **User Stories**              | Relation     | ⬜        | Link to the parent user story / epic.                                                        |
| **Estimation per User Story** | Relation     | ⬜        | Link to the detailed estimation record.                                                      |

### Allowed Status values (workflow)

`Backlog` → `Planned` → `TODO` → `In progress` → `Ready For Developer Review` →
`Ready For EM Review` → `EM Testing (DEV ENV)` → `Ready For Release` →
`In Release (STAGING)` → `Released To PROD`

---

## 2. Ticket Body Structure (3 mandatory sections)

The body of every ticket **must** contain these three sections, in this order.

```
## User Story
# Acceptance Criteria
# Test Cases
```

---

### Section A — User Story

State the need in the classic role/goal/benefit form, then add one short
clarifying paragraph that summarizes scope and key constraints.

```markdown
## User Story

As **a [Actor / role within a tenant]**,
I want to be able to **[action / capability]**,
so that **[business value / benefit]**.

[One short paragraph: scope, key constraints, what is in/out of scope,
references to related stories by ID.]
```

**Rules:**

- The role must match one of the `Actor` values.
- The benefit ("so that…") must be a real outcome, not a restatement of the action.
- The summary paragraph names hard constraints (e.g. tenant-safety, validation, UI patterns).

---

### Section B — Acceptance Criteria

Break criteria into **named sub-sections**, each with a **numbered list**.
Each item must be atomic, testable, and unambiguous (a yes/no can be answered).

Recommended sub-sections (include the ones that apply):

| Sub-section                  | What it covers                                                        |
| ---------------------------- | --------------------------------------------------------------------- |
| **Scope & Tenant Safety**    | Data isolation, what the user can/cannot touch.                       |
| **Authorization**            | Who is allowed; what happens to unauthorized users (UI + API/403).    |
| **General Behavior**         | Core flow, what opening/using the feature does.                       |
| **Form Fields**              | Split into **Required Fields** and **Optional Fields** + their rules. |
| **Behavior After Saving**    | What happens on success (IDs generated, defaults, confirmation).      |
| **Validation & Constraints** | Patterns, formats, mandatory-field enforcement.                       |
| **UI & API Consistency**     | UI and API enforce identical rules; structured errors.                |
| **Audit & Logging**          | What is logged on success and on failure (who, when, what).           |

```markdown
# Acceptance Criteria

---

## Scope & Tenant Safety

1. [Atomic, testable statement.]
2. [Atomic, testable statement.]

## Authorization

1. [Who may perform the action.]
2. Unauthorized attempts return 403 (API) / hide the control (UI).

## Form Fields

### Required Fields

1. **Field A**
2. **Field B**
   Rules:
3. All required fields are validated before saving.

### Optional Fields

1. Field C
2. Field D
```

---

### Section C — Test Cases

Each test case is a **named scenario** written in **Given / When / Then** (Gherkin) style.
Cover the happy path, validation/error paths, and authorization failures.

```markdown
# Test Cases

---

## [Descriptive scenario name]

**Given** [precondition]
**And** [extra precondition]
**When** [action]
**Then**

- [Expected, observable result]
- [Expected, observable result]
```

**Rules:**

- At minimum: 1 happy-path, 1 validation-error, 1 authorization-failure case.
- Every acceptance-criteria section should be traceable to at least one test case.
- "Then" outcomes must be observable (visible in UI, returned by API, written to log).

---

## 3. Quality Checklist (Definition of "good ticket")

A ticket is **ready** only when every box is checked:

- [ ] Title is short and action-oriented (verb + object).
- [ ] All required properties are filled (Status, Backbone, Actor, Assignee, Time Estimate).
- [ ] Body contains all 3 sections: User Story, Acceptance Criteria, Test Cases.
- [ ] User Story uses the As / I want / so that format with a real benefit.
- [ ] Acceptance Criteria are grouped into named sub-sections with numbered lists.
- [ ] Every criterion is atomic and testable (answerable yes/no).
- [ ] Tenant safety, authorization, validation, and audit are explicitly addressed.
- [ ] UI **and** API behavior are both specified where relevant.
- [ ] Test Cases cover happy path, error/validation, and authorization failure.
- [ ] No ambiguous words ("maybe", "should probably", "etc.") without explanation.
- [ ] Related tickets are referenced by their ID.

---

## 4. Common mistakes to reject

- ❌ A title that is a vague noun ("Tickets") instead of an action ("Create ticket").
- ❌ "so that…" repeats the action instead of stating value.
- ❌ Acceptance criteria written as one big paragraph instead of numbered items.
- ❌ No error/validation behavior — only the happy path described.
- ❌ Authorization not specified (who is blocked, and how).
- ❌ Test cases missing, or not in Given/When/Then form.
- ❌ Empty or missing properties (no assignee, no estimate, no status).
