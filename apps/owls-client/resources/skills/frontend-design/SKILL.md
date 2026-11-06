---
name: frontend-design
description: Use when the user asks to build, modify, redesign, style, polish, or critique a user-facing frontend UI, including websites, web apps, pages, dashboards, internal tools, landing pages, artifacts, React components, HTML/CSS layouts, forms, tables, navigation, and responsive layouts.
---

This skill guides creation of production-grade frontend interfaces with strong UX and visual design quality. Implement real working code with attention to user context, interaction quality, information structure, visual craft, and the role the interface plays.

Avoid AI slop: template-like layouts, default aesthetic reflexes, purposeless decoration, generic visual tropes, and effects that compete with the user's task. Avoiding slop does not mean making every interface loud or unusual. It means making deliberate, context-aware choices that improve the experience.

## Design Thinking

Before coding, understand the context and choose the right design register:
- **Purpose**: What problem does this interface solve? Who uses it?
- **Register**: Is this a brand surface or a product surface?
  - **Brand surfaces**: marketing pages, landing pages, portfolios, editorial/content experiences, campaign pages, and visual experiments where design is part of the message.
  - **Product surfaces**: app UI, dashboards, tools, settings, admin, ops, support, review, configuration, data/analytics, authenticated surfaces, and other internal tools or platforms where design serves the user's task.
- **Tone**: Pick a direction that fits the register. Brand surfaces can be more expressive, memorable, and art-directed. Product surfaces should optimize for trust, clarity, familiarity, speed, consistency, and task completion. Product UI can still be beautiful, but its craft should often disappear into the workflow.
- **Component strategy**: Prefer the project's existing design system first. If none exists, consider pragmatic component primitives such as shadcn/ui, Radix UI, or the framework's native component ecosystem, especially for forms, tables, menus, dialogs, tabs, filters, and toolbars. Use libraries for accessible, predictable interaction behavior; do not let them dictate the whole visual style.
- **Interaction model**: Identify the primary workflow, repeated actions, decision points, and failure states.
- **Constraints**: Technical requirements (framework, performance, accessibility).
- **Differentiation**: What should users immediately understand or remember?

Choose a clear direction and execute it with precision. Bold maximalism, refined minimalism, and quiet utility can all work. The key is fitness to context, not intensity.

Then implement working code using the project's frontend stack that is:
- Production-grade and functional
- Visually polished and appropriate for the product context
- Cohesive with a clear interaction model and visual point of view
- Meticulously refined in every detail

## Human-Centered Principles

Design with empathy for the user's attention, time, task, and environment. The interface should feel natural, comfortable, efficient, and trustworthy.

- **Function before expression**: Form, color, motion, typography, and layout should make the product easier to understand and use. Visual expression is valuable only when it clarifies purpose, hierarchy, state, feedback, or brand voice.
- **Respect attention**: Do not compete with the user's task. Draw attention only where it helps the user decide, act, recover, or understand what changed.
- **High signal, low fatigue**: Favor durable, readable interfaces over first-glance spectacle. Avoid visual noise, gratuitous novelty, and effects that become tiring after repeated use.
- **Pleasure through flow**: Delight should come from clarity, speed, responsiveness, stability, thoughtful details, and graceful recovery, not decoration for its own sake.
- **Proportional expression**: Match visual ambition to user intent. A campaign page can ask to be noticed; a tool used all day should help users stay focused.

## Product Surface Quality

For product surfaces, the failure mode is not flatness. It is strangeness without purpose: over-decorated controls, mismatched affordances, gratuitous motion, display fonts in functional labels, and invented interactions for standard tasks. The bar is earned familiarity.

