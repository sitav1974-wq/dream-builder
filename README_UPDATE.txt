DREAM BUILDER V3.1 — CACHE FIX

Your V3 index.html and manifest are already correct.

Important fix:
- Replace sw.js with this V3.1 sw.js.
- The cache name is now dream-builder-v3-20260921 so the installed app can discard the old V2 cache.

For your current GitHub repo, you only need to upload/replace:
- sw.js

Then commit directly to main.
Wait for GitHub Pages to redeploy, open:
https://sitav1974-wq.github.io/dream-builder/?v=31
Refresh once, close the installed app from Recent Apps, then reopen it.
