// One scenario for every mockup page. Pages read these facts instead of inventing their own,
// so the ham shortage has the same numbers on Ops, Demand, Forecast, Kitchen and the story.
// All values are illustrative (challenge mock data + team scenario), labelled as such on screen.
window.SCENARIO = {
  clock: 'Mon 7 Dec, 22:11',
  cutoff: 'Tue 8 Dec 15:00',
  cutoffIn: '16 h',
  delivery: 'Thu 10 Dec',
  kitchensInRun: 12,
  kitchen: {
    id: 'k-hotel', name: 'Hotel Rautatientori', event: 'Christmas buffet, 140 guests', eventDate: 'Sat 12 Dec',
    decisions: 2, orderableNow: '€319.78', heldTotal: '€614.14', eventAdds: '€934', eventKg: '103.6 kg',
    normalWeek: '€3,120', weekCap: '€4,000',
    mandate: 'Acts alone up to €800 a line, €1,000 an order, €4,000 a week. Asks before any new product. Never changes an allergen.'
  },
  // Valio-side problems, biggest risk first. "atRisk" = held € that misses the cut-off if nobody acts.
  cases: [
    { id: 'ham', product: '476768', title: 'Ham: 16 packs short for 6 kitchens', atRisk: '€401', due: '16 h', tone: 'red',
      line: 'Whole ham 462490 is out. Kitchens moved to HK Palvikinkku 476768: 6 kitchens want 31 packs for Thu 10, Valio states 15.',
      did: '4 kitchens moved on to Mattila Saunapalvikinkku, which they have bought before. 2 wait for their chef.',
      actions: ['Ask the 2 chefs', 'Pre-position 16 packs'] },
    { id: 'lantt', product: '462482', title: 'Lanttulaatikko out: 4 kitchens make it in house', atRisk: '€188', due: '16 h', tone: 'amber',
      line: 'Saarioinen 462482 is out. Making it in house adds milk, egg and gluten, so each kitchen signs off itself. 2 have, 2 have not.',
      did: 'Agents proposed the in-house recipe from in-stock ingredients for all 4.', actions: ['Remind 2 kitchens'] },
    { id: 'rosolli', product: '462157', title: 'Recall drill: Atria Rosolli', atRisk: '€156', due: '2 d', tone: 'amber',
      line: 'A notice matches the product name, not its barcode. 2 kitchens’ lines are held until someone checks. Labelled drill.',
      did: 'Monitor matched the notice and held the lines.', actions: ['Mark checked'] }
  ],
  waitingTotal: '€745',
  settledShare: '96%',
  products: {
    '476768': { name: 'HK Palvikinkku viipaloitu 1,5 kg', origin: 'FI', pack: '1,5 kg (ST)', price: '€15.43 / ST', supply: 'known', stockText: 'Valio states 15 packs', wanted: 31, stock: 15, unit: 'packs',
      kitchens: [['Hotel Rautatientori', 12, 'held: new product'], ['Hotel Kamppi', 14, 'held: new product'], ['Lounas Kallio', 2, 'moved to Mattila'], ['Hotel Espoo', 1, 'moved to Mattila'], ['Bistro Punavuori', 1, 'moved to Mattila'], ['Kantina Otaniemi', 1, 'moved to Mattila']],
      replaces: 'HK Viljaporsaan juhlakinkku 462490 (out)', forecast: 'Short for the Thu 10 delivery. Next supply Fri 11 (+10).', caseId: 'ham' },
    '462482': { name: 'Saarioinen Lanttulaatikko 700 g', origin: 'FI', pack: '700 g', price: '€2.89', supply: 'out', stockText: 'Out at Valio', wanted: 0, stock: 0, unit: 'packs',
      kitchens: [['Hotel Rautatientori', 0, 'make in house: needs sign-off'], ['Hotel Kamppi', 0, 'make in house: signed off'], ['Koulu Vallila', 0, 'make in house: signed off'], ['Hotel Tapiola', 0, 'make in house: needs sign-off']],
      replaces: null, forecast: 'No supply stated before Sat 12.', caseId: 'lantt' },
    '462157': { name: 'Atria Rosolli 2,5 kg', origin: 'FI', pack: '2,5 kg', price: '€13.03', supply: 'unknown', stockText: 'Supplier-delivered. Valio has not said how many.', wanted: 66, stock: null, unit: 'packs',
      kitchens: [['Hotel Rautatientori', 6, 'held: recall drill'], ['Hotel Kamppi', 5, 'held: recall drill']],
      replaces: null, forecast: 'Cannot be judged: no stated quantity. Never counted as covered.', caseId: 'rosolli' },
    '459000': { name: 'Valio laktoositon maito 1 l', origin: 'FI', pack: '1 l', price: '€1.09', supply: 'known', stockText: 'Valio states 900 l', wanted: 610, stock: 900, unit: 'l',
      kitchens: [['Espoo Central Kitchen', 420, 'within mandate'], ['Hotel Rautatientori', 120, 'within mandate'], ['Lounas Ruoholahti', 70, 'within mandate']],
      replaces: null, forecast: 'Holds for 14 days.', caseId: null }
  }
};
