import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync,existsSync} from "node:fs";
import {dirname,resolve} from "node:path";
import {fileURLToPath} from "node:url";

export const PARITY_IDS = Object.freeze([
  "header","hero","circular-controls","rails",
  "hover-details","hover-accessibility","next-up","sequels",
  "universes","novelty","side-by-side","real-library"
]);
const LEGAL_STATES = new Set([
  "pending","source-reviewed","synthetic-validated","real-validated"
]);
export const auditRoot=resolve(dirname(fileURLToPath(import.meta.url)),"../..");

export function verifyParityAudit(root=auditRoot,providedMatrix){
  const jsonPath=resolve(root,"desktop/parity/audit-traceability.json");
  const matrix=providedMatrix??JSON.parse(readFileSync(jsonPath,"utf8"));
  assert.equal(matrix.audit,"docs/AUDIT-PARITE-JELLYFIN-20261020.md");
  const original=resolve(root,matrix.audit);
  assert.ok(existsSync(original),"The 2026-10-20 audit is mandatory");
  // Git may check Markdown out as CRLF on Windows; pin the canonical text
  // rather than operating-system-specific line-ending bytes.
  const source=readFileSync(original,"utf8").replace(/\r\n/g,"\n");
  assert.match(source,/^# Vynéo Desktop : audit de parité/);
  const hash=createHash("sha256").update(source).digest("hex");
  assert.equal(hash,matrix.auditSha256,"Audit changed without review");
  for(const marker of ["Bloc A","Bloc B","Bloc C","Bloc D"]){
    assert.ok(source.includes(marker),"Missing audit block "+marker);
  }
  assert.deepEqual(matrix.items.map(x=>x.id),PARITY_IDS,
    "Every original audit criterion must be accounted for in its original order");
  for(const item of matrix.items){
    assert.match(item.block,/^[ABCD]$/);
    assert.ok(item.title?.length>8 && item.acceptance?.length>24);
    assert.ok(item.reference?.length>7);
    assert.ok(item.automation?.startsWith("desktop/"));
    assert.ok(LEGAL_STATES.has(item.status),"Invalid audit status "+item.id);
    if(item.status==="real-validated"){
      assert.ok(item.evidence?.startsWith("real:"),
        "Real Jellyfin validation requires a real evidence reference: "+item.id);
    }else if(item.status==="synthetic-validated"){
      assert.match(item.evidence,/synthétiques/i,
        "Synthetic QA must be labeled as such: "+item.id);
    }
  }
  for(const name of ["index.html","skin.css","inject.js","SecureApp.svelte"]){
    assert.match(matrix.referenceSources[name]?.sha256??"",/^[a-f0-9]{64}$/);
    assert.ok(matrix.referenceSources[name].path.startsWith("/"));
  }
  return matrix;
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const matrix=verifyParityAudit();
  console.log("VYNEO_PARITY_AUDIT_REQUIRED_OK: "+
    matrix.items.length+" criteria tracked, no synthetic evidence misrepresented");
}
