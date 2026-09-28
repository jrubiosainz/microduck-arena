// What the workshop sends a novice back with: the Hub repo it just published,
// the revision to pin and the code's address, as ?repo=&revision=&env= ahead of
// the hash. Taken once, for the challenge in the hash, and kept in
// sessionStorage for it: signing in leaves the page for huggingface.co and comes
// back to "/#<route>" with no query at all. Left in the address, the query would
// follow the visitor to every other challenge's page.

const KEY = "arena.entry";
const EMPTY = { repo: "", revision: "", env: "" };

function session() {
  try {
    return window.sessionStorage;
  } catch {
    return null; // storage disabled: the query still works, the round trip does not
  }
}

export function entryFromLocation(eventId, search = location.search, storage = session()) {
  const params = new URLSearchParams(search);
  const sent = { repo: params.get("repo") ?? "", revision: params.get("revision") ?? "", env: params.get("env") ?? "" };
  if (sent.repo) {
    try {
      storage?.setItem(KEY, JSON.stringify({ ...sent, eventId }));
    } catch {
      // A private window may refuse; the query in hand is still the answer.
    }
    history.replaceState(null, "", location.pathname + location.hash);
    return sent;
  }
  try {
    const kept = JSON.parse(storage?.getItem(KEY) ?? "null");
    if (kept?.eventId === eventId && kept.repo) {
      return { repo: kept.repo, revision: kept.revision ?? "", env: kept.env ?? "" };
    }
  } catch {
    // Nothing kept, or not ours to read.
  }
  return { ...EMPTY };
}

export function forgetEntry(storage = session()) {
  try {
    storage?.removeItem(KEY);
  } catch {
    // Nothing to forget.
  }
}
