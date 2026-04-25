/**
 * YAML string builders consumed by `WorkflowFactory.createWorkflowFromYAML`
 * via a temp file. Used by scale tests (story 30, 31, 32, 33) to exercise
 * 100-step graphs without committing fixture YAML to disk.
 */

/**
 * Linear chain: step 1 has no deps; step k (k>1) depends on step k-1.
 * All steps use `taskType: "polygonArea"`.
 */
export function buildLinearChainYaml(n: number): string {
  if (n < 1) throw new Error("buildLinearChainYaml: n must be >= 1");
  const lines: string[] = [`name: "linear_chain_${n}"`, "steps:"];
  for (let k = 1; k <= n; k++) {
    lines.push(`  - taskType: "polygonArea"`);
    lines.push(`    stepNumber: ${k}`);
    if (k > 1) lines.push(`    dependsOn: [${k - 1}]`);
  }
  return lines.join("\n") + "\n";
}

/**
 * Wide fan-in: steps 1..n-1 are independent leaves (`polygonArea`); step n
 * is a `reportGeneration` aggregator depending on every prior step.
 */
export function buildFanInYaml(n: number): string {
  if (n < 2) throw new Error("buildFanInYaml: n must be >= 2");
  const lines: string[] = [`name: "fan_in_${n}"`, "steps:"];
  for (let k = 1; k < n; k++) {
    lines.push(`  - taskType: "polygonArea"`);
    lines.push(`    stepNumber: ${k}`);
  }
  const parents = Array.from({ length: n - 1 }, (_, i) => i + 1).join(", ");
  lines.push(`  - taskType: "reportGeneration"`);
  lines.push(`    stepNumber: ${n}`);
  lines.push(`    dependsOn: [${parents}]`);
  return lines.join("\n") + "\n";
}
