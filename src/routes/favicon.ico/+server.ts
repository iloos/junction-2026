import { redirect } from '@sveltejs/kit';

/** Browsers ask for /favicon.ico regardless of the <link rel="icon">; point them at the SVG. */
export const GET = () => redirect(308, '/favicon.svg');
