import path from 'node:path';
import { rename, writeFile } from 'fs/promises';
import matter from 'gray-matter';
import { makeFetchTask } from '../tools/fetchTask';
import { makePushTask } from '../tools/pushTask';
import type { GraphStateType } from './state';
import type { Paths } from '../paths';

// ============================================================================
// Node factories
// ============================================================================

/**
 * Builds `fetchTaskNode` and `pushTaskNode` bound to the resolved Paths.
 *
 * `fetchTaskNode` reads the task spec from `tasksNew/`, populates
 * `task_content` and `task_metadata`, then moves the spec into `tasksStage/`
 * and flips its frontmatter `status` field to `stage`.
 *
 * `pushTaskNode` moves the task spec from `tasksStage/` to `tasksDone/` and
 * flips its `status` to `done`.
 */
export function makeFetchPushNodes(paths: Paths) {
  const readTaskFile = makeFetchTask(paths);
  const pushTaskSpec = makePushTask(paths);

  async function fetchTaskNode(
    state: GraphStateType
  ): Promise<Partial<GraphStateType>> {
    if (state.task_id === null) {
      throw new Error('fetchTaskNode: state.task_id is null');
    }
    const { body, metadata, filename } = await readTaskFile(state.task_id);

    const stagePath = path.join(paths.tasksStage, filename);
    const newPath = path.join(paths.tasksNew, filename);

    const updatedMetadata = { ...metadata, status: 'stage' };
    const stagedContent = matter.stringify(body, updatedMetadata);
    await writeFile(newPath, stagedContent, 'utf8');
    await rename(newPath, stagePath);

    return { task_content: body, task_metadata: metadata };
  }

  async function pushTaskNode(
    state: GraphStateType
  ): Promise<Partial<GraphStateType>> {
    if (state.task_id === null) {
      throw new Error('pushTaskNode: state.task_id is null');
    }
    await pushTaskSpec(state.task_id);
    return {};
  }

  return { fetchTaskNode, pushTaskNode };
}
