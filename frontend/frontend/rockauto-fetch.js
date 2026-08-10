/**
 * RockAuto Fetch Module v3.1.0
 * Typed fetch wrapper for CF Worker proxy → RockAuto data.
 * AbortController timeout, retry, dedup, Retry-After respect.
 */
const RockAutoFetch = (() => {
  'use strict';
  const CONFIG = Object.freeze({
    get baseUrl() {
      return (typeof window !== 'undefined' && window.__ROCKAUTO_PROXY_URL) ||
        'https://parts-command-api.techguruofficial.workers.dev';
    },
    timeoutMs: 12000, maxRetries: 2, baseRetryDelayMs: 500,
  });
  const _inflight = new Map();
  const _delay = (ms) => new Promise((r) => setTimeout(r, ms));

  async function _exec(url, extSignal) {
    let lastErr = null;
    for (let i = 0; i <= CONFIG.maxRetries; i++) {
      const ctrl = new AbortController();
      const tid = setTimeout(() => ctrl.abort(), CONFIG.timeoutMs);
      if (extSignal?.aborted) { clearTimeout(tid); return { ok:false,data:null,error:'Aborted',status:0 }; }
      if (extSignal) extSignal.addEventListener('abort', () => ctrl.abort(), { once:true });
      try {
        const res = await fetch(url.toString(), { method:'GET', headers:{'Accept':'application/json'}, signal:ctrl.signal, credentials:'omit' });
        clearTimeout(tid);
        if (res.status === 429) {
          const ra = parseInt(res.headers.get('Retry-After')||'5',10);
          if (i < CONFIG.maxRetries) { await _delay(ra*1000); continue; }
          return { ok:false,data:null,error:'Rate limited',status:429 };
        }
        if (res.status >= 500) {
          lastErr = `Server error (${res.status})`;
          if (i < CONFIG.maxRetries) { await _delay(CONFIG.baseRetryDelayMs*Math.pow(2,i)); continue; }
          return { ok:false,data:null,error:lastErr,status:res.status };
        }
        if (!res.ok) {
          let ed = `Failed (${res.status})`; try { const b=await res.json(); ed=b.error||b.detail||ed; } catch(_e){}
          return { ok:false,data:null,error:ed,status:res.status };
        }
        return { ok:true,data:await res.json(),error:null,status:res.status };
      } catch(e) {
        clearTimeout(tid);
        lastErr = e.name==='AbortError' ? 'Timed out' : (e.message||'Network error');
        if (i < CONFIG.maxRetries) { await _delay(CONFIG.baseRetryDelayMs*Math.pow(2,i)); continue; }
      }
    }
    return { ok:false,data:null,error:lastErr||'Failed',status:0 };
  }

  async function request(path, opts={}) {
    const url = new URL(path, CONFIG.baseUrl);
    if (opts.params) for (const [k,v] of Object.entries(opts.params)) { if (v!=null&&v!=='') url.searchParams.set(k,String(v)); }
    const key = url.toString();
    if (_inflight.has(key)) return _inflight.get(key);
    const p = _exec(url, opts.signal);
    _inflight.set(key, p);
    try { return await p; } finally { _inflight.delete(key); }
  }

  const enc = encodeURIComponent;
  const guard = (c,m) => c ? null : Promise.resolve({ok:false,data:null,error:m,status:400});
  return Object.freeze({
    request, CONFIG,
    getMakes:      ()                      => request('/v1/rockauto/makes'),
    getYears:      (mk)                    => guard(mk,'make required') || request(`/v1/rockauto/years/${enc(mk)}`),
    getModels:     (mk,yr)                 => guard(mk&&yr,'make+year required') || request(`/v1/rockauto/models/${enc(mk)}/${enc(yr)}`),
    getEngines:    (mk,yr,md)              => guard(mk&&yr&&md,'make+year+model required') || request(`/v1/rockauto/engines/${enc(mk)}/${enc(yr)}/${enc(md)}`),
    getCategories: (mk,yr,md,cc)           => guard(mk&&yr&&md&&cc,'make+year+model+carcode required') || request(`/v1/rockauto/categories/${enc(mk)}/${enc(yr)}/${enc(md)}/${enc(cc)}`),
    getParts:      (mk,yr,md,cc,category)  => guard(mk&&yr&&md&&cc&&category,'make+year+model+carcode+category required') || request(`/v1/rockauto/parts/${enc(mk)}/${enc(yr)}/${enc(md)}/${enc(cc)}`,{params:{category}}),
    searchParts:   (q)                     => guard(q&&q.length>=2,'query 2+ chars') || request('/v1/rockauto/search',{params:{q}}),
  });
})();
if (typeof module!=='undefined'&&module.exports) module.exports=RockAutoFetch;
