import prettier from 'eslint-config-prettier';
import path from 'node:path';
import js from '@eslint/js';
import svelte from 'eslint-plugin-svelte';
import { defineConfig, includeIgnoreFile } from 'eslint/config';
import globals from 'globals';
import ts from 'typescript-eslint';

const gitignorePath = path.resolve(import.meta.dirname, '.gitignore');

export default defineConfig(
	includeIgnoreFile(gitignorePath),
	// The static mandate.kitchen site deploys on its own (site/wrangler.jsonc) and has its own checks.
	{ ignores: ['site/**'] },
	js.configs.recommended,
	ts.configs.recommended,
	svelte.configs.recommended,
	prettier,
	svelte.configs.prettier,
	{
		languageOptions: { globals: { ...globals.browser, ...globals.node } },
		rules: {
			// typescript-eslint strongly recommend that you do not use the no-undef lint rule on TypeScript projects.
			// see: https://typescript-eslint.io/troubleshooting/faqs/eslint/#i-get-errors-from-the-no-undef-rule-about-global-variables-not-being-defined-even-though-there-are-no-typescript-errors
			'no-undef': 'off'
		}
	},
	{
		files: ['**/*.svelte', '**/*.svelte.ts', '**/*.svelte.js'],
		languageOptions: {
			parserOptions: {
				projectService: true,
				extraFileExtensions: ['.svelte'],
				parser: ts.parser
			}
		}
	},
	{
		// Pure core (CLAUDE.md rule 2): no Svelte, no DOM-bound modules, no Node built-ins, no vendor SDKs.
		files: ['src/lib/core/**/*.ts'],
		ignores: ['src/lib/core/**/*.test.ts'],
		rules: {
			'no-restricted-imports': [
				'error',
				{
					patterns: [
						{
							group: [
								'svelte',
								'svelte/*',
								'$app/*',
								'$env/*',
								'$lib/server/*',
								'node:*',
								'@google/genai',
								'ai',
								'@ai-sdk/*',
								'drizzle-orm',
								'drizzle-orm/*',
								'postgres',
								'@electric-sql/*',
								'@modelcontextprotocol/*'
							],
							message: 'src/lib/core is pure TS: depend on a port in core/ports.ts instead.'
						}
					]
				}
			]
		}
	}
);
