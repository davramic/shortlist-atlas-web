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
  if(menu&&nav){const setOpen=open=>{nav.hidden=!open;menu.setAttribute('aria-expanded',String(open));menu.setAttribute('aria-label',open?'Close navigation':'Open navigation')};const close=()=>setOpen(false);menu.addEventListener('click',()=>setOpen(nav.hidden));nav.addEventListener('click',e=>{if(e.target.closest('a'))close()});document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!nav.hidden){close();menu.focus()}});matchMedia('(min-width:901px)').addEventListener('change',e=>e.matches&&close())}
  // Background ornament is optional, with a persistent control and OS preference.
  const motionMedia=matchMedia('(prefers-reduced-motion: reduce)');
  let motionPaused=motionMedia.matches;
  try { motionPaused=motionPaused||localStorage.getItem('atlas.motion.paused')==='true'; } catch {}
  const setMotion=paused=>{motionPaused=paused;document.documentElement.classList.toggle('motion-paused',paused);document.querySelectorAll('[data-motion-toggle]').forEach(b=>{b.setAttribute('aria-pressed',String(paused));b.setAttribute('aria-label',paused?'Enable background motion':'Pause background motion');b.querySelector('[data-motion-label]').textContent=paused?'Motion Off':'Motion On';});};
  document.querySelectorAll('[data-motion-toggle]').forEach(b=>b.addEventListener('click',()=>{setMotion(!motionPaused);try{localStorage.setItem('atlas.motion.paused',String(motionPaused));}catch{}}));
  motionMedia.addEventListener('change',e=>{if(e.matches)setMotion(true)});setMotion(motionPaused);
  // Actual app footage plays only on request. Pause when the tab is hidden.
  document.querySelectorAll('[data-app-video]').forEach(video=>{
    document.addEventListener('visibilitychange',()=>{if(document.hidden)video.pause()});
  });
})();

