# Ranking

Ranking is explainable, centrally calculated, useful without AI, and responsive to feedback.

## Authority

The backend calculates authoritative rank and global ordering. Clients display rank, explanations,
and order controls, but they do not calculate the final ranking result.

## Inputs

- Base source weight
- Recency
- Explicit urgency
- Source/account rules
- Sender rules
- Keyword rules
- Due-date proximity
- Pin behavior
- Feedback history
- Bounded AI adjustment

## Output

Ranking output should include:

- numeric rank or sortable rank bucket
- global order position
- explanation summary
- contributing factors
- whether AI contributed
- confidence or quality metadata where available

Explanations must be stable enough for users to understand why an item appeared, but they should not
expose secrets, raw prompts, private credentials, or provider internals.

## Controls

Pinned items appear first. Manual ordering is global. Dragging does not create negative feedback.
Complete does not strongly penalize future items. Dismiss may contribute negative relevance feedback
only when ranking-feedback controls record that intent. AI may adjust only within documented bounds.

All fetched email remains searchable even when it is below the promotion threshold. The AI
importance threshold is applied after scoring, so the model scores independently and does not
receive the threshold value.

## Complete and dismiss

Complete means the user handled an actionable item. It moves applicable items to completed history
and should not strongly suppress similar future items.

Dismiss means the user no longer wants the item in Active. Normal Dismiss moves the item to
dismissed history without modifying the provider source. Ranking Mode may expose more detailed
relevance feedback for dismissals, but the base Dismiss action is a local state change.

Dismiss must not modify provider content. Drag reorder must not create negative relevance feedback.

## AI bounds

AI may summarize, estimate urgency, extract due dates, detect likely action requests, suggest tasks,
and apply bounded ranking adjustments. Deterministic rules and explicit user rules outrank AI
output. Core ranking must work with AI disabled.

Custom global or per-Gmail-account importance instructions supplement DentLink's fixed structured
prompt. A separate per-user global summary wording instruction can guide generated phrasing,
filtering, and replacement language. They cannot replace required output-schema, safety,
normalization, or provider-neutral instructions. Per-user hard-coded text replacements run after AI
processing against notification subjects and summaries. Prompt, replacement, and threshold changes
can trigger same-day reprocessing from stored normalized Gmail source records without refetching
Gmail or duplicating notifications.
