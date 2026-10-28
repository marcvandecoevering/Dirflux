import test from 'node:test';
import assert from 'node:assert/strict';
import {renderUnraid} from '../scripts/unraid-template.js';

// Synthetic metadata only: these are not advertised as published destinations.
const metadata={name:'Example & files',slug:'example-files',project:'https://github.com/example/example-files',image:'ghcr.io/example/example-files:0.1.0-beta.1',icon:'https://example.invalid/icon.png'};

test('central catalog changes only template location, preserving application links',()=>{
  const {template}=renderUnraid({...metadata,templateRepository:'https://github.com/example/unraid-templates'});
  assert.ok(template.includes('<TemplateURL>https://raw.githubusercontent.com/example/unraid-templates/main/templates/example-files.xml</TemplateURL>'));
  assert.ok(template.includes('<Project>https://github.com/example/example-files</Project>'));
  assert.ok(template.includes('<Support>https://github.com/example/example-files/issues</Support>'));
  assert.throws(()=>renderUnraid({...metadata,templateRepository:'https://github.com:8443/example/templates'}),/canonical/);
});

test('Unraid generator rejects a slug whose default host mounts would overlap',()=>{
  assert.throws(()=>renderUnraid({...metadata,slug:'appdata'}),/overlap/);
});

test('Unraid project metadata cannot silently change the supplied repository origin',()=>{
  for(const project of ['https://github.com:8443/example/files','http://github.com/example/files','https://github.com.evil.invalid/example/files','https://user:password@github.com/example/files','https://github.com/example/files?ref=main','https://github.com/example/files#readme'])
    assert.throws(()=>renderUnraid({...metadata,project}),/HTTPS|canonical/);
});

test('generated beta metadata escapes text and preserves restricted runtime settings',()=>{
  const {template,profile}=renderUnraid(metadata);
  assert.match(template,/<Name>Example &amp; files<\/Name>/);assert.match(profile,/<Profile>Example &amp; files /);
  assert.match(template,/<Privileged>false<\/Privileged>/);
  assert.ok(template.includes('--cap-drop=ALL --cap-add=CHOWN --cap-add=FOWNER --cap-add=DAC_OVERRIDE --cap-add=SETUID --cap-add=SETGID'));
  assert.match(template,/<WebUI>http:\/\/\[IP\]:\[PORT:8094\]\/<\/WebUI>/);
  assert.match(template,/Target="\/files" Default="\/mnt\/user\/example-files"/);
  assert.match(template,/Target="\/config" Default="\/mnt\/user\/appdata\/example-files"/);
  assert.match(template,/<TemplateURL>https:\/\/raw.githubusercontent.com\/example\/example-files\/main\/templates\/example-files.xml<\/TemplateURL>/);
  assert.match(template,/Target="INITIAL_ADMIN_PASSWORD".*Mask="true"/);
  assert.match(template,/<Beta>true<\/Beta>/);
  assert.doesNotMatch(template,/docker.sock|<MinVer>|<MaxVer>/);
});
