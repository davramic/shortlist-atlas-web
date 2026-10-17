/* Local interface state; geographic iframes use OpenStreetMap, without analytics. */
(() => {
  'use strict';
  // File:// review works without a server; web-hosted routes keep their clean URLs.
  if(location.protocol==='file:'){
    const repair=()=>document.querySelectorAll('a[href]').forEach(a=>{const raw=a.getAttribute('href');if(!raw||/^(https?:|mailto:|#)/.test(raw))return;const url=new URL(raw,location.href);if(url.pathname.endsWith('/')){url.pathname+='index.html';a.setAttribute('href',url.href)}});
    repair();new MutationObserver(repair).observe(document.body,{childList:true,subtree:true});
  }
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  // Swipe is optional: every gallery also has explicit, keyboard-ready controls.
  document.querySelectorAll('[data-rail-controls]').forEach(controls=>{
    const rail=document.getElementById(controls.dataset.railControls);
    if(!rail)return;
    const prev=controls.querySelector('[data-rail-prev]'),next=controls.querySelector('[data-rail-next]'),position=controls.querySelector('[data-rail-position]');
    const cards=()=>[...rail.children].filter(x=>!x.hidden&&!x.classList.contains('soon'));
    const current=()=>{if(rail.scrollLeft>0&&rail.scrollLeft>=rail.scrollWidth-rail.clientWidth-2)return cards().length-1;const left=rail.getBoundingClientRect().left;return cards().reduce((best,x,i,all)=>Math.abs(x.getBoundingClientRect().left-left)<Math.abs(all[best].getBoundingClientRect().left-left)?i:best,0)};
    const update=()=>{const count=cards().length,i=current();position.textContent=`${Math.min(i+1,count)} / ${count}`;prev.disabled=rail.scrollLeft<2;next.disabled=rail.scrollLeft>=rail.scrollWidth-rail.clientWidth-2};
    const move=step=>{const list=cards(),i=Math.max(0,Math.min(list.length-1,current()+step));if(list[i])rail.scrollTo({left:rail.scrollLeft+list[i].getBoundingClientRect().left-rail.getBoundingClientRect().left,behavior:reduced?'instant':'smooth'})};
    prev.addEventListener('click',()=>move(-1));next.addEventListener('click',()=>move(1));rail.addEventListener('scroll',update,{passive:true});new ResizeObserver(update).observe(rail);
    new MutationObserver(()=>{rail.scrollTo({left:0,behavior:'instant'});update()}).observe(rail,{subtree:true,attributes:true,attributeFilter:['hidden']});
    update();
  });
  document.querySelector('#dossier-jump')?.addEventListener('change',e=>{if(e.target.value)location.hash=e.target.value});
  document.querySelectorAll('[data-local-map]').forEach(map=>{
    const frame=map.querySelector('iframe'),unlock=map.querySelector('.map-unlock'),lock=map.querySelector('.map-lock');
    const setActive=active=>{map.classList.toggle('is-active',active);unlock.hidden=active;lock.hidden=!active;frame.tabIndex=active?0:-1};
    unlock.addEventListener('click',()=>{setActive(true);lock.focus({preventScroll:true})});
    lock.addEventListener('click',()=>{setActive(false);unlock.focus({preventScroll:true})});
    map.addEventListener('keydown',e=>{if(e.key==='Escape'){setActive(false);unlock.focus({preventScroll:true})}});
    map.querySelectorAll('[data-map-src]').forEach(button=>button.addEventListener('click',()=>{
      map.querySelectorAll('[data-map-src]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));
      frame.src=button.dataset.mapSrc;setActive(false);
    }));
  });
  document.querySelectorAll('.town-locator').forEach(d=>d.addEventListener('toggle',()=>{if(d.open)window.dispatchEvent(new Event('resize'))}));
  const menu=document.querySelector('.menu-toggle'), nav=document.querySelector('#mobile-nav');
  if(menu&&nav){const close=()=>{nav.hidden=true;menu.setAttribute('aria-expanded','false')};menu.addEventListener('click',()=>{nav.hidden=!nav.hidden;menu.setAttribute('aria-expanded',String(!nav.hidden))});nav.addEventListener('click',close);document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!nav.hidden){close();menu.focus()}});matchMedia('(min-width:901px)').addEventListener('change',e=>e.matches&&close())}
  document.querySelectorAll('.app-showcase').forEach(section=>{
    const buttons=[...section.querySelectorAll('[data-demo]')],screens=[...section.querySelectorAll('[data-screen]')],scroll=section.querySelector('.phone-scroll'),toggle=section.querySelector('.demo-play');
    let index=0,playing=false,visible=false,last=0,elapsed=0,raf=0;
    const select=i=>{index=i;buttons.forEach((b,n)=>b.setAttribute('aria-pressed',String(n===i)));screens.forEach(s=>s.hidden=s.dataset.screen!==buttons[i].dataset.demo);scroll.scrollTop=0;elapsed=0;last=0};
    const state=()=>{toggle.textContent=playing?'Pause preview':'Play preview';toggle.setAttribute('aria-pressed',String(playing))};
    const stop=()=>{playing=false;state();cancelAnimationFrame(raf)};
    const tick=now=>{if(!playing||!visible||document.hidden)return;const dt=last?Math.min(now-last,60):0;last=now;elapsed+=dt;const max=scroll.scrollHeight-scroll.clientHeight;if(elapsed>2000&&max>0)scroll.scrollTop=Math.min(max,(elapsed-2000)*.025);if(elapsed>Math.max(8500,2000+max/.025+1800))select((index+1)%screens.length);raf=requestAnimationFrame(tick)};
    const start=()=>{playing=true;last=0;state();cancelAnimationFrame(raf);if(visible&&!document.hidden)raf=requestAnimationFrame(tick)};
    buttons.forEach((b,i)=>b.addEventListener('click',()=>{stop();select(i)}));toggle.addEventListener('click',()=>playing?stop():start());
    ['wheel','touchstart','pointerdown','keydown'].forEach(ev=>scroll.addEventListener(ev,stop,{passive:ev!=='keydown'}));
    new IntersectionObserver(es=>{visible=es[0].isIntersecting;cancelAnimationFrame(raf);last=0;if(playing&&visible)raf=requestAnimationFrame(tick)},{threshold:.2}).observe(section.querySelector('.phone-stage')); 
    document.addEventListener('visibilitychange',()=>{cancelAnimationFrame(raf);last=0;if(playing&&visible&&!document.hidden)raf=requestAnimationFrame(tick)});
    select(0);if(!reduced)start();else state();
  });
})();
