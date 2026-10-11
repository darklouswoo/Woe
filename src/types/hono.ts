



import { Env } from "./index.ts";


export type HonoEnv = {
  Bindings: Env;
};


export interface TokenInfo {
  userId: number;
  isAdmin: boolean;
  tokenType: "app" | "client";
  resourceId?: number;

  clientId?: number;

  elevatedUntil?: string | null;







  clientTokenLookup?: string;
}


export interface UserInfo {
  id: number;
  name: string;
  pass: string;
  admin: boolean;
}
