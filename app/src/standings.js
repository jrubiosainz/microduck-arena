// Where a trial run WOULD stand.
//
// A trial is evaluated but never recorded, so it has no row on the server's
// board. To show it in place, the client INSERTS it into the server's already
// sorted rows — and never re-sorts them. That is deliberate: re-implementing
// the ranking rule here would give the page a second opinion about who is
// winning, and the two could drift. Insertion cannot drift, because the
// published order is whatever the server said it was.

export function insertProvisional(rows, trial) {
  if (!trial) return rows.map((row) => ({ ...row, provisional: false }));

  const entry = {
    rank: 0,
    user: trial.user ?? "you",
    policy_name: trial.policy_name,
    score: trial.score,
    command_vx: trial.command_vx,
    seeds_finished: trial.seeds_finished,
    seeds_total: trial.seeds_total,
    run_id: null,
    provisional: true,
  };

  const published = rows.map((row) => ({ ...row, provisional: false }));
  // A trial that finished nothing sits at the bottom; otherwise it goes before
  // the first published row it beats. Equal scores keep the published row
  // ahead — it is on the board and the trial is not.
  const beats = (row) =>
    trial.seeds_finished > 0 && row.seeds_finished === 0
      ? true
      : trial.seeds_finished === 0
        ? false
        : trial.score < row.score;

  const at = published.findIndex(beats);
  const merged = at === -1 ? [...published, entry] : [
    ...published.slice(0, at),
    entry,
    ...published.slice(at),
  ];

  return merged.map((row, i) => ({ ...row, rank: i + 1 }));
}
