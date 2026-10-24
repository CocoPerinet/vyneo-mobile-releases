import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {auditRoot,PARITY_IDS,verifyParityAudit,
  verifyReleaseParityReadiness} from "../scripts/parity-gate.mjs";

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

test("stable release refuses an unverified real-library comparison",()=>{
  const current=source();
  assert.throws(()=>verifyReleaseParityReadiness(current),
    /Block D real Jellyfin audit/);
  const approved=source();
  for(const id of ["side-by-side","real-library"]){
    const item=approved.items.find(entry=>entry.id===id);
    item.status="real-validated";
    item.evidence="real:docs/DESKTOP-PARITY-REAL-ACCEPTANCE.md";
  }
  assert.doesNotThrow(()=>verifyReleaseParityReadiness(approved));
});

test("live Home DOM reference is dated and never mistaken for per-user item parity",()=>{
  const snapshot=JSON.parse(readFileSync(resolve(auditRoot,
    "desktop/parity/live-home-reference.json"),"utf8"));
  assert.equal(snapshot.capturedDate,"2026-10-21");
  assert.equal(snapshot.sameUserAsCandidateVerified,false);
  assert.equal(snapshot.screenshotsCompared,false);
  assert.equal(snapshot.jellyfinItemIdsCompared,false);
  assert.deepEqual(snapshot.homeSequence.map(x=>x.id),[
    "resume","next-up","new-seasons","universe-rail","trending","for-you"
  ]);
  assert.equal(snapshot.visibleDomNodeCounts.universeButtons,7);
  assert.equal(snapshot.visibleDomNodeCounts.heroIndicators,15);
});
