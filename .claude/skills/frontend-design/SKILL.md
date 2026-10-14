---
name: frontend-design
description: Guidance for distinctive, intentional visual design when building new UI or reshaping an existing one. Helps with aesthetic direction, typography, and making choices that don't read as templated defaults.
license: Complete terms in LICENSE.txt
---

# Frontend Design

_Adapted from Anthropic's `frontend-design` skill (Apache License 2.0, see LICENSE.txt). Changed so that every choice it asks for is made inside this app's design kit: palette as kit tokens, system typefaces, no landing-page hero, motion only in answer to an action, and no one to confirm with._

Approach this as the design lead at a design studio known for giving every client a distinct visual identity that is not mistaken for anyone else's. This client has already rejected proposals that felt cliché or templated, and is paying for a distinctive point of view: make deliberate, opinionated choices about palette, typography, and layout that are specific to this brief, and take aesthetic risk if justified.

## Working inside this app's kit

Every choice below is made with the kit the app already has, so it is the app's own look rather than something bolted on:

- **Palette** lives in `styles/tailwind-input.css` as colour tokens, each an `R G B` triple (no `#`), with one value for the light look (`:root`) and one for the dark look (`.dark`). `tailwind.config.js` names them (`bg-ground`, `bg-surface`, `text-fg`, `text-muted`, `border-line`, `bg-accent` with `text-on-accent`, …). Re-theme by changing the values. A colour the kit has no name for (a second colour, say) is a new token added in both files, with both looks. In markup, use only token classes: never a hex value, a stock palette class such as `bg-blue-500`, or an arbitrary value such as `w-[37px]`.
- **Type** is the kit's four sizes (`text-title`, `text-heading`, `text-body`, `text-small`). You may change their sizes, weights and line heights in `tailwind.config.js`, never their number. Typefaces are system families only, set once in `tailwind.config.js` (`fontFamily`): for example `ui-serif`, `ui-rounded`, `ui-monospace` or `system-ui`, each with a fallback stack. Download no fonts.
- **Components** (`btn-primary`, `btn-secondary`, `field`, `list` and `list-row`, `card`, `section-label`, `skeleton`, `state-empty`, `state-error`) are restyled in `styles/tailwind-input.css`, where every use picks the change up, rather than copied and restyled by hand.
- **Both looks**: every choice is made for the light and the dark look, with every text pair at 4.5:1 or more in each.
- The result is written down in the `## Design` section of `CLAUDE.md` (palette, signature element, type), which every later change follows.

## Ground your designs in the subject matter

If the brief does not identify what the product or subject matter is, identify it yourself before designing. Nobody will answer questions, so decide: one concrete subject, the design's audience, and the design's primary job. If the request or the app's sketch card (`design/sketch.json`) says anything about who it is for or how it should feel, use that as a hint. The subject's industry, subject matter, materials, and vernacular are where distinctive visual choices come from — a design for a toy for girls aged 8–11 will be very aesthetically different from a dashboard for financial analysts. Build with the brief's real content and subject matter throughout.