/* Destination browsing uses existing app records. No account or remote search service. */
(() => {
  'use strict';
  const grid=document.querySelector('[data-visits-grid]');
  if(grid){
    const all=[...grid.children], select=document.querySelector('[data-visit-filter]'), prev=document.querySelector('[data-visits-prev]'), next=document.querySelector('[data-visits-next]'), count=document.querySelector('[data-visits-count]');
    let page=0;
    const size=()=>grid.hasAttribute('data-visits-all')?all.length:(matchMedia('(max-width:900px)').matches?2:4);
    const update=()=>{const list=all.filter(c=>!select.value||c.dataset.visitCountry===select.value), n=size();page=Math.max(0,Math.min(page,Math.ceil(list.length/n)-1));all.forEach(c=>c.hidden=true);list.slice(page*n,(page+1)*n).forEach(c=>c.hidden=false);count.textContent=`${page*n+1}–${Math.min((page+1)*n,list.length)} of ${list.length} city visits`;prev.disabled=page===0;next.disabled=(page+1)*n>=list.length;};
    select.addEventListener('change',()=>{page=0;update()});prev.addEventListener('click',()=>{page--;update()});next.addEventListener('click',()=>{page++;update()});matchMedia('(max-width:900px)').addEventListener('change',()=>{page=0;update()});update();
  }
  const filter=document.querySelector('[data-catalog]');
  if(!filter)return;
  const query=filter.querySelector('[data-catalog-query]'), country=filter.querySelector('[data-catalog-country]'), category=filter.querySelector('[data-catalog-category]'), submit=filter.querySelector('[data-catalog-submit]');
  const count=document.querySelector('[data-catalog-count]'), results=document.querySelector('[data-catalog-results]'), position=document.querySelector('[data-catalog-page]'), prev=document.querySelector('[data-catalog-prev]'), next=document.querySelector('[data-catalog-next]');
  const normalize=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  const urlSafe=raw=>{try{const u=new URL(raw);return ['https:','http:'].includes(u.protocol)?u.href:null}catch{return null}};
  const make=(tag,text,cls)=>{const el=document.createElement(tag);el.textContent=text;if(cls)el.className=cls;return el};
  const link=(url,label)=>{const a=make('a',label);a.href=url;a.target='_blank';a.rel='noopener noreferrer';return a};
  let records=[],matches=[],page=0,failed=false;
  const params=new URLSearchParams(location.search);query.value=params.get('q')||'';
  if([...country.options].some(o=>o.value===params.get('country')))country.value=params.get('country');
  if([...category.options].some(o=>o.value===params.get('interest')))category.value=params.get('interest');
  function render(){
    results.replaceChildren();const start=page*12;
    matches.slice(start,start+12).forEach(p=>{
      const card=make('article','','catalog-result');card.append(make('span',`${p.d} · ${p.c}`),make('h2',p.n));if(p.closed)card.append(make('p','Temporarily closed. Check the venue before you plan a visit.','catalog-closed'));
      const cats=(p.k||[]).map(c=>[...category.options].find(o=>o.value===c)?.textContent).filter(Boolean);if(cats.length)card.append(make('p',cats.join(' · ')));
      const detail=make('details','');detail.append(make('summary','Source & Date'),make('p',(p.s||'Source not recorded')+(p.checked?` · Source dated ${p.checked}`:' · Source date not recorded')));card.append(detail);
      const actions=make('div','','result-links'), website=urlSafe(p.u);if(website){let host='';try{host=new URL(website).hostname}catch(e){}actions.append(link(website,/(^|\.)(wikipedia|wikivoyage|wikidata)\.org$/i.test(host)?'Read Reference ↗':'Visit Website ↗'))}
      if(typeof p.lat==='number'&&typeof p.lon==='number'&&Math.abs(p.lat)<=90&&Math.abs(p.lon)<=180&&(p.lat!==0||p.lon!==0))actions.append(link(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${p.lat},${p.lon}`)}`,'View on Map ↗'));
      if(actions.childElementCount)card.append(actions);results.append(card);
    });
    count.textContent=`${matches.length.toLocaleString()} ${matches.length===1?'place':'places'} found`;
    position.textContent=matches.length?`${start+1}–${Math.min(start+12,matches.length)} of ${matches.length.toLocaleString()}`:'No matching places';
    prev.disabled=page===0;next.disabled=start+12>=matches.length;
    if(!matches.length)results.append(make('p','No places match those filters. Try a shorter name, another interest or All Countries.','catalog-empty'));
  }
  function search(){const terms=normalize(query.value).split(/\s+/).filter(Boolean);matches=records.filter(p=>(!country.value||p.c===country.value)&&(!category.value||p.k?.includes(category.value))&&terms.every(t=>p.search.includes(t)));page=0;render();const state=new URLSearchParams();if(query.value.trim())state.set('q',query.value.trim());if(country.value)state.set('country',country.value);if(category.value)state.set('interest',category.value);history.replaceState(null,'',location.pathname+(state.size?'?'+state.toString():'')+location.hash);}
  async function load(){submit.disabled=true;prev.disabled=true;next.disabled=true;try{const response=await fetch(filter.dataset.catalogUrl);if(!response.ok)throw Error('Catalog unavailable');const data=await response.json();if(!Array.isArray(data.places))throw Error('Invalid catalog');records=data.places.map(p=>({...p,search:normalize(`${p.n} ${p.d} ${p.c}`)}));failed=false;submit.textContent='Search Places ↗';search();}catch{failed=true;count.textContent='The place catalog didn’t load. Please try again.';submit.textContent='Try Again ↻';}finally{submit.disabled=false}}
  submit.addEventListener('click',()=>failed?load():search());query.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();if(!submit.disabled)failed?load():search()}});country.addEventListener('change',()=>{if(records.length)search()});category.addEventListener('change',()=>{if(records.length)search()});
  prev.addEventListener('click',()=>{page--;render()});next.addEventListener('click',()=>{page++;render()});load();
})();