Judge product UI by:
- **Clarity**: Users can immediately understand what exists, what changed, and what to do next.
- **Efficiency**: Common actions are close at hand. Repeated workflows minimize clicks, scrolling, waiting, and mode switches.
- **Information density**: Screen space matches task density. Data-heavy tools should be compact and scannable without feeling cramped.
- **Consistency**: Navigation, controls, tables, filters, dialogs, status indicators, and forms reuse the same vocabulary.
- **State coverage**: Loading, empty, error, success, selected, disabled, unsaved, destructive, and permission states are designed.
- **Familiarity and restraint**: Standard affordances are a strength. Color, motion, typography, and decoration support hierarchy and feedback, not spectacle.

Product surface defaults:
- Use restrained color. Accent color is for primary actions, current selection, focus, and meaningful status, not decoration.
- Prefer highly readable typography. One well-tuned family is often better than decorative display/body pairing.
- Use predictable structure, strong alignment, controlled density, and practical type scales.
- Motion should convey state, feedback, loading, navigation, or focus. Avoid choreography that delays the user.

## Brand Surface Quality

Brand surfaces have more permission to be expressive because impression, memory, and narrative are part of the job.

For brand, editorial, entertainment, and experimental surfaces:
- Commit to a clear point of view. Distinctive typography, stronger color strategies, art direction, imagery, and purposeful motion can all be appropriate.
- Avoid generic AI aesthetics: cliched palettes, predictable hero/card grids, decorative effects with no concept, and template-like layouts.
- Use imagery, media, illustration, or rich visual systems when the brief implies a real product, place, person, object, or story.
- Make creative choices specific to the brand and audience, not to the generic category.

## Interaction & Information Design

Good frontend work is not only visual. It should make the user's job faster, clearer, and less error-prone.

For every register:
- **Information architecture**: Put the most important objects, statuses, and actions where users expect them. Avoid hiding core workflows behind decorative structure.
- **Screen efficiency**: Use space according to task density. High-frequency workflows and data-heavy tools need compact, scannable layouts; expressive spacing is better for narrative or brand-led pages.
- **Interaction efficiency**: Reduce unnecessary clicks, mode switches, and scrolling. Provide direct controls for common actions and progressive disclosure for rare or destructive actions.
- **State clarity**: Users should always know what changed, what is actionable, and what needs attention.
- **Data usability**: For tables, lists, dashboards, and records, support comparison, filtering, sorting, grouping, selection, batch actions, and readable status indicators when the task calls for them.
- **Feedback and recovery**: Make destructive actions confirmable or undoable. Show inline validation and actionable error messages near the source of the problem.

## Shared Craft Guidelines

Apply these to both registers:
- **Typography**: Choose fonts that fit the context. Expressive pages can use distinctive type. Product surfaces often need restrained, highly readable typography.
- **Color & Theme**: Use CSS variables for consistency. Pick a color strategy before picking colors: restrained, committed, full palette, or drenched. Product surfaces usually start restrained; brand surfaces can earn more committed strategies.
- **Layout**: Match layout ambition to the task. Expressive experiences can break the grid; repeated-use product surfaces usually need predictable structure, strong alignment, and controlled density.
- **Motion**: Use animation only when it improves orientation, feedback, continuity, or delight without blocking the task. Respect reduced motion.
- **Visual Details**: Texture, depth, glow, blur, gradients, and decorative backgrounds must earn their place. They should clarify hierarchy, strengthen brand voice, or create a meaningful atmosphere, not fill empty space.
- **Accessibility**: Text must be readable. Interactive controls need visible focus, disabled, hover, active, loading, and error states. Contrast and text overflow matter more than decorative polish.

Avoid generic AI-generated aesthetics: cliched color schemes, hero-metric templates, repeated icon-card grids, decorative effects with no purpose, and cookie-cutter layouts that lack context-specific character. Predictable layouts, familiar component patterns, and common UI fonts are acceptable when they improve usability, readability, and speed for the user's task.

Remember: strong frontend design comes from matching visual ambition to the user's actual context, then executing that direction with care. The best product interfaces often feel inevitable rather than flashy.
