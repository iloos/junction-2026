/**
 * The menu module: an open event request becomes a brief (words, then one question at a time), a menu proposal
 * (next), a chef review, and then plan_event{proposal:{id, revision}}. Proposals live in a MenuStore per workspace.
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
export { memoryMenuStore, menuStore, MenuStoreError, proposalDigest } from './store';
