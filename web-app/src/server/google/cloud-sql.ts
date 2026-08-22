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
let connector: SqlConnector | undefined;

/// The connector nests google-auth-library v10 beside this project's v11, and
/// the two `GoogleAuth` classes are not assignable to one another — they brand
/// with different private fields. Same shape of problem as the Gen AI SDK's
/// `GoogleAuthOptions` (see `auth.ts`), and the same answer: the object is the
/// one both libraries actually accept at runtime, proven against the live
/// instance in infra §XVI.
function connectorAuth() {
  return googleAuth() as unknown as ConnectorGoogleAuth<AuthClient>;
}

/// The connector, injected the way `agent-runtime.ts` takes its transport and
/// the agents take `generateContent` (tech-spec §VII "Keep the seam"). A
/// module that constructs its own reaches the Admin API on its first
/// `getOptions()` to mint the instance's certs, so none of the three rules
/// below — one per process, public IP, closed on the way out — could be read
/// without a live instance, and none of them was read at all.
///
/// `Pick` rather than the class: `Connector` brands with private fields, so a
/// fake could not be assignable to it, and the two methods this module calls
/// are the whole of what it needs from one.
export type SqlConnector = Pick<Connector, "getOptions" | "close">;
export type ConnectorFactory = () => SqlConnector;

/// The auth is the point of the default, not decoration. Vercel has no metadata
/// server and no ambient ADC (infra §VI), so a connector left to find its own
/// credentials finds none and fails at the first query rather than at boot.
const dialingConnector: ConnectorFactory = () => new Connector({ auth: connectorAuth() });

/// `{ stream }` — a socket factory, not the `{host, port, ssl}` the connector's
/// README describes. Spread into a `pg` config, which is why a config with no
/// hostname in it is correct.
export function cloudSqlOptions(
  instanceConnectionName: string,
  make: ConnectorFactory = dialingConnector,
): Promise<DriverOptions> {
  connector ??= make();
  return connector.getOptions({ instanceConnectionName, ipType: IpAddressTypes.PUBLIC });
}

export function closeCloudSql() {
  connector?.close();
  connector = undefined;
}
