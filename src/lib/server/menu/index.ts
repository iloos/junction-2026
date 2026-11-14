/**
 * The menu module: an open event request becomes a brief (words, then one question at a time), a menu proposal
 * judged by the rubric, a chef review, and then plan_event{proposal:{id, revision}}. Proposals live in a
 * MenuStore per workspace.
 */
export {
	applyBriefAnswers,
	dietaryIn,
	draftBrief,
	missing,
	nextQuestion,
	readBriefAnswers,
	toEventBrief
} from './brief';
export { fixtureMenu, LlmMenu, proposeMenu, type ProposeDeps, type Proposed } from './proposal';
export { blocks, reviewProposal, type Issue } from './rubric';
export { drizzleMenuStore } from './pg';
export { memoryMenuStore, MenuStoreError, proposalDigest } from './store';
export { proposeMenuHandler, type ProposeMenuDeps, type ProposeMenuOutput } from './tool';
