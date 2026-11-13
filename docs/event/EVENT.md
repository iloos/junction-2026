# Junction 2026 — the facts that matter

Source: the participant guidebook PDF (kept local, not in git), https://2026.hackjunction.com/, partner pages (researched 13 Nov 16:00–17:30). Tags: [C] = confirmed, [S] = seen in social posts, [I] = our inference.

## Clock (Europe/Helsinki, UTC+2)
| When | What |
|---|---|
| Fri 16:00 | Doors, registration on the 2nd floor (ID plus the QR code from the dashboard) |
| Fri 18:00–19:30 | Opening; DeepMind keynote 18:30; **challenge videos at 19:10** |
| **Fri 19:30** | **Hacking starts. No code before this.** |
| Fri 20:00 | Google DeepMind workshop · 20:30 Verda · 20:30 Arduino · 21:00 MLH×GitHub |
| **Fri 23:55** (platform; the guidebook says 23:59) | **Pre-submission draft** (team count plus chosen challenge; the challenge can change later). We aim for 23:30. |
| Sat 11:00 | **Cala workshop** ("what our judges are looking for") · 12:00 Intel · 13:00 Hostinger keynote · **13:30 Modal** · 14:30 Kiuas · **16:30 Exa** · **17:30 Context.dev** · 18:00 Maria01 (founding in Finland) |
| Sat 12:00 | Submissions open |
| **Sun 06:00** | **Our feature freeze** (self-imposed) |
| **Sun 10:00** | **Final submission, hard.** Set it to FINAL, not DRAFT. |
| Sun 10:30–14:00 | Live peer review. **The whole team must be present** or we're ineligible for the main prize. |
| Sun 14:15 | Top-5 pitches: 3 min plus 3 min Q&A, mic cut at 3:00, demo from our own laptop |
| Sun 15:10 / 15:50 | Challenge winners / Junction winner |
| Sun 17:00 / 18:00 | Event ends / doors close |

## Rules that can disqualify us [C]
- No code written before the event. All code outside open-source libraries must be written at the event.
- No project "somehow related to an already existing company". The project stands alone.
- Team size 1–4. At least one challenge (we may submit to several).
- Submission is MIT-licensed and the source must be accessible.

## Submission checklist [C]
- [ ] Name, punchline, description
- [ ] Challenge(s), plus every tech challenge we qualify for
- [ ] Technologies used
- [ ] **2-minute video**, public (YouTube/Vimeo). Not a second over.
- [ ] Demo link plus public source link
- [ ] Pitch deck PDF
- [ ] Phone numbers and Discord handles
- [ ] Source code publicity setting, plus "credit us?"
- [ ] Status: FINAL

## Judging [C]
- Generic criteria: **Innovation** (new or different compared with others), **Impact** (significance and share of affected people helped), **Implementation** (realistic, viable, feasible).
- Partners pick challenge winners on their own criteria. Read every brief in the logged-in Junction app (the public challenge URL returns 404, and partner criteria aren't published).
- Main prize: peer review → top 5 → 7-judge jury.

### Grand jury (their own words = our rubric) [C]
| Judge | Looks for |
|---|---|
| Kia Kanninen (Founders House) | "problem worth solving, not just a feature that's easy to build" |
| Daksh Raghuvanshi (AfterQuery, RL) | "explain exactly why an agent fails"; reward that holds when someone tries to break it |
| Otto Söderlund (Supercell AI) | a real user problem, something people come back to |
| Umar Noor (Google DeepMind) | — |
| Beer van der Drift (Context.dev CTO) | moves fast, pragmatic, a "unique insight that solves a problem 10x faster" |
| Arturs Polis (Verda CTO) | hardest problems, a clear path to production and scale |
| Timo Ahopelto (Lifeline Ventures) | VC lens [I] |

[I] Four of seven are founders or investors, and Slush is next week. Business framing (who pays, why now) counts alongside the tech.

## Tracks and known challenges
Tracks [C]: Hardware, Healthcare, AI Infrastructure, FinTech, **Agentic AI**, **Data**. Tech challenges (best-use prizes) cut across all of them, so they stack.

| Partner | Challenge | Data | Src |
|---|---|---|---|
| Cala | **Make Unicorns Real**: a product for founders/VCs on Cala's public company/people/investor/funding graph | Cala API + MCP | C |
| MariaDB | **Wikipedia Through Time**: track how knowledge changes; sourced answers | vector search plus system-versioned (temporal) tables | S |
| S-Pankki | **Personal Economic Trainer**: AI that helps people understand their spending | synthetic banking data | S |
| Valio Aimo | **Trusted Trade Agents**: foodservice purchasing agents, humans in control | synthetic data, mock APIs | S |
| Aalto Univ. | Wellbeing at home after depression treatment (sensing plus adaptive support) | ? | S |
| Meta | AI-glasses experiences | glasses SDK | S |
| Context.dev | Open: "build anything with Context.dev" | live web data API | S |
| Verda | Best use of Verda: €10k / €2.5k / €2.5k credits; hard problem plus path to scale; **document the process** | GPU cloud; OpenAI-compatible inference `https://inference.verda.com/v1` (`kimi-k3-1-pro`, `deepseek-4-1-flash-1017`) | C |
| Modal | Best use of Modal | credits | S |
| Arduino / Intel | Hardware Lab, OpenVINO | boards, robot arms | C |
| No brief found yet | City of Espoo, AstraZeneca, Bahn Express, Stoa, Rokoko (mocap data), AfterQuery, Tieto, Hostinger | | |

Tech partners [C, platform dashboard]: Anthropic, OpenAI, Google DeepMind, NVIDIA, **Featherless**, Modal, Aiven, Oxylabs, Cloudinary, Craci, IronShard, Qualia, Scailab, Wendy, Atech; also Lifeline Ventures, XR Creator Con. Save the platform's "Challenges" and "Developer Tools and Assets" tabs into `Misc/` (gitignored) as soon as they open. Google DeepMind: "something special for the winning teams".

Past main winners: 2025 **WAVELET** (real-time GPU Maxwell-equation simulation, visually stunning), 2024 BREAKDANCE (solo), 2021 Nice-ify (real-time voice de-toxifier). [I] Main winners are tight, live, real-time demos a peer can grasp in under a minute.

Links: platform https://hackjunction.app · Discord https://discord.gg/NMDxBZEep · Wi-Fi `Junction2026` / `pushtheboundaries`
