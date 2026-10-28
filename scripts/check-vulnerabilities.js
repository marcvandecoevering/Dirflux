import fs from 'node:fs/promises';

const report=JSON.parse(await fs.readFile(process.argv[2],'utf8'));
if(report.SchemaVersion!==2||!Array.isArray(report.Results)||!report.Metadata?.OS?.Family)throw new Error('Expected a complete Trivy container report.');
const issues=report.Results.flatMap(result=>(result.Vulnerabilities||[]).map(issue=>({target:result.Target,id:issue.VulnerabilityID,severity:issue.Severity,package:issue.PkgName,fixed:issue.FixedVersion||null})));
const counts={};for(const issue of issues)counts[issue.severity]=(counts[issue.severity]||0)+1;
console.log(JSON.stringify({os:report.Metadata.OS,counts,issues},null,2));
if(issues.some(issue=>['HIGH','CRITICAL'].includes(issue.severity)))throw new Error('Release blocked by HIGH/CRITICAL container vulnerabilities. See the uploaded report.');
