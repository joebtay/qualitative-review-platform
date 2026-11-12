# The Cloudflare site and its sign-in service


## What it is

- **The address:** https://reviews.example.org (PI, 3 November 2026). `your-site.pages.dev` still works. Each address keeps its own sign-ins, so everyone uses the new one.
- **A welcome page at `/`, closed for now** (PI, 3 November 2026). With `site.welcome_public: false` in `projects.json`, the address opens on `/signin/` and `/api/welcome` answers 404. The PI still edits the text on `/admin/`. Remove the setting and it is public again: each review's status, a short description, links and team.
- **One site, a section per project.** `/cogimp/` and `/greylit/` now. More are added in `projects.json`.
- **Coders sign in at `/signin/` with a name and a password.** No GitHub token. After sign-in a coder lands in their own review. Nobody types a repo name. They stay signed in on that device for 30 days, or until they sign out.
- **The PI's page at `/admin/`** (PI, 24 October 2026). The PI signs in with their own password and, with no dashboard, script or Claude:
  - adds a coder and gets their password to send on (shown once);
  - makes a new password, which ends the old one and its sessions at once;
  - unlocks a locked name, sets a coder's email, removes a coder the page added;
  - sees progress: for each review and coder, items done of assigned, records decided of assigned, last activity, and a flag after a week with nothing done. Counts and dates only, read from team repos, never a master;
  - edits the welcome page, and changes their own password.
- **"Forgot your password?"** on the sign-in page (PI, 25 October 2026). The coder gives their name; a one-hour, one-use link comes by email from `noreply@example.org`, and they choose their own password (at least 12 characters). Free: it goes only to an email the coder has confirmed once. When the PI adds a coder's email, Cloudflare sends them a "verify this address" message; the PI's page shows who has confirmed. The reply never says whether a name or email exists, and at most 3 links an hour go to a name.
- **Data stays in GitHub.** Each project keeps its master and its team repos. Cloudflare holds the app, the sign-in service, the App key, the coders the page added and the scrambled passwords.
- **The sign-in service** is a Cloudflare Worker. It runs as the site's Functions, so it deploys with the site.
  - It passes on only the GitHub calls the app makes: who am I, the repo's default branch, list files, read a file, save a file.
  - It saves only into `work/<handle>/`, in the one repo given to that coder in that project, on the default branch.
  - It never reads or saves a master, even if the App were installed on one. The page refuses to give a coder a master, or another coder's repo.
  - 5 wrong passwords in 15 minutes lock that name for 15 minutes. The PI's password locks the same way.
  - Each save names the coder as commit author. GitHub records the App as committer.
- **A GitHub App owned by joebtay** does the saving. It has Contents read and write and is installed on team repos only. The PI keeps signing in to masters with a token.
- **The site is built from `projects-stable`**, the branch review-coder-app is built from, so coders see the screens they have now. Without `js/section.js` from the build, the app signs in with a token exactly as before.

## Files

| Path | What |
| --- | --- |
| `projects.json` | The project list: each section's title, whether it is on, its masters, the coders added by PR, and the welcome page's starting text. No passwords. |
| `service.js`, `ghapp.js` | The sign-in service and the App's sign-in to GitHub. |
| `mail.js` | Email through Cloudflare's Email Service: confirm an address, check who has confirmed, send. |
| `admin.js`, `welcome.js`, `progress.js`, `count.js` | The PI's page, the welcome text, and progress (`count.js` is `progress/js/count.js` from `main`, unchanged). |
| `site/` | The welcome page (`index.html`, `welcome.js`, `site.css`) and the PI's page (`admin/`). |
| `../functions/api/[[path]].js` | Sends every `/api/` request to the service, with the project list built in. |
| `build.mjs` | Builds the site into `dist/` (the Cloudflare build command). Stops if a coder name, handle or repo from `projects.json` would be published. |
| `hash-password.mjs` | Makes the scrambled form of a password. `--new` makes a password too. `--secret` makes a SESSION_SECRET. |
| `one-line-key.mjs` | Turns the App's `.pem` key into one line, if a settings box will not take several lines. |
| `../app/js/section.js`, `../app/js/signin.js` | The app's side: which section it is, and the name-and-password sign-in. |

## Where things are kept (Cloudflare, never in a repo)

| Name | Where | What |
| --- | --- | --- |
| `GITHUB_APP_ID` | Setting, Text | The App ID (5456989). |
| `GITHUB_APP_PRIVATE_KEY` | Setting, Secret | The App's private key. |
| `SESSION_SECRET` | Setting, Secret | At least 32 random characters. Changing it signs everyone out. |
| `ADMIN_PASSWORD` | Setting, Secret | The PI's first password, scrambled. Once the PI changes it on the page, the page's one is used. |
| `PASSWORD_<NAME>` | Setting, Secret (optional) | A coder's scrambled password set by hand. A password made on the page takes its place. |
| `EMAIL_API_TOKEN` | Setting, Secret | A Cloudflare key with Email Routing Addresses Edit and Email Sending Edit, for "Forgot password" emails. Without it the page says email is off and Forgot password points to the PI. |
| `LOCKS` | KV binding (`review-coder-locks`) | The lock, coders added on the page (`coder:<name>`), their scrambled passwords (`pw:<name>`), the PI's (`admin:pw`) the welcome text (`site:welcome`), and one-hour reset links (`reset:<fingerprint>`, never the link itself). |

