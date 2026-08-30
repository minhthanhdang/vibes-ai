import "server-only";
import {
  Connector,
  IpAddressTypes,
  type AuthClient,
  type DriverOptions,
  type GoogleAuth as ConnectorGoogleAuth,
} from "@google-cloud/cloud-sql-connector";
import { googleAuth } from "./auth";

let connector: SqlConnector | undefined;

function connectorAuth() {
  return googleAuth() as unknown as ConnectorGoogleAuth<AuthClient>;
}

export type SqlConnector = Pick<Connector, "getOptions" | "close">;
export type ConnectorFactory = () => SqlConnector;

const dialingConnector: ConnectorFactory = () => new Connector({ auth: connectorAuth() });

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
