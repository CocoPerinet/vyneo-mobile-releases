import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {auditRoot,PARITY_IDS,verifyParityAudit} from "../scripts/parity-gate.mjs";

const source=()=>JSON.parse(readFileSync(resolve(auditRoot,
  "desktop/parity/audit-traceability.json"),"utf8"));
test("the original visual parity audit is a required CI contract",()=>{
  const result=verifyParityAudit();
  assert.equal(result.items.length,12);
  assert.deepEqual(result.items.map(x=>x.id),PARITY_IDS);
  assert.equal(result.items.find(x=>x.id==="side-by-side").status,"pending");
  assert.equal(result.items.find(x=>x.id==="real-library").status,"pending");
});
test("a missing criterion or a forged real validation is rejected",()=>{
  const missing=source();
  missing.items=missing.items.filter(x=>x.id!=="hover-accessibility");
  assert.throws(()=>verifyParityAudit(auditRoot,missing),/Every original audit criterion/);
  const fake=source();
  fake.items.find(x=>x.id==="real-library").status="real-validated";
  assert.throws(()=>verifyParityAudit(auditRoot,fake),/real evidence/);
});
