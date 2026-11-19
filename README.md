# Health Allowance chat lander (medicare_f)

Static, single-page chat-style lander. It's a UI/UX refresh of `senior-coverage-solutions-health-allowance` with the same copy and flow.

**URLs:** the lander is at `/getoffer/` (`getoffer/index.html`). The home page `/` only shows "Happy World".

- **Flow:** intro → "Yes" → age range (54 - 75 / 76 and Older) → Medicare Part A or B (Yes / No). "Yes" shows the **Click to Call now** button. "No" shows the "don't qualify" message and closes the chat.
- **Voice:** voice messages (`assets/audio/*.mp3`) play after the visitor's first tap, at 1.2× speed, and can be muted from the chat header.
- **CTA:** the call button and partner logos link to `https://trk.viewapproval.com/cf/click/1` (`ctaUrl` in `PAGE_CONFIG`, top of the scripts in `getoffer/index.html`). The ClickFlare tag at the end of the page reads `cftmid` and `cpid` from the campaign URL and handles the click. The call button appears after the tag has run, so its click is handed to ClickFlare directly. If the tag fails to load, both links open the plain click URL.
- **Tracking:** Meta Pixel `1711662127291981` on `/getoffer/` sends PageView only (no Lead or other events). The home page and policy pages have no Pixel.
- **Policy pages:** the back links on `privacy.html` and `terms.html` return visitors to the lander they came from, with its URL params.
- **No dependencies:** no Tailwind, jQuery or Font Awesome on the lander. The policy pages still use the Tailwind CDN.

Serve locally with `python3 -m http.server 8080` and open `http://localhost:8080/getoffer/`.

## Tests

```sh
PLAYWRIGHT_MODULE=/path/to/playwright CHROMIUM_PATH=/path/to/chrome node tests/flow.cjs
```

## Security note

The source folder this was based on contained PHP web shells (`audio/lndex.php`, `audio/template-singl-portfolio.php`). None were copied here. `.gitignore` blocks `*.php`, and the tests fail if any server-side script appears in this folder.
