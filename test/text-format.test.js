import test from 'node:test';
import assert from 'node:assert/strict';
import {dominantLineEnding} from '../public/text-format.js';

test('editor preserves the original dominant CRLF/LF policy, including ties',()=>{
  for(const [text,expected] of [['','\n'],['one','\n'],['a\nb\n','\n'],['a\r\nb\r\n','\r\n'],['a\r\nb\nc\r\n','\r\n'],['a\r\nb\n','\n'],['a\rb\r','\n'],['\uFEFFé\r\n','\r\n']])
    assert.equal(dominantLineEnding(text),expected,JSON.stringify(text));
});
