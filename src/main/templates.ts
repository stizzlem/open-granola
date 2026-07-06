export interface Template {
  id: string;
  label: string;
  structure: string; // instructions for the output structure
}

export const TEMPLATES: Template[] = [
  {
    id: 'generic',
    label: 'Generic meeting',
    structure: `Structure the notes as:
# {meeting title}
## Summary
2-4 sentences on what the meeting was about and where things landed.
## Key points
Bullet list of the important points discussed, each backed by what was actually said.
## Decisions
Bullet list of decisions made (write "None recorded" if none).
## Action items
Checkbox list (- [ ]) of action items with owner and due date when mentioned.`,
  },
  {
    id: '1on1',
    label: '1:1',
    structure: `Structure the notes as:
# {meeting title}
## Topics discussed
Bullet list of topics, grouped by theme.
## Feedback & growth
Any feedback given or received, coaching points, career discussion (omit section if none).
## Blockers & concerns
Anything raised as a blocker, worry, or friction (write "None raised" if none).
## Agreements & follow-ups
Checkbox list (- [ ]) of what each person committed to before the next 1:1.`,
  },
  {
    id: 'standup',
    label: 'Standup',
    structure: `Structure the notes as:
# {meeting title}
## By person
For each speaker identified: what they did, what they're doing next, blockers.
## Blockers
Consolidated bullet list of all blockers (write "None" if none).
## Follow-ups
Checkbox list (- [ ]) of items that need attention outside standup.`,
  },
  {
    id: 'sales',
    label: 'Sales call',
    structure: `Structure the notes as:
# {meeting title}
## Prospect & context
Who was on the call and where this deal stands.
## Needs & pain points
What the prospect needs, what problems they raised.
## Pricing & commercial terms
Any numbers, budget signals, discounts, contract terms discussed — quote exact figures.
## Objections & risks
Concerns raised and how they were handled.
## Next steps
Checkbox list (- [ ]) of concrete next steps with owner and date when mentioned.`,
  },
  {
    id: 'discovery',
    label: 'Customer discovery',
    structure: `Structure the notes as:
# {meeting title}
## Participant context
Who we talked to, their role, and their environment.
## Current workflow
How they work today, in their words.
## Pain points
Bullet list of problems and frustrations, each with a supporting quote from the transcript.
## Feature reactions & requests
Reactions to anything we showed or proposed; requests they made.
## Insights & hypotheses
What we learned; hypotheses confirmed or challenged.
## Follow-ups
Checkbox list (- [ ]) of follow-up actions.`,
  },
];

export function getTemplate(id: string): Template {
  return TEMPLATES.find((t) => t.id === id) ?? TEMPLATES[0];
}
