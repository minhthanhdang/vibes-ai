import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  Connector,
  type AuthClient,
  type GoogleAuth as ConnectorGoogleAuth,
} from "@google-cloud/cloud-sql-connector";
import { Storage } from "@google-cloud/storage";
import { PrismaPg } from "@prisma/adapter-pg";
import { GoogleAuth } from "google-auth-library";

import { PrismaClient } from "../src/generated/prisma/client";
import { closeCloudSql, cloudSqlOptions } from "../src/server/google/cloud-sql";

const DEPLOY = fileURLToPath(new URL("./deploy.sh", import.meta.url));

const SCOPE = "https://www.googleapis.com/auth/cloud-platform";

const POOL_MAX = 3;

export type ServiceAccountKey = {
  client_email: string;
  private_key: string;
  project_id: string;
};

export type ProdConfig = {
  instance: string;
  user: string;
  password: string;
  database: string;
  project: string;
  bucket: string;
  credentials: ServiceAccountKey;
};

function pairsOf(printed: string): Record<string, string> {
  return Object.fromEntries(
    printed
      .split("\n")
      .filter((line) => line.includes("="))
      .map((line) => {
        const at = line.indexOf("=");
        return [line.slice(0, at), line.slice(at + 1)];
      }),
  );
}

function required(pairs: Record<string, string>, key: string): string {
  const value = pairs[key];
  if (!value) throw new Error(`${key} is not in what deploy.sh printed`);
  return value;
}

export function readProdConfig(): ProdConfig {
  const printed = execFileSync(DEPLOY, ["prod-env", "--secrets"], { encoding: "utf8" });
  const pairs = pairsOf(printed);

  return {
    instance: required(pairs, "CLOUD_SQL_INSTANCE"),
    user: required(pairs, "CLOUD_SQL_USER"),
    password: required(pairs, "CLOUD_SQL_PASSWORD"),
    database: required(pairs, "CLOUD_SQL_DATABASE"),
    project: required(pairs, "GOOGLE_CLOUD_PROJECT"),
    bucket: required(pairs, "GCS_BUCKET"),
    credentials: JSON.parse(required(pairs, "GOOGLE_SERVICE_ACCOUNT_JSON")) as ServiceAccountKey,
  };
}

export type ProdSource = {
  db: PrismaClient;
  bucket: string;
  read(objectPath: string): Promise<Buffer>;
  exists(objectPath: string): Promise<boolean>;
  close(): Promise<void>;
};

export async function prodSource(config: ProdConfig): Promise<ProdSource> {
  const auth = new GoogleAuth({
    credentials: config.credentials,
    projectId: config.project,
    scopes: [SCOPE],
  });
  const connector = new Connector({
    auth: auth as unknown as ConnectorGoogleAuth<AuthClient>,
  });

  const options = await cloudSqlOptions(config.instance, () => connector);
  const db = new PrismaClient({
    adapter: new PrismaPg({
      ...options,
      user: config.user,
      password: config.password,
      database: config.database,
      max: POOL_MAX,
    }),
  });

  const storage = new Storage({ projectId: config.project, credentials: config.credentials });
  const files = storage.bucket(config.bucket);

  return {
    db,
    bucket: config.bucket,
    read: async (objectPath) => (await files.file(objectPath).download())[0],
    exists: async (objectPath) => (await files.file(objectPath).exists())[0],
    close: async () => {
      await db.$disconnect();
      closeCloudSql();
    },
  };
}
