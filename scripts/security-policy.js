import crypto from 'node:crypto';

export function findings(report) {
  if(report.SchemaVersion!==2 || !report.Metadata?.OS?.Family || !Array.isArray(report.Results) ||
    !report.Results.some(r=>r.Class==='os-pkgs' && r.Packages?.length)) throw new Error('Incomplete container scan');
  return report.Results.flatMap(r=>(r.Vulnerabilities||[]).map(v=>({
    key:`${r.Class}:${v.PkgName}:${v.VulnerabilityID}`, id:v.VulnerabilityID,
    package:v.PkgName, version:v.InstalledVersion, fixed:v.FixedVersion||'', severity:v.Severity
  })));
}
export function auditFindings(report) {
  if(report.auditReportVersion!==2 || !report.vulnerabilities || !report.metadata?.dependencies) throw new Error('Incomplete npm audit');
  return Object.entries(report.vulnerabilities).flatMap(([name,v])=>(v.via?.length?v.via:[name]).map(advisory=>({
    key:`npm:${name}:${typeof advisory==='string'?advisory:advisory.source||advisory.url}`,
    package:name,fixed:!!v.fixAvailable,severity:v.severity
  })));
}
export function validateImprovement(before,after) {
  const previous=new Set(before.map(v=>v.key)), current=new Set(after.map(v=>v.key));
  if(after.some(v=>!previous.has(v.key))) throw new Error('Candidate introduces a vulnerability');
  if(before.some(v=>v.fixed && current.has(v.key))) throw new Error('A targeted vulnerability remains');
  return before.filter(v=>!current.has(v.key)).length;
}
export function fingerprint(value) {return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');}
export function sameMajor(a,b) {return /^\d+\.\d+\.\d+$/.test(a)&&/^\d+\.\d+\.\d+$/.test(b)&&a.split('.')[0]===b.split('.')[0];}
