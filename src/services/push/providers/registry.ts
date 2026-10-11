import { PushProvider, PushPlatform } from "./types.ts";

export class ProviderRegistry {
  private providers = new Map<PushPlatform, PushProvider>();

  constructor(initialProviders: PushProvider[] = []) {
    for (const provider of initialProviders) {
      this.providers.set(provider.name, provider);
    }
  }

  get(platform: PushPlatform): PushProvider | null {
    return this.providers.get(platform) || null;
  }
}

export function createProviderRegistry(initialProviders: PushProvider[] = []): ProviderRegistry {
  return new ProviderRegistry(initialProviders);
}
