import fs from 'node:fs';
import path from 'node:path';
import {json,issueOnce} from './security-maintenance.js';
const file=path.join(process.env.SECURITY_DIR,'plan.json');
const plan=fs.existsSync(file)?json(file):null;
await issueOnce(plan?.marker||'<!-- dirflux-security-workflow-failure -->','Dirflux security maintenance needs attention',
  'The security patch workflow failed. Inspect the linked run. An identical failed candidate is not rebuilt until its inputs change. The update channel is promoted only after both platforms pass.');
