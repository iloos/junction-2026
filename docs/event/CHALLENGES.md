# Challenges: digest

From the platform's Challenges and Developer Tools pages, saved 13 Nov 20:00. The raw saves are in `Misc/manual page saves/` (gitignored). Prizes are per team unless noted. **The guidebook allows one project to be submitted to several challenges**, and the challenge can be changed later. **Fit** is our first read against our strengths (agentic chat, data dashboard, transforms, provenance, KG).

## Agentic AI
| Challenge | Ask (one line) | Judged on / hard requirements | Prize | Fit |
|---|---|---|---|---|
| **Hostinger:** Decode the Noise | Detect propaganda, bots and bad actors in text, social or traffic data | **Must run live on Hostinger** with a public URL. The honesty of the detection logic and its false-positive handling count more than the UI | €2k / €1k, plus a year of hosting | med |
| **Tieto:** Earned Trust in AI Code | An AI code-review concept: a PR that explains itself (what, why, what it touches, per-part confidence), and what the AI *refused to decide* | A concept card (principles, trade-offs), a live walkthrough of "where the trust comes from", a lessons log, one sample agent-written change with a requirement ID, and how a named human accepts it without a full read | €2k / €1k / €500 | **high**: provenance-native |
| **Bahn Express:** Spread | Run a simulated car-transport company for a week: quote prices, post driver gigs, set fees | A leaderboard by gross margin with ≥90% on time. Ranking rounds **from Fri 19:30**; final Sun 08:00 (register by 07:30). The top 10 present; the jury judges elegance and robustness. Event code `spread-kmu9z6`; feed `spread.bahnexpress.com/llms.txt` to agents | €2k / €1k / €500 | med (optimisation, separate game) |
| **AfterQuery:** Break the Agent | Build an RL environment where frontier agents fail meaningfully; the reward must resist hacking | Rubric: gap 30, meaningful difficulty 30, reward integrity 25, craft 15 (one-command reproducible). Judges rerun it and hunt for exploits for 15 min | €3k / €1.5k / €500, plus a work trial | med–high (eval, jury: Daksh) |
| **Valio Aimo:** Trusted Trade Agents | Interface and operating model so external purchasing agents can look up products, prices and availability, order, and route to human approval | Core: lookup, inquiry→order at fixed prices, permission and approval rules. Optional: delivery and sustainability, substitution, **traceability** ("what the agent did and why"). Open standards, not a black box | **€4k** / €2k / €1k | **high**: MCP and provenance |
| **Exa:** The Internet Butler | A personal agent that finishes tedious real-life tasks (rent legality, benefits, travel disruption) | Exa supplies info a model couldn't know; useful to a specific group; **clear sources**; works on live queries the judges type | $2.5k + $5k credits / $1.5k / $500 | high |

## FinTech
| Challenge | Ask | Judged on | Prize | Fit |
|---|---|---|---|---|
| **Cala:** Make Unicorns Real | One sharp product for founders or investors built on Cala's sourced KG (companies, rounds, investors, connections) | Real need, execution, originality and Cala-as-core, 25% each. Focus over breadth; "usable at Slush on Monday" | ~€5k "Cala Comet" travel + €1k credits | **high**: KG |
| **S-Pankki:** Personal Economic Trainer | Chat with your own (synthetic) bank data. Three baskets: mandatory regular, mandatory irregular, everyday leakage. In the MyData spirit, explore freely; Statistics Finland benchmarks | Mobile or embeddable web app; teaching angle | €2k / €1k / €500 Airbnb | high (coach plus data dashboard) |

## Healthcare
| Challenge | Ask | Requirements | Prize | Fit |
|---|---|---|---|---|
| **AstraZeneca:** Equal Care Across Finland | Find cancer-care pathway gaps (detection → referral → diagnosis → treatment) and **recommend actions** | Public data, **sources for every claim**, at least one indicator from Goal 3 of the national cancer strategy, a working demo. Briefing Fri 20:00 at their stand | €1k / €750 / €250 | med–high (data dashboard plus agent) |
| **Aalto:** Beyond the Clinic | At-home maintenance after TMS depression treatment, as a closed loop (sense → respond → learn) | Open | TBA | low–med |

## AI Infrastructure (Verda track)
| **Stoa:** Make Blueprints Talk | Natural-language Q&A over construction drawings and BIM, **verifiable**: show where in the drawing the answer comes from | Real dataset; hybrids (CV, geometry, small models) favoured | €1k + work trial / €750 / €250 | med (hard CV) |

