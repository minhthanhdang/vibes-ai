/// Builds a value at most once and hands every later caller that same value —
/// but only once the build has *succeeded*.
///
/// `cached ??= build()` gets the first half and loses the second: a rejected
/// promise is not nullish, so it stays in the slot and is re-thrown at every
/// call for the rest of the process's life. One lost packet during the first
/// build is then indistinguishable from a permanent misconfiguration. The
/// build this exists for dials the Cloud SQL Admin API to mint a cert, and a
/// warm Vercel instance that can never serve another query is a much worse
/// answer than one slow query.
///
/// Callers arriving while a build is in flight share it, rejection included:
/// twenty queries behind one cold start are one Admin API call rather than
/// twenty. The retry belongs to whoever asks *after* the failure is known.
export function buildOnce<T>(build: () => Promise<T>): () => Promise<T> {
  let built: Promise<T> | undefined;

  return function value() {
    if (built) return built;

    /// `Promise.resolve().then` so a `build` that throws synchronously fails
    /// the same way as one that rejects — otherwise the throw escapes past the
    /// catch below and the slot is left holding nothing anyone can retry.
    return (built = Promise.resolve()
      .then(build)
      .catch((reason: unknown) => {
        built = undefined;
        throw reason;
      }));
  };
}
