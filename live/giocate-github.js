// Client GitHub Contents API. Il token arriva solo come argomento, mai dal file salvato.

import { isPristine, mergeStates, meaningfulFingerprint, toRemote, validateTarget } from './giocate-model.js';

export class GithubError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'GithubError';
    this.status = status;
  }
}

export function encodeContent(obj) {
  const json = JSON.stringify(obj, null, 1);
  const bytes = new TextEncoder().encode(json);
  let bin = '';
  const size = 0x8000;
  for (let i = 0; i < bytes.length; i += size) {
    bin += String.fromCharCode(...bytes.subarray(i, i + size));
  }
  return btoa(bin);
}

export function decodeContent(b64) {
  const bin = atob(String(b64 || '').replace(/\s/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return JSON.parse(new TextDecoder().decode(bytes));
}

export function contentsUrl(target, { ref = false } = {}) {
  const path = String(target.path || '').replace(/^\/+/, '');
  const url = new URL(`https://api.github.com/repos/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.repo)}/contents/${path.split('/').map(encodeURIComponent).join('/')}`);
  if (ref && target.branch) url.searchParams.set('ref', target.branch);
  return url.toString();
}

function headers(token) {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

function italianMessage(status, message) {
  if (status === 401) return 'Token non valido o scaduto. Creane uno nuovo e incollalo nelle impostazioni.';
  if (status === 403) return `Accesso negato. Il token deve avere Contents: Read and write solo su questo repository. ${message || ''}`.trim();
  if (status === 404) return 'Repository, branch o percorso non trovato. Controlla owner, nome, branch e percorso.';
  if (status === 409 || status === 422) return 'Il file è stato aggiornato da un altro salvataggio. Riprovo unendo le giocate.';
  return `GitHub: ${message || 'errore ' + status}`;
}

async function asError(res) {
  let message = '';
  try {
    const data = await res.json();
    if (data && data.message) message = String(data.message);
  } catch { /* corpo vuoto */ }
  return new GithubError(res.status, italianMessage(res.status, message));
}

export async function readRemote(fetchImpl, target, token) {
  const err = validateTarget(target);
  if (err) throw new GithubError(0, err);
  const res = await fetchImpl(contentsUrl(target, { ref: true }), { headers: headers(token) });
  if (res.status === 404) return { exists: false, sha: null, state: null };
  if (!res.ok) throw await asError(res);
  const data = await res.json();
  if (Array.isArray(data)) throw new GithubError(0, 'Il percorso punta a una cartella, non a un file.');
  if (!data.content) throw new GithubError(0, 'File delle giocate senza contenuto leggibile.');
  return { exists: true, sha: data.sha, state: decodeContent(data.content) };
}

export async function writeRemote(fetchImpl, target, token, { sha, state, message }) {
  const err = validateTarget(target);
  if (err) throw new GithubError(0, err);
  const payload = toRemote(state);
  const body = {
    message: message || 'giocate: aggiorna',
    content: encodeContent(payload),
    branch: target.branch || 'main',
  };
  if (sha) body.sha = sha;
  const res = await fetchImpl(contentsUrl(target), {
    method: 'PUT',
    headers: { ...headers(token), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await asError(res);
  const data = await res.json();
  return { sha: data.content && data.content.sha, commit: data.commit && data.commit.sha, payload };
}

/**
 * Legge, unisce (nessuna giocata sparisce da sola) e riscrive.
 * Su 409/422 rilegge e ritenta una volta.
 */
export async function syncRemote(fetchImpl, target, token, localState) {
  if (!token) throw new GithubError(0, 'Manca il token GitHub. Le giocate restano in questo browser.');
  let remote = await readRemote(fetchImpl, target, token);
  if (!remote.exists && isPristine(localState)) {
    return { state: mergeStates(localState, {}), sha: null, wrote: false };
  }
  let merged = remote.exists ? mergeStates(localState, remote.state) : mergeStates(localState, {});
  const remoteFp = remote.exists ? meaningfulFingerprint(remote.state) : null;
  if (remote.exists && meaningfulFingerprint(merged) === remoteFp) {
    return { state: merged, sha: remote.sha, wrote: false };
  }
  try {
    const written = await writeRemote(fetchImpl, target, token, { sha: remote.sha, state: merged });
    return { state: merged, sha: written.sha, wrote: true };
  } catch (e) {
    if (!(e instanceof GithubError) || (e.status !== 409 && e.status !== 422)) throw e;
    remote = await readRemote(fetchImpl, target, token);
    merged = mergeStates(merged, remote.state || {});
    const written = await writeRemote(fetchImpl, target, token, { sha: remote.sha, state: merged });
    return { state: merged, sha: written.sha, wrote: true };
  }
}
