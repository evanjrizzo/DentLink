# Ranking

Ranking is explainable, centrally calculated, useful without AI, and responsive to feedback.

## Authority

The backend calculates authoritative rank and global ordering. Clients display rank, explanations, and order controls, but they do not calculate the final ranking result.

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

Explanations must be stable enough for users to understand why an item appeared, but they should not expose secrets, raw prompts, private credentials, or provider internals.

## Controls

Pinned items appear first. Manual ordering is global. Dragging does not create negative feedback. Done does not strongly penalize future items. Dismiss does. AI may adjust only within documented bounds.

All fetched email remains searchable even when it is below the promotion threshold.

## Done and dismiss

Done means the user handled the item. It moves applicable items to completed history and should not strongly suppress similar future items.

Dismiss means the item should not have been promoted. It is available only in Ranking Mode on web and desktop, moves the item to dismissed history, and records negative relevance feedback.

Dismiss must not modify provider content. Drag reorder must not create negative relevance feedback.

## AI bounds

AI may summarize, estimate urgency, extract due dates, detect likely action requests, suggest tasks, and apply bounded ranking adjustments. Deterministic rules and explicit user rules outrank AI output. Core ranking must work with AI disabled.
