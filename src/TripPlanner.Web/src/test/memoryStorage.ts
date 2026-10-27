// Enumerable stored keys match browser Storage (including Object.keys behavior).
export function memoryStorage(): Storage {
  const storage = Object.create(null) as Storage;
  Object.defineProperties(storage, {
    getItem: { value: (key: string) => storage[key] ?? null },
    setItem: {
      value: (key: string, value: string) => {
        storage[key] = String(value);
      },
    },
    removeItem: {
      value: (key: string) => {
        delete storage[key];
      },
    },
    clear: {
      value: () => {
        for (const key of Object.keys(storage)) delete storage[key];
      },
    },
    key: { value: (index: number) => Object.keys(storage)[index] ?? null },
    length: { get: () => Object.keys(storage).length },
  });
  return storage;
}
