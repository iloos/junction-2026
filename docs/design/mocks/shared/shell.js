// Shared shell for every app mockup page: one nav, the scenario label, the System toggle,
// and a product sheet that opens from any element with data-product="<id>".
// Usage: <script src="shared/scenario.js"></script><script src="shared/shell.js" data-page="ops"></script>
// The page's own CSS variables (--ink, --ink2, --line, --paper|--p, --fill|--p2) theme it.
(function () {
  const me = document.currentScript;
  const page = me?.dataset.page || '';
  const S = window.SCENARIO || {};
  const groups = [
    ['Kitchen', [['kitchen', 'Today', 'kitchen-b.html'], ['rhythm', 'Usual order', 'rhythm.html']]],
    ['Valio', [['ops', 'Operations', 'ops.html'], ['flow', 'Demand', 'flow.html'], ['engine', 'Forecast', 'engine.html']]],
    ['How it works', [['journey', 'Request to order', 'journey.html'], ['architecture', 'Architecture', 'architecture.html'], ['story', 'Story', 'landing.html']]]
  ];
  const css = `
  .mshell{position:sticky;top:0;z-index:40;height:52px;display:flex;align-items:center;gap:20px;padding:0 18px;border-bottom:1px solid var(--line);background:var(--paper,var(--p,var(--bg)));font:13px/1.4 'IBM Plex Sans',system-ui,sans-serif;color:var(--ink)}
  .mshell .b{font-weight:600;display:flex;gap:8px;align-items:center;text-decoration:none;color:inherit}
  .mshell .b i{width:18px;height:18px;border:1.5px solid;border-radius:4px;display:grid;place-items:center;font:normal 10px 'IBM Plex Sans',sans-serif}
  .mshell nav{display:flex;gap:14px;align-items:center}
  .mshell .g{display:flex;align-items:center;gap:2px;padding-left:14px;border-left:1px solid var(--line)}
  .mshell .g:first-child{border-left:0;padding-left:0}
  .mshell .g>span{font-size:12px;color:var(--ink3,var(--ink2));margin-right:6px}
  .mshell .g a{padding:6px 9px;border-radius:6px;color:var(--ink2);text-decoration:none;white-space:nowrap}
  .mshell .g a:hover{color:var(--ink)}
  .mshell .g a.on{background:var(--fill,var(--p2));color:var(--ink);font-weight:500}
  .mshell .r{margin-left:auto;display:flex;gap:12px;align-items:center;font-size:12.5px;color:var(--ink2)}
  .mshell .scen{border:1px solid var(--line);border-radius:999px;padding:3px 10px;white-space:nowrap}
  .mshell .sys{display:flex;align-items:center;gap:7px;border:1px solid var(--line);border-radius:999px;padding:4px 11px;color:var(--ink2);text-decoration:none;white-space:nowrap}
  .mshell .sys:hover{color:var(--ink)}
  @media(max-width:1100px){.mshell .g>span{display:none}.mshell .scen{display:none}}
  @media(max-width:760px){.mshell{overflow-x:auto}.mshell .sys{display:none}}
  .psheet-bg{position:fixed;inset:0;background:rgba(0,0,0,.28);z-index:60;opacity:0;pointer-events:none;transition:opacity .2s}
  .psheet-bg.on{opacity:1;pointer-events:auto}
  .psheet{position:fixed;top:0;right:0;bottom:0;width:min(440px,100vw);z-index:61;background:var(--paper,var(--p,var(--bg)));color:var(--ink);border-left:1px solid var(--line);transform:translateX(100%);transition:transform .25s ease;overflow:auto;padding:22px 24px;font:14px/1.5 'IBM Plex Sans',system-ui,sans-serif}
  .psheet.on{transform:none}
  .psheet .x{position:absolute;right:16px;top:14px;font-size:20px;color:var(--ink2);background:none;border:0;cursor:pointer}
  .psheet .k{font:12px 'IBM Plex Mono',monospace;color:var(--ink3,var(--ink2))}
  .psheet h2{font:400 28px/1.15 'Instrument Serif',Georgia,serif;margin:4px 0 10px}
  .psheet p{color:var(--ink2);margin:0 0 12px}.psheet p b{color:var(--ink);font-weight:500}
  .psheet .gauge{display:grid;grid-template-columns:80px 1fr 56px;gap:8px;align-items:center;font-size:13px;color:var(--ink2);margin:6px 0}
  .psheet .gauge div{height:10px;background:var(--fill,var(--p2));border-radius:5px;overflow:hidden}.psheet .gauge i{display:block;height:100%}
  .psheet .gauge b{font:13px 'IBM Plex Mono',monospace;color:var(--ink);text-align:right;font-weight:400}
  .psheet table{width:100%;border-collapse:collapse;font-size:13px;margin:6px 0 14px}
  .psheet td{padding:6px 0;border-bottom:1px solid var(--line);color:var(--ink2)}.psheet td:first-child{color:var(--ink)}.psheet td.n{text-align:right;font-family:'IBM Plex Mono',monospace;color:var(--ink)}
  .psheet .links{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}
  .psheet .links a{border:1px solid var(--line);border-radius:8px;padding:6px 10px;color:var(--ink);text-decoration:none;font-size:13px}
  [data-product]{cursor:pointer}
  `;
  const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

  function nav() {
    const h = document.createElement('header'); h.className = 'mshell';
    h.innerHTML = `<a class="b" href="index.html"><i>M</i>Mandate</a><nav>${groups.map(([g, items]) =>
      `<div class="g"><span>${g}</span>${items.map(([id, label, href]) => `<a href="${href}" class="${id === page || (page.startsWith('kitchen') && id === 'kitchen') || (page === 'flow-scale' && id === 'flow') ? 'on' : ''}">${label}</a>`).join('')}</div>`).join('')}</nav>
      <div class="r"><span class="scen">${S.kitchen?.name || ''} · ${S.clock || ''} · scenario</span><a class="sys" href="live.html" title="Every call, live: the engine room">⚙ Engine room</a></div>`;
    const old = document.querySelector('header.top');
    if (old) old.replaceWith(h); else document.body.prepend(h);
  }

  function sheet() {
    const bg = document.createElement('div'); bg.className = 'psheet-bg';
    const el = document.createElement('aside'); el.className = 'psheet'; el.setAttribute('aria-label', 'Product');
    document.body.append(bg, el);
    const close = () => { bg.classList.remove('on'); el.classList.remove('on'); };
    bg.onclick = close; addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
    window.openProduct = id => {
      const p = S.products?.[id]; if (!p) return;
      const c = S.cases?.find(x => x.id === p.caseId);
      const gauge = p.stock == null
        ? `<p><b>Valio has not said how many it has.</b> It never counts as covered until the supplier confirms.</p>`
        : `<div class="gauge"><span>wanted</span><div><i style="width:100%;background:${p.wanted > p.stock ? 'var(--red)' : 'var(--teal)'}"></i></div><b>${p.wanted}</b></div>
           <div class="gauge"><span>Valio has</span><div><i style="width:${Math.min(100, p.stock / Math.max(p.wanted, p.stock) * 100)}%;background:var(--ok)"></i></div><b>${p.stock}</b></div>`;
      el.innerHTML = `<button class="x" aria-label="Close">×</button>
        <div class="k">PRODUCT · ${id} · ${p.origin} · ${p.pack}</div><h2>${p.name}</h2>
        <p>${p.stockText}. ${p.price}.${p.replaces ? ` Replaces ${p.replaces}.` : ''}</p>${gauge}
        <p><b>Next two weeks:</b> ${p.forecast}</p>
        <table>${p.kitchens.map(([k, q, s]) => `<tr><td>${k}</td><td>${s}</td><td class="n">${q || ''}</td></tr>`).join('')}</table>
        ${c ? `<p><b>Open problem:</b> ${c.title}. ${c.atRisk} at risk, cut-off in ${c.due}.</p>` : ''}
        <div class="links"><a href="ops.html#${p.caseId || ''}">Operations</a><a href="engine.html#${id}">Forecast</a><a href="flow.html#${id}">Demand</a><a href="kitchen-b.html">Kitchen</a></div>
        <p class="k" style="margin-top:16px">illustrative scenario values</p>`;
      el.querySelector('.x').onclick = close;
      bg.classList.add('on'); el.classList.add('on');
    };
    document.addEventListener('click', e => {
      const t = e.target.closest('[data-product]'); if (!t) return;
      e.preventDefault(); window.openProduct(t.dataset.product);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => { nav(); sheet(); });
  else { nav(); sheet(); }
})();
