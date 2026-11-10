(() => {
 const colors={dark:'#18191c',gray:'#37383c',blue:'#0d1630',purple:'#1c1424',light:'#ffffff',lightgray:'#e3e4e6'};
 const system=matchMedia('(prefers-color-scheme: dark)');
 function apply(){
  const requested=new URLSearchParams(location.search).get('theme')||'auto';
  const theme=colors[requested]?requested:system.matches?'dark':'light';
  const root=document.documentElement;
  root.dataset.theme=theme;root.style.setProperty('--background',colors[theme]);
  root.style.colorScheme=['light','lightgray'].includes(theme)?'light':'dark';
 }
 system.addEventListener('change',apply);window.addEventListener('popstate',apply);apply();
})();
