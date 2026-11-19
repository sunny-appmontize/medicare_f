// Local browser tests: external requests are intercepted.
// PLAYWRIGHT_MODULE=/path/to/playwright CHROMIUM_PATH=/path/to/chrome node tests/flow.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..');
const cta = 'https://trk.viewapproval.com/cf/click/1';
const types = {'.html':'text/html','.css':'text/css','.js':'application/javascript','.png':'image/png','.webp':'image/webp','.jpg':'image/jpeg','.mp3':'audio/mpeg'};
const server = http.createServer((req,res)=>{
  let file = path.join(root, decodeURIComponent(new URL(req.url,'http://x').pathname));
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file,'index.html');
  if (!file.startsWith(root) || !fs.existsSync(file)) { res.writeHead(404).end(); return; }
  res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
  res.end(fs.readFileSync(file));
});
(async()=>{
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
  try {
    // No server-side scripts may ship with this static page.
    const walk = d => fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>e.name==='.git'?[]:e.isDirectory()?walk(path.join(d,e.name)):[path.join(d,e.name)]);
    assert.deepEqual(walk(root).filter(f=>/\.(php\d?|phtml|cgi|pl|asp|aspx|jsp)$/i.test(f)),[],'no server-side scripts');

    const ctx = await browser.newContext();
    let external = [];
    await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, r => { external.push(r.request().url()); return r.abort(); });
    await ctx.route(/\.mp3$/, r => r.abort()); // keep tests fast; audio failures must not block the flow
    const page = await ctx.newPage();

    // ClickFlare tag blocked here (all external requests aborted): links fall back to the plain CTA.
    await page.goto(base + '/getoffer/');
    await page.waitForFunction(u=>document.querySelector('.logos').getAttribute('href')===u, cta);
    const defaultUrl = cta;
    assert.match(await page.locator('#currentDate').innerText(), /^[A-Z][a-z]+ \d{1,2}, \d{4}$/);

    // Qualified path -> click-to-call button.
    await page.getByRole('button',{name:'Yes',exact:true}).click({timeout:15000});
    await page.getByRole('button',{name:'54 - 75'}).click({timeout:15000});
    await page.getByRole('button',{name:'Yes',exact:true}).click({timeout:15000});
    const call = page.locator('#PrimaryNumber');
    await call.waitFor({timeout:15000});
    assert.equal(await call.getAttribute('href'), defaultUrl);
    assert.match(await call.innerText(), /Click to Call now/);
    assert.equal(await page.locator('.row.user').count(), 3);
    assert.equal(await page.locator('.choice').count(), 0, 'answered questions are removed');

    // Disqualified path -> sorry + chat closed, no call button.
    await page.goto(base + '/getoffer/');
    await page.getByRole('button',{name:'Yes',exact:true}).click({timeout:15000});
    await page.getByRole('button',{name:'76 and Older'}).click({timeout:15000});
    await page.getByRole('button',{name:'No',exact:true}).click({timeout:15000});
    await page.locator('.closed').waitFor({timeout:15000});
    assert.match(await page.locator('#log').innerText(), /don't qualify/);
    assert.equal(await page.locator('#PrimaryNumber').count(), 0);

    // Meta Pixel 1711662127291981 (PageView only) on /getoffer/; no Meta on other pages.
    external = [];
    for (const f of ['/', '/privacy.html', '/terms.html']) { await page.goto(base + f); }
    assert.equal(external.filter(u=>/facebook|fbevents/.test(u)).length, 0, 'no Meta requests off /getoffer/');
    await page.goto(base + '/getoffer/');
    assert(external.some(u=>u==='https://connect.facebook.net/en_US/fbevents.js'), 'Pixel script requested on /getoffer/');
    const fbEvents = await page.evaluate(()=>fbq.queue.map(e=>Array.from(e).slice(0,2)));
    assert.deepEqual(fbEvents, [['init','1711662127291981'],['track','PageView']], 'PageView only');

    // Layout: no horizontal scroll.
    for (const width of [360, 390, 768, 1440]) {
      await page.setViewportSize({width, height: 900});
      for (const f of ['/', '/getoffer/', '/privacy.html', '/terms.html']) {
        await page.goto(base + f);
        assert(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth), `no overflow ${f} @${width}`);
      }
    }

    // Policy back links return to the lander with its params.
    const lander = base + '/getoffer/?p1=abc&source=fb';
    for (const name of ['Privacy Policy', 'Terms & Conditions']) {
      await page.goto(lander);
      await page.locator('footer').getByRole('link',{name}).click(); await page.waitForLoadState();
      assert.equal(await page.locator('[data-return-link]').first().getAttribute('href'), lander);
      await page.locator('[data-return-link]').first().click(); await page.waitForURL(lander);
    }
    await ctx.close();

    // ClickFlare tag loads: static links are rewritten and the call button hands off to the tag.
    {
      const c2 = await browser.newContext();
      let tagUrl, directClicks = 0;
      await c2.route(/^https?:\/\/(?!127\.0\.0\.1)/, r => r.abort());
      await c2.route(/\.mp3$/, r => r.abort());
      await c2.route('https://trk.viewapproval.com/cf/tags/**', r => { tagUrl = new URL(r.request().url());
        return r.fulfill({contentType:'application/javascript', body:`Object.defineProperty(window.clickflare,'l',{configurable:true,set(u){window.testClickflareHandled=u;}});`}); });
      await c2.route('https://trk.viewapproval.com/cf/click/**', r => { directClicks++; return r.fulfill({contentType:'text/html', body:'offer'}); });
      const p2 = await c2.newPage();
      await p2.goto(base + '/getoffer/?cftmid=test-container&cpid=test-campaign');
      await p2.waitForFunction(()=>!!Object.getOwnPropertyDescriptor(window.clickflare,'l'));
      assert.equal(tagUrl.pathname, '/cf/tags/test-container');
      assert.equal(tagUrl.searchParams.get('cpid'), 'test-campaign');
      assert((await p2.locator('.logos').getAttribute('href')).startsWith('javascript:window.clickflare.l='), 'logos rewritten by tag');
      await p2.getByRole('button',{name:'Yes',exact:true}).click({timeout:15000});
      await p2.getByRole('button',{name:'54 - 75'}).click({timeout:15000});
      await p2.getByRole('button',{name:'Yes',exact:true}).click({timeout:15000});
      await p2.locator('#PrimaryNumber').click({timeout:15000});
      await p2.waitForFunction(u=>window.testClickflareHandled===u, cta);
      assert.equal(directClicks, 0, 'call button uses the ClickFlare handler');
      await c2.close();
    }
    const fresh = await browser.newContext(); const fp = await fresh.newPage();
    await fp.route(/^https?:\/\/(?!127\.0\.0\.1)/, r=>r.abort());
    await fp.goto(base + '/terms.html');
    assert.equal(await fp.locator('[data-return-link]').first().getAttribute('href'), 'getoffer/');
    await fp.goto(base + '/');
    assert.equal((await fp.locator('h1').innerText()).trim(), 'Happy World');
    await fresh.close();

    console.log('PASS: home shows Happy World, lander at /getoffer/, no server-side scripts, ClickFlare CTA (tag rewrite, call-button handoff, fallback), qualified and disqualified chat paths, Pixel PageView only on /getoffer/, responsive layout, policy back links.');
  } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>server.close());
