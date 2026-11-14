# Lane: images (proposal, for the lead to assign)

**Branch:** `lane/images` · **Worktree:** `../junc26-lanes/images` · **Dev port:** 517N · **Owner:** unassigned

## Goal (one sentence, user-visible)
Product lines and rescue candidates show a verified product image when one is legitimately available, and an honest dish/category visual otherwise.

## Context to read first (≤4 files)
- docs/research/product-images.md (measured chain: 14/50 verified)
- docs/research/valio-baseline.md, "Means for Mandate" item 5 (rules: what may be shown and how)
- src/lib/ui/ (line and candidate components)

## Owned paths (only these may be edited)
- scripts/images/** (batch: Open Food Facts → manufacturer page via Exa → Gemini vision verdict)
- src/lib/ui/ProductImage.svelte (new), src/lib/server/images/** (verdict cache reader)
- data/images/ (gitignored cache: URLs + verdicts only, never image files)

## Contracts used (read-only; fixtures exist)
- Product id/GTIN/name/vendor from the catalogue.

## Tasks (small; each one ends in a commit)
- [ ] Batch job writes `data/images/verdicts.json` `{productId, source: off|manufacturer, imageUrl, pageUrl, verdict, checkedAt, licenceBasis}`; re-check on 404 or after 7 days. The app reads only the cache.
- [ ] Display rule:
  - Open Food Facts image: copied/shown with "Image: Open Food Facts contributors, CC BY-SA".
  - Manufacturer image: only verdict `yes`, only by hotlinking the source URL with "source ↗".
  - Variable-weight products: brand-matching packshot without visible size is accepted.
  - Otherwise: a dish illustration or category icon.
- [ ] Hand-check the remaining hero products (about 10) into the cache.
- [ ] Never: Valio webshop/media API images, committed image files, lifestyle photos as the product.

## Acceptance (observable)
- [ ] Kitchen plan screenshot with images where verified and icons elsewhere; attribution visible
- [ ] Works offline (icons only) with no network
- [ ] `pnpm check`, `pnpm test:unit` pass

## Out of scope
Cloudinary (only if the document flow is revived); Gemini-generated dish illustrations (separate small task if wanted).

## Needs (requests to the lead; keep working on the fixture meanwhile)
- The Valio mentors' answer on showing their own-brand packshots (message drafted by 1f).
