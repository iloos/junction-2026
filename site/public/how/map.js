// The system map on /how. Mounts on [data-system-map]: five zones you can open, and the recorded ham line
// (cases.json → cases.#out-of-stock.trace) traced through them as you scroll. Copy follows the system map
// (scratch SYSTEM-MAP.md) and 91's claims check; statuses are "seen live" or "tested", never more.
(() => {
	const root = document.querySelector('[data-system-map]');
	if (!root) return;
	const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
	const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

	// [title, side note, parts, lead, mechanisms: [claim, how, test, status]]
	const Z = {
		doors: ['Doors', 'who asks', ['Kitchen screen: the chef', 'Request page: the chef', 'Chat: the in-app agent', 'Your agent: MCP or REST'],
			'Four ways in. Each acts as someone, and that decides what it may do. Only a person in the kitchen approves; Operations at Valio sees the held lines but cannot grant.',
			[
				['The chef approves exact terms', 'On the Kitchen screen or the chat\'s decision card, hold to confirm.', 'server/store/gate.test.ts', 'tested'],
				['The in-app agent plans and orders inside the mandate', 'It asks at most one question; "approve it" in chat is refused.', 'evals/chat', 'tested'],
				['An outside agent never approves', 'Its key has no approve tool; trying is refused and logged for Operations.', 'judge key → 403', 'live'],
				['Operations sees, never grants', 'Held lines by cause, each order\'s stages, the op log.', '/ops', 'live'],
			]],
		gate: ['One gate', 'every call', ['Known tool', 'Scope of the caller', 'Validated input', 'Identity from key or cookie'],
			'Every door calls the same tools through one gate. Identity comes from the key or the visitor\'s cookie, never from the request.',
			[
				['Same checks for every caller', 'Kitchen, chat, MCP and REST share one tool registry and one gate.', 'agent/adversarial.test.ts · eval s5', 'tested'],
				['Each visitor has a sandbox', 'A signed cookie or judge key binds every call to its own workspace.', 'server/demo/*.test.ts', 'tested'],
				['Outside agents are metered', '120 calls, 30 writes and 20 quotes a minute per key.', 'server/tools/key-limits.ts', 'tested'],
			]],
		rules: ['Pure rules', 'plain code', ['Demand: guests × amount ÷ yield', 'Ranking: known stock first', 'Mandate: act, ask, or refuse', 'One state change: applyOps'],
			'The decisions are plain code you can read. No model and no network call decides what may be ordered; a model can only add a hold.',
			[
				['No part packs', 'Every need is rounded up to Valio\'s lot step.', 'eval s3', 'tested'],
				['Known stock ranks first', 'Hard constraints exclude, then stock Valio states, then the kitchen\'s own weights.', 'core/rank/rank.ts · server/store/pool.test.ts', 'tested'],
				['Unknown stock is never cover', 'A quantity Valio doesn\'t state is never counted as covering a dish.', 'core/mandate/fulfilment.test.ts', 'tested'],
				['Caps hold even when split', 'Line, order and weekly caps; a hard limit no approval can pass.', 'eval s5 · ceiling.test.ts', 'tested'],
				['Never delegated', 'An allergen change, a new product or a broken preference always goes to the chef, in its own group.', 'server/store/groups.test.ts', 'tested'],
				['One way to change anything', 'Every change is one of nine logged operations through applyOps.', 'core/state.test.ts', 'tested'],
			]],
		store: ['Store', 'Postgres', ['Plans and their versions', 'Approvals bound to terms', 'Orders and receipts', 'The op log'],
			'Postgres on Aiven holds the plans, approvals, orders and the log of every change, with who made it and through which door.',
			[
				['An approval covers the exact terms', 'Bound to plan version, terms and mandate version; any edit voids it.', 'server/store/gate.test.ts · eval s4', 'tested'],
				['One receipt per order', 'The same order sent four times at once returns one receipt.', 'scripts/smoke-race.mjs', 'live'],
				['Slow calls never hold a lock', 'Valio and Gemini finish before the transaction starts.', 'server/store/prepare.test.ts', 'tested'],
			]],
		ports: ['Partners', 'each with a fallback', ['Valio Aimo: catalogue, price, stock', 'Gemini: reading, menus, fit', 'Exa: facts from the web', 'Context.dev: recall watch', 'Aiven: Postgres, runtime'],
			'Outside services sit behind ports. Each has a fallback, so the app keeps working, labelled, when one is down.',
			[
				['Valio Aimo', 'Price and stock fetched only for shortlisted products. Fallback: the cached offer, labelled with its age.', 'Why drawer', 'live'],
				['Gemini Flash-Lite and 3.8 Flash', 'Flash-Lite reads requests (fallback: rules). 3.8 Flash proposes menus as estimates (fallback: team dish templates).', 'request page · menu', 'live'],
				['Gemini Decisions', 'Decisions scores how well each substitute fits the dish, one input to the code\'s ranking, and can flag a constraint risk that holds the line. It never approves or allows anything. Fallback: a recorded replay, then rules.', 'one live call (DECIDE_LIVE=1 pnpm test:live)', 'tested'],
				['Exa', 'Facts with sources in the Why drawer, as suggestions that never overwrite the catalogue. Fallback: recorded answers.', 'Why drawer', 'live'],
				['Context.dev', 'Watches Ruokavirasto\'s recall list every 5 minutes; notices become cases in Operations. Fallback: a labelled drill.', '/ops', 'live'],
				['Aiven', 'Postgres and the app container. Fallback: the same migrations on an in-memory Postgres.', 'deployed app', 'live'],
			]],
	};
	const ORDER = ['doors', 'gate', 'rules', 'store', 'ports'];

	root.classList.add('smap');
	root.innerHTML = `<div class="smap-head"><h2>The system in five parts</h2><p>Four ways in, one gate, the rules in plain code, one database, and five partners. Open a part to see what it does and the test behind it.</p></div>
	<div class="smap-track"><div class="smap-stage"><div class="smap-grid">${ORDER.map((k) => {
		const [t, s, parts] = Z[k];
		return `<button type="button" class="zone z-${k}" data-z="${k}" aria-pressed="false" aria-controls="smap-panel"><span class="zt"><b>${t}</b><span>${s}</span></span><ul>${parts.map((p) => `<li>${esc(p)}</li>`).join('')}</ul></button>`;
	}).join('')}</div><div class="smap-panel" id="smap-panel" aria-live="polite"><p class="hint">Open a part of the system above.</p></div></div></div>`;

	const panel = root.querySelector('.smap-panel'), zones = [...root.querySelectorAll('.zone')], track = root.querySelector('.smap-track');
	// A clicked zone stays open until the reader closes it or scrolls past the map; the trace waits meanwhile.
	let pinned = false, resume = null;
	function open(k) {
		const [t, , , lead, mech] = Z[k];
		zones.forEach((z) => z.setAttribute('aria-pressed', String(z.dataset.z === k)));
		const back = pinned && resume ? '<button type="button" class="smap-back">Back to the ham line</button>' : '';
		panel.innerHTML = `<div class="smap-ph"><h3>${t}</h3>${back}</div><p class="lead">${esc(lead)}</p><div class="mech">${mech.map(([c, h, , st]) => `<div><b>${esc(c)}</b><span>${esc(h)}</span><span class="st ${st === 'live' ? 'live' : ''}">${st === 'live' ? 'seen live' : 'tested'}</span></div>`).join('')}</div><p class="mech-proof">Each claim with its test: <a href="/proof">Proof</a>.</p>`;
		const b = panel.querySelector('.smap-back');
		if (b) b.addEventListener('click', () => { pinned = false; zones.forEach((z) => z.setAttribute('aria-pressed', 'false')); resume(); });
	}
	zones.forEach((z) => z.addEventListener('click', () => { pinned = true; root.classList.remove('tracing'); zones.forEach((x) => x.classList.remove('lit')); open(z.dataset.z); }));

	// The trace: only with recorded values; without them the map stays a static, clickable diagram.
	fetch('/cases.json').then((r) => (r.ok ? r.json() : null)).then((d) => {
		const c = d && d.cases && d.cases.find((x) => x.id === 'out-of-stock');
		const tr = c && c.trace;
		if (!tr || !tr.need || !tr.pack || !tr.line || !tr.receipt) { open('rules'); return; }
		const eur = (n) => '€' + Number(n).toFixed(2);
		const q = (s) => `<span class="q">${esc(s)}</span>`;
		const fmt = (n) => String(n);
		const STEPS = [
			[['doors'], 'var(--accent)', `The chef opens the Christmas buffet for ${q(fmt(tr.need.guests) + ' guests')}.`, 'From the Kitchen screen. The booking is a demo scenario.'],
			[['rules'], 'var(--accent)', `Demand: ${esc(tr.need.label)} at ${q(fmt(tr.need.perGuestG) + ' g')} a guest.`, 'Worked out in plain code from the menu and the guest count.'],
			[['ports'], 'var(--out)', `Valio's own data: ${esc(tr.pack.replaces)} is out of stock.`, 'Valio challenge data, fetched for this product only.'],
			[['rules'], 'var(--accent)', `A replacement with stock Valio states: ${esc(tr.pack.product)}. ${q(tr.need.perGuestG + ' g × ' + tr.need.guests + ' = ' + tr.need.servedKg + ' kg')} served. The raw ham would need ${tr.need.value} kg before cooking losses; the replacement is already cooked and sliced, so it's sized on the ${tr.need.servedKg} kg served: ${q(tr.pack.qty + ' = ' + tr.bought.value + ' kg')}.`, 'Yields are team estimates.'],
			[['rules'], 'var(--warn)', `A new product for this kitchen, so the mandate holds the line for the chef.`, '', `<span class="chip wait">${esc(tr.line.label)} · ${eur(tr.line.eur)}</span>`],
			[['doors'], 'var(--warn)', `${esc(tr.decision ? tr.decision.label : 'Approved by the chef')}, on these exact terms. Any later change voids the approval.`, 'Only a person in the kitchen can approve.'],
			[['gate', 'store'], 'var(--ok)', `The order passes the gate and is written once, with one receipt.`, 'Orders are local simulated commitments; nothing is sent to Valio.', `<span class="chip ok">${esc(tr.receipt.label)} · ${eur(tr.receipt.eur)}</span>`],
		];
		if (reduce) {
			open('rules');
			panel.insertAdjacentHTML('afterend', `<ol class="trace-list" aria-label="One recorded line through the system">${STEPS.map((s) => `<li>${s[2]} ${s[4] || ''}</li>`).join('')}</ol>`);
			return;
		}
		root.insertAdjacentHTML('beforeend', '');
		track.style.height = `calc(${STEPS.length * 60}svh + 100svh)`;
		root.querySelector('.smap-head p').insertAdjacentHTML('beforeend', ' Scroll to follow one recorded order line, the Christmas ham, from need to receipt.');
		let cur = -1;
		function show(i) {
			const outside = i < 0 || i >= STEPS.length;
			if (pinned && !outside) return;
			if (i === cur) return;
			cur = i;
			if (outside) {
				pinned = false;
				root.classList.remove('tracing');
				zones.forEach((z) => z.classList.remove('lit'));
				if (!panel.querySelector('.mech')) open(i < 0 ? 'doors' : 'rules');
				return;
			}
			const [zs, col, t, x, chip] = STEPS[i];
			root.classList.add('tracing');
			zones.forEach((z) => { z.setAttribute('aria-pressed', 'false'); z.classList.toggle('lit', zs.includes(z.dataset.z)); z.style.setProperty('--c', col); });
			panel.innerHTML = `<div class="trace-cap"><span class="n">The ham line · ${i + 1} of ${STEPS.length}</span><span class="t">${t}</span>${chip || ''}${x ? `<span class="x">${x}</span>` : ''}<div class="trace-bar">${STEPS.map((_, j) => `<i class="${j <= i ? 'on' : ''}"></i>`).join('')}</div></div>`;
		}
		let ticking = false;
		function onScroll() {
			ticking = false;
			const r = track.getBoundingClientRect(), span = track.offsetHeight - innerHeight;
			const p = -r.top / span;
			show(p < 0.02 ? -1 : p >= 1 ? STEPS.length : Math.min(STEPS.length - 1, Math.floor(p * STEPS.length)));
		}
		resume = () => { cur = -2; onScroll(); };
		addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(onScroll); } }, { passive: true });
		onScroll();
	}).catch(() => open('rules'));
})();
