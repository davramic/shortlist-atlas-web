/* Decorative only: no event capture, navigation, storage or network requests. */
(() => {
  'use strict';
  const artwork = [...document.querySelectorAll('.travel-ornament')];
  if (!artwork.length) return;
  const root = document.documentElement;
  const background = section => {
    for (let node=section; node; node=node.parentElement) {
      const color=getComputedStyle(node).backgroundColor;
      const rgb=color.match(/[\d.]+/g)?.map(Number);
      // color-mix() resolves to normalized color(srgb ...) in modern browsers.
      if (rgb && color.startsWith('color(srgb ')) for(let i=0;i<3;i++) rgb[i]*=255;
      if (rgb?.length>=3 && (rgb.length===3 || rgb[3]>.85)) return rgb;
    }
    return [255,253,250];
  };
  const place = el => {
    const section=el.parentElement;
    const [r,g,b]=background(section);
    const luminance=(r*.2126+g*.7152+b*.0722)/255;
    el.dataset.ornamentTone=luminance<.4?'dark':g>r+5&&g>=b?'sage':b>r+3?'cool':el.dataset.travelOrnament==='passport'?'cool':'warm';
    const content=[...section.children].find(child=>child.classList.contains('wrap'));
    if (!content) return;
    const bounds=content.getBoundingClientRect();
    const outer=section.getBoundingClientRect();
    const css=getComputedStyle(content);
    const rail=el.dataset.ornamentSide==='left'
      ? bounds.left-outer.left+parseFloat(css.paddingLeft)-16
      : outer.right-bounds.right+parseFloat(css.paddingRight)-16;
    el.style.setProperty('--travel-rail',`${Math.max(0,Math.min(360,rail))}px`);
  };
  artwork.forEach(place);
  if ('ResizeObserver' in window) {
    const resize=new ResizeObserver(entries=>entries.forEach(({target})=>{
      const el=target.querySelector(':scope > .travel-ornament');
      if(el) place(el);
    }));
    artwork.forEach(el=>resize.observe(el.parentElement));
  }
  if ('IntersectionObserver' in window) {
    const visible=new IntersectionObserver(entries=>entries.forEach(entry=>{
      entry.target.dataset.ornamentVisible=String(entry.isIntersecting);
    }),{rootMargin:'40px'});
    artwork.forEach(el=>visible.observe(el));
  } else artwork.forEach(el=>{el.dataset.ornamentVisible='true';});
  const visibility=()=>{root.dataset.atlasPageHidden=String(document.hidden);};
  document.addEventListener('visibilitychange',visibility);
  visibility();
})();
