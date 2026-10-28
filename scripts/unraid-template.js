import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const xml=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
function httpsUrl(value) {
  const url=new URL(value);
  if(url.protocol!=='https:'||url.username||url.password)throw new Error('Public metadata URLs must use HTTPS without credentials.');
  return url;
}
export function renderUnraid({name,slug,project,image,icon,branch='main',templateRepository=project}) {
  if(typeof name!=='string'||!name.trim()||name.length>64||/[\x00-\x1f]/.test(name))throw new Error('Provide a display name.');
  if(typeof slug!=='string'||!/^[a-z][a-z0-9-]{1,47}$/.test(slug))throw new Error('Provide a lowercase application slug.');
  if(slug==='appdata')throw new Error('The appdata slug would overlap the default Files and Appdata folders.');
  const projectUrl=httpsUrl(project);
  if(projectUrl.hostname!=='github.com'||projectUrl.port||!/^\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/?$/.test(projectUrl.pathname)||projectUrl.search||projectUrl.hash)throw new Error('Project must be the canonical GitHub repository URL.');
  if(!/^[A-Za-z0-9_.-]+$/.test(branch)||branch==='.'||branch==='..')throw new Error('Provide a simple published branch name.');
  if(typeof image!=='string'||!/^ghcr\.io\/[a-z0-9_.-]+\/[a-z0-9_.-]+:[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/.test(image))throw new Error('Provide a tagged GHCR image.');
  httpsUrl(icon);
  const repo=projectUrl.pathname.replace(/\/$/,'');
  const templateRepoUrl=httpsUrl(templateRepository);
  if(templateRepoUrl.hostname!=='github.com'||templateRepoUrl.port||!/^\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/?$/.test(templateRepoUrl.pathname)||templateRepoUrl.search||templateRepoUrl.hash)throw new Error('Template repository must be the canonical GitHub repository URL.');
  const templateRaw=`https://raw.githubusercontent.com${templateRepoUrl.pathname.replace(/\/$/,'')}/${branch}`;
  const source='https://github.com'+repo,raw=`https://raw.githubusercontent.com${repo}/${branch}`;
  const config=(label,target,defaultValue,type,mode,description,display='always',mask='false')=>
    `  <Config Name="${xml(label)}" Target="${xml(target)}" Default="${xml(defaultValue)}" Mode="${xml(mode)}" Description="${xml(description)}" Type="${type}" Display="${display}" Required="true" Mask="${mask}"/>`;
  const template=`<?xml version="1.0" encoding="UTF-8"?>
<Container version="2">
  <Name>${xml(name)}</Name>
  <Repository>${xml(image)}</Repository>
  <Network>bridge</Network>
  <Shell>sh</Shell>
  <Privileged>false</Privileged>
  <ExtraParams>--read-only --cap-drop=ALL --cap-add=CHOWN --cap-add=FOWNER --cap-add=DAC_OVERRIDE --cap-add=SETUID --cap-add=SETGID --security-opt=no-new-privileges --tmpfs=/tmp:rw,noexec,nosuid,size=64m</ExtraParams>
  <WebUI>http://[IP]:[PORT:8080]/</WebUI>
  <Icon>${xml(icon)}</Icon>
  <Project>${xml(source)}</Project>
  <Support>${xml(source+'/issues')}</Support>
  <TemplateURL>${xml(templateRaw+'/templates/'+slug+'.xml')}</TemplateURL>
  <ReadMe>${xml(raw+'/README.md')}</ReadMe>
  <Category>Tools:System</Category>
  <License>BSD-2-Clause</License>
  <Beta>true</Beta>
  <Overview>${xml(name)} is a self-hosted file manager with two panes, uploads, previews, editing and share links. Beta release. Set the initial administrator password during installation, then sign in as admin. Protect remote access with HTTPS.</Overview>
  <Requires>Use separate Files and Appdata folders. Empty mount roots are initialized automatically; existing files and permissions are preserved.</Requires>
${config('Web interface','8080','8094','Port','tcp','HTTP port. Use an HTTPS proxy for remote access.')}
${config('Files','/files','/mnt/user/'+slug,'Path','rw','Only this folder is exposed through the file manager. Keep it outside Appdata.')}
${config('Appdata','/config','/mnt/user/appdata/'+slug,'Path','rw','Private accounts, sessions, settings and trash. Never place inside Files.')}
${config('Initial administrator password','INITIAL_ADMIN_PASSWORD','','Variable','','Choose 12–1024 characters. Used only when no account exists; never resets an existing password.','always','true')}
${config('User ID','PUID','99','Variable','','Numeric application user ID.','advanced')}
${config('Group ID','PGID','100','Variable','','Numeric application group ID.','advanced')}
${config('Read only','READ_ONLY','false','Variable','','Set true to disable file mutations.','advanced')}
${config('Secure cookies','COOKIE_SECURE','false','Variable','','Set true only when accessing through HTTPS.','advanced')}
</Container>
`;
  const profile=`<?xml version="1.0" encoding="UTF-8"?>
<CommunityApplications>
  <Profile>${xml(name)} is a self-hosted browser file manager. Source, installation instructions and support are available at ${xml(source)}. Use the project's private reporting channel for security issues.</Profile>
  <Icon>${xml(icon)}</Icon>
  <WebPage>${xml(source)}</WebPage>
</CommunityApplications>
`;
  return {template,profile};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const [configFile,output]=process.argv.slice(2);
  if(!configFile||!output)throw new Error('Usage: node scripts/unraid-template.js release-metadata.json NEW_OUTPUT_DIRECTORY');
  const metadata=JSON.parse(await fs.readFile(configFile,'utf8'));
  const rendered=renderUnraid(metadata);
  // Require a new staging directory so existing published files are never replaced.
  await fs.mkdir(output);
  await fs.mkdir(path.join(output,'templates'));
  await fs.writeFile(path.join(output,'templates',metadata.slug+'.xml'),rendered.template,{flag:'wx'});
  await fs.writeFile(path.join(output,'ca_profile.xml'),rendered.profile,{flag:'wx'});
  console.log('Created beta submission files. Publish verified source/image/icon, then run Community Apps Validate and Scan; this generator does not submit anything.');
}
