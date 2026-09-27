// Development verification entry point, not part of the user's installation flow.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {nodeApi} from '../js/node-bridge.js';
import {packageBehanceCase} from '../js/case/package.js';
Object.assign(nodeApi,{fs,path,crypto,Buffer});
const [, , input, output] = process.argv;
if (!input || !output) throw new Error('Usage: node scripts/package-case.mjs downloaded-entry.json output.rscase');
const result = await packageBehanceCase(JSON.parse(fs.readFileSync(input,'utf8')),path.resolve(output));
console.log(JSON.stringify({path:result.path,bytes:result.bytes,complete:result.manifest.complete,blocks:result.manifest.blocks.length}));
