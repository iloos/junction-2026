/**
 * The incident deck (D27 addendum 2, lite): three canned, simulated incidents the presenter runs in the room. Each
 * is a story line and the products it hits, chosen from the seeded plans so something visibly changes. Each product
 * goes through the shortage cascade (every store re-plans inside its own rules). Always labelled "Simulated incident".
 * Pure data: the page shows the story, the server action runs it.
 */
export interface Incident {
	id: string;
	title: string;
	story: string;
	products: { productId: string; name: string }[];
	/** Share of Valio's stock left after the incident (0 = nothing can be delivered). */
	left: number;
}

export const INCIDENT_LABEL = 'Simulated incident';

export const INCIDENTS: readonly Incident[] = [
	{
		id: 'drought',
		title: 'Drought: root vegetables scarce',
		story:
			'A dry summer cut the harvest. Valio Aimo has a quarter of its usual potatoes and swede for the next deliveries.',
		products: [
			{ productId: '475214', name: 'Potatoes, peeled, 10 kg' },
			{ productId: '460879', name: 'Swede' }
		],
		left: 0.25
	},
	{
		id: 'bankrupt',
		title: 'Drinks supplier bankrupt',
		story:
			"The supplier of the café's coffee and oat drink went bankrupt overnight: its products can't be delivered.",
		products: [
			{ productId: '460588', name: 'Paulig Café Parisien coffee' },
			{ productId: '469512', name: 'Elovena oat drink for coffee' }
		],
		left: 0
	},
	{
		id: 'rush',
		title: 'Christmas rush: dairy demand up',
		story:
			'Every kitchen orders for Christmas at once. Milk, cream and butter run low across Valio Aimo’s customers.',
		products: [
			{ productId: '464201', name: 'Valio light milk 1 l' },
			{ productId: '464249', name: 'Valio cooking cream 15 %' },
			{ productId: '463437', name: 'Valio butter 500 g' }
		],
		left: 0.35
	}
];

export const incidentLabel = (i: Pick<Incident, 'title'>) => `${INCIDENT_LABEL}: ${i.title}`;
