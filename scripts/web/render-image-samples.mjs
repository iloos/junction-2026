// Renders the read_image sample pictures (typed, fictional: no real people or brands) into fixtures/images/.
// Usage: node scripts/web/render-image-samples.mjs
import { chromium } from '@playwright/test';
const css = `body{font-family:Georgia,serif;background:#fbf8f1;margin:0;padding:28px;color:#222} h1{font-size:22px;margin:0 0 12px} table{border-collapse:collapse;width:100%;font-family:Arial,sans-serif;font-size:15px} td,th{border-bottom:1px solid #bbb;padding:6px 8px;text-align:left} .r{text-align:right} .s{color:#555;font-size:13px}`;
const pages = {
	'prep-list': `<h1>Prep list · Sat buffet (140)</h1><p class="s">Kitchen: Hotel test kitchen · order by Thu</p>
 <table><tr><th>Item</th><th class="r">Qty</th><th>Unit</th></tr>
 <tr><td>Butter, unsalted</td><td class="r">4</td><td>kg</td></tr>
 <tr><td>Lactose-free milk</td><td class="r">12</td><td>l</td></tr>
 <tr><td>Whipping cream 35 %</td><td class="r">6</td><td>l</td></tr>
 <tr><td>Swede (lanttu)</td><td class="r">15</td><td>kg</td></tr>
 <tr><td>Rainbow trout fillet</td><td class="r">9</td><td>kg</td></tr>
 <tr><td>Rye bread</td><td class="r">40</td><td>pcs</td></tr></table>
 <p class="s">Note: no shellfish on the buffet. Ham is on order separately.</p>`,
	'delivery-note': `<h1>DELIVERY NOTE  No. 2026-1144</h1><p class="s">Supplier: Example Wholesale Oy · Delivered 10.12.2026 to: Test Kitchen</p>
 <table><tr><th>Product</th><th class="r">Ordered</th><th class="r">Delivered</th><th>Unit</th></tr>
 <tr><td>Kerma 35 % 1 l</td><td class="r">6</td><td class="r">6</td><td>ST</td></tr>
 <tr><td>Voi 500 g</td><td class="r">8</td><td class="r">8</td><td>ST</td></tr>
 <tr><td>Kirjolohifilee 1 kg</td><td class="r">9</td><td class="r">7</td><td>KG</td></tr>
 <tr><td>Laktoositon maito 1 l</td><td class="r">12</td><td class="r">12</td><td>ST</td></tr></table>
 <p class="s">Short delivery: trout 2 kg missing, credit to follow. Signature: ____________</p>`
};
pages['label'] =
	`<div style="border:3px solid #333;border-radius:10px;padding:18px;width:420px;background:#fff">
 <h1 style="font-family:Arial;font-size:26px">ESIMERKKI VOI</h1><p style="font-family:Arial;margin:4px 0">Normaalisuolainen voi · Salted butter</p>
 <p style="font-family:Arial;font-size:30px;margin:8px 0"><b>500 g</b></p>
 <p class="s">Ainesosat: kerma (maito), suola 1,2 %. Allergeenit: maito.</p>
 <p class="s">Parasta ennen 20.01.2027 · Säilytys +2…+6 °C</p>
 <p style="font-family:monospace;font-size:18px;letter-spacing:2px">6 400000 123457</p>
 <p class="s">Valmistaja: Esimerkkimeijeri Oy (fictional)</p></div>`;
const b = await chromium.launch();
for (const [name, html] of Object.entries(pages)) {
	const p = await b.newPage({ viewport: { width: 640, height: 480 } });
	await p.setContent(`<style>${css}</style>${html}`);
	await p.screenshot({ path: `fixtures/images/${name}.png`, fullPage: true });
}
await b.close();
