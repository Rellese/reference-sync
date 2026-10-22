import {downloadDirectMedia} from './direct-media.js';
import {xTarget,xMediaUrl} from './x-target.js';
import {xFailure} from './x-session.js';
export const downloadX=(options,deps)=>downloadDirectMedia(options,{code:'x',title:'X',target:xTarget,mediaUrl:xMediaUrl,failure:xFailure,extensions:['jpg','jpeg','png','webp','gif','mp4']},deps);