/* Feature previews, accessible motion and a concise native tour. */
(() => {
  'use strict';
  const motionOK=()=>!matchMedia('(prefers-reduced-motion: reduce)').matches&&!document.documentElement.classList.contains('motion-paused');
  if('IntersectionObserver' in window){
    const observer=new IntersectionObserver(entries=>entries.forEach(e=>{e.target.classList.toggle('rise-in',e.isIntersecting)}),{threshold:.08,rootMargin:'0px 0px -25px 0px'});
    document.querySelectorAll('[data-rise]').forEach(el=>{el.classList.add('rise-ready');observer.observe(el)});
  }
  document.querySelectorAll('[data-odometer]').forEach(el=>{
    const value=Number(el.dataset.odometer).toLocaleString('en-US');el.setAttribute('aria-label',value);el.setAttribute('role','img');
    const display=document.createElement('span');display.className='odometer-display';display.setAttribute('aria-hidden','true');
    [...value].forEach((char,i)=>{
      if(!/\d/.test(char)){const sep=document.createElement('span');sep.textContent=char;display.append(sep);return}
      const windowEl=document.createElement('span');windowEl.className='digit-window';const reel=document.createElement('span');reel.className='digit-reel';
      const digit=Number(char);reel.style.setProperty('--digit',digit);reel.style.setProperty('--landing',digit+10);reel.style.setProperty('--delay',`${i*.07}s`);
      for(let n=0;n<20;n++){const number=document.createElement('span');number.textContent=String(n%10);reel.append(number)}windowEl.append(reel);display.append(windowEl);
    });el.replaceChildren(display);
    if('IntersectionObserver' in window){const observer=new IntersectionObserver(entries=>{entries.forEach(e=>{if(e.isIntersecting&&motionOK())requestAnimationFrame(()=>el.classList.add('odometer-running'));else if(!e.isIntersecting)el.classList.remove('odometer-running')})},{threshold:.6});observer.observe(el)}
  });
  const tabs=[...document.querySelectorAll('[data-feature-tab]')];
  function selectFeature(tab){const index=tab.dataset.featureTab;tabs.forEach(b=>{const active=b===tab;b.setAttribute('aria-selected',String(active));b.tabIndex=active?0:-1});document.querySelectorAll('[data-feature-panel]').forEach(p=>p.hidden=p.dataset.featurePanel!==index);document.querySelectorAll('[data-feature-image]').forEach(img=>img.hidden=img.dataset.featureImage!==index);const caption=document.querySelector('[data-feature-caption]');if(caption)caption.textContent=`${tab.textContent} · ${index==='5'?'Available from Home':'Current App Screen'}`;}
  tabs.forEach((tab,i)=>{tab.addEventListener('click',()=>selectFeature(tab));tab.addEventListener('keydown',e=>{let next;if(e.key==='ArrowRight'||e.key==='ArrowDown')next=(i+1)%tabs.length;if(e.key==='ArrowLeft'||e.key==='ArrowUp')next=(i-1+tabs.length)%tabs.length;if(e.key==='Home')next=0;if(e.key==='End')next=tabs.length-1;if(next!==undefined){e.preventDefault();selectFeature(tabs[next]);tabs[next].focus()}})});
  document.querySelectorAll('[data-app-video]').forEach(video=>{const figure=video.closest('figure'),play=figure.querySelector('[data-tour-play]'),status=figure.querySelector('[data-tour-status]'),speeds=[...figure.querySelectorAll('[data-video-speed]')];if(!play)return;
    const update=()=>{play.textContent=video.ended?'Replay the Tour ↻':video.paused?'Play the 31-Second Tour ▶':'Pause the Tour Ⅱ';play.setAttribute('aria-label',video.paused?'Play recorded app tour':'Pause recorded app tour')};
    play.addEventListener('click',async()=>{if(!video.paused){video.pause();return}try{status.textContent='Starting the tour…';await video.play()}catch{status.textContent='Tap the video’s Play button, or read the walkthrough below.'}update()});
    video.addEventListener('playing',()=>{status.textContent=`Playing at ${video.playbackRate}× speed.`;update()});video.addEventListener('pause',update);video.addEventListener('ended',()=>{status.textContent='That’s the tour. Explore a feature, or watch it again.';update()});speeds.forEach(b=>b.addEventListener('click',()=>{video.playbackRate=Number(b.dataset.videoSpeed);speeds.forEach(x=>x.setAttribute('aria-pressed',String(x===b)));status.textContent=`${b.textContent} · ${video.playbackRate}× speed.`}));
  });
})();
// Anchor targets remain below the header when the reader enlarges text.
(()=>{const header=document.querySelector('.hdr');if(header&&'ResizeObserver' in window)new ResizeObserver(()=>document.documentElement.style.setProperty('--header-height',`${header.getBoundingClientRect().height}px`)).observe(header)})();
