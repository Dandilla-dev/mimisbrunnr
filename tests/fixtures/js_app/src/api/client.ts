export class ApiClient {
  constructor(private base: string) {}

  get(path: string): Promise<unknown> {
    return fetch(this.base + path).then((r) => r.json());
  }
}

export function makeClient(): ApiClient {
  return new ApiClient('/api');
}
