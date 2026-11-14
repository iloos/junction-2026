# User directives ledger (Sat 14 Nov, Ring 4 → freeze)

_Lead-kept. Every steer the user gave since Ring 4, with its owner and state. `[x]` merged, `[~]` in progress, `[ ]` queued, `[p]` pitch only, `[!]` waiting on the user. Update a row when its state changes; add a new row for each new steer._

## The shape (D15, full merge, balanced)
| # | Directive | Owner | State |
|---|---|---|---|
| S1 | Join as an establishment: pick a seeded kitchen or describe yours (notes stay editable and change no rule) | c3 (picker), 0d (all 7 joinable) | [ ] |
| S2 | A chat-first home: one composer is the entry, with chips per profile | 1f (home state), E (chat) | [ ] |
| S3 | Request merges into the agent: its steps are chat cards, edit in place, re-run only downstream; /request redirects | B (pipeline + cards), E (renders) | [~] |
| S4 | The Kitchen is the canvas once a basket exists; the agent docks in the right rail (Decide on top); both sides stay in sync | 1f | [~] rail done, home next |
| S5 | Fallback if the merge isn't deployed by Sun 04:00: picker + chat home; /request linked from cards | lead | rule |

## Request and chat
| # | Directive | Owner | State |
|---|---|---|---|
| R1 | A real delivery-date control with cut-offs, holidays and festivities (a day picker, not just an .ics) | c3 (DayPicker), B (uses it) | [~] |
| R2 | "Deliver Wed instead" jumped to Thu: name the real day and why | B ea36d02 | [~] gating |
| R3 | No raw ids or keys on screen (product codes, rq- keys) | B 5666527, da (/agents), E (chat step) | [~] |
| R4 | A dish plus a count reads as portions, with visible ratio reasoning (75% beef / 25% pork) | B (interpretDish), E (chat) | [~] |
| R5 | Ready-made vs from raw ingredients, recipe-backed, side by side | B | [~] |
| R6 | Never pick a product that contradicts the ask (soy for "cow") | B checks.ts | [~] |
| R7 | The over-limit card offers ways forward, not "place it anyway" | B | [ ] |
| R8 | Personalisation: remember usual day, ranking and units; say where defaults come from | B | [ ] |
| R9 | Chat: "understood an order" then "not recognised" contradiction; first message vanished; chips not clickable; duplicated prompt; a useful "what" follow-up | E | [ ] |
| R10 | Quantity and item read separately; a product opens a card with the public Valio Aimo listing (via Exa) | D (ProductToken), 1f/B/d0 adopt | [~] |

## Kitchen
| # | Directive | Owner | State |
|---|---|---|---|
| K1 | Switching kitchen must switch the basket: one event per kitchen | 0d b8f58db | [~] gating |
| K2 | The Christmas 140 is overused: vary the app and site examples | 0d (events), d0 (cards done), 1f (copy) | [~] |
| K3 | Diet and allergen marks (G/L/VL/M/VEG/VE, EU allergens; "no allergen record" when undeclared), per line/dish/order, with one legend | 1f d8a5c95 | [x] |
| K4 | Say on the collapsed row why a product changed ("Out at Valio → …") | 1f a16e192 | [x] |
| K5 | Group "still not covered" by reason, with a one-tap approve | 1f 3443052 | [~] queued |
| K6 | Agent sidebar pushes the page, is resizable, and shows decisions once | 1f 0e204a0 | [~] queued |
| K7 | Options with one labelled "Valio suggests" slot (upsell/cross-sell, honest, inside the mandate, never the default; "I don't mind") | 8d (rule), 1f (card) | [ ] |
| K8 | A comparison table (properties as columns, sort/filter) inside Compare; cards only with images | 1f | [ ] |
| K9 | The calendar link didn't work: an "Add to calendar" menu (.ics, Google, copy), demoted | c3 | [~] |

## Profiles, memory, recurring
| # | Directive | Owner | State |
|---|---|---|---|
| P1 | More establishment profiles (à la carte, care home, café, ski resort) shaping the recommendations | 0d 0501b16 | [~] gating |
| P2 | Order history per kitchen; a window of n days/weeks/months, a few months max; detect periodic patterns (D14) | lead agent U (lane/u-usual) | [~] |
| P3 | Usual / recurring orders as suggestions the chef confirms; top-ups on top; dependable demand for Valio | U (core), UI after | [~] |

## Ops (Valio's side)
| # | Directive | Owner | State |
|---|---|---|---|
| O1 | An orders overview like a diff (asked → proposed → signed → ordered) that doubles as approval and supplier view | 9c | [x] on prod next deploy |
| O2 | Demand as Valio sees it, per delivery day across kitchens | 9c 4d60718 | [~] gating |
| O3 | Ops still "not there": a design brainstorm with the user, then a brief | d0 (with the user) → 9c | [~] |

## Site and pitch
| # | Directive | Owner | State |
|---|---|---|---|
| W1 | The landing page shows the full chain: kitchen → event → dish → ingredient → product → order | d0 | [x] live |
| W2 | Rework /how around the chain | d0 | [x] live |
| W3 | Quantity tokens on the case cards | d0 | [x] live |
| W4 | Re-record the chain on the lunch or school event once it's on prod | d0 | [ ] after deploy |
| W5 | Kafka on Aiven via Debezium, as pitch "next" | lead (PITCH Next) | [p] |
| W6 | Margin-aware suggestions; Exa monitors for web-wide watch | lead (PITCH Next) | [p] |

## Review and process
| # | Directive | Owner | State |
|---|---|---|---|
| V1 | Round 11: a sponsor-usage pass plus end-to-end wiring and quality, as an adversarial review on the deployed build | lead (dispatch ~3–4 h before freeze) | [ ] |
| V2 | Keep reviewing continuously with every session; land stable first, then iterate | lead | ongoing |
| V3 | Booth: reduce friction; reliable, trustworthy, private; clean mix of UI and agent | all | ongoing |

## Waiting on the user
- [!] Placeholder Valio prices and the git history rewrite before the repo goes public.
- [!] `SMOKE_KEY` for the race smoke.
- [!] The Nemotron endpoint (the current one returns 404).
- [!] A push for 91's lane/f-evals to origin (91's session asked you; I merge its local head meanwhile).
