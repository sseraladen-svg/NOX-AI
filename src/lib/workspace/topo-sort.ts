// Deterministic Kahn's topological sorter (<1 ms, 0 tokens) for ordering
// planner tasks into dependency-safe execution waves with cycle protection.

export interface DagTaskNode {
  id: string;
  targetFile: string;
  action: "create" | "patch" | "command";
  instruction: string;
  dependsOn: string[];
}

export interface TopoSortResult<T extends DagTaskNode = DagTaskNode> {
  waves: T[][];
  hadCycle: boolean;
  missingDeps: Array<{ taskId: string; missingDepId: string }>;
}

export function sortTasksTopologically<T extends DagTaskNode>(tasks: T[]): TopoSortResult<T> {
  const taskMap = new Map<string, T>(tasks.map((t) => [t.id, t]));
  const inDegree = new Map<string, number>();
  const adj = new Map<string, string[]>();
  const missingDeps: Array<{ taskId: string; missingDepId: string }> = [];

  for (const t of tasks) {
    inDegree.set(t.id, 0);
    adj.set(t.id, []);
  }

  for (const t of tasks) {
    const seenDeps = new Set<string>();
    for (const depId of t.dependsOn) {
      if (depId === t.id || seenDeps.has(depId)) continue;
      seenDeps.add(depId);
      if (!taskMap.has(depId)) {
        missingDeps.push({ taskId: t.id, missingDepId: depId });
        continue;
      }
      adj.get(depId)!.push(t.id);
      inDegree.set(t.id, (inDegree.get(t.id) ?? 0) + 1);
    }
  }

  const waves: T[][] = [];
  const remaining = new Set<string>(tasks.map((t) => t.id));
  let hadCycle = false;

  while (remaining.size > 0) {
    const readyIds = Array.from(remaining).filter((id) => (inDegree.get(id) ?? 0) === 0);

    if (readyIds.length === 0) {
      hadCycle = true;
      const fallbackId = Array.from(remaining).sort(
        (a, b) => (inDegree.get(a) ?? 0) - (inDegree.get(b) ?? 0)
      )[0];
      readyIds.push(fallbackId);
    }

    const wave: T[] = [];
    for (const id of readyIds) {
      remaining.delete(id);
      wave.push(taskMap.get(id)!);
      for (const neighbor of adj.get(id) ?? []) {
        inDegree.set(neighbor, Math.max(0, (inDegree.get(neighbor) ?? 1) - 1));
      }
    }
    waves.push(wave);
  }

  return { waves, hadCycle, missingDeps };
}