## Data
| Challenge | Ask | Notes | Prize | Fit |
|---|---|---|---|---|
| **Context.dev:** The Web Is Your Real-Time Database | A product that reacts to the live web: decisions or actions from live data | 50k credits per team, monitors and webhooks, MCP | €2k / €500 | high (live data dashboard) |
| **City of Espoo:** Rethinking Recruitment | Matchmaking events where talent and companies connect despite AI-generated CVs and AI screening | Text-only brief | €1.5k / €1k / €500 | med |
| **MariaDB:** Wikipedia Through Time | RAG over Wikipedia (vector search) and/or edit history via system-versioned tables | SVT or both earns extra credit for ambition; scalability across the provided datasets | €1k + UpCloud / €500 / €250 | med–high (provenance over time) |

## Hardware (Arduino track): low fit for us
Arduino Green Renaissance (UNO Q edge AI) · Meta AI glasses · Intel Physical AI (SO-101 arm, VLA plus Anomalib, €5k/3k/2k) · Rokoko teleoperation · Aalto humanoid G1 sorting (sim first, Docker policy).

## Tech challenges (stack on top of the main pick)
- **Modal** best use: $100 per participant; Sandboxes, web endpoints, Volumes, Dojo fine-tuning.
- **Verda:** €200 credits plus the inference API.
- **MariaDB:** open to any team for "an interesting use of the database".
- **Cloudinary:** submit via form `cld.media/hackathon-survey`.

See [KICKOFF.md](KICKOFF.md) for workshops, MLH extras and more partner detail.

## Credits to claim (one person per team where noted)
| Who | What | How |
|---|---|---|
| Anthropic | $20 per participant | Platform |
| OpenAI | $100 Codex per participant | Platform |
| Google DeepMind | Gemini key per team (≤5 people), emailed tonight; **side prize** for cool Gemini use | AI Studio |
| NVIDIA | **Bounty: 2 RTX GPUs** for building on Nemotron 3.5 Super VL (via Verda) | Discord NVIDIA channel |
| Verda | €200 | Console sign-up + form |
| Modal | $100 per participant | Booth / Discord |
| Exa | $50 per participant | Platform |
| Context.dev | 50k per team, no card | Platform |
| Featherless | $50 coupon | Platform; GPU credits only for selected teams |
| Aiven | $50 | Sign-up |
| CRACI | €1000 CI/compute per team | Invite code in Discord #craci |
| IronShard | Dataset buckets (S3 + MCP) for artefacts >100 MiB | Platform |
| Oxylabs | First month of the $500 plan free with code JUNCTION2026 | **Card required; cancel after** |

## Side prizes we're targeting: known facts vs. questions to ask
| Prize | Known | Ask at the booth / on Discord |
|---|---|---|
| **Google Gemini** | "Big prize money" for building Gemini into the app in a cool or interesting way. One AI Studio key per team (≤5 people), emailed Fri night. Gemini 4: Argon (frontier), Carbon (coding, agents), Hydrogen (fast); Decisions API ("Jev"), Live audio with tool calls, smart transcription; Gemini API agent skill | Amount; criteria; how to enter (tag on platform or a form?); does Decisions API usage count; do we need a model (Gemini 4) in the *runtime*, not just dev |
| **NVIDIA** | 2 teams win an RTX GPU; project must be *powered by* Nemotron 3.5 Super VL (120B MoE, 12B active, multimodal); Verda key via the NVIDIA channel on Discord | How "powered by" is judged (main model vs. one call); rate limits on the key; how to enter |
| **Modal** | Tech challenge on top of the main pick; $100 per participant; Sandboxes, web endpoints, Volumes, Dojo fine-tuning; workshop **Sat 13:30–14:00**, Loft | Prize; criteria (load-bearing use vs. a token call); is the Junction starter kit online |
| **Verda** | €200 credits; the CTO is on the grand jury; workshop **Fri 20:30–21:00**, Loft | Is there a separate best-use prize (the Tech Challenges tab wasn't saved) |

Fri workshops: DeepMind 20:00–20:30 (Loft), Verda 20:30–21:00 (Loft), MLH × GitHub 21:00–21:30. Sat: Cala 11:00, Intel 12:00, Hostinger keynote 13:00, Modal 13:30, Kiuas 14:30, Exa 16:30, Context.dev 17:30, MariaDB 18:00. Sun: Top-5 pitches 14:15; challenge winners 15:10; Junction winner 15:50.
