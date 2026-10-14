import {caseBackground,caseSpacing} from '../case/layout.js';

// Behance exports project background and generated separator CSS in stylesInline.
// Read only exact project selectors/declarations; none of the CSS is executed.
export function behanceLayout(project={}) {
  const rules=new Map();
  const css=typeof project.stylesInline==='string' ? project.stylesInline.slice(0,1000000).replace(/\/\*[\s\S]*?\*\//g,'') : '';
  for(const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    for(const selector of match[1].split(',').map(s=>s.trim().replace(/\s+/g,' '))) {
      if(!['#primary-project-content','#primary-project-content .module','.spacer','#primary-project-content .spacer'].includes(selector))continue;
      const declarations=rules.get(selector) || {};
      for(const part of match[2].split(';')) {
        const declaration=part.match(/^\s*([a-z-]+)\s*:\s*(.*?)\s*$/i);
        if(declaration)declarations[declaration[1].toLowerCase()]=declaration[2];
      }
      rules.set(selector,declarations);
    }
  }
  const canvas=rules.get('#primary-project-content') || {};
  const module=rules.get('#primary-project-content .module') || {};
  const spacer={...rules.get('.spacer'),...rules.get('#primary-project-content .spacer')};
  const backgroundColor=caseBackground(canvas['background-color']);
  const topSpacing=caseSpacing(canvas['padding-top']) ?? caseSpacing(project.styles?.spacing?.projectTopMargin);
  const moduleSpacing=caseSpacing(module['padding-bottom']);
  const spacerSpacing=caseSpacing(spacer.height);
  if(!backgroundColor&&topSpacing===null&&moduleSpacing===null&&spacerSpacing===null)return null;
  return {backgroundColor,topSpacing:topSpacing ?? 0,blockSpacing:caseSpacing((moduleSpacing ?? 0)+(spacerSpacing ?? 0)) ?? 0};
}
