/**
 * External trigger for the existing live scanner.
 *
 * Deploy as a Cloudflare Worker with a Cron Trigger every minute.
 * Required Worker secrets:
 *   GITHUB_TOKEN  - fine-grained PAT limited to edbass1/segnali, Actions: write
 *
 * It only dispatches .github/workflows/scan.yml; it never reads or changes
 * the public website. The existing GitHub workflow continues to run the
 * Python scanner and send Telegram alerts using its existing repository secrets.
 */
export default {
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(dispatchScan(env));
  },

  async fetch() {
    return new Response("Telegram scanner scheduler is running. Manual HTTP triggers are disabled.", {
      status: 200,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  },
};

async function dispatchScan(env) {
  if (!env.GITHUB_TOKEN) {
    console.error("Missing GITHUB_TOKEN Worker secret");
    return;
  }

  const url = "https://api.github.com/repos/edbass1/segnali/actions/workflows/scan.yml/dispatches";
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Accept": "application/vnd.github+json",
      "Authorization": `Bearer ${env.GITHUB_TOKEN}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "segnali-telegram-external-scheduler",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ref: "main" }),
  });

  if (response.status !== 204) {
    const body = (await response.text()).slice(0, 500);
    console.error(`GitHub workflow dispatch failed: HTTP ${response.status}: ${body}`);
    return;
  }

  console.log(`Scanner workflow dispatched successfully at ${new Date().toISOString()}`);
}
