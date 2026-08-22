import "server-only";
import {
  Connector,
  IpAddressTypes,
  type AuthClient,
  type DriverOptions,
  type GoogleAuth as ConnectorGoogleAuth,
} from "@google-cloud/cloud-sql-connector";
import { googleAuth } from "./auth";

/// One connector per process. It holds the instance's cert and refreshes it on
/// a timer, so a second one is a second refresh loop against the Admin API for
/// the same instance.
let connector: Connector | undefined;

/// The connector nests google-auth-library v10 beside this project's v11, and
/// the two `GoogleAuth` classes are not assignable to one another — they brand
/// with different private fields. Same shape of problem as the Gen AI SDK's
/// `GoogleAuthOptions` (see `auth.ts`), and the same answer: the object is the
/// one both libraries actually accept at runtime, proven against the live
/// instance in infra §XVI.
function connectorAuth() {
  return googleAuth() as unknown as ConnectorGoogleAuth<AuthClient>;
}

/// `{ stream }` — a socket factory, not the `{host, port, ssl}` the connector's
/// README describes. Spread into a `pg` config, which is why a config with no
/// hostname in it is correct.
export function cloudSqlOptions(instanceConnectionName: string): Promise<DriverOptions> {
  connector ??= new Connector({ auth: connectorAuth() });
  return connector.getOptions({ instanceConnectionName, ipType: IpAddressTypes.PUBLIC });
}

export function closeCloudSql() {
  connector?.close();
  connector = undefined;
}
