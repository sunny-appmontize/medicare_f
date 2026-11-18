// Local browser tests: external requests are intercepted.
// PLAYWRIGHT_MODULE=/path/to/playwright CHROMIUM_PATH=/path/to/chrome node tests/flow.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..');
const base0 = 'https://appmontize.gotrackier.com/click?campaign_id=225&pub_id=2';
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

    // CTA link: params passed through in order; default when none present.
    await page.goto(base + '/?p1=abc&p2=AFB9&source=fb&p4=x y&other=1');
    assert.equal(await page.locator('.logos').getAttribute('href'), base0 + '&p1=abc&p2=AFB9&source=fb&p4=x%20y');
    await page.goto(base + '/');
    const defaultUrl = base0 + '&p1={your-transaction-id}&p2=AFB2';
    assert.equal(await page.locator('.logos').getAttribute('href'), defaultUrl);
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
    await page.goto(base + '/');
    await page.getByRole('button',{name:'Yes',exact:true}).click({timeout:15000});
    await page.getByRole('button',{name:'76 and Older'}).click({timeout:15000});
    await page.getByRole('button',{name:'No',exact:true}).click({timeout:15000});
    await page.locator('.closed').waitFor({timeout:15000});
    assert.match(await page.locator('#log').innerText(), /don't qualify/);
    assert.equal(await page.locator('#PrimaryNumber').count(), 0);

    // No Meta/Facebook tracking on any page.
    for (const f of ['/', '/privacy.html', '/terms.html']) { await page.goto(base + f); }
    assert.equal(external.filter(u=>/facebook|fbevents/.test(u)).length, 0, 'no Meta requests');

    // Layout: no horizontal scroll.
    for (const width of [360, 390, 768, 1440]) {
      await page.setViewportSize({width, height: 900});
      for (const f of ['/', '/privacy.html', '/terms.html']) {
        await page.goto(base + f);
        assert(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth), `no overflow ${f} @${width}`);
      }
    }

    // Policy back links return to the lander with its params.
    const lander = base + '/?p1=abc&source=fb';
    for (const name of ['Privacy Policy', 'Terms & Conditions']) {
      await page.goto(lander);
      await page.locator('footer').getByRole('link',{name}).click(); await page.waitForLoadState();
      assert.equal(await page.locator('[data-return-link]').first().getAttribute('href'), lander);
      await page.locator('[data-return-link]').first().click(); await page.waitForURL(lander);
    }
    await ctx.close();
    const fresh = await browser.newContext(); const fp = await fresh.newPage();
    await fp.route(/^https?:\/\/(?!127\.0\.0\.1)/, r=>r.abort());
    await fp.goto(base + '/terms.html');
    assert.equal(await fp.locator('[data-return-link]').first().getAttribute('href'), 'index.html');
    await fresh.close();

    console.log('PASS: no server-side scripts, CTA param pass-through/default, qualified and disqualified chat paths, no Meta requests, responsive layout, policy back links.');
  } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>server.close());
