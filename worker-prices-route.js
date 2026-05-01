/**
 * =============================================================
 * CLOUDFLARE WORKER — /prices ROUTE HANDLER
 * =============================================================
 * 
 * Add this route handler to your existing Cloudflare Worker
 * (parts-command-api.techguruofficial.workers.dev)
 * 
 * INSTRUCTIONS:
 * 1. Copy the handlePriceLookup() function and the scraper functions below
 * 2. Add this routing logic inside your Worker's fetch handler:
 * 
 *    if (url.pathname === '/prices') {
 *      return handlePriceLookup(request, url);
 *    }
 * 
 * 3. Deploy with `wrangler deploy`
 * =============================================================
 */

// Add this to your Worker's main fetch handler
// if (url.pathname === '/prices') {
//   return handlePriceLookup(request, url);
// }

async function handlePriceLookup(request, url) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  // Handle CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers });
  }

  const partNumber = url.searchParams.get('partNumber');
  const brand = url.searchParams.get('brand') || '';

  if (!partNumber) {
    return new Response(JSON.stringify({ error: 'partNumber required' }), { status: 400, headers });
  }

  // Run all retailer fetches in parallel — don't wait for slow ones
  const results = await Promise.allSettled([
    scrapeNapa(partNumber, brand),
    scrapeAutozone(partNumber, brand),
    scrapeAdvanceAuto(partNumber, brand),
  ]);

  const prices = {
    partNumber,
    napa:     results[0].status === 'fulfilled' ? results[0].value : null,
    autozone: results[1].status === 'fulfilled' ? results[1].value : null,
    advance:  results[2].status === 'fulfilled' ? results[2].value : null,
    rockauto: null,  // blocks all scraping — manual only
    oreilly:  null,  // blocks all scraping — manual only
    carquest: null,  // same as Advance, would be duplicate anyway
    fetchedAt: new Date().toISOString()
  };

  return new Response(JSON.stringify(prices), { headers });
}


// ==================== RETAILER SCRAPERS ====================

/**
 * Each scraper fetches the retailer's search page and attempts
 * to parse the first product price found.
 * 
 * IMPORTANT: Retailer HTML structures change frequently.
 * These parsers will need periodic updates.
 * Test locally with `wrangler dev` before deploying.
 */

async function scrapeNapa(partNumber, brand) {
  try {
    const searchUrl = `https://www.napaonline.com/en/search?q=${encodeURIComponent(partNumber)}`;

    const res = await fetch(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      cf: { cacheTtl: 3600 }  // cache in Cloudflare edge for 1 hour
    });

    if (!res.ok) return null;
    const html = await res.text();

    // NAPA often renders prices in JSON-LD structured data
    const jsonLdMatch = html.match(/"price"\s*:\s*"?([\d.]+)"?/);
    if (jsonLdMatch) return parseFloat(jsonLdMatch[1]);

    // Fallback: look for price pattern in HTML
    const priceMatch = html.match(/\$\s*([\d,]+\.[\d]{2})/);
    return priceMatch ? parseFloat(priceMatch[1].replace(',', '')) : null;
  } catch (e) {
    return null;
  }
}

async function scrapeAutozone(partNumber, brand) {
  try {
    const searchUrl = `https://www.autozone.com/searchresult?searchText=${encodeURIComponent(partNumber)}`;

    
    const res = await fetch(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15',
        'Accept': 'text/html',
      },
      cf: { cacheTtl: 3600 }
    });

    if (!res.ok) return null;
    const html = await res.text();

    // AutoZone embeds prices in __NEXT_DATA__ JSON
    const nextDataMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (nextDataMatch) {
      try {
        const data = JSON.parse(nextDataMatch[1]);
        const products = data?.props?.pageProps?.products ||
                         data?.props?.pageProps?.initialData?.products || [];
        if (products.length > 0) {
          const price = products[0]?.pricing?.finalPrice || products[0]?.price;
          if (price) return parseFloat(price);
        }
      } catch (e) { /* JSON parse failed */ }
    }

    // Fallback regex
    const priceMatch = html.match(/data-testid="price"[^>]*>\$?([\d.]+)/);
    return priceMatch ? parseFloat(priceMatch[1]) : null;
  } catch (e) {
    return null;
  }
}

async function scrapeAdvanceAuto(partNumber, brand) {
  try {
    const searchUrl = `https://shop.advanceautoparts.com/find/${encodeURIComponent(partNumber)}`;

    const res = await fetch(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html',
      },
      cf: { cacheTtl: 3600 }
    });

    if (!res.ok) return null;
    const html = await res.text();

    const priceMatch = html.match(/"salePrice"\s*:\s*([\d.]+)/);
    return priceMatch ? parseFloat(priceMatch[1]) : null;
  } catch (e) {
    return null;
  }
}