Without `SESSION_SECRET` and `LOCKS` the service lets no one in. Without the App settings, coders cannot open their reviews. Settings take effect on the next deployment; what the page saves takes effect within a minute.

## Adding a coder or a project

**A coder, on an existing project:** ask Claude to build their team repo if it does not exist, install the App on it (App page, Install App, the gear next to joebtay, add the repo), then on `/admin/` fill in **Add a coder**. The page shows the password once, with a message to send. A GitHub username is optional: give it to keep a coder's existing work folder (for example, moving a greylit coder over) and to link their saves to their GitHub profile.

**A project:** create its master and team repos, install the App on the team repos only, and add an entry to `projects.json` (title, `"enabled": true`, `masters`, and an `about` for the welcome page). Merge the PR; the site rebuilds itself. Then add its coders on the page.

Switching greylit on later: `"enabled": true` for greylit, the App on the greylit-team repos, then each coder on the page with their GitHub username, so their work carries on in the same folder.

## The PI's steps (done 24 October 2026)

Kept for the record. About 30 minutes. Do them in this order. Use a desktop browser.

### 0. Two-step sign-in on Cloudflare

1. Go to https://dash.cloudflare.com and sign in.
2. Click the person icon (top right), then **My Profile**.
3. Click **Authentication**. Under **Two-Factor Authentication**, check it is on. If not, click **Set up** and follow the steps.

### 1. Link the repo to Cloudflare

1. In the Cloudflare dashboard, left menu: **Workers & Pages**.
2. Click **Create application** (or **Create**). Choose the **Pages** tab, then **Connect to Git** (it may say **Import an existing Git repository**).
3. Click **Connect GitHub**. GitHub asks to install **Cloudflare Workers and Pages**.
   - Choose **Only select repositories**, pick **review-coder**, click **Install & Authorize**.
   - Do not give it any data repo.
4. Back in Cloudflare, pick **review-coder** and click **Begin setup**.
5. Fill in:
   - **Project name:** `review-coder`. The address will be `https://your-site.pages.dev`. If Cloudflare adds letters to the name, note the address it shows.
   - **Production branch:** `projects-stable`.
   - **Framework preset:** None.
   - **Build command:** `node cloudflare/build.mjs`
   - **Build output directory:** `dist`
   - Leave **Root directory** empty. Add no variables here.
6. Click **Save and Deploy**. **This first build fails. That is expected.** `projects-stable` does not have the site until you merge the PR. Click **Continue to project**.

### 2. Make the store for the lock

1. Left menu: **Storage & Databases**, then **KV** (older menus: **Workers & Pages**, then **KV**).
2. Click **Create** (or **Create a namespace**). Name: `review-coder-locks`. Click **Add** or **Create**.
3. Left menu: **Workers & Pages**, then **review-coder**, then **Settings**, then **Bindings**.
4. Click **Add**, choose **KV namespace**.
   - **Variable name:** `LOCKS`
   - **KV namespace:** `review-coder-locks`
5. Click **Save**.
6. If the Settings page lets you choose **Production** or **Preview** at the top, do steps 4 and 5 for both.

### 3. Create the GitHub App and install it on cogimp-team

1. Go to https://github.com/settings/apps (your photo, **Settings**, **Developer settings** at the bottom of the left menu, **GitHub Apps**).
2. Click **New GitHub App**.
3. Fill in:
   - **GitHub App name:** `Review Coder saver joebtay`. It must be unique on GitHub; add a word if it is taken.
   - **Homepage URL:** `https://your-site.pages.dev` (or the address from step 1.5).
   - Leave **Callback URL** empty. Leave **Request user authorization (OAuth) during installation** unticked.
   - **Webhook:** untick **Active**.
4. **Permissions**, **Repository permissions**: set **Contents** to **Read and write**. **Metadata** turns to **Read-only** by itself. Leave everything else at **No access**. Give no **Account permissions**.
5. **Where can this GitHub App be installed?** Choose **Only on this account**.
6. Click **Create GitHub App**.
7. On the App's page, note the **App ID** (a number near the top).
8. Scroll to **Private keys**. Click **Generate a private key**. A `.pem` file downloads.
9. Left menu: **Install App**. Click **Install** next to joebtay.
   - Choose **Only select repositories**.
   - Pick **cogimp-team** only.
   - Never pick cogimp-review-data, greylit-review-data, any greylit-team repo or any other master.
   - Click **Install**.

