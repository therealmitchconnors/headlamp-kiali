import { executeMutation, PreparedMutation } from './mutations';
import { ReadFailure, readFailure } from './requests';

export interface MutationOutcome {
  mutation: PreparedMutation;
  status: 'not-attempted' | 'succeeded' | 'blocked' | 'failed-or-unknown';
  error?: ReadFailure;
}
export interface ReviewedMutationBatch {
  readonly mutations: readonly PreparedMutation[];
}
const reviewed = new WeakSet<ReviewedMutationBatch>();
function validateBatch(mutations: readonly PreparedMutation[]) {
  if (!mutations.length || mutations.length > 5)
    throw new Error('A reviewed batch must contain between 1 and 5 operations');
  if (new Set(mutations.map(mutation => mutation.target.cluster)).size !== 1)
    throw new Error('A mutation batch must remain in one explicit cluster');
  const targets = mutations.map(({ target }) =>
    JSON.stringify([
      target.definition.group,
      target.definition.plural,
      target.namespace,
      target.name,
    ])
  );
  if (new Set(targets).size !== targets.length)
    throw new Error('A mutation batch cannot target the same resource twice');
}
export async function reviewMutationBatch(
  mutations: readonly PreparedMutation[],
  signal: AbortSignal,
  guard: (signal: AbortSignal) => Promise<void>
): Promise<ReviewedMutationBatch> {
  validateBatch(mutations);
  const snapshot = Object.freeze([...mutations]);
  for (const mutation of snapshot) {
    signal.throwIfAborted();
    await guard(signal);
    await executeMutation(mutation, true, signal);
  }
  const batch = Object.freeze({ mutations: snapshot });
  reviewed.add(batch);
  return batch;
}
export async function commitMutationBatch(
  batch: ReviewedMutationBatch,
  signal: AbortSignal,
  guard: (signal: AbortSignal) => Promise<void>
): Promise<MutationOutcome[]> {
  if (!reviewed.delete(batch))
    throw new Error('Review this batch before confirmation; a commit attempt cannot be repeated');
  const mutations = batch.mutations;
  validateBatch(mutations);
  const results: MutationOutcome[] = mutations.map(mutation => ({
    mutation,
    status: 'not-attempted',
  }));
  for (const result of results) {
    let dispatched = false;
    try {
      signal.throwIfAborted();
      await guard(signal);
      await executeMutation(result.mutation, false, signal, () => {
        dispatched = true;
      });
      result.status = 'succeeded';
    } catch (error) {
      result.status = dispatched ? 'failed-or-unknown' : 'blocked';
      result.error = readFailure(error);
      break;
    }
  }
  return results;
}
