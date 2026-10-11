
export type PushPlatform = string;






export interface ProviderSendInput {
  userId: number;
  platform: PushPlatform;
  deviceToken: string;
  messageId: number;
  appid: number;
  date: string;
  title?: string;
  message: string;
  priority?: number;
  extras?: Record<string, unknown>;
}







export interface ProviderSendResult {
  ok: boolean;
  retriable: boolean;
  errorCode?: string;
  errorMessage?: string;
  raw?: unknown;
  invalidateToken?: boolean;
  suspend?: boolean;
}


export interface PushProvider {
  name: PushPlatform;
  send(input: ProviderSendInput): Promise<ProviderSendResult>;
}



export const SUSPEND_RETRY_AT_DELAY_MS = 60_000;
