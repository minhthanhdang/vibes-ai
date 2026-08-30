export function buildOnce<T>(build: () => Promise<T>): () => Promise<T> {
  let built: Promise<T> | undefined;

  return function value() {
    if (built) return built;

    return (built = Promise.resolve()
      .then(build)
      .catch((reason: unknown) => {
        built = undefined;
        throw reason;
      }));
  };
}