### 4. Add the key and the passwords to Cloudflare

1. **Workers & Pages**, **review-coder**, **Settings**, **Variables and Secrets**. Click **Add**.
2. Add these four. For each, type the name, choose the type, paste the value.

| Variable name | Type | Value |
| --- | --- | --- |
| `GITHUB_APP_ID` | Text | The App ID from step 3.7. |
| `GITHUB_APP_PRIVATE_KEY` | Secret | Open the `.pem` from step 3.8 in TextEdit or Notepad. Copy all of it, including the BEGIN and END lines. Paste. |
| `SESSION_SECRET` | Secret | The value Claude gave you, or 40 random characters from your password manager. |
| `PASSWORD_CODERB` | Secret | Coder B's scrambled password, kept in your own notes. It starts `pbkdf2-sha256$`. |

3. Click **Save**.
4. If the page lets you choose **Production** or **Preview**, add the same four to both.
5. Delete the `.pem` file from Downloads, and empty the bin. If it is ever needed again, generate a new key on the App's page.

### 5. Build the preview

The preview builds when the PR's branch gets a new commit. Do one of these:

- Tell Claude "linked". Claude pushes the next commit.
- Or do it yourself: on GitHub, open the PR, **Files changed**, find `cloudflare/README.md`, click **...** then **Edit file**. At the very bottom, change "Linked to Cloudflare: not yet." to today's date. Click **Commit changes**, keep **Commit directly to the claude/cloudflare-signin branch**, and confirm.

A few minutes later Cloudflare posts a comment on the PR with the preview address. It is also under **Workers & Pages**, **review-coder**, **Deployments**. It looks like `https://preview.your-site.pages.dev`.

### 6. Test on the preview address

The preview reads the real cogimp-team. **Look, but save nothing**: no screening decision, no note. A save would be a real record in a shared repo.

1. Open the preview address in a private window.
2. Type a name and a wrong password. It says "Name or password not recognised." Do not try 5 times: that locks the name for 15 minutes.
3. Sign in with **coderb** and Coder B's password. You land in the cognitive impairment review, with only **Project** and **Screen**, signed in as xcoder.
4. Open **Screen**. The records list. Click one record and look, then leave it. Do not click Met, Not met, Unclear, Include, Exclude or Discuss, and do not press M, N or U: each of those saves.
5. Click **Sign out**. The sign-in form comes back.
6. Open `<preview address>/greylit/`. It says the review is not open on this site yet.
7. Your own sign-in to masters: open `<preview address>/cogimp/?token`. The usual token form appears. You can keep using `joebtay.github.io/review-coder-app` too.

If step 3 says the App is not installed, check step 3.9. If it says "not set up yet", check steps 2 and 4, then redeploy (step 7).

### 7. Redeploy after a change of settings

**Workers & Pages**, **review-coder**, **Deployments**. On the latest deployment, click **...**, then **Retry deployment**.

### 8. Go live

1. Merge the PR into `projects-stable`. Cloudflare builds `https://your-site.pages.dev` by itself.
2. Repeat step 6 there, steps 1 to 6.
3. Send Coder B the sign-in note. Send the link and the password by different routes.

joebtay.github.io/review-coder-app stays up until you say otherwise.

## Day to day

All on `/admin/`:
- **A coder forgot their password:** they click **Forgot your password?** if their email is confirmed. Otherwise **New password** on your page, then send it. Either way their old password and sessions end at once.
- **Checking email works:** the **Email** box on your page shows the last email the site tried to send, and Cloudflare's reason if it refused. **Send a test email** sends one to any address confirmed in Cloudflare.
- **A coder is locked out:** **Unlock**. Or wait 15 minutes.
- **Progress:** the **Progress** tab, counted when you open it; **Refresh** counts again.
- **The welcome page:** the **Welcome page** tab. Everyone can see it, so publish only what you are happy to make public.
- **Sign everyone out:** change `SESSION_SECRET` in the Cloudflare settings, then redeploy.
- **Changes wait safely.** If the service is down or a session ends, the coder's work stays in their browser and saves when they sign in again.

## Limits

- Passwords are scrambled with PBKDF2-SHA256, 10,000 rounds, so a sign-in fits Cloudflare's free CPU limit. Use the long passwords `--new` makes.
- The lock counts on Cloudflare KV. The free plan allows 1,000 writes a day, which is far above this use.
- A coder's session lasts 30 days, the PI's 12 hours. A sign-out on one device does not end a session copied elsewhere; a new password or a new SESSION_SECRET does.
- The preview copy has no App key: the dashboard sets the live copy's settings only, and Cloudflare never shows a secret back. Test the App on the live address, saving nothing, before telling coders.

## Tests

- `npm test` includes `tests/service.test.mjs`: the service against a fake GitHub and KV.

Linked to Cloudflare: 24 October 2026 (Pages project review-coder, production branch projects-stable).
