import { localSemanticHashEmbedding } from "../apps/workbench/src/domain/embeddingEngine.ts";
import { readFileSync } from "node:fs";

const target = process.env.KF_GO_HASH_FIXTURE;
if (!target) {
  console.error("set KF_GO_HASH_FIXTURE to the vector exported by Go");
  process.exit(2);
}
const goVec = readFileSync(target, "utf8").trim().split("\n").map(Number);
const tsVec = localSemanticHashEmbedding("知识库检索与向量", 128);
if (goVec.length !== tsVec.length) {
  console.error(`dimension mismatch: go ${goVec.length} vs ts ${tsVec.length}`);
  process.exit(1);
}
let worst = 0;
let worstAt = -1;
for (let i = 0; i < tsVec.length; i++) {
  const diff = Math.abs(goVec[i] - tsVec[i]);
  if (diff > worst) { worst = diff; worstAt = i; }
}
if (worst > 1e-6) {
  console.error(`vector mismatch at ${worstAt}: go ${goVec[worstAt]} vs ts ${tsVec[worstAt]} (diff ${worst})`);
  process.exit(1);
}
console.log(`hash vector parity ok: ${tsVec.length} dims, max diff ${worst.toExponential(2)}`);