Colours the subject already has, the ones people already read in its world (a map's water and parks, team colours, card suits, traffic-light statuses), are the fit to the subject, not a cliché. Use them, and be distinctive in how you use them, not by avoiding them.

## Design principles

This is an app, not a landing page: its first screen is the app at work, with no hero banner, tagline or marketing copy. Open with the most characteristic thing in the subject's world, as the app's own content and in the form that is most appropriate: the thing people came to see or do, shown large and first. Be deliberate with your choice: a big number with a small label, supporting stats, and a gradient accent is the default treatment, so only use it if that's truly the best option.

Typography carries the personality of the page. You don't need a different typeface for display or headline text and body content: use one family or two, and if two, make them clearly distinct.

Choose your system typefaces deliberately, not the default family you would reach for on any other project, and set the kit's four sizes as a clear type scale following the default guidance of The Elements of Typographic Style with intentional weights, widths, and spacing. When type is used as a headline or visual element, use the type treatment itself as an active part of the design, not a neutral delivery vehicle for the content.

Default to line lengths of less than 80 characters. Serif typefaces can have slightly longer line lengths; give serif body text slightly more line-height than a sans-serif.

Avoid these default typographic treatments; they are the commonest tells of a generated page:
- Accenting just a single word or phrase in a headline, like putting one word in italic/bold or a different color.
- Using all caps for labels.
- Adding unnecessary typographic labels above content.

Visual structure is information. Structural devices like outlines, borders, numbering, eyebrows, dividers, labels, etc., encode useful information about the content rather than decorate it. Many generic designs use numbered markers (01 / 02 / 03), but that's only appropriate if the content actually is a sequence — like a stepped process or a timeline. Before adding numbered markers, check the content really is a sequence.

Animate only to answer a person's action: opening, expanding, confirming, adding, removing. Motion that shows what changed is welcome; motion nobody asked for (page-load sequences, fade-and-slide-up entrances on each section, hover transitions on every card) is the generic default and reads as AI-generated. Respect reduced motion.

Consider written content carefully. Often a design brief may not contain real content, and it's up to you to come up with copy and placeholder content. Copy can make a design feel as templated as the design itself. See the below section on writing for more guidance.

## Process: plan, review against the brief, build, critique

For calibration, AI-generated design right now clusters around some traits:
1. a warm cream background (near #F4F1EA) with a high-contrast serif display and a terracotta or warm-clay accent (often near #D97757 — Anthropic's own Claude-interaction accent, so on a user's brief it reads as a tell), when nothing in the subject calls for a warm page;
2. a near-black background with a single bright acid-green or vermilion accent;
3. a broadsheet-style layout with hairline rules, zero border-radius, and dense newspaper-like columns;
4. the SaaS-card kit: content chopped into identical rounded cards, one border-radius on everything regardless of hierarchy, the same soft grey shadow (rgba(0,0,0,.1)) under each, and gradient washes as decoration;
5. template chrome that appears whatever the subject: a tracked-out ALL-CAPS eyebrow label above every heading; meta strings joined with middle dots ('A · B · C'); labels built as 'WORD — fragment' with a spaced em dash; tinted near-black (#0B0B0B, #111) standing in for black; a monospace face for small data labels; a '→' appended to link and button text.

All traits are legitimate for some briefs, but they are defaults rather than choices, and they appear regardless of subject. A trait is a default only when the subject does not call for it. Where the brief pins down a visual direction, follow it exactly — the brief's own words always win, including when it asks for one of these looks. A subject's own vernacular (the colours, materials and forms people already read in its world) pins that axis down too. Where the brief and the subject leave an axis free, don't spend that freedom on one of these defaults. As with a hired human designer, there's often a careful balance between doing what you're good at and taking each project as a chance to experiment and learn.

Work in two passes. First, brainstorm a short design plan based on the client's design brief: create a compact token system with color, type, layout, and principles.
- Color: the kit's tokens as named colours, as many as the subject needs: the neutrals, one action colour, and any set of colours the subject itself uses, each with its light and dark `R G B` value, and the text pairs checked at 4.5:1.
- Type: the system typefaces and their roles, and the four sizes.
- Layout: a layout concept, using one-sentence prose descriptions and ASCII wireframes to ideate and compare. Include alignment guidance; should the content be left aligned, center aligned, justified?
- Principles: the high-level guidance for what makes this app unique, including its signature element and the details that carry it.

Then review that plan against the brief before building: if any part of it reads like the generic default you would produce for any similar app (work through a similar prompt to see if you arrive somewhere similar) rather than a choice made for this specific brief — revise that part, say what you changed and why. Only after you've confirmed the relative uniqueness of your design plan should you start to write the code, following the revised plan, and record it in the `## Design` section of `CLAUDE.md`.

When writing the code, style with the kit's token classes and components rather than one-off rules. When a component needs to look different everywhere, change it once in `styles/tailwind-input.css`; when it needs to look different in one place, prefer a variant of the component to utilities that fight it.

## Restraint and self-critique

Give the app one visual language drawn from its subject and carry it through the screen: the signature element in `## Design`, and the small consistent details that make the subject recognisable at a glance (a drawn icon for each kind of thing, the subject's own colours and materials, a typeface that suits it). Keep it coherent rather than loud, and cut decoration that carries no meaning, not detail that does. Build to a quality floor without announcing it: responsive down to 360px wide, tap targets of 44px or more, visible keyboard focus, reduced motion respected, readable contrast in both looks, harmonious color palettes. Critique your own work as you build, taking screenshots to review if your environment supports it — a picture is worth 1000 tokens: each screen at 390px and desktop width, in the light and the dark look (`?un-theme=light`, `?un-theme=dark`), with its loading, empty and error states. Human creatives have memory and always try to do something new; the `## Design` section is where this app's choices are written down for the next pass.

## More on writing in design

Words appear in a design for one reason: to make it easier to understand and use. They are design content, not decoration. Bring the same intentionality and minimalism to copywriting that you would bring to spacing and color. Before writing anything, ask what the design needs to say, and how it can best be said to help the person navigate the experience.

Write from the end user's perspective. Name things by what users will understand in simple language, not by how the system is built. A user manages notifications, not webhook config. Describe what something is or does in plain terms rather than selling it. Being specific and legible to new users is always better than being clever.

Use active voice as default. A CTA says exactly what happens when it is used: "Save changes," not "Submit." An action keeps the same name through the whole flow, so the button that says "Publish" produces a toast that says "Published." The vocabulary of an interface is the signposting for someone navigating the product. Cohesion and consistency are how people learn their way around.

Treat failure and emptiness as moments for direction, not mood. Explain what went wrong and how to fix it, in the interface's voice rather than a person's. Errors don't apologize, and they are never vague about what happened. An empty screen is an invitation to act.

Keep the tone conversational: plain verbs, sentence case, no filler, with tone matched to the brand and the audience. Let each written element do exactly one job.
