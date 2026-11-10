import test from 'node:test';import assert from 'node:assert/strict';
import {archiveHttpsUrl,requireAuthenticatedHttps} from '../../js/authenticated-links.js';
import {resolveArchiveLinks} from '../../js/archive-transfer.js';
import {parseArchiveMetadata} from '../../js/archive-reader.js';
test('archive links become canonical HTTPS with no tracking data',()=>{
 assert.equal(archiveHttpsUrl('http://www.instagram.com/reel/ABC_123/?foo=bar','instagram'),'https://www.instagram.com/reel/ABC_123/');
 assert.equal(archiveHttpsUrl('http://ru.pinterest.com/pin/123456/','pinterest'),'https://www.pinterest.com/pin/123456/');
 for(const url of ['https://instagram.com.evil.test/p/ABC/','https://evil.instagram.com/p/ABC/','http://user:pass@instagram.com/p/ABC/','http://instagram.com:8080/p/ABC/','ftp://instagram.com/p/ABC/','https://instagram.com/profile/'])assert.throws(()=>archiveHttpsUrl(url,'instagram'));
 const parsed=parseArchiveMetadata('<a href="http://instagram.com/p/ABC/">post</a>','html','instagram');assert.equal(parsed.links[0].url,'https://www.instagram.com/p/ABC/');
});
test('archive resolver validates again before invoking authenticated engine',async()=>{
 let calls=0;await resolveArchiveLinks([{publicationId:'123',url:'http://pinterest.com/pin/123/'}],{settings:{platform:'pinterest',browser:'chrome',speed:'lightning'},run:async args=>{calls++;assert.ok(args.includes('https://www.pinterest.com/pin/123/'));assert.ok(!args.some(x=>x.startsWith('http:')));return {stdout:'',code:0};}});assert.equal(calls,1);
 await assert.rejects(resolveArchiveLinks([{publicationId:'123',url:'http://attacker.test/pin/123/'}],{settings:{platform:'pinterest'},run:()=>assert.fail('must not execute')}));
 for(const cookies of ['--cookies','--cookies-from-browser','--cookies-from-browser=chrome'])assert.throws(()=>requireAuthenticatedHttps([cookies,'fixture','http://www.pinterest.com/pin/123/']),/HTTPS/);
 assert.doesNotThrow(()=>requireAuthenticatedHttps(['--cookies','fixture','https://www.pinterest.com/pin/123/']));
});
