# FinMate UI Implementation Prompt

Build a production-quality A-share market intelligence workspace, not a landing page.

The visual language is precise, calm, and slightly technological: near-black backgrounds,
charcoal analytical surfaces, neutral gray structure, and a restrained signal-yellow accent.
Use A-share semantics consistently: red means rising and green means falling. Cyan may
identify data provenance or model state, but it must never compete with market direction.

The first viewport must communicate the product immediately through live-looking market
state rather than marketing copy. Place a compact A-share index tape and global reference
indices above a large collision-based market field. Stocks are physical circles: radius
represents absolute price movement, fill represents direction and intensity, and force
layout separates rising and falling instruments into clearly labeled zones. Motion should
continue as gentle drift and collisions after layout. Pause movement during pointer inspection
and when the browser tab is hidden; respect reduced-motion preferences. Hover enlarges the focused stock and fades unrelated
nodes. Clicking reveals stock facts, sector breadth, and attributed event/news context.

Provide a discreet two-icon segmented view switch beside search. The alternative is a
sector-grouped rectangular treemap with area proportional to turnover. Both modes share
search, filters and detail selection. Remember the selected mode locally; default to bubbles.

Keep information density suitable for repeated analyst use. Prefer flat bands, thin rules,
small-radius panels, tabbed detail views, crisp typography, and concise Chinese labels. Avoid
marketing heroes, oversized headings, decorative blobs, glassmorphism, nested cards, and
gratuitous gradients. Every timestamp, demo state, source, model-enhanced answer, and risk
boundary must remain visible. The AI explains verified data; it never invents prices or news.

On mobile, preserve the full market interaction, stack the detail panel below the canvas,
and keep all controls reachable without document-level horizontal scrolling. Validate both
desktop and mobile with real canvas pixels, pointer interaction, selection state, and text
overflow checks.
