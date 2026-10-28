import test from 'node:test';
import assert from 'node:assert/strict';
import {findings,auditFindings,validateImprovement,fingerprint,sameMajor} from '../scripts/security-policy.js';

const issue=(key,fixed='',severity='LOW')=>({key,fixed,severity});
test('security maintenance distinguishes no fix, an available fix, and an actual fix',()=>{
  const before=[issue('unfixable'),issue('patch','1.2.3')];
  assert.equal(before.filter(v=>v.fixed).length,1);
  assert.equal(validateImprovement(before,[issue('unfixable')]),1);
  assert.throws(()=>validateImprovement(before,before),/targeted vulnerability remains/);
  assert.throws(()=>validateImprovement(before,[issue('new'),issue('unfixable')]),/introduces/);
  assert.equal(validateImprovement([],[]),0);
});
test('a disappearing fix annotation does not conceal an unresolved vulnerability',()=>{
  assert.throws(()=>validateImprovement([issue('CVE','2.0')],[issue('CVE')]),/remains/);
});
test('missing or incomplete scanner data fails closed',()=>{
  for(const report of [{},{SchemaVersion:2,Metadata:{OS:{Family:'alpine'}},Results:[]}])assert.throws(()=>findings(report),/Incomplete/);
  assert.deepEqual(findings({SchemaVersion:2,Metadata:{OS:{Family:'alpine'}},Results:[{Class:'os-pkgs',Packages:[{Name:'musl'}]}]}),[]);
  assert.throws(()=>auditFindings({error:{code:'ENETWORK'}}),/Incomplete/);
  assert.deepEqual(auditFindings({auditReportVersion:2,vulnerabilities:{},metadata:{dependencies:{total:1}}}),[]);
});
test('major upgrades and prereleases are not automatic; changed patch inputs permit a new attempt',()=>{
  assert.equal(sameMajor('5.1.0','5.3.0'),true);
  assert.equal(sameMajor('5.1.0','6.0.0'),false);
  assert.equal(sameMajor('5.1.0','5.2.0-beta.1'),false);
  assert.equal(fingerprint({base:'a',lock:'a'}),fingerprint({base:'a',lock:'a'}));
  assert.notEqual(fingerprint({base:'a',lock:'a'}),fingerprint({base:'b',lock:'a'}));
});
