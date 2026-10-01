import { nodeApi } from '../node-bridge.js';
import { throwIfAborted } from '../job-control.js';
import { packageBehanceCase } from './package.js';

export function caseRegistryId(post) {
  if (post?.source !== 'behance' || !/^behance:\S+$/.test(post.postId || '')) throw new Error('Invalid case source identity');
  return `case:v1:${post.postId}`;
}
export function caseModes(post) {
  if(!post?.caseSelection && post?.source==='behance' && post.caseDocument)return {whole:true,blocks:false};
  return {whole:post?.caseSelection?.whole === true, blocks:post?.caseSelection?.blocks !== false};
}
export function isPostImported(post,known=new Set()) {
  if(post?.source!=='behance'||!post.caseDocument)return known.has(post?.postId);
  const mode=caseModes(post),wholeKnown=known.has(caseRegistryId(post)),blocksKnown=known.has(post.postId);
  if(mode.whole)return wholeKnown && (!mode.blocks || blocksKnown);
  return mode.blocks ? blocksKnown : wholeKnown && blocksKnown;
}

export function pendingCase(post, known = new Set()) {
  return post?.source === 'behance' && caseModes(post).whole && !known.has(caseRegistryId(post));
}

export function caseImportItem(entry) {
  if (!entry.caseFile) return null;
  return {path:entry.caseFile,postId:caseRegistryId(entry.post),sourcePostId:entry.post.postId,
    component:'0',componentCount:1,importKind:'case',
    name:entry.post.caseDocument?.source?.title || entry.post.username || 'Behance',
    website:entry.post.url,tags:['Behance'],annotation:''};
}

// Keep the user's block selection separate from the full download needed for
// the case. One network pass can feed both outputs without duplicate downloads.
export async function downloadWithCases(options, download, pack=packageBehanceCase) {
  const originals = new Map((options.posts || []).map(post=>[post.postId,post]));
  const selected = [...originals.values()].filter(post=>{
    const mode=caseModes(post);return mode.whole || (mode.blocks && (!Array.isArray(post.selectedComponents) || post.selectedComponents.length > 0));
  });
  const hasCases = selected.some(post=>caseModes(post).whole);
  if (!hasCases) return download({...options,posts:selected});
  const {path,crypto} = nodeApi;
  let stagingRoot = options.stagingRoot || '';
  const processed = new Map();
  const complete = async entry => {
    if (processed.has(entry.post.postId)) return processed.get(entry.post.postId);
    throwIfAborted(options.signal);
    const original = originals.get(entry.post.postId);
    const mode = caseModes(original);
    const result = {...entry,post:original};
    if (mode.whole) {
      try {
        await options.control?.checkpoint();
        if (!stagingRoot) throw new Error('Missing case staging directory');
        const destination=path.join(stagingRoot,`case-${crypto.randomBytes(12).toString('hex')}.rscase`);
        const packed=await pack(result,destination,{signal:options.signal});
        result.caseFile=packed.path;
        result.caseComplete=packed.manifest.complete;
      } catch(error) {
        if (options.signal?.aborted || error.code === 'JOB_STOPPED') throw error;
        result.caseError=error.message;
      }
    }
    // These are the original downloads, including media used only by the case.
    // Individual import must use blockFiles, never the expanded files array.
    const chosen = new Set((original.selectedComponents || original.components?.map(c=>c.index) || []).map(Number));
    result.blockFiles = mode.blocks ? entry.files.filter(file=>chosen.has(Number(path.basename(file).match(/^(\d+)\./)?.[1]))) : [];
    processed.set(original.postId,result);
    await options.onCompleted?.(result);
    return result;
  };
  const output = await download({...options,
    posts:selected.map(post=>caseModes(post).whole ? {...post,selectedComponents:post.components.map(c=>c.index)} : post),
    onStagingReady:async root=>{stagingRoot=root;await options.onStagingReady?.(root);},
    onCompleted:complete,
  });
  const results=[];
  for(const entry of output.results || []) results.push(await complete(entry));
  return {...output,results};
}
